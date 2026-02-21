/**
 * Generic credential rotation manager using a Least-Recently-Used (LRU) strategy.
 *
 * Credentials that fail are placed on a cool-down so they are temporarily skipped.
 * If every credential is cooling down, the cool-down is ignored and the LRU
 * credential is returned anyway (better to retry than to block forever).
 *
 * @typeParam TCredential - The shape of a single credential (e.g. `{ apiKey: string }`).
 *
 * @example
 * ```ts
 * const km = new KeyManager([{ apiKey: "a" }, { apiKey: "b" }]);
 * const key = km.getKey();        // returns least-recently-used key
 * km.reportError(key);            // puts it on 3-minute cool-down
 * const next = km.getKey();       // returns the other key
 * ```
 */
export class KeyManager<TCredential> {
    /** Internal bookkeeping: tracks usage time and cool-down expiry for each credential. */
    private entries: { credential: TCredential; lastUsedAt: number; coolDownUntil: number }[];

    /**
     * Create a new KeyManager.
     * @param credentials - Array of credentials to rotate through. Must contain at least one.
     * @throws {Error} If the credentials array is empty.
     */
    constructor(credentials: TCredential[]) {
        if (credentials.length === 0) throw new Error("KeyManager requires at least one credential");
        this.entries = credentials.map(credential => ({ credential, lastUsedAt: 0, coolDownUntil: 0 }));
    }

    /**
     * Returns the credential with the oldest last-use time, skipping credentials in cool-down.
     * Falls back to all credentials if every one is cooling down.
     * The returned credential's `lastUsedAt` is updated to `Date.now()`.
     */
    getKey(): TCredential {
        const now = Date.now();

        // Filter to credentials whose cool-down has expired
        let available = this.entries.filter(e => e.coolDownUntil <= now);

        // If all credentials are on cool-down, use them all anyway
        if (available.length === 0) available = [...this.entries];

        // Sort by oldest usage first (LRU)
        available.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

        const entry = available[0];
        entry.lastUsedAt = now;
        return entry.credential;
    }

    /**
     * Marks a credential as failed so it is temporarily excluded from selection.
     *
     * @param credential - The exact credential reference returned by {@link getKey}.
     * @param coolDownMs - How long to exclude this credential, in milliseconds. @default 180000 (3 minutes)
     */
    reportError(credential: TCredential, coolDownMs: number = 3 * 60 * 1000): void {
        const entry = this.entries.find(e => e.credential === credential);
        if (entry) entry.coolDownUntil = Date.now() + coolDownMs;
    }
}
