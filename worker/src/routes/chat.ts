import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { SCAFFOLD_PROMPT, ITERATION_PROMPT } from "../ai/system-prompt";
import { parseStreamToJSON } from "../ai/file-parser";
import { hasEnoughCredits, deductCredit } from "../services/credits";
import { replaceImagePlaceholders } from "../services/image-gen";
import { sanitizeGeneratedCode } from "../ai/code-sanitizer";
import { buildAttachmentPromptBlock } from "../services/attachments";
import { AttachmentInput } from "../types/attachment";
import type { SupabaseLinkRecord, SupabaseSchemaRecord } from "../types/supabase";
import type { SelectionPayload } from "../types/selection";
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
  "/src/lib/supabase.ts",  // Supabase client — system-managed, never AI-edited
  "/src/__lovable_select_runtime.ts",  // Selection runtime — system-managed, never AI-edited
]);

const SHADCN_PREFIX = "/src/components/ui/";

function buildSupabaseLib(link: SupabaseLinkRecord): string {
  return `// /src/lib/supabase.ts
// SYSTEM-MANAGED FILE — DO NOT EDIT.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '${link.restUrl}';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '${link.anonKey}';

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
`;
}

function validateSelection(s: unknown): SelectionPayload | null {
  if (!s || typeof s !== "object") return null;
  const sel = s as Record<string, unknown>;
  if (typeof sel.id !== "string") return null;
  if (typeof sel.tag !== "string") return null;
  if (typeof sel.text !== "string") return null;
  if (typeof sel.selectorPath !== "string" || sel.selectorPath.length > 500) return null;
  if (typeof sel.outerHTML !== "string" || sel.outerHTML.length > 4000) return null;
  if (typeof sel.ancestorContext !== "string") return null;
  if (!sel.attributes || typeof sel.attributes !== "object") return null;
  if (!sel.computedStyles || typeof sel.computedStyles !== "object") return null;
  if (!sel.bbox || typeof sel.bbox !== "object") return null;
  return s as SelectionPayload;
}

