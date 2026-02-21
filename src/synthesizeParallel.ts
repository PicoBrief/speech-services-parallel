/**
 * Parallel text-to-speech synthesis with audio concatenation.
 *
 * Each text chunk is synthesized independently (with retry and credential
 * rotation), written to a temporary file to keep memory usage low, and then
 * concatenated into a single audio buffer via ffmpeg (or `Buffer.concat` as
 * a fallback). The result includes per-chunk metadata with timing offsets.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getAudioDuration } from "@pico-brief/audio-duration";
import type { SynthesizeParams } from "@pico-brief/speech-services";
import { KeyManager } from "./KeyManager.js";
import { createClientFromCredential } from "./clientFactory.js";
import { withRetry } from "./retry.js";
import { mapWithConcurrency } from "./concurrency.js";
import { generateRandomString, bufferToArrayBuffer } from "./helpers.js";
import { detectAudioFormat, audioFormatToExtension } from "./audioFormat.js";
import type {
    SynthesizeParallelParams,
    SynthesizeParallelResult,
    SynthesizeChunkInput,
    SynthesizeChunkResult,
    SynthesizeCredential,
} from "./types.js";

const commander = promisify(exec);

/** Directory for temporary chunk audio files. */
const workdir = os.tmpdir();

/**
 * Synthesizes multiple text chunks into a single audio buffer in parallel.
 *
 * Chunks are processed concurrently (optionally limited by `maxConcurrency`),
 * each with automatic retry and credential rotation. The resulting audio
 * segments are concatenated via ffmpeg into one continuous file.
 *
 * @param params - Configuration including provider, credentials, text chunks, and options.
 * @returns Combined audio buffer, format string, and per-chunk metadata with timing offsets.
 *
 * @example
 * ```ts
 * const result = await synthesizeParallel({
 *   provider: "openai",
 *   credentials: [{ apiKey: "sk-..." }],
 *   chunks: [{ text: "Hello" }, { text: "World" }],
 *   ffmpegPath: "ffmpeg",
 * });
 * fs.writeFileSync("output.mp3", result.audio);
 * ```
 */
export async function synthesizeParallel(params: SynthesizeParallelParams): Promise<SynthesizeParallelResult> {
    const { chunks, ffmpegPath } = params;
    const retryTimeoutMs = params.retryTimeoutMs ?? 5 * 60 * 1000;
    const { onProgress, signal, maxConcurrency } = params;

    const provider = params.provider;
    const defaultGender = params.gender;
    const defaultVoice = params.voice;
    const defaultLanguages = params.languages;
    const defaultProviderOptions = params.providerOptions;

    const keyManager = new KeyManager<SynthesizeCredential>(params.credentials as SynthesizeCredential[]);

    const tmpPrefix = path.join(workdir, generateRandomString());
    const tmpFiles: string[] = [];

    try {
        // Synthesize all chunks with optional concurrency limiting.
        // Each chunk is written to disk immediately to avoid holding all audio in memory.
        let completed = 0;
        const chunkMetas = await mapWithConcurrency(
            chunks,
            async (input: SynthesizeChunkInput, i: number) => {
                // Merge per-chunk provider options on top of the defaults
                const resolvedProviderOptions = input.providerOptions
                    ? { ...defaultProviderOptions, ...input.providerOptions }
                    : defaultProviderOptions;

                const result = await withRetry(
                    { keyManager, retryTimeoutMs, signal, operationName: "Synthesis" },
                    (credential) => {
                        const client = createClientFromCredential(provider, credential);
                        return client.synthesize({
                            provider,
                            text: input.text,
                            gender: input.gender ?? defaultGender,
                            voice: input.voice ?? defaultVoice,
                            languages: input.languages ?? defaultLanguages,
                            providerOptions: resolvedProviderOptions,
                        } as unknown as SynthesizeParams);
                    },
                );

                // Compute duration while the audio buffer is still in scope
                const duration = getAudioDuration(bufferToArrayBuffer(result.audio));

                // Write each chunk to disk immediately to free memory
                const ext = audioFormatToExtension(detectAudioFormat(result.audio));
                const chunkFile = `${tmpPrefix}_chunk_${i}.${ext}`;
                fs.writeFileSync(chunkFile, result.audio);
                tmpFiles.push(chunkFile);

                onProgress?.(++completed, chunks.length);

                return {
                    index: i,
                    duration,
                    voice: result.voice,
                    format: result.format,
                    chunkFile,
                };
            },
            maxConcurrency,
        );

        // Sort by original index to ensure correct ordering
        chunkMetas.sort((a, b) => a.index - b.index);

        // Build per-chunk result metadata with cumulative start times
        let timeAcc = 0;
        const chunkResults: SynthesizeChunkResult[] = chunkMetas.map(({ index, duration, voice, format }) => {
            const startTime = timeAcc;
            timeAcc += duration;

            // Try to derive language from voice name (e.g. "en-US-JennyNeural" → "en-US"),
            // otherwise fall back to the first language in the languages array
            const voiceParts = voice.split("-");
            const resolvedLanguages = chunks[index].languages ?? params.languages;
            const language: string | undefined =
                voiceParts.length >= 2
                    ? voiceParts.slice(0, 2).join("-")
                    : resolvedLanguages?.[0];

            return { chunkIndex: index, startTime, duration, voice, language, format, provider };
        });

        const format = chunkMetas[0]?.format ?? "mp3";

        // Concatenate all chunk audio files into a single output
        let combinedAudio: Buffer;
        if (ffmpegPath) {
            // Use ffmpeg's concat demuxer for seamless joining
            const outExt = audioFormatToExtension(detectAudioFormat(fs.readFileSync(chunkMetas[0].chunkFile)));
            const manifestFile = `${tmpPrefix}_manifest.txt`;
            // ffmpeg concat demuxer requires single-quoted paths in the manifest
            const manifestContent = chunkMetas
                .map(m => `file '${m.chunkFile}'`)
                .join("\n");
            fs.writeFileSync(manifestFile, manifestContent);
            tmpFiles.push(manifestFile);

            const outFile = `${tmpPrefix}_out.${outExt}`;
            tmpFiles.push(outFile);
            await commander(`"${ffmpegPath}" -f concat -safe 0 -i "${manifestFile}" -c copy "${outFile}"`);
            combinedAudio = fs.readFileSync(outFile);
        } else {
            // Fallback: naive buffer concatenation (may produce audible glitches)
            console.warn("ffmpegPath not set; using Buffer.concat — audio may not be seamlessly joined");
            combinedAudio = Buffer.concat(
                chunkMetas.map(m => fs.readFileSync(m.chunkFile)),
            );
        }

        return { audio: combinedAudio, format, chunks: chunkResults };
    } finally {
        // Clean up all temporary files regardless of success or failure
        for (const f of tmpFiles) {
            try { fs.unlinkSync(f); } catch { /* ignore cleanup errors */ }
        }
    }
}
