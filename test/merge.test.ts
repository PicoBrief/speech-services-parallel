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
            offset: 0,
        };
        const result = mergeTranscribeResults([chunk]);
        assert.equal(result.text, "hello world");
        assert.equal(result.words.length, 2);
        assert.equal(result.language, "en");
        assert.equal(result.duration, 1.0);
    });

    it("offsets word timestamps by chunk offset", () => {
        const chunk: ChunkBoundary = {
            result: {
                text: "hello world",
                words: [word("hello", 0, 0.5), word("world", 0.6, 1.0)],
                language: "en",
                duration: 1.0,
            },
            offset: 100,
        };
        const result = mergeTranscribeResults([chunk]);
        assert.equal(result.words[0].startTime, 100);
        assert.equal(result.words[0].endTime, 100.5);
        assert.equal(result.words[1].startTime, 100.6);
        assert.equal(result.words[1].endTime, 101.0);
    });

    it("finds hand-over in overlap and deduplicates words", () => {
        // Chunk 0: audio from 0-15s, words at 0-12s
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c d",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7), word("d", 9, 10)],
                language: "en",
                duration: 10,
            },
            offset: 0,
        };
        // Chunk 1: audio from 5s onward, words starting at local time 0
        // "c" and "d" overlap with chunk 0 (global times 6 and 9 → appear as 1, 4 in chunk-local)
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d e f",
                words: [word("c", 1, 2), word("d", 4, 5), word("e", 7, 8), word("f", 10, 11)],
                language: "en",
                duration: 11,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // Hand-over at "c"/"d" pair match → keep a, b from chunk1; c, d, e, f from chunk2
        assert.equal(result.text, "a b c d e f");
        assert.equal(result.words.length, 6);
        // Words after hand-over use chunk2's timestamps (offset by 5)
        assert.equal(result.words[2].startTime, 6);  // "c" from chunk2: 1 + 5
        assert.equal(result.words[3].startTime, 9);  // "d" from chunk2: 4 + 5
        assert.equal(result.words[4].startTime, 12); // "e" from chunk2: 7 + 5
    });

    it("handles single-word hand-over when no two-word match exists", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        // Chunk 2 overlaps at "c" but the word after differs
        const chunk2: ChunkBoundary = {
            result: {
                text: "c x y",
                words: [word("c", 1, 2), word("x", 4, 5), word("y", 7, 8)],
                language: "en",
                duration: 8,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // Single word match on "c" → keep a, b from chunk1; c, x, y from chunk2
        assert.equal(result.text, "a b c x y");
        assert.equal(result.words.length, 5);
    });

    it("falls back to midpoint split when no words match", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        // Chunk 2 overlaps in time but has completely different words
        const chunk2: ChunkBoundary = {
            result: {
                text: "x y z",
                words: [word("x", 1, 2), word("y", 4, 5), word("z", 7, 8)],
                language: "en",
                duration: 8,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // No text match → midpoint split (overlap 6..7, midpoint ~6.5)
        // chunk1: a(0), b(3) kept; c(6) at midpoint so cut
        // chunk2: y(9 global), z(12 global) after midpoint
        assert.ok(result.words.length > 0);
        // All words should be in ascending time order
        for (let i = 1; i < result.words.length; i++) {
            assert.ok(result.words[i].startTime >= result.words[i - 1].startTime);
        }
    });

    it("concatenates non-overlapping chunks", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b",
                words: [word("a", 0, 1), word("b", 2, 3)],
                language: "en",
                duration: 3,
            },
            offset: 0,
        };
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d",
                words: [word("c", 0, 1), word("d", 2, 3)],
                language: "en",
                duration: 3,
            },
            offset: 10,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        assert.equal(result.text, "a b c d");
        assert.equal(result.words.length, 4);
        assert.equal(result.words[2].startTime, 10); // "c" offset by 10
    });

    it("uses language from first chunk", () => {
        const chunk1: ChunkBoundary = {
            result: { text: "hola", words: [word("hola", 0, 1)], language: "es", duration: 1 },
            offset: 0,
        };
        const chunk2: ChunkBoundary = {
            result: { text: "world", words: [word("world", 0, 1)], language: "en", duration: 1 },
            offset: 10,
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
            offset: 0,
        };
        // Duration is from last word's endTime, not the original result.duration
        assert.equal(mergeTranscribeResults([chunk]).duration, 3.5);
    });

    it("matches words case-insensitively and ignores punctuation", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "Hello, world",
                words: [word("Hello,", 0, 1), word("world", 3, 4)],
                language: "en",
                duration: 4,
            },
            offset: 0,
        };
        const chunk2: ChunkBoundary = {
            result: {
                text: "hello world goodbye",
                words: [word("hello", 0, 1), word("world", 3, 4), word("goodbye", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // "Hello," matches "hello", "world" matches "world" → hand-over at "hello"/"world"
        // Keep nothing from chunk1 (hand-over at first overlap word), all from chunk2
        assert.equal(result.words.length, 3);
        assert.ok(result.text.includes("goodbye"));
    });

    it("matches with tight tolerance (≤0.1s difference)", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        // "c" in chunk2 at global time 6.05 (within 0.1s of 6)
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d e",
                words: [word("c", 1.05, 2), word("d", 4, 5), word("e", 7, 8)],
                language: "en",
                duration: 8,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        assert.equal(result.text, "a b c d e");
        assert.equal(result.words.length, 5);
    });

    it("rejects match when text matches but time exceeds tight tolerance, retries with loose", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        // "c" in chunk2 at global time 6.3 — too far for 0.1s but within 0.5s
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d e",
                words: [word("c", 1.3, 2.3), word("d", 4, 5), word("e", 7, 8)],
                language: "en",
                duration: 8,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // Should still find handover via loose tolerance
        assert.equal(result.text, "a b c d e");
        assert.equal(result.words.length, 5);
    });

    it("falls back to midpoint when text matches but time exceeds loose tolerance", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c",
                words: [word("a", 0, 1), word("b", 3, 4), word("c", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        // "c" in chunk2 at global time 7.0 — 1s off, exceeds both tolerances
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d e",
                words: [word("c", 2.0, 3.0), word("d", 4, 5), word("e", 7, 8)],
                language: "en",
                duration: 8,
            },
            offset: 5,
        };
        const result = mergeTranscribeResults([chunk1, chunk2]);
        // No time match → midpoint split; words should still be in order
        assert.ok(result.words.length > 0);
        for (let i = 1; i < result.words.length; i++) {
            assert.ok(result.words[i].startTime >= result.words[i - 1].startTime);
        }
    });

    it("merges three chunks correctly", () => {
        const chunk1: ChunkBoundary = {
            result: {
                text: "a b c d",
                words: [word("a", 0, 1), word("b", 2, 3), word("c", 4, 5), word("d", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 0,
        };
        const chunk2: ChunkBoundary = {
            result: {
                text: "c d e f g h",
                words: [word("c", 0, 1), word("d", 2, 3), word("e", 4, 5), word("f", 6, 7), word("g", 8, 9), word("h", 10, 11)],
                language: "en",
                duration: 11,
            },
            offset: 4,
        };
        const chunk3: ChunkBoundary = {
            result: {
                text: "g h i j",
                words: [word("g", 0, 1), word("h", 2, 3), word("i", 4, 5), word("j", 6, 7)],
                language: "en",
                duration: 7,
            },
            offset: 12,
        };
        const result = mergeTranscribeResults([chunk1, chunk2, chunk3]);
        assert.equal(result.text, "a b c d e f g h i j");
        assert.equal(result.words.length, 10);
    });
});
