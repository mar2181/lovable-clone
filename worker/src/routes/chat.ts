import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { SCAFFOLD_PROMPT, ITERATION_PROMPT } from "../ai/system-prompt";
import { parseStreamToJSON } from "../ai/file-parser";
import { hasEnoughCredits, deductCredit } from "../services/credits";
import { replaceImagePlaceholders } from "../services/image-gen";
import { sanitizeGeneratedCode } from "../ai/code-sanitizer";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const chatRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

chatRouter.use("*", authMiddleware);

// System-managed file paths. These ship in defaultFiles when a project is
// created and should NOT be sent to the model as iteration context (the
// system prompt explicitly forbids the model from creating/modifying them).
const SYSTEM_MANAGED_PATHS = new Set<string>([
  "/src/index.tsx",
  "/src/main.tsx",
  "/src/index.ts",
  "/src/main.ts",
  "/src/styles.css",
  "/src/index.css",
  "/public/index.html",
  "/package.json",
]);

const SHADCN_PREFIX = "/src/components/ui/";

function stripSystemFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    if (SYSTEM_MANAGED_PATHS.has(k)) continue;
    if (k.startsWith(SHADCN_PREFIX)) continue;
    if (k.startsWith("/src/lib/utils.ts")) continue;
    out[k] = v;
  }
  return out;
}

