import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeTranscribeResults } from "../dist/merge.js";
import type { ChunkBoundary } from "../dist/merge.js";

function word(text: string, startTime: number, endTime: number) {
    return { text, startTime, endTime, confidence: 1 };
}

describe("mergeTranscribeResults", () => {
    it("returns empty result for empty chunks", () => {
        const result = mergeTranscribeResults([]);
        assert.equal(result.text, "");
        assert.deepEqual(result.words, []);
        assert.equal(result.duration, 0);
        assert.equal(result.language, "");
    });

    it("passes through a single chunk", () => {
        const chunk: ChunkBoundary = {
            result: {
                text: "hello world",
                words: [word("hello", 0, 0.5), word("world", 0.6, 1.0)],
                language: "en",
                duration: 1.0,
            },
            ownedStart: 0,
            ownedEnd: Infinity,
        };
        const result = mergeTranscribeResults([chunk]);
        assert.equal(result.text, "hello world");
        assert.equal(result.words.length, 2);
        assert.equal(result.language, "en");
        assert.equal(result.duration, 1.0);
    });

    it("filters words by ownership boundaries", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 2, 3), word("c", 4, 5)],
                language: "en",
                duration: 5,
            },
            ownedStart: 0,
            ownedEnd: 3, // owns "a" (0) and "b" (2)
        };
        const chunk2: ChunkBoundary = {
            result: {
                text: "b c d",
                words: [word("b", 2, 3), word("c", 4, 5), word("d", 6, 7)],
                language: "en",
                duration: 7,
            },
            ownedStart: 3, // owns "c" (4) and "d" (6), not "b" (2)
            ownedEnd: Infinity,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        assert.equal(result.text, "a b c d");
        assert.equal(result.words.length, 4);
    });

    it("sorts words by startTime", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "z",
                words: [word("z", 5, 6)],
                language: "en",
                duration: 6,
            },
            ownedStart: 3,
            ownedEnd: Infinity,
        };
        const chunk2: ChunkBoundary = {
            result: {
                text: "a",
                words: [word("a", 1, 2)],
                language: "en",
                duration: 2,
            },
            ownedStart: 0,
            ownedEnd: 3,
        };
        // Pass in reverse order
        const result = mergeTranscribeResults([chunk1, chunk2]);
        assert.equal(result.words[0].text, "a");
        assert.equal(result.words[1].text, "z");
    });

    it("uses language from first chunk", () => {
        const chunk1: ChunkBoundary = {
            result: { text: "hola", words: [word("hola", 0, 1)], language: "es", duration: 1 },
            ownedStart: 0,
            ownedEnd: 2,
        };
        const chunk2: ChunkBoundary = {
            result: { text: "world", words: [word("world", 2, 3)], language: "en", duration: 3 },
            ownedStart: 2,
            ownedEnd: Infinity,
        };
        assert.equal(mergeTranscribeResults([chunk1, chunk2]).language, "es");
    });

    it("derives duration from last word endTime", () => {
        const chunk: ChunkBoundary = {
            result: {
                text: "a b",
                words: [word("a", 0, 1), word("b", 2, 3.5)],
                language: "en",
                duration: 10,
            },
            ownedStart: 0,
            ownedEnd: Infinity,
        };
        // Duration is from last word's endTime, not the original result.duration
        assert.equal(mergeTranscribeResults([chunk]).duration, 3.5);
    });
});
