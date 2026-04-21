/**
 * Gemini Tool Schema Cleaner
 *
 * Gemini doesn't support certain JSON Schema fields that Anthropic tools use.
 * This recursively cleans schemas for compatibility.
 */
/**
 * Recursively clean a JSON Schema for Gemini compatibility.
 * Removes unsupported fields and string formats.
 */
export declare function cleanGeminiSchema(schema: unknown): unknown;
