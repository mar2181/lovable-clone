export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  vision?: boolean;
}

// OpenRouter top-20 by market share (user-curated). The exact slug strings are
// best-effort and will need to be reconciled with OpenRouter's live catalog;
// any mismatched ID will surface in the chat as a clean "Generation failed:
// invalid model ID (<slug>)" thanks to the worker's empty-stream check.
export const AI_MODELS: AIModel[] = [
  {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "Top market-share model, strong general coding",
    vision: false,
  },
  {
    id: "tencent/hy3-preview:free",
    name: "Hy3 preview (free)",
    provider: "Tencent",
    description: "Free preview tier",
    vision: false,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Vision-capable, strong general coding",
    vision: true,
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "DeepSeek",
    description: "Open-source coding workhorse",
    vision: false,
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    description: "Highest-capability Anthropic tier",
    vision: true,
  },
  {
    id: "google/gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "Google",
    description: "Fast Gemini preview",
    vision: true,
  },
  {
    id: "stepfun/step-3.5-flash",
    name: "Step 3.5 Flash",
    provider: "StepFun",
    description: "Fast general model",
    vision: false,
  },
  {
    id: "minimax/minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "MiniMax",
    description: "MiniMax M-series",
    vision: false,
  },
  {
    id: "x-ai/grok-4.1-fast",
    name: "Grok 4.1 Fast",
    provider: "xAI",
    description: "Fast Grok variant",
    vision: true,
  },
  {
    id: "nvidia/nemotron-3-super:free",
    name: "Nemotron 3 Super (free)",
    provider: "NVIDIA",
    description: "Free Nemotron tier",
    vision: false,
  },
  {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    description: "Stable Opus tier (vision)",
    vision: true,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Fast, low-latency Anthropic tier",
    vision: true,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "Google",
    description: "Lightweight Gemini",
    vision: true,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    description: "Fast Gemini, vision",
    vision: true,
  },
  {
    id: "inclusionai/ling-2.6-1t:free",
    name: "Ling 2.6 1T (free)",
    provider: "InclusionAI",
    description: "Free 1T-param model",
    vision: false,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    description: "OpenAI flagship, vision",
    vision: true,
  },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    description: "Fast DeepSeek tier",
    vision: false,
  },
  {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "MiniMax",
    description: "MiniMax M-series prior gen",
    vision: false,
  },
  {
    id: "z-ai/glm-5.1",
    name: "GLM 5.1",
    provider: "Z.AI",
    description: "GLM general model",
    vision: false,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    provider: "OpenAI",
    description: "Open-weights 120B",
    vision: false,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "Google",
    description: "Largest Gemini preview",
    vision: true,
  },
];

export const DEFAULT_MODEL = "moonshotai/kimi-k2.6";
export const VISION_MODEL = "anthropic/claude-sonnet-4.6";
