// Smart Fill — lightweight AI content generation for templates
// One short call to fill in real content after template structure is built

import { BusinessInfo } from '../templates/types';

export interface SmartFillRequest {
  businessName: string;
  businessType: string;
  city: string;
  state: string;
  services: Array<{ name: string; description: string }>;
  tone?: string; // 'professional' | 'friendly' | 'bold'
}

export interface SmartFillResult {
  tagline: string;
  description: string;
  aboutParagraph: string;
  heroSubtext: string;
  serviceDescriptions: string[]; // enhanced descriptions for each service
  faqPairs: Array<{ q: string; a: string }>;
  reviewSnippets: Array<{ name: string; text: string }>;
}

const SYSTEM_PROMPT = `You are a copywriter for local service businesses. Write concise, compelling marketing copy.
Output ONLY valid JSON. No markdown, no explanations. Be specific to the business type and location.
Keep descriptions under 30 words each. Keep FAQ answers under 50 words. Review snippets under 40 words.`;

export function buildSmartFillPrompt(req: SmartFillRequest): { system: string; user: string } {
  const serviceList = req.services.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join('\n');

  return {
    system: SYSTEM_PROMPT,
    user: `Business: ${req.businessName}
Type: ${req.businessType}
Location: ${req.city}, ${req.state}
Services:
${serviceList}

Generate this JSON:
{
  "tagline": "short punchy tagline (under 10 words)",
  "description": "2 sentence business overview mentioning location and key differentiator",
  "aboutParagraph": "3 sentences about the business, their values, experience, and commitment to the community",
  "heroSubtext": "1 sentence compelling reason to choose this business",
  "serviceDescriptions": ["enhanced description for each service, same order as provided, under 30 words each"],
  "faqPairs": [
    {"q": "question 1", "a": "answer 1"},
    {"q": "question 2", "a": "answer 2"},
    {"q": "question 3", "a": "answer 3"},
    {"q": "question 4", "a": "answer 4"},
    {"q": "question 5", "a": "answer 5"}
  ],
  "reviewSnippets": [
    {"name": "First name + last initial", "text": "realistic 5-star review"},
    {"name": "First name + last initial", "text": "realistic 5-star review"},
    {"name": "First name + last initial", "text": "realistic 5-star review"},
    {"name": "First name + last initial", "text": "realistic 5-star review"}
  ]
}

Make the reviews sound like real people in ${req.city}. Vary the writing styles. Mention specific services.`.trim(),
  };
}

/**
 * Apply Smart Fill results to the business info, enhancing it with AI content.
 */
export function applySmartFill(info: BusinessInfo, fill: SmartFillResult): BusinessInfo {
  return {
    ...info,
    tagline: fill.tagline || info.tagline,
    description: fill.description || info.description,
    services: info.services.map((s, i) => ({
      ...s,
      description: fill.serviceDescriptions?.[i] || s.description,
    })),
  };
}
