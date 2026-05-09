export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  vision?: boolean;
}

// OpenRouter model list — verified against live API (2026-05-08).
// Every ID here was confirmed to exist on OpenRouter via GET /api/v1/models.
// When removing/adding models, always keep VISION_MODEL in sync so the
// dropdown doesn't lie about which model handled an image-attachment request.
export const AI_MODELS: AIModel[] = [
  {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "Top market-share model, strong coding + vision",
    vision: true,
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    description: "Highest-capability Anthropic tier, vision",
    vision: true,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    description: "OpenAI flagship, vision + file support",
    vision: true,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "Google",
    description: "Large Gemini preview, multimodal",
    vision: true,
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "Google",
    description: "Fast multimodal Gemini",
    vision: true,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    description: "Latest DeepSeek flagship",
    vision: false,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    description: "Fast DeepSeek tier",
    vision: false,
  },
  {
    id: "x-ai/grok-4.3",
    name: "Grok 4.3",
    provider: "xAI",
    description: "Latest Grok, vision-capable",
    vision: true,
  },
  {
    id: "minimax/minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "MiniMax",
    description: "Latest MiniMax M-series",
    vision: false,
  },
  {
    id: "z-ai/glm-5.1",
    name: "GLM 5.1",
    provider: "Z.AI",
    description: "GLM general-purpose model",
    vision: false,
  },
  {
    id: "tencent/hy3-preview",
    name: "Hy3 Preview",
    provider: "Tencent",
    description: "Tencent preview tier",
    vision: false,
  },
  {
    id: "qwen/qwen3.6-plus",
    name: "Qwen 3.6 Plus",
    provider: "Qwen",
    description: "Alibaba Qwen latest",
    vision: false,
  },
  {
    id: "qwen/qwen3.6-flash",
    name: "Qwen 3.6 Flash",
    provider: "Qwen",
    description: "Fast Qwen, vision + video",
    vision: true,
  },
  {
    id: "google/gemma-4-31b-it",
    name: "Gemma 4 31B",
    provider: "Google",
    description: "Open model, multimodal",
    vision: true,
  },
  {
    id: "inclusionai/ling-2.6-1t",
    name: "Ling 2.6 1T",
    provider: "InclusionAI",
    description: "1T-param general model",
    vision: false,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super (free)",
    provider: "NVIDIA",
    description: "Free 120B Nemotron tier",
    vision: false,
  },
];

export const DEFAULT_MODEL = "moonshotai/kimi-k2.6";

// Must be a model that supports image inputs (vision: true above).
// Kept in sync with the live OpenRouter model catalog as of 2026-05-08.
export const VISION_MODEL = "google/gemini-3.1-flash-lite";
