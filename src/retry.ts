/**
 * Retry loop with exponential backoff, credential rotation, error classification,
 * and optional hedged requests.
 *
 * On each transient failure the current credential is placed on cool-down
 * (via {@link KeyManager.reportError}) and a fresh credential is selected for
 * the next attempt. Terminal errors (bad input, invalid keys) are thrown
 * immediately without retry.
 *
 * When hedging is enabled, additional speculative requests are launched at
 * fixed intervals while the original request is still in flight. The first
 * successful response wins; all others are cancelled.
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
    /** Time in ms to wait before launching a hedge request. When undefined, hedging is disabled. */
    hedgeAfterMs?: number;
    /** Maximum number of additional hedge requests to launch. @default 1 */
    maxHedges?: number;
}

/**
 * Internal options for {@link withRetrySequential}. Extends the public options
 * with an optional pre-computed deadline so that hedged processes share a
 * single wall-clock cutoff.
 */
interface SequentialOptions<TCredential> extends WithRetryOptions<TCredential> {
    /** Pre-computed deadline (ms since epoch). Overrides `retryTimeoutMs` when set. */
    deadline?: number;
}

/**
 * Executes `fn` with automatic retry on transient errors, and optional hedged
 * requests for latency-sensitive workloads.
 *
 * When `hedgeAfterMs` is undefined the function behaves identically to a simple
 * sequential retry loop. When set, additional speculative requests are launched
 * at `hedgeAfterMs` intervals (up to `maxHedges`) while existing requests are
 * still in flight. The first success wins.
 *
 * @typeParam TCredential - Credential type managed by the key manager.
 * @typeParam TResult - Return type of the wrapped function.
 * @param options - Retry configuration (key manager, timeout, signal, operation name, hedge settings).
 * @param fn - The async function to execute. Receives a credential and should return a result.
 * @returns The result of `fn` on the first successful attempt.
 * @throws On terminal error, timeout, or abort.
 */
export async function withRetry<TCredential, TResult>(
    options: WithRetryOptions<TCredential>,
    fn: (credential: TCredential) => Promise<TResult>,
): Promise<TResult> {
    if (options.hedgeAfterMs === undefined || (options.maxHedges ?? 1) <= 0) {
        return withRetrySequential(options, fn);
    }
    return withRetryHedged(options, fn);
}

/**
 * Sequential retry loop — the original `withRetry` behavior.
 *
 * - **Credential rotation**: a fresh credential is obtained from the key manager on every attempt.
 * - **Exponential backoff**: delay doubles each attempt (1 s → 2 s → 4 s → …) capped at 60 s, plus 30 % jitter.
 * - **Deadline enforcement**: retries stop once `retryTimeoutMs` has elapsed.
 * - **Abort support**: the loop checks `signal.aborted` before each attempt and after each sleep.
 * - **Terminal errors**: errors classified as terminal (e.g. 401, 403) are thrown immediately.
 */
async function withRetrySequential<TCredential, TResult>(
    options: SequentialOptions<TCredential>,
    fn: (credential: TCredential) => Promise<TResult>,
): Promise<TResult> {
    const { keyManager, retryTimeoutMs, signal, operationName } = options;
    const deadline = options.deadline ?? Date.now() + retryTimeoutMs;
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

/**
 * Hedged retry — launches speculative requests at fixed intervals while
 * existing requests are still in flight. The first success wins; all other
 * in-flight requests are cancelled via `AbortController`.
 */
async function withRetryHedged<TCredential, TResult>(
    options: WithRetryOptions<TCredential>,
    fn: (credential: TCredential) => Promise<TResult>,
): Promise<TResult> {
    const { hedgeAfterMs, signal, retryTimeoutMs, operationName } = options;
    const maxHedges = options.maxHedges ?? 1;
    const deadline = Date.now() + retryTimeoutMs;
    const totalProcesses = 1 + maxHedges;

    // Master controller: aborting this cancels all hedges
    const masterController = new AbortController();

    // Link to parent signal so caller cancellation propagates
    const onParentAbort = () => masterController.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
        return await new Promise<TResult>((resolve, reject) => {
            let resolved = false;
            let launchedCount = 0;
            let settledCount = 0;
            const errors: Error[] = [];
            const hedgeTimers: ReturnType<typeof setTimeout>[] = [];

            const onSuccess = (result: TResult) => {
                if (resolved) return;
                resolved = true;
                masterController.abort();
                for (const t of hedgeTimers) clearTimeout(t);
                resolve(result);
            };

            const onFailure = (error: Error) => {
                errors.push(error);
                settledCount++;
                checkAllDone();
            };

            const checkAllDone = () => {
                if (resolved) return;
                // All launched processes have settled — check if more hedges are pending
                if (settledCount >= launchedCount) {
                    if (launchedCount >= totalProcesses || masterController.signal.aborted) {
                        // No more processes can be launched
                        resolved = true;
                        for (const t of hedgeTimers) clearTimeout(t);
                        reject(errors[errors.length - 1]);
                    }
                    // Otherwise a hedge timer may still fire and launch a new process
                }
            };

            const launchProcess = () => {
                if (resolved || masterController.signal.aborted) return;
                launchedCount++;

                // Create a child signal that is linked to the master controller.
                // Each process gets the master's signal so that when one succeeds,
                // all others see the abort.
                const processOptions: SequentialOptions<TCredential> = {
                    ...options,
                    signal: masterController.signal,
                    deadline,
                };

                withRetrySequential(processOptions, fn).then(onSuccess, onFailure);
            };

            // Launch original request immediately
            launchProcess();

            // Schedule hedge launches at fixed intervals
            for (let h = 0; h < maxHedges; h++) {
                const timer = setTimeout(() => {
                    if (!resolved && !masterController.signal.aborted) {
                        launchProcess();
                    }
                    // After the last timer fires, check if all processes are already done
                    if (h === maxHedges - 1) {
                        // All timers have fired — if everything already settled, reject
                        checkAllDone();
                    }
                }, hedgeAfterMs! * (h + 1));
                hedgeTimers.push(timer);
            }
        });
    } finally {
        signal?.removeEventListener("abort", onParentAbort);
    }
}
