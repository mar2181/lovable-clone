// Extracts the JSON payload from the LLM's text stream

export function parseStreamToJSON(text: string): any {
  try {
    // If the model wrapped it in markdown code blocks, strip them
    let cleanText = text.trim();
    if (cleanText.startsWith("```json")) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith("```")) {
      cleanText = cleanText.substring(3);
    }
    
    if (cleanText.endsWith("```")) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    
    cleanText = cleanText.trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Failed to parse AI output to JSON:", e);
    
    // Fallback: extract the outermost JSON object from the text
    try {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonCandidate);
      }
    } catch (e2) {
      console.error("Fallback parsing failed:", e2);
    }
    
    return null;
  }
}
