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
    const { prompt, model = "moonshotai/kimi-k2", contextFiles, imageBase64 } = body;

    // 3. Verify project exists
    const projectExists = await kv.get(`user:${userId}:project:${projectId}`);
    if (!projectExists) return c.json({ error: "Project not found" }, 404);

    // 3.5 Load project memory and chat history
    const projectMemory = await kv.get(`project:${projectId}:memory`) || "";
    const chatHistoryStr = await kv.get(`project:${projectId}:chat_history`);
    const chatHistory: Array<{ role: string; summary: string }> = chatHistoryStr ? JSON.parse(chatHistoryStr) : [];

    // 4. Initialize OpenRouter (OpenAI-compatible API)
    const openrouter = createOpenAI({
      apiKey: c.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    // If user attached an image, force a vision-capable model
    const VISION_MODEL = "openai/gpt-4.1";
    const effectiveModel = imageBase64 ? VISION_MODEL : model;
    
    if (imageBase64 && model !== VISION_MODEL) {
      console.log(`Image attached — auto-switching from ${model} to ${VISION_MODEL} for vision support`);
    }

    // Model ID comes from frontend (or auto-switched for vision)
    const aiModel = openrouter(effectiveModel);

    // 5. Detect first prompt vs iteration
    const hasExistingFiles = contextFiles && Object.keys(contextFiles).length > 0;
    const basePrompt = hasExistingFiles ? ITERATION_PROMPT : SCAFFOLD_PROMPT;

    // 5.1 Construct full system prompt with memory, history, and context
    const memoryBlock = projectMemory
      ? `\n# PROJECT MEMORY (IMPORTANT — read this before doing anything)\nThe user has defined the following context for this project. ALWAYS respect this:\n${projectMemory}\n`
      : "";

    const historyBlock = chatHistory.length > 0
      ? `\n# RECENT CONVERSATION HISTORY (last ${chatHistory.length} exchanges)\nThis is what has been discussed/built recently. Use this to stay consistent:\n${chatHistory.map((h, i) => `${i + 1}. [${h.role}]: ${h.summary}`).join("\n")}\n`
      : "";

    const contextBlock = hasExistingFiles
      ? `\nCURRENT PROJECT FILES (Do not modify unless requested by the user's prompt):\n${JSON.stringify(contextFiles, null, 2)}\n`
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
        if (imageBase64) {
          // AI SDK v6 rejects data: URLs (only accepts http/https or binary). Decode base64 to Uint8Array.
          const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
          const binary = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0));
          userContent.push({ type: "image", image: binary });
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

        // 7. Parse final completed JSON
        const modifiedFiles = parseStreamToJSON(fullContent);

        if (!modifiedFiles || !modifiedFiles.files || Object.keys(modifiedFiles.files).length === 0) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              files: contextFiles,
              dependencies: {},
            }),
            event: "message",
          });
          return;
        }

        // 8. Sanitize AI-generated code (fix bad icon imports, etc.)
        const sanitizedFiles = sanitizeGeneratedCode(modifiedFiles.files);

        // 8.1 Merge files with context
        let mergedFiles = { ...contextFiles, ...sanitizedFiles };

        // 8.5 Generate AI images via fal.ai (replace FAL_IMAGE[] placeholders)
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: "chunk", content: "\n\n🎨 Generating AI images..." }),
            event: "message",
          });
          mergedFiles = await replaceImagePlaceholders(mergedFiles, c.env.FAL_KEY);
        } catch (imgErr) {
          console.error("Image generation failed (continuing without images):", imgErr);
        }

        // 9. Create new Version
        const latestVersionStr = await kv.get(`project:${projectId}:latest_version`);
        const newVersionNum = parseInt(latestVersionStr || "1") + 1;

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
