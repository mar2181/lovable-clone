export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  vision?: boolean;
}

// Starter set — small and reliable. Each model has been picked so we can
// test it end-to-end without juggling a full catalog. Vision is provided
// by Claude Sonnet 4.6, which keeps the dropdown honest (the worker
// auto-switches to this exact ID for image attachments).
export const AI_MODELS: AIModel[] = [
  {
    id: "xiaomi/mimo-v2.5-pro",
    name: "Mimo V2.5 Pro",
    provider: "Xiaomi",
    description: "Default coding model — fast, large context",
    vision: false
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Vision-capable, strong general coding",
    vision: true
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    description: "Highest-capability Anthropic tier",
    vision: false
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Fast, low-latency drafts",
    vision: false
  },
  {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    description: "Open-source coding alternative",
    vision: false
  },
];

export const DEFAULT_MODEL = "xiaomi/mimo-v2.5-pro";
export const VISION_MODEL = "anthropic/claude-sonnet-4.6";
