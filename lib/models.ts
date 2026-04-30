export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  vision?: boolean;
}

export const AI_MODELS: AIModel[] = [
  {
    id: "xiaomi/mimo-v2-pro",
    name: "Mimo V2 Pro",
    provider: "Xiaomi",
    description: "Top-tier coding model, 1M context",
    vision: false
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "Fast and versatile (vision)",
    vision: true
  },
  {
    id: "google/gemini-2.5-pro-preview-05-06",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Vision + huge context window",
    vision: true
  },
  {
    id: "qwen/qwen3-coder",
    name: "Qwen3 Coder",
    provider: "Qwen",
    description: "Powerful coding specialist",
    vision: false
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    description: "Powerful open-source coding model",
    vision: false
  },
  {
    id: "moonshotai/kimi-k2",
    name: "Kimi K2",
    provider: "Moonshot",
    description: "Fast free coding model",
    vision: false
  },
  {
    id: "x-ai/grok-3-mini-beta",
    name: "Grok 3 Mini",
    provider: "xAI",
    description: "Fast reasoning model",
    vision: false
  },
];

export const DEFAULT_MODEL = AI_MODELS[0].id;
export const VISION_MODEL = "openai/gpt-4.1";
