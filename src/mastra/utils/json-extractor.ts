/**
 * Extract JSON from LLM response text
 * Handles various formats: markdown code blocks, plain JSON, or JSON embedded in text
 */
export function extractJSONFromResponse(responseText: string): string | null {
  // Strategy 1: Try to extract from markdown code blocks (```json ... ```)
  const jsonCodeBlockMatch = responseText.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonCodeBlockMatch) {
    return jsonCodeBlockMatch[1].trim();
  }

  // Strategy 2: Try to extract from generic code blocks (``` ... ```)
  const codeBlockMatch = responseText.match(/```[a-z]*\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    const codeContent = codeBlockMatch[1].trim();
    // Check if it looks like JSON (starts with { or [)
    if (codeContent.startsWith("{") || codeContent.startsWith("[")) {
      return codeContent;
    }
  }

  // Strategy 3: Find the first valid JSON object by matching braces properly
  const jsonObject = extractJSONObject(responseText);
  if (jsonObject) {
    return jsonObject;
  }

  // Strategy 4: Try to parse the entire response as JSON
  return responseText.trim();
}

/**
 * Extract a JSON object from text by properly matching braces
 * This handles nested braces correctly and continues searching if first match isn't valid JSON
 */
function extractJSONObject(text: string): string | null {
  let searchStart = 0;

  while (true) {
    const startIndex = text.indexOf("{", searchStart);
    if (startIndex === -1) {
      return null;
    }

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let stringChar: string | null = null;
    let foundMatch = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
        continue;
      }

      if (inString && char === stringChar) {
        inString = false;
        stringChar = null;
        continue;
      }

      if (!inString) {
        if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            // Found the complete JSON object
            const jsonString = text.substring(startIndex, i + 1);
            // Validate it's valid JSON by trying to parse it
            try {
              JSON.parse(jsonString);
              return jsonString;
            } catch {
              // Not valid JSON, continue searching from after this brace
              searchStart = i + 1;
              foundMatch = true;
              break;
            }
          }
        }
      }
    }

    // If we didn't find a matching closing brace, stop searching
    if (!foundMatch) {
      return null;
    }
  }
}

/**
 * Safely parse JSON from LLM response
 * Returns the parsed object or null if parsing fails
 */
export function parseJSONFromResponse(responseText: string): any | null {
  try {
    const jsonString = extractJSONFromResponse(responseText);
    if (!jsonString) {
      return null;
    }
    return JSON.parse(jsonString);
  } catch (error) {
    return null;
  }
}
