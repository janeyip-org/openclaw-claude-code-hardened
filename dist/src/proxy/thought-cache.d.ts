/**
 * Thought Signature Cache — Gemini round-trip support
 *
 * Gemini 2.5+ with thinking requires `thought_signature` in tool_calls
 * for 2nd+ turns. We cache signatures from responses and inject on next request.
 *
 * Uses in-memory LRU cache (no file I/O needed in plugin context).
 */
/** Cache a thought signature from a tool call response */
export declare function cacheThoughtSig(toolCallId: string, signature: string): void;
/** Get a cached thought signature for a tool call */
export declare function getThoughtSig(toolCallId: string): string;
/**
 * Inject cached thought signatures into messages for Gemini round-trip.
 * Mutates the messages array in place.
 */
export declare function injectThoughtSigs(messages: Array<Record<string, unknown>>): void;
/** Clear the cache (for testing) */
export declare function clearCache(): void;
