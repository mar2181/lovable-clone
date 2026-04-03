interface ParsedResponse {
  files: Record<string, string>;
  dependencies?: Record<string, string>;
}

/**
 * Parses the AI's streamed text output into structured files + dependencies.
 * 
 * The worker's system prompt instructs the AI to return pure JSON like:
 * { "files": { "/src/App.tsx": "..." }, "dependencies": { "some-pkg": "^1.0" } }
 * 
 * During streaming the text may be incomplete / wrapped in markdown fences.
 * We handle both cases gracefully.
 */
export function parseStreamToJSON(text: string): ParsedResponse | null {
  try {
    // 1. Strip markdown code fences if the model wrapped the JSON
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

    // 2. Try to parse as JSON directly
    const parsed = JSON.parse(cleanText);
    if (parsed && parsed.files && typeof parsed.files === "object") {
      return {
        files: parsed.files,
        dependencies: parsed.dependencies || {},
      };
    }
    return null;
  } catch {
    // 3. Fallback: try to extract the outermost JSON object from the text
    //    This handles partial streams where extra text surrounds the JSON
    try {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && parsed.files && typeof parsed.files === "object") {
          return {
            files: parsed.files,
            dependencies: parsed.dependencies || {},
          };
        }
      }
    } catch {
      // Still incomplete stream — that's fine, return null
    }
    return null;
  }
}
