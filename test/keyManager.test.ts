import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KeyManager } from "../dist/KeyManager.js";

describe("KeyManager", () => {
    it("throws with empty credentials", () => {
        assert.throws(() => new KeyManager([]), /at least one credential/);
    });

    it("returns single credential repeatedly", () => {
        const km = new KeyManager(["key-a"]);
        assert.equal(km.getKey(), "key-a");
        assert.equal(km.getKey(), "key-a");
        assert.equal(km.getKey(), "key-a");
    });

    it("rotates through multiple credentials (LRU)", () => {
        const km = new KeyManager(["a", "b", "c"]);
        const first = km.getKey();
        const second = km.getKey();
        const third = km.getKey();
        // All three distinct credentials should be returned
        const seen = new Set([first, second, third]);
        assert.equal(seen.size, 3);
    });

    it("skips credentials in cool-down", () => {
        const km = new KeyManager(["a", "b"]);
        const keyA = km.getKey(); // gets "a" (LRU)
        km.reportError(keyA, 60_000); // cool down "a" for 60s

        // Next calls should return "b" since "a" is cooling
        assert.equal(km.getKey(), "b");
        assert.equal(km.getKey(), "b");
    });

    it("falls back to all credentials when all are cooling down", () => {
        const km = new KeyManager(["a", "b"]);
        const keyA = km.getKey();
        km.reportError(keyA, 60_000);
        const keyB = km.getKey();
        km.reportError(keyB, 60_000);

        // Both cooling — falls back to all, returns LRU
        const key = km.getKey();
        assert.ok(key === "a" || key === "b");
    });
});
