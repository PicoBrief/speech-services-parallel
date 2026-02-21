/**
 * Retry loop with exponential backoff, credential rotation, and error classification.
 *
 * On each transient failure the current credential is placed on cool-down
 * (via {@link KeyManager.reportError}) and a fresh credential is selected for
 * the next attempt. Terminal errors (bad input, invalid keys) are thrown
 * immediately without retry.
 */

import { classifyError } from "./errors.js";
import { sleepAsync, extractErrorMessage } from "./helpers.js";
import type { KeyManager } from "./KeyManager.js";

/** Options that control retry behavior. */
export interface WithRetryOptions<TCredential> {
    /** The key manager used for credential rotation between attempts. */
    keyManager: KeyManager<TCredential>;
    /** Maximum wall-clock time (ms) to keep retrying before giving up. */
    retryTimeoutMs: number;
    /** Optional abort signal — checked before each attempt and after each sleep. */
    signal?: AbortSignal;
    /** Human-readable label for error messages (e.g. `"Transcription"`). */
    operationName: string;
}

/**
 * Executes `fn` with automatic retry on transient errors.
 *
 * - **Credential rotation**: a fresh credential is obtained from the key manager on every attempt.
 * - **Exponential backoff**: delay doubles each attempt (1 s → 2 s → 4 s → …) capped at 60 s, plus 30 % jitter.
 * - **Deadline enforcement**: retries stop once `retryTimeoutMs` has elapsed.
 * - **Abort support**: the loop checks `signal.aborted` before each attempt and after each sleep.
 * - **Terminal errors**: errors classified as terminal (e.g. 401, 403) are thrown immediately.
 *
 * @typeParam TCredential - Credential type managed by the key manager.
 * @typeParam TResult - Return type of the wrapped function.
 * @param options - Retry configuration (key manager, timeout, signal, operation name).
 * @param fn - The async function to execute. Receives a credential and should return a result.
 * @returns The result of `fn` on the first successful attempt.
 * @throws On terminal error, timeout, or abort.
 */
export async function withRetry<TCredential, TResult>(
    options: WithRetryOptions<TCredential>,
    fn: (credential: TCredential) => Promise<TResult>,
): Promise<TResult> {
    const { keyManager, retryTimeoutMs, signal, operationName } = options;
    const deadline = Date.now() + retryTimeoutMs;
    let attempt = 0;

    while (true) {
        // Check for cancellation before each attempt
        if (signal?.aborted) {
            throw new Error(`${operationName} aborted`);
        }

        const credential = keyManager.getKey();
        try {
            return await fn(credential);
        } catch (e) {
            // Terminal errors (bad input, invalid key, etc.) are not retryable
            if (classifyError(e) === "terminal") throw e;

            // Mark the credential as failed so the key manager avoids it temporarily
            keyManager.reportError(credential);

            // Check if we've exceeded the retry deadline
            if (Date.now() >= deadline) {
                throw new Error(`${operationName} timed out after ${retryTimeoutMs}ms: ${extractErrorMessage(e)}`);
            }

            // Exponential backoff: min(1000 * 2^attempt, 60000) + 30% jitter
            const base = Math.min(1000 * Math.pow(2, attempt), 60000);
            const jitter = base * 0.3 * Math.random();
            const delay = base + jitter;

            // Don't sleep past the deadline
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error(`${operationName} timed out after ${retryTimeoutMs}ms: ${extractErrorMessage(e)}`);
            }

            await sleepAsync(Math.min(delay, remaining));

            // Check for cancellation after sleeping
            if (signal?.aborted) {
                throw new Error(`${operationName} aborted`);
            }

            attempt++;
        }
    }
}
