/**
 * Build orchestrator — the Ralph Loop engine.
 *
 * Takes a BuildPlan, splits pages into batches, and generates each batch
 * by calling the AI with accumulated context. Streams progress via SSE.
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { buildBatchSystemPrompt } from "../ai/multi-page-prompt";
import { parseStreamToJSON } from "../ai/file-parser";
import { sanitizeGeneratedCode } from "../ai/code-sanitizer";
import { replaceImagePlaceholders } from "./image-gen";
import {
  BuildPlan,
  BuildManifest,
  PageSpec,
  BuildEvent,
} from "../ai/build-types";

const BATCH_SIZE = 3; // pages per batch

/**
 * Split pages into batches of BATCH_SIZE.
 * First batch always includes shared component pages if they exist.
 */
export function createBatches(pages: PageSpec[]): PageSpec[][] {
  const batches: PageSpec[][] = [];
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    batches.push(pages.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

/**
 * Create the initial build manifest from a plan.
 */
export function createManifest(plan: BuildPlan, existingFiles: Record<string, string> = {}): BuildManifest {
  const batches = createBatches(plan.pages);

  return {
    plan,
    files: { ...existingFiles },
    dependencies: {},
    completedPages: [],
    currentBatch: 0,
    totalBatches: batches.length,
    batches,
  };
}

/**
 * Build the user message for a specific batch.
 * Contains: the build plan summary, which pages to build, relevant content, and existing files.
 */
function buildBatchUserMessage(
  manifest: BuildManifest,
  batch: PageSpec[],
  batchIndex: number,
): string {
  const { plan } = manifest;
  const isFirstBatch = batchIndex === 0;

  // Content snippets for the pages in this batch
  const contentSnippets: Record<string, any> = {};
  if (plan.contentFiles) {
    for (const page of batch) {
      const contentRef = page.contentRef || page.slug;
      // Try to find content for both en and es
      for (const lang of Object.keys(plan.contentFiles)) {
        const langContent = plan.contentFiles[lang];
        if (langContent && langContent[contentRef]) {
          if (!contentSnippets[lang]) contentSnippets[lang] = {};
          contentSnippets[lang][contentRef] = langContent[contentRef];
        }
        // Also try top-level keys that might match
        if (langContent) {
          for (const [key, val] of Object.entries(langContent)) {
            if (typeof val === "object" && val !== null && !contentSnippets[lang]?.[key]) {
              // Include top-level sections that might be relevant
            }
          }
        }
      }
    }

    // If we didn't find page-specific content, include the full content files
    if (Object.keys(contentSnippets).length === 0 && plan.contentFiles) {
      for (const [lang, content] of Object.entries(plan.contentFiles)) {
        if (content && typeof content === "object") {
          contentSnippets[lang] = content;
        }
      }
    }
  }

  // Existing files context — only send relevant ones
  const relevantFiles: Record<string, string> = {};

  if (!isFirstBatch) {
    // Send shared components, router, and design system files
    for (const [path, content] of Object.entries(manifest.files)) {
      if (
        path.includes("/components/Header") ||
        path.includes("/components/Footer") ||
        path.includes("/components/LanguageToggle") ||
        path === "/src/App.tsx" ||
        path.includes("/lib/constants") ||
        path.includes("/lib/design") ||
        path.includes("/components/Layout")
      ) {
        relevantFiles[path] = content;
      }
      // Also send pages from the same section if applicable
      for (const page of batch) {
        const sectionPrefix = page.slug.split("-")[0];
        if (path.includes("/pages/") && path.toLowerCase().includes(sectionPrefix)) {
          relevantFiles[path] = content;
        }
      }
    }
  }

  // Build the pages to generate section
  const pagesToBuild = batch.map((p) => ({
    name: p.name,
    slug: p.slug,
    sections: p.sections.map((s) => s.name),
    contentRef: p.contentRef || p.slug,
  }));

  const message = [
    `# BUILD PLAN`,
    `Business: ${plan.businessName} (${plan.businessType})`,
    `Description: ${plan.description}`,
    plan.bilingual ? `Bilingual: YES (${plan.defaultLanguage || "en"} default)` : "",
    plan.globalInstructions ? `Instructions: ${plan.globalInstructions}` : "",
    ``,
    `# DESIGN SYSTEM`,
    JSON.stringify(plan.designSystem, null, 2),
    ``,
    `# SHARED COMPONENTS`,
    JSON.stringify(plan.sharedComponents, null, 2),
    ``,
    `# ALL PAGES IN PROJECT`,
    plan.pages.map((p) => `- ${p.name} (/${p.slug}) [${p.status || "pending"}]`).join("\n"),
    ``,
    `# PAGES TO BUILD IN THIS BATCH (${batchIndex + 1}/${manifest.totalBatches})`,
    JSON.stringify(pagesToBuild, null, 2),
    ``,
    contentSnippets && Object.keys(contentSnippets).length > 0
      ? `# CONTENT\n${JSON.stringify(contentSnippets, null, 2)}`
      : "",
    ``,
    Object.keys(relevantFiles).length > 0
      ? `# EXISTING FILES (do not modify unless updating App.tsx routes)\n${JSON.stringify(relevantFiles, null, 2)}`
      : isFirstBatch
        ? `# EXISTING FILES\n(none — this is the first batch, create everything from scratch)`
        : "",
    ``,
    isFirstBatch
      ? `Generate the foundation: App.tsx with router, shared components (Header, Footer${plan.bilingual ? ", LanguageToggle" : ""}), constants, and the pages listed above.`
      : `Generate the new page files and update App.tsx to add their routes. Do NOT modify existing shared components or pages.`,
  ]
    .filter(Boolean)
    .join("\n");

  return message;
}

/**
 * Generate a single batch of pages using the AI.
 *
 * @returns Updated manifest with new files merged in.
 */
export async function generateBatch(
  manifest: BuildManifest,
  batchIndex: number,
  apiKeys: { openrouter?: string; openai?: string; anthropic?: string },
  modelId: string,
  falKey: string,
  onEvent: (event: BuildEvent) => Promise<void>,
  assetOptions?: { r2: R2Bucket; projectId: string; publicBaseUrl: string },
): Promise<BuildManifest> {
  const batch = manifest.batches[batchIndex];
  if (!batch) {
    throw new Error(`Batch ${batchIndex} does not exist`);
  }

  const isFirstBatch = batchIndex === 0;
  const pageNames = batch.map((p) => p.name);

  // Notify: batch starting
  await onEvent({
    type: "batch_start",
    batchIndex,
    totalBatches: manifest.totalBatches,
    pages: pageNames,
  });

  // Mark pages as generating
  for (const page of batch) {
    page.status = "generating";
    await onEvent({ type: "page_status", page: page.name, status: "generating" });
  }

  // Build prompts
  const systemPrompt = buildBatchSystemPrompt(isFirstBatch, batchIndex, manifest.totalBatches);
  const userMessage = buildBatchUserMessage(manifest, batch, batchIndex);

  // Call AI
  const useDirectOpenAI = modelId.startsWith("openai:");
  const useAnthropic = modelId.startsWith("anthropic:");
  const resolvedModelId = useDirectOpenAI
    ? modelId.replace(/^openai:/, "")
    : useAnthropic
      ? modelId.replace(/^anthropic:/, "")
      : modelId;

  const aiModel = useDirectOpenAI
    ? createOpenAI({ apiKey: apiKeys.openai })(resolvedModelId)
    : useAnthropic
      ? createAnthropic({ apiKey: apiKeys.anthropic })(resolvedModelId)
      : createOpenAI({
          apiKey: apiKeys.openrouter,
          baseURL: "https://openrouter.ai/api/v1",
        })(resolvedModelId);

  const result = await generateText({
    model: aiModel,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const fullContent = result.text || "";
  if (fullContent) {
    await onEvent({ type: "batch_stream", content: fullContent });
  }

  // Parse the AI output
  const parsed = parseStreamToJSON(fullContent);

  if (!parsed || !parsed.files || Object.keys(parsed.files).length === 0) {
    // Mark pages as error
    for (const page of batch) {
      page.status = "error";
      await onEvent({ type: "page_status", page: page.name, status: "error" });
    }
    await onEvent({
      type: "error",
      error: `Batch ${batchIndex + 1}: AI returned no files`,
      batchIndex,
    });
    return manifest;
  }

  // Sanitize
  let newFiles = sanitizeGeneratedCode(parsed.files);

  // Merge into manifest
  manifest.files = { ...manifest.files, ...newFiles };

  // Merge dependencies
  if (parsed.dependencies) {
    manifest.dependencies = { ...manifest.dependencies, ...parsed.dependencies };
  }

  // Generate images
  try {
    manifest.files = await replaceImagePlaceholders(manifest.files, falKey, assetOptions);
  } catch (err) {
    console.error("Image generation failed (continuing):", err);
  }

  // Mark pages as done
  for (const page of batch) {
    page.status = "done";
    manifest.completedPages.push(page.name);
    await onEvent({ type: "page_status", page: page.name, status: "done" });
  }

  // Notify: batch complete
  await onEvent({
    type: "batch_done",
    batchIndex,
    files: manifest.files,
  });

  return manifest;
}
