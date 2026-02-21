import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../dist/concurrency.js";

describe("mapWithConcurrency", () => {
    it("maps all items without limit", async () => {
        const result = await mapWithConcurrency(
            [1, 2, 3],
            async (x) => x * 2,
        );
        assert.deepEqual(result, [2, 4, 6]);
    });

    it("preserves result order with limit", async () => {
        const result = await mapWithConcurrency(
            [3, 1, 2],
            async (x) => {
                await new Promise(r => setTimeout(r, x * 10));
                return x;
            },
            2,
        );
        assert.deepEqual(result, [3, 1, 2]);
    });

    it("enforces concurrency limit", async () => {
        let active = 0;
        let maxActive = 0;

        await mapWithConcurrency(
            [1, 2, 3, 4, 5],
            async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise(r => setTimeout(r, 20));
                active--;
            },
            2,
        );
        assert.equal(maxActive, 2);
    });

    it("uses Promise.all when limit >= items.length", async () => {
        let active = 0;
        let maxActive = 0;

        await mapWithConcurrency(
            [1, 2, 3],
            async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise(r => setTimeout(r, 20));
                active--;
            },
            10, // limit >= items.length
        );
        // All 3 should run concurrently
        assert.equal(maxActive, 3);
    });

    it("passes index to callback", async () => {
        const indices: number[] = [];
        await mapWithConcurrency(
            ["a", "b", "c"],
            async (_, i) => { indices.push(i); },
            1,
        );
        assert.deepEqual(indices, [0, 1, 2]);
    });
});
