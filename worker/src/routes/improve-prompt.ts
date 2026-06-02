import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

// Powers Map Mode's "/prompt" (and friends). Takes a rough request + a rewrite
// instruction (chosen client-side from the slash registry) and returns a single
// cleaned-up, structured prompt — no streaming, no tools, just a fast rewrite.
const improvePromptRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

improvePromptRouter.use("*", authMiddleware);

const DEFAULT_INSTRUCTION =
  "You are a senior prompt engineer for an AI web-app builder. Rewrite the user's rough request " +
  "into ONE clear, well-structured prompt. Preserve their intent and every concrete detail; add " +
  "structure (goal, key pages/sections, layout, style/brand, content, constraints) only where it " +
  "sharpens the request. Do NOT invent unrelated requirements, do NOT ask questions, do NOT add " +
  "any preamble, labels, or commentary. Output ONLY the improved prompt text, ready to paste.";

const MAX_RAW = 4000;
const MAX_INSTRUCTION = 2000;

improvePromptRouter.post("/", async (c) => {
  let body: { raw?: string; instruction?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const raw = (body.raw || "").toString().trim();
  if (!raw) return c.json({ error: "Missing raw text" }, 400);
  if (raw.length > MAX_RAW) return c.json({ error: "Input too long" }, 400);

  const instruction = ((body.instruction || "").toString().trim() || DEFAULT_INSTRUCTION).slice(0, MAX_INSTRUCTION);

  if (!c.env.OPENROUTER_API_KEY) return c.json({ error: "AI not configured" }, 500);

  const openrouter = createOpenAI({
    apiKey: c.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  try {
    const result = await generateText({
      model: openrouter("moonshotai/kimi-k2"),
      system: instruction,
      messages: [{ role: "user", content: raw }],
    });
    let improved = (result.text || "").trim();
    // Strip accidental markdown fences if the model wraps the prompt.
    if (improved.startsWith("```")) {
      improved = improved.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
    }
    if (!improved) return c.json({ error: "Empty result" }, 502);
    return c.json({ improved });
  } catch (err) {
    console.error("[improve-prompt] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Rewrite failed" }, 502);
  }
});

export default improvePromptRouter;
