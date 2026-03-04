/**
 * Merging logic for transcription results from overlapping audio chunks.
 *
 * When audio is split into overlapping chunks, each chunk may transcribe words
 * that fall in the overlap region. This module finds a "hand-over" point in
 * each overlap where we switch from the earlier chunk's words to the later
 * chunk's words, so that each word appears exactly once in the merged output.
 */

import type { TranscribeResult, TranscribedWord } from "@pico-brief/speech-services";

/**
 * A single chunk's transcription result together with its global time offset.
 *
 * The `offset` is the start time (in seconds) of this chunk's audio slice
 * within the original file. Word timestamps returned by the provider are
 * chunk-local (starting near 0); adding `offset` converts them to global time.
 */
export interface ChunkBoundary {
    /** The transcription result for this chunk. */
    result: TranscribeResult;
    /** Global start time of this chunk's audio slice, in seconds. */
    offset: number;
}

/** Strip leading/trailing punctuation and lowercase for comparison. */
function normalizeWord(text: string): string {
    return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Create a copy of each word with timestamps shifted by `offset`. */
function offsetWords(words: TranscribedWord[], offset: number): TranscribedWord[] {
    if (offset === 0) return words.map(w => ({ ...w }));
    return words.map(w => ({ ...w, startTime: w.startTime + offset, endTime: w.endTime + offset }));
}

/** Check whether two words match by normalized text and close timing. */
function wordsMatch(a: TranscribedWord, b: TranscribedWord, tolerance: number): boolean {
    return (
        normalizeWord(a.text) === normalizeWord(b.text) &&
        Math.abs(a.startTime - b.startTime) <= tolerance
    );
}

/**
 * Finds the hand-over point between two consecutive chunks' word lists
 * (both already in global time).
 *
 * The overlap region is where the later chunk's words begin (its earliest
 * `startTime`) up to where the earlier chunk's words end (its latest
 * `endTime`). Within that region we look for a matching word (or pair of
 * consecutive words) that appears in both lists — matched by both text and
 * timing. The hand-over happens at that match: we keep the earlier chunk's
 * words before it, and the later chunk's words from it onward.
 *
 * Matching is attempted first with a tight tolerance (0.1 s). If no match
 * is found, it is retried with a loose tolerance (0.5 s). If still no
 * match, the overlap is split at the midpoint.
 *
 * @returns `{ prevKeepCount, nextSkipCount }` — keep `prevWords[0..prevKeepCount)`
 *          and append `nextWords[nextSkipCount..]`.
 */
function findHandover(
    prevWords: TranscribedWord[],
    nextWords: TranscribedWord[],
): { prevKeepCount: number; nextSkipCount: number } {
    if (prevWords.length === 0) return { prevKeepCount: 0, nextSkipCount: 0 };
    if (nextWords.length === 0) return { prevKeepCount: prevWords.length, nextSkipCount: 0 };

    const overlapStart = nextWords[0].startTime;
    const overlapEnd = prevWords[prevWords.length - 1].endTime;

    // No overlap — just concatenate
    if (overlapStart >= overlapEnd) {
        return { prevKeepCount: prevWords.length, nextSkipCount: 0 };
    }

    // Index of the first prevWord inside the overlap region.
    // Pad by the loose tolerance so words just outside the boundary are still
    // considered — providers may report slightly different timestamps for the
    // same spoken word.
    const prevOverlapIdx = prevWords.findIndex(w => w.startTime >= overlapStart - 0.5);
    if (prevOverlapIdx === -1) {
        return { prevKeepCount: prevWords.length, nextSkipCount: 0 };
    }

    // Index of the first nextWord past the overlap region
    let nextOverlapEnd = nextWords.findIndex(w => w.startTime >= overlapEnd);
    if (nextOverlapEnd === -1) nextOverlapEnd = nextWords.length;

    // Try matching with tight tolerance first, then loose
    for (const tolerance of [0.1, 0.5]) {
        // Try to find two consecutive matching words (more reliable than a single match)
        for (let pi = prevOverlapIdx; pi < prevWords.length - 1; pi++) {
            for (let ni = 0; ni < nextOverlapEnd - 1; ni++) {
                if (
                    wordsMatch(prevWords[pi], nextWords[ni], tolerance) &&
                    wordsMatch(prevWords[pi + 1], nextWords[ni + 1], tolerance)
                ) {
                    return { prevKeepCount: pi, nextSkipCount: ni };
                }
            }
        }

        // Fallback: single word match
        for (let pi = prevOverlapIdx; pi < prevWords.length; pi++) {
            for (let ni = 0; ni < nextOverlapEnd; ni++) {
                if (wordsMatch(prevWords[pi], nextWords[ni], tolerance)) {
                    return { prevKeepCount: pi, nextSkipCount: ni };
                }
            }
        }
    }

    // No text+time match at all — split at the midpoint of the overlap
    const midpoint = (overlapStart + overlapEnd) / 2;
    let prevKeepCount = prevWords.length;
    for (let i = prevOverlapIdx; i < prevWords.length; i++) {
        if (prevWords[i].startTime >= midpoint) {
            prevKeepCount = i;
            break;
        }
    }
    let nextSkipCount = 0;
    for (let i = 0; i < nextWords.length; i++) {
        if (nextWords[i].startTime >= midpoint) {
            nextSkipCount = i;
            break;
        }
    }
    return { prevKeepCount, nextSkipCount };
}

/**
 * Merges multiple chunk transcription results into a single unified result.
 *
 * Word timestamps are shifted by each chunk's `offset` to produce global
 * timestamps. For each pair of consecutive chunks, a hand-over point is found
 * in the overlap region so that duplicate words are eliminated.
 *
 * @param chunks - Array of chunk results with their time offsets, in order.
 * @returns A single merged {@link TranscribeResult} with deduplicated, sorted words.
 */
export function mergeTranscribeResults(chunks: ChunkBoundary[]): TranscribeResult {
    if (chunks.length === 0) {
        return { text: "", words: [], language: "", duration: 0 };
    }

    // Offset every chunk's words to global time
    const offsetChunks = chunks.map(({ result, offset }) => offsetWords(result.words, offset));

    // Start with all words from the first chunk
    let merged = offsetChunks[0];

    // Merge each subsequent chunk by finding a hand-over in the overlap
    for (let i = 1; i < offsetChunks.length; i++) {
        const next = offsetChunks[i];
        const { prevKeepCount, nextSkipCount } = findHandover(merged, next);
        merged = [...merged.slice(0, prevKeepCount), ...next.slice(nextSkipCount)];
    }

    const text = merged.map(w => w.text).join(" ");
    const duration = merged.length > 0 ? merged[merged.length - 1].endTime : 0;
    const language = chunks[0].result.language;

    return { text, words: merged, language, duration };
}
