// Tool: send_message
import { z } from "zod";
import { client } from "../client.js";
import { config } from "../config.js";

export const sendMessageTool = {
  name: "send_message",
  description: "Send a prompt to a project. The AI generates/updates code based on your prompt. Supports optional image attachment (auto-switches to vision model). Returns generated files and dependencies.",
  schema: {
    projectId: z.string().describe("Project ID from create_project"),
    prompt: z.string().describe("What to build or change (e.g., 'Build a landing page with hero section')"),
    model: z.string().optional().describe("AI model to use (default: qwen/qwen3-coder, vision auto-switches to gemini)"),
    imageBase64: z.string().optional().describe("Optional base64-encoded image to attach (for design references or screenshots)"),
  },
  handler: async ({ projectId, prompt, model, imageBase64 }: {
    projectId: string;
    prompt: string;
    model?: string;
    imageBase64?: string;
  }) => {
    // Validate image size
    if (imageBase64 && imageBase64.length > config.maxImageSize) {
      return { content: [{ type: "text" as const, text: "❌ Image too large. Maximum size is 5MB." }] };
    }

    try {
      const result = await client.streamSse(
        `/api/chat/${projectId}`,
        { prompt, model: model || "qwen/qwen3-coder", contextFiles: {}, imageBase64 },
        config.requestTimeout
      );

      const fileCount = Object.keys(result.files).length;
      const fileList = Object.keys(result.files).join(", ");

      let responseText = `✅ Generation complete!\n`;
      responseText += `- Version: ${result.version}\n`;
      responseText += `- Files: ${fileCount} (${fileList})\n`;
      responseText += `- Chunks received: ${result.chunksReceived}\n`;
      responseText += `\n--- AI Response ---\n${result.response.substring(0, 2000)}`;

      if (result.response.length > 2000) {
        responseText += `\n... (truncated, ${result.response.length} total chars)`;
      }

      return { content: [{ type: "text" as const, text: responseText }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `❌ Generation failed: ${msg}` }] };
    }
  },
};
