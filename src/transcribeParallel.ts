/**
 * Parallel audio transcription with automatic chunking.
 *
 * Long audio files are split into overlapping chunks via ffmpeg, each chunk is
 * transcribed in parallel (with retry and credential rotation), and the results
 * are merged back into a single {@link TranscribeResult} with word-level timing.
 *
 * Short audio (≤ one chunk) is transcribed directly without any splitting.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getAudioDuration } from "@pico-brief/audio-duration";
import type { TranscribeResult, TranscribeParams } from "@pico-brief/speech-services";
import { KeyManager } from "./KeyManager.js";
import { createClientFromCredential } from "./clientFactory.js";
import { mergeTranscribeResults } from "./merge.js";
import type { ChunkBoundary } from "./merge.js";
import { withRetry } from "./retry.js";
import { mapWithConcurrency } from "./concurrency.js";
import { generateRandomString, formatTimestamp, bufferToArrayBuffer } from "./helpers.js";
import { detectAudioFormat, audioFormatToExtension } from "./audioFormat.js";
import type { TranscribeParallelParams, TranscribeCredential, StorageProvider } from "./types.js";

const commander = promisify(exec);

/** Directory for temporary chunk files created during splitting. */
const workdir = os.tmpdir();

/**
 * Transcribes an audio buffer in parallel using the specified provider.
 *
 * If the audio is longer than `targetChunkDuration` (default 300 s), it is split
 * into overlapping chunks via ffmpeg. Each chunk is sent to the provider with
 * automatic retry, credential rotation, and optional concurrency limiting.
 * Overlapping words at chunk boundaries are deduplicated during the merge step.
 *
 * @param params - Configuration including provider, credentials, audio data, and options.
 * @returns A merged transcription result with full text, word-level timestamps, language, and duration.
 *
 * @example
 * ```ts
 * const result = await transcribeParallel({
 *   provider: "openai",
 *   credentials: [{ apiKey: "sk-..." }],
 *   audio: fs.readFileSync("interview.mp3"),
 *   ffmpegPath: "ffmpeg",
 * });
 * console.log(result.text);
 * ```
 */
export async function transcribeParallel(params: TranscribeParallelParams): Promise<TranscribeResult> {
    const { audio, languages, ffmpegPath } = params;
    const targetChunkDuration = params.targetChunkDuration ?? 300;
    const chunkOverlap = params.chunkOverlap ?? 15;
    const retryTimeoutMs = params.retryTimeoutMs ?? 5 * 60 * 1000;
    const { onProgress, signal, maxConcurrency } = params;

    const provider = params.provider;
    const providerOptions = params.providerOptions;
    const storageProvider: StorageProvider | undefined = params.storageProvider;

    // Validate: Azure batch mode requires a storageProvider
    if (
        provider === "azure" &&
        providerOptions &&
        "mode" in providerOptions &&
        (providerOptions as Record<string, unknown>).mode === "batch" &&
        !storageProvider
    ) {
        throw new Error("Azure batch transcription requires a storageProvider to upload audio chunks.");
    }

    const keyManager = new KeyManager<TranscribeCredential>(params.credentials as TranscribeCredential[]);
    const sessionId = generateRandomString();
    const uploadedKeys: string[] = [];

    /**
     * Transcribes a single audio chunk. If a storageProvider is configured, the
     * buffer is uploaded first and the resulting URL is passed as `audio`.
     * Upload happens outside the retry loop so it is only done once.
     */
    const transcribeChunk = async (buffer: Buffer, chunkIndex: number): Promise<TranscribeResult> => {
        let audioInput: Buffer | string = buffer;

        if (storageProvider) {
            const key = `${sessionId}_chunk_${chunkIndex}`;
            const url = await storageProvider.upload(buffer, key);
            uploadedKeys.push(key);
            audioInput = url;
        }

        return withRetry(
            { keyManager, retryTimeoutMs, signal, operationName: "Transcription" },
            (credential) => {
                const client = createClientFromCredential(provider, credential);
                return client.transcribe({
                    provider,
                    audio: audioInput,
                    languages,
                    providerOptions,
                } as unknown as TranscribeParams);
            },
        );
    };

    // Compute total duration and determine how many chunks we need
    const totalDuration = getAudioDuration(bufferToArrayBuffer(audio));
    const numChunks = Math.max(1, Math.round(totalDuration / targetChunkDuration));

    try {
        // Single chunk — transcribe directly, no ffmpeg splitting needed
        if (numChunks === 1) return await transcribeChunk(audio, 0);

        // Multiple chunks — split the audio file and transcribe each piece
        const ext = audioFormatToExtension(detectAudioFormat(audio));
        const tmpPrefix = path.join(workdir, generateRandomString());
        const srcFile = `${tmpPrefix}_src.${ext}`;
        const tmpFiles: string[] = [srcFile];

        try {
            fs.writeFileSync(srcFile, audio);

            // D = ideal duration of each chunk (before adding overlap)
            const D = totalDuration / numChunks;

            // Build chunk file paths and ownership boundaries
            const chunkFiles: string[] = [];
            const chunkMetas: { ownedStart: number; ownedEnd: number }[] = [];

            for (let i = 0; i < numChunks; i++) {
                const chunkFile = `${tmpPrefix}_chunk_${i}.${ext}`;
                tmpFiles.push(chunkFile);
                chunkFiles.push(chunkFile);

                // Each chunk "owns" a time range. Words outside this range are discarded
                // during merge to eliminate duplicates from overlapping regions.
                const ownedStart = i * D;
                const ownedEnd = i < numChunks - 1 ? (i + 1) * D : Infinity;
                chunkMetas.push({ ownedStart, ownedEnd });
            }

            // Slice all chunks in parallel via ffmpeg (each writes to a separate file).
            // Slices extend beyond the owned range by `chunkOverlap` on each side so
            // that words straddling chunk boundaries are captured by both neighbors.
            await Promise.all(
                chunkFiles.map((chunkFile, i) => {
                    const sliceStart = Math.max(0, i * D - chunkOverlap);
                    const sliceEnd = Math.min(totalDuration, (i + 1) * D + chunkOverlap);
                    const startTs = formatTimestamp(sliceStart);
                    const endTs = formatTimestamp(sliceEnd);
                    return commander(`"${ffmpegPath}" -ss ${startTs} -to ${endTs} -i "${srcFile}" -c copy "${chunkFile}"`);
                }),
            );

            // Transcribe each chunk with optional concurrency limiting
            let completed = 0;
            const chunkBoundaries = await mapWithConcurrency(
                chunkFiles,
                async (chunkFile, i): Promise<ChunkBoundary> => {
                    const chunkBuffer = fs.readFileSync(chunkFile);
                    const result = await transcribeChunk(chunkBuffer, i);
                    onProgress?.(++completed, numChunks);
                    return { result, ownedStart: chunkMetas[i].ownedStart, ownedEnd: chunkMetas[i].ownedEnd };
                },
                maxConcurrency,
            );

            // Merge all chunk results, deduplicating words at overlap boundaries
            return mergeTranscribeResults(chunkBoundaries);
        } finally {
            // Clean up all temporary files regardless of success or failure
            for (const f of tmpFiles) {
                try { fs.unlinkSync(f); } catch { /* ignore cleanup errors */ }
            }
        }
    } finally {
        // Clean up uploaded storage objects regardless of success or failure
        for (const key of uploadedKeys) {
            try { await storageProvider?.delete(key); } catch { /* ignore cleanup errors */ }
        }
    }
}
