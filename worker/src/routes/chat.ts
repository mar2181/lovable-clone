import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import {
  SCAFFOLD_PROMPT,
  ITERATION_PROMPT,
  ASK_PROMPT,
  RESEARCH_PROMPT,
  TASTE_RULES,
  STRATEGY_SOURCE_OF_TRUTH,
} from "../ai/system-prompt";
import { parseStreamToJSON } from "../ai/file-parser";
import { hasEnoughCredits, deductCredit } from "../services/credits";
import { replaceImagePlaceholders } from "../services/image-gen";
import { sanitizeGeneratedCode } from "../ai/code-sanitizer";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildTools } from "../ai/tools";
import { buildAttachmentPromptBlock, type AttachmentPromptEntry } from "../services/attachments";

// Inbound attachment shape from the chat composer. URLs are validated server-side
// against R2_PUBLIC_DOMAIN before being injected into the prompt — never trust
// arbitrary URLs from the client (an open-redirect-style prompt injection vector).
interface InboundAttachment {
  publicUrl: string;
  kind: "image" | "video";
  mimeType: string;
  filename: string;
}

function isAllowedAttachmentUrl(url: string, allowedDomain: string): boolean {
  if (!allowedDomain) return false;
  try {
    const u = new URL(url);
    const allowed = new URL(allowedDomain);
    // Require exact host match. Subdomain attacks (e.g. pub-xxx.r2.dev.evil.com)
    // would mismatch on host so this is safe.
    return u.protocol === "https:" && u.host === allowed.host;
  } catch {
    return false;
  }
}

// Models that we've confirmed handle OpenAI-style tool calls reliably via
// OpenRouter. Ask mode forces effectiveModel onto this list before passing
// `tools` to streamText so we don't silently land on a model that ignores
// them. Vision already auto-switches to gpt-4.1; this is the same idea for
// tool use.
const TOOL_CAPABLE_MODELS = new Set<string>([
  "openai/gpt-4.1",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4",
  "anthropic/claude-opus-4",
]);
const ASK_TOOL_FALLBACK_MODEL = "openai/gpt-4.1";

// Research mode runs the Outlier Engine workflow: ~20 tool calls, long reasoning
// between them. Claude Sonnet is the best balance of tool-use reliability and
// long-context coherence at our budget — force it regardless of the user's
// dropdown pick. (Kimi K2.6 in particular cannot drive this workflow.)
const RESEARCH_FORCED_MODEL = "anthropic/claude-sonnet-4";

