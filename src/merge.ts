/**
 * Merging logic for transcription results from overlapping audio chunks.
 *
 * When audio is split into overlapping chunks, each chunk may transcribe words
 * that fall in the overlap region. This module filters words by ownership
 * boundaries so that each word appears exactly once in the merged output.
 */

import type { TranscribeResult, TranscribedWord } from "@pico-brief/speech-services";

/**
 * Defines the ownership range for a single chunk's transcription result.
 *
 * Words whose `startTime` falls within `[ownedStart, ownedEnd)` are kept;
 * words outside that range (i.e. in the overlap zone) are discarded to
 * prevent duplicates.
 */
export interface ChunkBoundary {
    /** The transcription result for this chunk. */
    result: TranscribeResult;
    /** Inclusive lower bound of the time range this chunk "owns" (seconds). */
    ownedStart: number;
    /** Exclusive upper bound; set to `Infinity` for the last chunk. */
    ownedEnd: number;
}

/**
 * Merges multiple chunk transcription results into a single unified result.
 *
 * For each chunk, only words whose `startTime` falls within the chunk's owned
 * range are included. The combined words are sorted by timestamp, and the
 * full text is reconstructed by joining word texts with spaces.
 *
 * @param chunks - Array of chunk results with their ownership boundaries.
 * @returns A single merged {@link TranscribeResult} with deduplicated, sorted words.
 */
export function mergeTranscribeResults(chunks: ChunkBoundary[]): TranscribeResult {
    const allWords: TranscribedWord[] = [];

    for (const { result, ownedStart, ownedEnd } of chunks) {
        for (const word of result.words) {
            // Only keep words that fall within this chunk's owned time range
            if (word.startTime >= ownedStart && word.startTime < ownedEnd) {
                allWords.push(word);
            }
        }
    }

    // Sort all words by their start time for correct ordering
    allWords.sort((a, b) => a.startTime - b.startTime);

    const text = allWords.map(w => w.text).join(" ");
    // Duration is the end time of the last word (safe against Infinity from ownedEnd)
    const duration = allWords.length > 0 ? allWords[allWords.length - 1].endTime : 0;
    // Use the language detected by the first chunk
    const language = chunks.length > 0 ? chunks[0].result.language : "";

    return { text, words: allWords, language, duration };
}