function buildSelectionBlock(selection: SelectionPayload): string {
  return `
## User Selection

The user pointed at this specific element in the live preview. Their next message is about THIS element only — apply edits narrowly. If they ask a question, answer about this element.

**Element:** ${selection.outerHTML}
**Tag:** ${selection.tag}
**Text:** ${selection.text || "(empty)"}
**CSS selector path:** ${selection.selectorPath}
**Attributes:** ${JSON.stringify(selection.attributes)}
**Computed styles:** ${JSON.stringify(selection.computedStyles)}
**Ancestor context:** ${selection.ancestorContext}

To edit it: search the project files for the matching JSX. Use the text content first ("${selection.text}") to narrow candidates, then the tag + className to disambiguate. If multiple matches remain, prefer the one whose ancestor context matches. If you cannot confidently identify exactly one source location, ASK before editing.
`;
}

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
    const {
      prompt,
      model = "moonshotai/kimi-k2.6",
      contextFiles,
      imageBase64,
      attachments,
      selection,
    } = body;

    // 2.5 Validate selection if present
    let selectionBlock = "";
    if (selection !== undefined && selection !== null) {
      const validated = validateSelection(selection);
      if (!validated) {
        return c.json({ error: "Selection too large or malformed — try a smaller element." }, 400);
      }
      selectionBlock = buildSelectionBlock(validated);
      console.log(
        `[chat] selection projectId=${projectId} tag=${validated.tag} textLen=${validated.text.length} htmlLen=${validated.outerHTML.length} selectorLen=${validated.selectorPath.length}`,
      );
    }

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

    // If user attached an image (legacy or new), force a vision-capable model.
    // Must stay in sync with VISION_MODEL in lib/models.ts so the dropdown
    // doesn't lie to the user about which model handled their request.
    // Must stay in sync with VISION_MODEL in lib/models.ts — both must be a
    // vision-capable model that actually exists on OpenRouter.
    const VISION_MODEL = "google/gemini-3.1-flash-lite";
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const hasImageAttachments =
      hasAttachments && attachments.some((a: AttachmentInput) => a.kind === "image");
    // Videos-only does NOT trigger auto-switch (hasOnlyVideoAttachments case).
    let effectiveModel = model;
    if (imageBase64 || hasImageAttachments) {
      effectiveModel = VISION_MODEL;
      if (model !== VISION_MODEL) {
        console.log(
          `Image attached - auto-switching from ${model} to ${VISION_MODEL} for vision support`,
        );
      }
    }

    // Model ID comes from frontend (or auto-switched for vision)
    const aiModel = openrouter(effectiveModel);

    // 5. Pick the system prompt based on first-prompt detection (server-side,
    // not based on whatever context the client claims).
    const basePrompt = isFirstPrompt ? SCAFFOLD_PROMPT : ITERATION_PROMPT;
    console.log(`[Chat] project=${projectId} mode=${isFirstPrompt ? "SCAFFOLD" : "ITERATION"} latest_version=${latestVersionStr || "(none)"}`);

    // 5.1 Load Supabase link + schema (if this project is connected)
    const supabaseLinkRaw = await kv.get(`project:${projectId}:supabase`);
    const supabaseLink: SupabaseLinkRecord | null = supabaseLinkRaw ? JSON.parse(supabaseLinkRaw) : null;
    const supabaseSchemaRaw = supabaseLink ? await kv.get(`project:${projectId}:supabase_schema`) : null;
    const supabaseSchema: SupabaseSchemaRecord | null = supabaseSchemaRaw ? JSON.parse(supabaseSchemaRaw) : null;

    // 5.2 Construct full system prompt with memory, history, and context
    const memoryBlock = projectMemory
      ? `\n# PROJECT MEMORY (IMPORTANT - read this before doing anything)\nThe user has defined the following context for this project. ALWAYS respect this:\n${projectMemory}\n`
      : "";

    const historyBlock = chatHistory.length > 0
      ? `\n# RECENT CONVERSATION HISTORY (last ${chatHistory.length} exchanges)\nThis is what has been discussed/built recently. Use this to stay consistent:\n${chatHistory.map((h, i) => `${i + 1}. [${h.role}]: ${h.summary}`).join("\n")}\n`
      : "";

    // Build Supabase Block for the AI prompt (only if linked)
    let supabaseBlock = "";
    if (supabaseLink) {
      const tablesMd = supabaseSchema?.tables?.map((t) => {
        const cols = t.columns.map((c) =>
          `  - ${c.name} (${c.type}${c.nullable ? "" : " NOT NULL"}${c.default !== null ? ` DEFAULT ${c.default}` : ""})`
        ).join("\n");
        const policies = t.policies?.length
          ? `  Policies: ${t.policies.map((p) => `${p.name} (${p.command})[${p.roles.join(",")}]`).join(", ")}\n`
          : "";
        return `### ${t.name}${t.rlsEnabled ? " (RLS ON)" : " (RLS OFF ⚠️)"}\n${policies}${cols}`;
      }).join("\n\n") || "(no tables found in public schema)";

      supabaseBlock = `
# SUPABASE BACKEND IS CONNECTED

This project is linked to a real Supabase project. You can use it for auth, database, storage, and realtime.

Project ref: ${supabaseLink.ref}
REST URL: ${supabaseLink.restUrl}
Anon key (public, safe to commit): ${supabaseLink.anonKey}

## Current schema

${tablesMd}

## How to use Supabase in generated code

- Import the client: \`import { supabase } from './lib/supabase'\`
- Do NOT create a new Supabase client anywhere. The shared instance is provided.
- Do NOT modify \`/src/lib/supabase.ts\` — it is system-managed.
- For any data the user wants to persist, use the schema above. If a needed table doesn't exist, propose a migration (see below).
- For auth, use \`supabase.auth.signUp\`, \`signInWithPassword\`, \`signInWithOAuth\`, \`signOut\`. Wrap in error handling.
- For storage, use \`supabase.storage.from(bucket)\`.

## Proposing migrations

If the user's request requires schema changes, return a \`migration\` object alongside \`files\` in your JSON response:

\`\`\`json
{
  "files": { "/src/components/SignupForm.tsx": "..." },
  "migration": {
    "description": "Create leads table with email + name, RLS enabled, anon insert allowed.",
    "sql": "CREATE TABLE leads (...);\\nALTER TABLE leads ENABLE ROW LEVEL SECURITY;\\nCREATE POLICY \\"anon_can_insert\\" ON leads FOR INSERT TO anon WITH CHECK (true);"
  },
  "dependencies": {}
}
\`\`\`

Migration rules:
- ALWAYS enable RLS on new tables.
- ALWAYS include at least one policy. Default to anon insert-only for lead-capture, authenticated read/write for app data.
- Prefer additive changes. Avoid DROP unless explicitly asked.
- Never reference tables that don't exist in the schema above and weren't created in this migration.
- The user reviews and approves migrations before they run; you don't have to be conservative, just be correct.
`;
    }

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
      ${supabaseBlock}
      ${selectionBlock}
      ${memoryBlock}
      ${historyBlock}
      ${contextBlock}
      Remember: Reply ONLY in valid JSON. No markdown ticks, no extra text.
    `;

    // Build virtual lib/supabase.ts if linked (injected server-side, not in user files)
    const virtualSupabaseLib = supabaseLink ? buildSupabaseLib(supabaseLink) : null;

    // 6. Return Streaming Server-Sent Events (SSE) Response
    return streamSSE(c, async (stream) => {
      try {
        const userContent: any[] = [{ type: "text", text: prompt }];

        // ── New attachment pipeline (takes priority over legacy imageBase64) ────
        if (hasAttachments) {
          // Push image attachments as binary for vision models
          if (hasImageAttachments) {
            for (const att of attachments as AttachmentInput[]) {
              if (att.kind === "image") {
                try {
                  const r2obj = await r2.get(att.r2Key);
                  if (r2obj) {
                    const binary = new Uint8Array(await r2obj.arrayBuffer());
                    userContent.push({
                      type: "image" as const,
                      image: binary,
                      mimeType: att.mimeType as any,
                    });
                  }
                } catch (imgErr: any) {
                  console.warn(
                    `[Chat] Could not fetch image attachment ${att.id} from R2: ${imgErr?.message || "unknown"}`,
                  );
                }
              }
            }
          }

          // Build and inject the structured attachment text block for ALL attachments
          const promptBlock = buildAttachmentPromptBlock(
            (attachments as AttachmentInput[]).map((a) => ({
              kind: a.kind,
              mimeType: a.mimeType,
              filename: a.filename,
              publicUrl: a.url,
            })),
          );
          userContent.push({ type: "text", text: promptBlock });
        }

        // ── Legacy imageBase64 (backwards compat — only used when no attachments) ──
        if (imageBase64 && !hasAttachments) {
          // AI SDK v6 rejects data: URLs (only accepts http/https or binary). Decode base64 to Uint8Array.
          const mimeMatch = imageBase64.match(/^data:([^;]+);/);
          const mimeType = (mimeMatch ? mimeMatch[1] : "image/jpeg") as any;
          const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
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

        // Extract migration if the AI proposed one
        const aiMigration = (modifiedFiles && modifiedFiles.migration && typeof modifiedFiles.migration === "object"
          && typeof modifiedFiles.migration.description === "string"
          && typeof modifiedFiles.migration.sql === "string")
          ? { description: modifiedFiles.migration.description as string, sql: modifiedFiles.migration.sql as string }
          : null;

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

          // aiMessage: prefer the model's structured explanation; fall back to
          // the raw prose it returned (truncated). Used by the chat panel.
          let aiMessage: string | undefined;
          if (modifiedFiles && typeof modifiedFiles.noChangesReason === "string"
              && modifiedFiles.noChangesReason.trim()) {
            aiMessage = modifiedFiles.noChangesReason.trim();
          } else if (reason === "parse_failure" && fullContent.trim()) {
            aiMessage = fullContent.trim().slice(0, 400);
          }

          console.error(
            `[Chat] Empty files - reason=${reason} project=${projectId} model=${effectiveModel} mode=${isFirstPrompt ? "SCAFFOLD" : "ITERATION"} rawFirst500=${JSON.stringify(fullContent.slice(0, 500))}`
          );

          const donePayload: Record<string, unknown> = {
            type: "done",
            files: contextFiles,
            dependencies: {},
          };
          if (aiMessage) donePayload.aiMessage = aiMessage;
          if (aiMigration) (donePayload as any).migration = aiMigration;
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

        // 8.2 Inject virtual lib/supabase.ts if linked (so Sandpack can use it)
        if (virtualSupabaseLib) {
          mergedFiles["/src/lib/supabase.ts"] = virtualSupabaseLib;
        }

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
        const donePayload: Record<string, unknown> = {
          type: "done",
          version: newVersionNum,
          files: mergedFiles,
          dependencies: modifiedFiles.dependencies,
        };
        if (aiMigration) (donePayload as any).migration = aiMigration;
        await stream.writeSSE({
          data: JSON.stringify(donePayload),
          event: "message",
        });

      } catch (error: any) {
        console.error("Streaming error:", error);
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", error: error.message }),
          event: "error",
        });
      }
    });

  } catch (error) {
    console.error("Failed to start chat session:", error);
    return c.json({ error: "Failed to initialize AI session" }, 500);
  }
});

export default chatRouter;