chatRouter.post("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    // 1. Check Credits
    const { hasCredits } = await hasEnoughCredits(userId, kv);
    if (!hasCredits) {
      return c.json({ error: "Insufficient credits. Please upgrade to continue." }, 402);
    }

    // 2. Parse Request
    const body = await c.req.json();
    const { prompt, model = "moonshotai/kimi-k2.6", contextFiles, imageBase64, imagesBase64 } = body;
    // Support both multi-image array (imagesBase64) and legacy single (imageBase64)
    const imageList: string[] = imagesBase64 && Array.isArray(imagesBase64)
      ? imagesBase64.slice(0, 10) // cap at 10
      : imageBase64 ? [imageBase64] : [];

    // 3. Verify project exists
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // 3.1 Detect SCAFFOLD vs ITERATION mode using server-side state.
    // A brand-new project has latest_version === "1" (the "Initial Setup"
    // version written at project creation, which only contains system files).
    // Any successful AI generation bumps it to 2+. So:
    //   - latest_version null/1  -> first user prompt -> SCAFFOLD
    //   - latest_version >= 2    -> user has generated something -> ITERATION
    const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
    const latestVersion = parseInt(latestVersionStr || "1");
    const isFirstPrompt = !latestVersionStr || latestVersion < 2;

    // 3.5 Load project memory and chat history
    const projectMemory = await kv.get(`project:${projectId}:memory`) || "";
    const chatHistoryStr = await kv.get(`project:${projectId}:chat_history`);
    const chatHistory: Array<{ role: string; summary: string }> = chatHistoryStr ? JSON.parse(chatHistoryStr) : [];

    // 4. Initialize OpenRouter (OpenAI-compatible API)
    const openrouter = createOpenAI({
      apiKey: c.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    // If user attached an image, force a vision-capable model.
    // Must stay in sync with VISION_MODEL in lib/models.ts so the dropdown
    // doesn't lie to the user about which model handled their request.
    const VISION_MODEL = "openai/gpt-4.1";
    const effectiveModel = imageList.length > 0 ? VISION_MODEL : model;

    if (imageList.length > 0 && model !== VISION_MODEL) {
      console.log(`${imageList.length} image(s) attached - auto-switching from ${model} to ${VISION_MODEL} for vision support`);
    }

    // Model ID comes from frontend (or auto-switched for vision)
    const aiModel = openrouter(effectiveModel);

    // 5. Pick the system prompt based on first-prompt detection (server-side,
    // not based on whatever context the client claims).
    const basePrompt = isFirstPrompt ? SCAFFOLD_PROMPT : ITERATION_PROMPT;
    console.log(`[Chat] project=${projectId} mode=${isFirstPrompt ? "SCAFFOLD" : "ITERATION"} latest_version=${latestVersionStr || "(none)"}`);

    // 5.1 Construct full system prompt with memory, history, and context
    const memoryBlock = projectMemory
      ? `\n# PROJECT MEMORY (IMPORTANT - read this before doing anything)\nThe user has defined the following context for this project. ALWAYS respect this:\n${projectMemory}\n`
      : "";

    const historyBlock = chatHistory.length > 0
      ? `\n# RECENT CONVERSATION HISTORY (last ${chatHistory.length} exchanges)\nThis is what has been discussed/built recently. Use this to stay consistent:\n${chatHistory.map((h, i) => `${i + 1}. [${h.role}]: ${h.summary}`).join("\n")}\n`
      : "";

    // For ITERATION mode, send only the AI-authored files as context - never
    // the system-managed scaffolding (index.tsx, package.json, shadcn/ui, etc).
    // For SCAFFOLD mode, send no context block at all so the model treats this
    // as greenfield.
    const userFiles = !isFirstPrompt && contextFiles ? stripSystemFiles(contextFiles) : {};
    const contextBlock = !isFirstPrompt && Object.keys(userFiles).length > 0
      ? `\nCURRENT PROJECT FILES (Do not modify unless requested by the user's prompt):\n${JSON.stringify(userFiles, null, 2)}\n`
      : "";

    const fullSystemPrompt = `
      ${basePrompt}
      ${memoryBlock}
      ${historyBlock}
      ${contextBlock}
      Remember: Reply ONLY in valid JSON. No markdown ticks, no extra text.
    `;

    // 6. Return Streaming Server-Sent Events (SSE) Response
    return streamSSE(c, async (stream) => {
      try {
        const userContent: any[] = [{ type: "text", text: prompt }];
        // Attach all images (up to 10). AI SDK v6 requires Uint8Array + mimeType.
        for (const imgData of imageList) {
          const mimeMatch = imgData.match(/^data:([^;]+);/);
          const mimeType = (mimeMatch ? mimeMatch[1] : "image/jpeg") as any;
          const base64Data = imgData.includes(",") ? imgData.split(",")[1] : imgData;
          const binary = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0));
          userContent.push({ type: "image", image: binary, mimeType });
        }

        const result = await streamText({
          model: aiModel,
          system: fullSystemPrompt,
          messages: [{ role: "user", content: userContent }],
        });

        let fullContent = "";

        // Stream chunks to the client as they arrive
        for await (const textPart of result.textStream) {
          fullContent += textPart;
          await stream.writeSSE({
            data: JSON.stringify({ type: "chunk", content: textPart }),
            event: "message",
          });
        }

        // 6.5 Detect upstream model failure.
        // The AI SDK can silently yield an empty stream when OpenRouter rejects
        // the request (e.g. invalid model ID, auth failure, upstream 4xx) instead
        // of throwing. Treat an empty raw stream as a hard generation error so
        // the user sees a real message instead of a misleading "no files changed".
        if (!fullContent || fullContent.trim().length === 0) {
          console.error(`[Chat] Empty stream from model "${effectiveModel}" - likely invalid model ID or upstream rejection.`);
          await stream.writeSSE({
            data: JSON.stringify({
              type: "error",
              error: `model returned an empty response or invalid model ID (${effectiveModel}).`,
            }),
            event: "error",
          });
          return;
        }

        // 7. Parse final completed JSON
        const modifiedFiles = parseStreamToJSON(fullContent);

        if (!modifiedFiles || !modifiedFiles.files || Object.keys(modifiedFiles.files).length === 0) {
          // Three distinct upstream conditions land here. Classify and log them
          // so debugging in `wrangler dev` doesn't require a re-run, and surface
          // the model's own explanation to the user when one is available.
          //   1. Parse failure       — modifiedFiles === null (file-parser returned null)
          //   2. Structured no-op    — modifiedFiles.files === {} + optional noChangesReason
          //   3. Missing files key   — model returned JSON without a files property
          let reason: "parse_failure" | "structured_no_op" | "missing_files_key";
          if (modifiedFiles === null) reason = "parse_failure";
          else if (modifiedFiles.files === undefined) reason = "missing_files_key";
          else reason = "structured_no_op";

          let aiMessage: string | undefined;
          if (modifiedFiles && typeof modifiedFiles.noChangesReason === "string"
              && modifiedFiles.noChangesReason.trim()) {
            aiMessage = modifiedFiles.noChangesReason.trim();
          } else if (reason === "parse_failure" && fullContent.trim()) {
            aiMessage = fullContent.trim().slice(0, 400);
          }

          console.error(
            `[Chat] Empty files - reason=${reason} model=${effectiveModel} rawFirst500=${JSON.stringify(fullContent.slice(0, 500))}`
          );

          const donePayload: Record<string, unknown> = {
            type: "done",
            files: contextFiles,
            dependencies: {},
          };
          if (aiMessage) donePayload.aiMessage = aiMessage;
          await stream.writeSSE({
            data: JSON.stringify(donePayload),
            event: "message",
          });
          return;
        }

        // 8. Sanitize AI-generated code (fix bad icon imports, etc.)
        const sanitizedFiles = sanitizeGeneratedCode(modifiedFiles.files);

        // 8.1 Merge files with context (preserves system defaults + prior user files)
        let mergedFiles = { ...contextFiles, ...sanitizedFiles };

        // 8.5 Generate AI images via fal.ai (replace FAL_IMAGE[] placeholders)
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: "chunk", content: "\n\nGenerating AI images..." }),
            event: "message",
          });
          mergedFiles = await replaceImagePlaceholders(mergedFiles, c.env.FAL_KEY);
        } catch (imgErr) {
          console.error("Image generation failed (continuing without images):", imgErr);
        }

        // 9. Create new Version (reuse latestVersion read above)
        const newVersionNum = latestVersion + 1;

        const newVersionData = {
          version: newVersionNum,
          createdAt: new Date().toISOString(),
          prompt: prompt,
          files: mergedFiles
        };

        // Save to R2 & Update KV pointer
        await r2.put(`${projectId}/v${newVersionNum}.json`, JSON.stringify(newVersionData));
        await kv.put(`project:${projectId}:latest_version`, newVersionNum.toString());

        // 10. Save chat history (keep last 5 exchanges)
        const promptSummary = prompt.length > 200 ? prompt.slice(0, 200) + "..." : prompt;
        const fileNames = Object.keys(mergedFiles).filter(f => f.endsWith(".tsx") || f.endsWith(".jsx")).join(", ");
        const responseSummary = `Generated/updated files: ${fileNames}`;

        chatHistory.push({ role: "user", summary: promptSummary });
        chatHistory.push({ role: "assistant", summary: responseSummary });

        // Keep only last 10 entries (5 exchanges)
        const trimmedHistory = chatHistory.slice(-10);
        await kv.put(`project:${projectId}:chat_history`, JSON.stringify(trimmedHistory));

        // Auto-generate memory on first prompt if empty
        if (!projectMemory && prompt.length > 20) {
          const autoMemory = `Project created from prompt: "${promptSummary}"`;
          await kv.put(`project:${projectId}:memory`, autoMemory);
        }

        // 10.5 Deduct Credit
        await deductCredit(userId, 1, kv);

        // 11. Send Completion Event
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            version: newVersionNum,
            files: mergedFiles,
            dependencies: modifiedFiles.dependencies
          }),
          event: "message",
        });

      } catch (error: any) {
        console.error("[Chat] Stream error:", error);
        try {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "error",
              error: error.message || "An unexpected error occurred during generation.",
            }),
            event: "error",
          });
        } catch (_) {
          // stream may already be closed
        }
      }
    });
  } catch (error: any) {
    console.error("[Chat] Route error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default chatRouter;
