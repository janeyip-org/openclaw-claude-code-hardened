/**
 * Centralized Model Registry — single source of truth for all model metadata.
 *
 * Every model definition lives here. All other files derive from this registry.
 * To add a model: add one entry to MODELS[]. Everything else auto-generates.
 */
import type { EngineType } from './types.js';
export type ProviderName = 'anthropic' | 'openai' | 'google' | 'cursor' | 'custom';
export interface ModelPricing {
    input: number;
    output: number;
    cached?: number;
}
export interface ModelDef {
    /** Canonical model ID, e.g. 'claude-opus-4-6' */
    id: string;
    /** Which CLI engine to use */
    engine: EngineType;
    /** Upstream provider for API routing */
    provider: ProviderName;
    /** Token pricing */
    pricing: ModelPricing;
    /** Short aliases that resolve to this model */
    aliases?: string[];
    /** Whether to expose in /v1/models (default: true) */
    listed?: boolean;
    /** Context window size in tokens */
    contextWindow?: number;
}
/** Resolve a model string (id or alias) to its full definition. Returns undefined for unknown models. */
export declare function lookupModel(idOrAlias: string): ModelDef | undefined;
/** Resolve alias → canonical id. Returns the input unchanged if not an alias. */
export declare function resolveAlias(alias: string): string;
/** Resolve model string to engine + canonical model. Pattern fallback for unknown models. */
export declare function resolveEngineAndModel(model: string): {
    engine: EngineType;
    model: string;
};
/** Resolve model string to provider + API model name. Used by proxy handler. */
export declare function resolveProvider(model: string): {
    provider: ProviderName;
    apiModel: string;
};
/** Get context window size for a model. Returns 200k default for unknown models. */
export declare function getContextWindow(model: string): number;
/** Get pricing for a model. Falls back to sonnet pricing for unknown models. */
export declare function getModelPricing(model?: string, defaultModel?: string): ModelPricing;
export declare function overrideModelPricing(overrides: Record<string, Partial<ModelPricing>>): void;
/** Reset all pricing overrides (for testing). */
export declare function _resetPricingOverrides(): void;
/** Get /v1/models list — auto-generated from registry. */
export declare function getModelList(): {
    object: string;
    data: Array<{
        id: string;
        object: string;
        owned_by: string;
    }>;
};
/** Get all model aliases as a Record (backward compat). */
export declare function getAliases(): Record<string, string>;
/** Check if a model string is a Gemini model. */
export declare function isGeminiModel(model: string): boolean;
/** Check if a model string is a Claude model. */
export declare function isClaudeModel(model: string): boolean;
/** Rough token estimate: ~4 chars per token. */
export declare function estimateTokens(text: string): number;
/** Resolve a model string to its full definition. Throws for unknown models. */
export declare function lookupModelStrict(idOrAlias: string): ModelDef;
