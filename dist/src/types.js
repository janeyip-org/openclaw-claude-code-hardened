/**
 * Shared types for openclaw-claude-code plugin
 */
import { getAliases } from './models.js';
export { getModelPricing, overrideModelPricing, _resetPricingOverrides, getModelList, resolveAlias, resolveEngineAndModel, resolveProvider, getContextWindow, isGeminiModel, isClaudeModel, estimateTokens, lookupModelStrict, getAliases, } from './models.js';
// Backward compat: MODEL_ALIASES as a static object
export const MODEL_ALIASES = getAliases();
//# sourceMappingURL=types.js.map