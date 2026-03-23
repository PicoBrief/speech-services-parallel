import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../dist/retry.js";
import { KeyManager } from "../dist/KeyManager.js";
import { SpeechServiceError } from "@pico-brief/speech-services";

/**
 * Helper that creates a function which resolves after `delayMs` with the
 * credential that was used, tracking all calls.
 */
function makeDelayedFn<T>(delayMs: number, result: T, calls: string[]) {
    return async (credential: string) => {
        calls.push(credential);
        await new Promise((r) => setTimeout(r, delayMs));
        return result;
    };
}

describe("withRetry hedging", () => {
    it("does not hedge when hedgeAfterMs is undefined", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a"]);
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 5000, operationName: "test" },
            async (cred) => { calls.push(cred); return "ok"; },
        );
        assert.equal(result, "ok");
        assert.equal(calls.length, 1);
    });

    it("does not hedge when maxHedges is 0", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a"]);
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 5000, operationName: "test", hedgeAfterMs: 10, maxHedges: 0 },
            async (cred) => { calls.push(cred); return "ok"; },
        );
        assert.equal(result, "ok");
        assert.equal(calls.length, 1);
    });

    it("returns original result when it completes before hedgeAfterMs", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a", "b"]);
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 5000, operationName: "test", hedgeAfterMs: 500, maxHedges: 1 },
            async (cred) => { calls.push(cred); return "fast"; },
        );
        assert.equal(result, "fast");
        // Only the original request should have been made
        assert.equal(calls.length, 1);
    });

    it("launches hedge after hedgeAfterMs and returns first success", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a", "b"]);

        let callCount = 0;
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 50, maxHedges: 1 },
            async (cred) => {
                calls.push(cred);
                const myCall = ++callCount;
                if (myCall === 1) {
                    // Original is slow
                    await new Promise((r) => setTimeout(r, 500));
                    return "slow";
                }
                // Hedge is fast
                return "hedge-won";
            },
        );

        assert.equal(result, "hedge-won");
        assert.equal(calls.length, 2);
    });

    it("launches exactly maxHedges additional requests", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a", "b", "c", "d"]);

        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 30, maxHedges: 3 },
            async (cred) => {
                calls.push(cred);
                // All processes are slow, last one finishes
                await new Promise((r) => setTimeout(r, 200));
                return "done";
            },
        );

        assert.equal(result, "done");
        // 1 original + 3 hedges = 4 total processes launched
        assert.equal(calls.length, 4);
    });

    it("uses different credentials for each hedge", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a", "b", "c"]);

        await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 30, maxHedges: 2 },
            async (cred) => {
                calls.push(cred);
                await new Promise((r) => setTimeout(r, 200));
                return "done";
            },
        );

        // All three credentials should have been used
        assert.equal(calls.length, 3);
        const unique = new Set(calls);
        assert.equal(unique.size, 3);
    });

    it("terminal error in one hedge does not kill others", async () => {
        const km = new KeyManager(["a", "b"]);
        let callCount = 0;

        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 30, maxHedges: 1 },
            async () => {
                const myCall = ++callCount;
                if (myCall === 1) {
                    // Original takes a while then succeeds
                    await new Promise((r) => setTimeout(r, 200));
                    return "original-wins";
                }
                // Hedge fails with terminal error
                throw new SpeechServiceError("bad", "INVALID_INPUT", "openai");
            },
        );

        assert.equal(result, "original-wins");
    });

    it("throws when all processes fail with terminal errors", async () => {
        const km = new KeyManager(["a", "b"]);

        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 30, maxHedges: 1 },
                async () => {
                    throw new SpeechServiceError("bad", "INVALID_INPUT", "openai");
                },
            ),
            (err: unknown) => {
                assert.ok(err instanceof SpeechServiceError);
                return true;
            },
        );
    });

    it("respects retryTimeoutMs deadline across all hedges", async () => {
        const km = new KeyManager(["a", "b"]);

        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 200, operationName: "test", hedgeAfterMs: 50, maxHedges: 1 },
                async () => { throw new Error("always fails"); },
            ),
            /timed out/,
        );
    });

    it("cancels all hedges when caller aborts", async () => {
        const km = new KeyManager(["a", "b"]);
        const ac = new AbortController();

        // Abort after 80ms
        setTimeout(() => ac.abort(), 80);

        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 10_000, signal: ac.signal, operationName: "test", hedgeAfterMs: 30, maxHedges: 1 },
                async () => {
                    // Simulate transient failures so the retry loop keeps going
                    // and checks signal.aborted between attempts
                    throw new Error("transient");
                },
            ),
            /aborted/,
        );
    });

    it("hedgeAfterMs=0 launches all hedges immediately", async () => {
        const calls: string[] = [];
        const km = new KeyManager(["a", "b", "c"]);

        await withRetry(
            { keyManager: km, retryTimeoutMs: 5000, operationName: "test", hedgeAfterMs: 0, maxHedges: 2 },
            async (cred) => {
                calls.push(cred);
                await new Promise((r) => setTimeout(r, 50));
                return "done";
            },
        );

        // All 3 processes should have been launched
        assert.equal(calls.length, 3);
    });

    it("each hedge retries independently on transient errors", async () => {
        const km = new KeyManager(["a", "b"]);
        let totalCalls = 0;
        let hedgeAttempts = 0;

        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test", hedgeAfterMs: 50, maxHedges: 1 },
            async () => {
                totalCalls++;
                if (totalCalls === 1) {
                    // Original process: very slow
                    await new Promise((r) => setTimeout(r, 2000));
                    return "slow";
                }
                // Hedge process calls: fail once then succeed
                hedgeAttempts++;
                if (hedgeAttempts < 2) throw new Error("transient");
                return "hedge-retried-and-won";
            },
        );

        // Hedge should have won after retrying
        assert.equal(result, "hedge-retried-and-won");
        assert.ok(hedgeAttempts >= 2, "hedge should have retried at least once");
    });
});