// Step cap. Build/Ask use a tight cap so a runaway prompt can't drain Tavily
// or Firecrawl credit. Research mode legitimately needs many more steps —
// the workflow does ~8 web_search + ~12 web_scrape + reasoning steps.
const STEP_CAP_DEFAULT = 5;
const STEP_CAP_RESEARCH = 30;

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
    const {
      prompt,
      model = "moonshotai/kimi-k2.6",
      contextFiles,
      imageBase64,
      imagesBase64,
      attachments: rawAttachments,
      mode: rawMode,
    } = body;
    // Support both multi-image array (imagesBase64) and legacy single (imageBase64)
    const imageList: string[] = imagesBase64 && Array.isArray(imagesBase64)
      ? imagesBase64.slice(0, 10) // cap at 10
      : imageBase64 ? [imageBase64] : [];
    // Mode discriminator on the chat request.
    //   "ask"      — conversational, no file writes, prose response. Tools enabled.
    //   "build"    — default. Generates files. JSON envelope. Tools optional (model-gated).
    //   "research" — runs the Outlier Engine workflow. Tools always on, step cap raised,
    //                model forced to Claude Sonnet. Produces /src/pages/Strategy.tsx +
    //                a strategy_digest field that gets stashed to KV.
    const mode: "ask" | "build" | "research" =
      rawMode === "ask" ? "ask" : rawMode === "research" ? "research" : "build";

    // Validate inbound R2-hosted attachments. We only trust URLs on the configured
    // R2 public domain — anything else is dropped to prevent the model from being
    // tricked into embedding attacker-controlled URLs. The vision-side imagesBase64
    // path is separate and unaffected.
    const inboundAttachments: InboundAttachment[] = Array.isArray(rawAttachments)
      ? rawAttachments.slice(0, 10).filter(
          (a: any): a is InboundAttachment =>
            a &&
            typeof a.publicUrl === "string" &&
            (a.kind === "image" || a.kind === "video") &&
            typeof a.mimeType === "string" &&
            typeof a.filename === "string" &&
            isAllowedAttachmentUrl(a.publicUrl, c.env.R2_PUBLIC_DOMAIN),
        )
      : [];
    if (Array.isArray(rawAttachments) && rawAttachments.length !== inboundAttachments.length) {
      console.warn(
        `[Chat] Dropped ${rawAttachments.length - inboundAttachments.length} attachment(s) — failed URL/shape validation`,
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

    // 3.6 Load taste + strategy state.
    //   - taste_enabled: per-project flag for the design-taste layer. Default ON
    //     (treat null and "true" the same; only "false" disables it).
    //   - strategy_digest: 3–5 KB executive summary written by a prior research-mode
    //     run. When present, it gets prepended to BUILD prompts as the
    //     source-of-truth block so the model can never drift from the researched plan.
    const tasteEnabledStr = await kv.get(`project:${projectId}:taste_enabled`);
    const tasteEnabled = tasteEnabledStr !== "false";
    const strategyDigest = (await kv.get(`project:${projectId}:strategy_digest`)) || "";

    // 4. Initialize OpenRouter (OpenAI-compatible API)
    const openrouter = createOpenAI({
      apiKey: c.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    // If user attached an image, force a vision-capable model.
    // Must stay in sync with VISION_MODEL in lib/models.ts so the dropdown
    // doesn't lie to the user about which model handled their request.
    const VISION_MODEL = "openai/gpt-4.1";
    let effectiveModel = imageList.length > 0 ? VISION_MODEL : model;

    if (imageList.length > 0 && model !== VISION_MODEL) {
      console.log(`${imageList.length} image(s) attached - auto-switching from ${model} to ${VISION_MODEL} for vision support`);
    }

    // Ask mode wants real tool calls (web_search, web_fetch, web_scrape). If
    // the user picked a model we haven't confirmed supports tool use, fall
    // back to a known-good one — Ask without tools is useless.
    // Build mode also supports tools now, but we DO NOT auto-switch the
    // model: code-generation strength matters more than tool support there.
    // If the user wants to scrape during Build, they pick a tool-capable
    // model from the dropdown; otherwise the worker silently skips tools.
    if (mode === "ask" && !TOOL_CAPABLE_MODELS.has(effectiveModel)) {
      console.log(`[Chat] Ask mode: model "${effectiveModel}" not in tool-capable allowlist — switching to ${ASK_TOOL_FALLBACK_MODEL}`);
      effectiveModel = ASK_TOOL_FALLBACK_MODEL;
    }

    // Research mode always forces a tool-capable, long-context model. The
    // Outlier Engine workflow is tool-heavy (8+ web_search calls, 12+ scrapes,
    // reasoning steps between them) and the user's dropdown pick is irrelevant
    // here — we need Claude Sonnet specifically for this turn.
    if (mode === "research") {
      if (effectiveModel !== RESEARCH_FORCED_MODEL) {
        console.log(`[Chat] Research mode: forcing model "${effectiveModel}" → ${RESEARCH_FORCED_MODEL}`);
        effectiveModel = RESEARCH_FORCED_MODEL;
      }
    }

    // Model ID comes from frontend (or auto-switched for vision/tools)
    const aiModel = openrouter(effectiveModel);

    // 5. Pick the system prompt. ASK and RESEARCH short-circuit the
    // SCAFFOLD/ITERATION selection — they each have a dedicated prompt.
    const basePrompt =
      mode === "ask"
        ? ASK_PROMPT
        : mode === "research"
          ? RESEARCH_PROMPT
          : isFirstPrompt
            ? SCAFFOLD_PROMPT
            : ITERATION_PROMPT;
    console.log(
      `[Chat] project=${projectId} requestMode=${mode} buildMode=${isFirstPrompt ? "SCAFFOLD" : "ITERATION"} latest_version=${latestVersionStr || "(none)"} taste=${tasteEnabled ? "on" : "off"} strategy=${strategyDigest ? "present" : "none"}`,
    );

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

    // The "Reply ONLY in valid JSON" trailer applies to BUILD mode only.
    // In ASK mode the model must respond in prose — JSON envelopes are wrong.
    const jsonTrailer =
      mode === "ask"
        ? ""
        : "\n      Remember: Reply ONLY in valid JSON. No markdown ticks, no extra text.\n    ";

    // User-uploaded media (real estate agent photo, product shot, etc.) — these
    // are hosted at R2 public URLs and the model MUST embed them verbatim. The
    // helper produces the strong, opinionated block already in the codebase.
    const attachmentPromptEntries: AttachmentPromptEntry[] = inboundAttachments.map((a) => ({
      kind: a.kind,
      mimeType: a.mimeType,
      filename: a.filename,
      publicUrl: a.publicUrl,
    }));
    const attachmentBlock =
      attachmentPromptEntries.length > 0
        ? `\n# USER ATTACHMENTS — EMBED THESE EXACT URLS\n${buildAttachmentPromptBlock(attachmentPromptEntries)}\n`
        : "";

    // Taste rules apply to BUILD mode only. ASK is conversational (no code) so
    // the design-taste rules are noise there. RESEARCH already bakes its own
    // workflow into its prompt and shouldn't be biased by taste rules — the
    // researched data is the source of truth, not the taste defaults.
    const tasteBlock =
      mode === "build" && tasteEnabled ? `\n${TASTE_RULES}\n` : "";

    // Strategy source-of-truth: prepend the digest to BUILD prompts when a
    // prior research run wrote one. Honors the digest on every subsequent edit
    // without the user having to remind the pet.
    const strategyBlock =
      mode === "build" && strategyDigest ? `\n${STRATEGY_SOURCE_OF_TRUTH(strategyDigest)}\n` : "";

    const fullSystemPrompt = `
      ${basePrompt}
      ${tasteBlock}
      ${strategyBlock}
      ${memoryBlock}
      ${historyBlock}
      ${attachmentBlock}
      ${contextBlock}${jsonTrailer}`;

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

        // Tool gating:
        //   - ASK / RESEARCH always get tools (their system prompts depend on them).
        //   - BUILD gets tools only when the user's chosen model is in the
        //     tool-capable allowlist — picking a code-strong-but-no-tools model
        //     (e.g. Kimi K2.6) still works exactly as before.
        const toolsEnabled =
          mode === "ask" ||
          mode === "research" ||
          TOOL_CAPABLE_MODELS.has(effectiveModel);
        const tools = toolsEnabled ? buildTools(c.env) : undefined;
        const stepCap = mode === "research" ? STEP_CAP_RESEARCH : STEP_CAP_DEFAULT;
        const result = await streamText({
          model: aiModel,
          system: fullSystemPrompt,
          messages: [{ role: "user", content: userContent }],
          ...(tools ? { tools, stopWhen: stepCountIs(stepCap) } : {}),
        });

        let fullContent = "";

        // Stream events to the client. We use fullStream (not textStream) so we
        // can also surface tool-call heartbeats — research mode in particular
        // can run for 3+ minutes between text deltas, and a silent stream looks
        // like a hang. text-delta parts still accumulate into fullContent for
        // the JSON parse downstream; tool-call/tool-result parts emit as
        // separate SSE chunks (decorative — frontend renders them in the bubble
        // but they are NOT part of fullContent so they don't break JSON parsing).
        const truncate = (s: string, n: number) =>
          s.length > n ? s.slice(0, n) + "…" : s;
        for await (const part of result.fullStream) {
          const partType = (part as any).type;
          if (partType === "text-delta") {
            // AI SDK v6 exposes the delta on `.text` (older versions used `.textDelta`).
            const text = (part as any).text ?? (part as any).textDelta ?? "";
            if (!text) continue;
            fullContent += text;
            await stream.writeSSE({
              data: JSON.stringify({ type: "chunk", content: text }),
              event: "message",
            });
          } else if (partType === "tool-call") {
            const toolName = (part as any).toolName ?? "tool";
            const input = (part as any).input ?? (part as any).args ?? {};
            const icon = toolName === "web_search" ? "🔎" : toolName === "web_scrape" ? "📄" : "🛠";
            const arg =
              (input && (input.query || input.url)) ||
              JSON.stringify(input).slice(0, 80);
            const heartbeat = `\n${icon} ${toolName}(${truncate(String(arg), 80)})…\n`;
            await stream.writeSSE({
              data: JSON.stringify({ type: "tool", content: heartbeat, toolName }),
              event: "message",
            });
          } else if (partType === "tool-result") {
            // Optional: a brief ack so the user knows the call finished.
            const toolName = (part as any).toolName ?? "tool";
            await stream.writeSSE({
              data: JSON.stringify({ type: "tool", content: `✓ ${toolName} returned\n`, toolName }),
              event: "message",
            });
          } else if (partType === "error") {
            // Let the outer try/catch surface this — re-throw via the stream.
            const err = (part as any).error;
            throw err instanceof Error ? err : new Error(String(err));
          }
          // Ignore other part types (start-step, finish-step, finish, etc.)
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

        // 6.6 ASK MODE — short-circuit: no JSON parse, no version write, no
        // file mutation. The streamed text is the entire response. Save a
        // chat-history summary, deduct the credit, and emit `done` with the
        // model's prose as `aiMessage` so the UI can display it cleanly.
        if (mode === "ask") {
          // Trim chat history bookkeeping (still useful for context next turn).
          const promptSummary = prompt.length > 200 ? prompt.slice(0, 200) + "..." : prompt;
          const askSummary = fullContent.length > 200 ? fullContent.slice(0, 200) + "..." : fullContent;
          chatHistory.push({ role: "user", summary: `[ask] ${promptSummary}` });
          chatHistory.push({ role: "assistant", summary: `[ask] ${askSummary}` });
          const trimmedHistory = chatHistory.slice(-10);
          await kv.put(`project:${projectId}:chat_history`, JSON.stringify(trimmedHistory));

          await deductCredit(userId, 1, kv);

          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              mode: "ask",
              aiMessage: fullContent,
              // No files mutation in ask mode — echo back the current context
              // so the UI's "files changed" diff comes up clean (0 added/0 modified).
              files: contextFiles,
              dependencies: {},
            }),
            event: "message",
          });
          return;
        }

        // 7. Parse final completed JSON
        const modifiedFiles = parseStreamToJSON(fullContent);

        // 7.1 Research mode: pull the top-level strategy_digest field out of
        // the envelope and stash it to KV. Subsequent BUILD turns inject this
        // back into the system prompt as STRATEGY SOURCE-OF-TRUTH so the
        // model can't drift from the researched plan. Failure to find a digest
        // is non-fatal — we still ship the /src/pages/Strategy.tsx file the
        // model produced, but downstream BUILD turns won't have the digest
        // shortcut (they'd have to re-read the full Strategy.tsx every time).
        let researchDigestSaved = false;
        if (mode === "research" && modifiedFiles) {
          const rawDigest = (modifiedFiles as any).strategy_digest;
          if (typeof rawDigest === "string" && rawDigest.trim().length > 0) {
            const digest = rawDigest.trim().slice(0, 8 * 1024); // hard 8 KB cap
            await kv.put(`project:${projectId}:strategy_digest`, digest);
            researchDigestSaved = true;
            console.log(`[Chat] research mode: saved strategy_digest (${digest.length} bytes) for project=${projectId}`);
          } else {
            console.warn(`[Chat] research mode: no strategy_digest in envelope — skipping KV write`);
          }
        }

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

        // 11. Send Completion Event.
        //
        //   strategyGateAvailable — true when this was the FIRST successful
        //   build for the project (SCAFFOLD) AND no prior research has been
        //   run. The frontend reads this flag and renders the inline "Run
        //   strategy first?" gate inside the first assistant bubble.
        //
        //   strategyDocExists — true whenever the project has a strategy_digest
        //   in KV. The frontend uses this to gate the 📋 Strategy header pill.
        //   After a research turn, the just-written digest counts.
        const strategyGateAvailable =
          mode === "build" && isFirstPrompt && !strategyDigest;
        const strategyDocExists = Boolean(strategyDigest) || researchDigestSaved;
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            version: newVersionNum,
            files: mergedFiles,
            dependencies: modifiedFiles.dependencies,
            mode,
            strategyGateAvailable,
            strategyDocExists,
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
