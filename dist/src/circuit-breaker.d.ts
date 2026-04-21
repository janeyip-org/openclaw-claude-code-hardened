/**
 * Circuit breaker for engine failure tracking.
 *
 * Opens after CIRCUIT_BREAKER_THRESHOLD consecutive failures per engine,
 * with exponential backoff capped at CIRCUIT_BREAKER_MAX_BACKOFF_MS.
 * Resets on a successful engine start.
 */
export declare class CircuitBreaker {
    private breakers;
    /** Throws if the engine circuit is open and backoff has not yet expired. */
    check(engine: string): void;
    /** Record a failure — increments count and sets exponential backoff. */
    recordFailure(engine: string): void;
    /** Reset (clear) the breaker for an engine after a successful start. */
    reset(engine: string): void;
    /** Get status snapshot for health() reporting. */
    getStatus(): Record<string, {
        failures: number;
        backoffUntil: string | null;
    }>;
}
