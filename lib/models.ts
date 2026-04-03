export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

export const AI_MODELS: AIModel[] = [
  {
    id: "moonshotai/kimi-k2",
    name: "Kimi K2",
    provider: "Moonshot",
    description: "Powerful free coding model"
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    description: "Powerful open-source coding model"
  },
  {
    id: "google/gemini-2.5-pro-preview-05-06",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Large context window for complex apps"
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "Fast and versatile coding assistant"
  },
  {
    id: "x-ai/grok-3-mini-beta",
    name: "Grok 3 Mini",
    provider: "xAI",
    description: "Fast reasoning model"
  },
];

export const DEFAULT_MODEL = AI_MODELS[0].id;
