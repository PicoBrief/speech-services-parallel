import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../dist/retry.js";
import { KeyManager } from "../dist/KeyManager.js";
import { SpeechServiceError } from "@pico-brief/speech-services";

describe("withRetry", () => {
    it("succeeds on first attempt", async () => {
        const km = new KeyManager(["key-a"]);
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 5000, operationName: "test" },
            async () => "ok",
        );
        assert.equal(result, "ok");
    });

    it("retries on retryable error then succeeds", async () => {
        const km = new KeyManager(["key-a"]);
        let attempts = 0;
        const result = await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test" },
            async () => {
                attempts++;
                if (attempts < 2) throw new Error("transient");
                return "recovered";
            },
        );
        assert.equal(result, "recovered");
        assert.equal(attempts, 2);
    });

    it("throws immediately on terminal error", async () => {
        const km = new KeyManager(["key-a"]);
        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 10_000, operationName: "test" },
                async () => {
                    throw new SpeechServiceError("bad input", "INVALID_INPUT", "openai");
                },
            ),
            (err: unknown) => {
                assert.ok(err instanceof SpeechServiceError);
                assert.equal(err.code, "INVALID_INPUT");
                return true;
            },
        );
    });

    it("throws immediately when abort signal is set", async () => {
        const km = new KeyManager(["key-a"]);
        const ac = new AbortController();
        ac.abort();

        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 10_000, signal: ac.signal, operationName: "test" },
                async () => "should not reach",
            ),
            /aborted/,
        );
    });

    it("times out after deadline", async () => {
        const km = new KeyManager(["key-a"]);
        await assert.rejects(
            () => withRetry(
                { keyManager: km, retryTimeoutMs: 100, operationName: "test" },
                async () => { throw new Error("always fails"); },
            ),
            /timed out/,
        );
    });

    it("rotates credentials on retry", async () => {
        const km = new KeyManager(["key-a", "key-b"]);
        const usedKeys: string[] = [];
        let attempts = 0;

        await withRetry(
            { keyManager: km, retryTimeoutMs: 10_000, operationName: "test" },
            async (credential) => {
                usedKeys.push(credential);
                attempts++;
                if (attempts < 3) throw new Error("transient");
                return "done";
            },
        );

        // Should have used different credentials due to cool-down after errors
        assert.ok(usedKeys.length >= 2);
        // After first error on key-a, should switch to key-b
        assert.notEqual(usedKeys[0], usedKeys[1]);
    });
});
