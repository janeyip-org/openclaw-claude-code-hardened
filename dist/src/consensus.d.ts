/**
 * Consensus vote parsing utilities
 *
 * Ported from three-minds — detects [CONSENSUS: YES/NO] tags in agent
 * responses with multiple fallback patterns for variant formats.
 */
/** Remove all [CONSENSUS: YES/NO] tags from text */
export declare function stripConsensusTags(text: string): string;
/** Check whether text contains any consensus vote marker */
export declare function hasConsensusMarker(text: string): boolean;
/**
 * Parse a consensus vote from agent response text.
 *
 * Priority chain:
 * 1. Strict format: [CONSENSUS: YES] / [CONSENSUS: NO]
 * 2. Common variants: consensus: yes, **consensus**: no, CONSENSUS=YES, etc.
 * 3. Tail fallback: analyse last 8 lines for positive/negative signals
 * 4. Default: false (no consensus)
 */
export declare function parseConsensus(content: string): boolean;
