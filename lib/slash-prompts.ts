// Map Mode slash-prompt registry.
//
// In Map Mode, start a dictation/typed line with a slash command — "/prompt …"
// (or spoken "slash prompt …") — and instead of typing your words literally, the
// raw text is rewritten by the AI using the matching instruction below and the
// IMPROVED prompt is dropped into the focused field, ready to Build.
//
// Add your own: copy a block, give it a kebab-case key (spoken with spaces, e.g.
// key "blog-writer" => say "slash blog writer"), and write the instruction. The
// instruction is the system prompt for the rewrite. No backend change needed —
// the worker /api/improve-prompt endpoint runs whatever instruction we send.

export interface SlashPrompt {
  /** Human label shown in the HUD log. */
  label: string;
  /** System instruction sent to the rewrite model. */
  instruction: string;
}

const IMPROVER_CORE =
  "Rewrite the user's rough request into ONE clear, well-structured prompt. Preserve their intent " +
  "and every concrete detail; add structure only where it sharpens the request. Do NOT invent " +
  "unrelated requirements, do NOT ask questions, do NOT add preamble, labels, or commentary. " +
  "Output ONLY the improved prompt text, ready to paste.";

export const SLASH_PROMPTS: Record<string, SlashPrompt> = {
  prompt: {
    label: "prompt",
    instruction:
      "You are a senior prompt engineer for an AI web-app builder. " + IMPROVER_CORE +
      " Where useful, organize the request around: goal, key pages/sections, layout, " +
      "style/brand, content, and constraints.",
  },

  "prompt-writer": {
    label: "prompt writer",
    instruction:
      "You are an expert prompt engineer. " + IMPROVER_CORE +
      " Make it precise and unambiguous, with explicit success criteria.",
  },

  "blog-writer": {
    label: "blog writer",
    instruction:
      "You are a senior content strategist. Turn the user's rough idea into ONE structured brief " +
      "for writing a blog post: working title, target reader, angle, an outline of H2 sections, " +
      "tone, and a clear call-to-action. Preserve every concrete detail the user gave. No preamble " +
      "or commentary — output ONLY the brief.",
  },

  designer: {
    label: "designer",
    instruction:
      "You are a senior product/web designer. Turn the user's rough idea into ONE structured design " +
      "brief: layout and sections, visual style and mood, color and typography direction, key " +
      "components, and responsive notes. Preserve every concrete detail. No preamble — output ONLY " +
      "the brief.",
  },
};
