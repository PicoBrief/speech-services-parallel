/**
 * Type definitions for the parallel speech services API.
 *
 * This file defines the parameter and result types for {@link transcribeParallel}
 * and {@link synthesizeParallel}. Discriminated unions are used so that TypeScript
 * can narrow the credential and option types based on the chosen `provider`.
 */

import type {
    AssemblyAIConfig,
    AssemblyAITranscribeOptions,
    AzureConfig,
    AzureTranscribeOptions,
    AzureSynthesizeOptions,
    CartesiaConfig,
    CartesiaSynthesizeOptions,
    DeepgramConfig,
    DeepgramTranscribeOptions,
    DeepgramSynthesizeOptions,
    ElevenLabsConfig,
    ElevenLabsTranscribeOptions,
    ElevenLabsSynthesizeOptions,
    GoogleConfig,
    GoogleTranscribeOptions,
    GoogleSynthesizeOptions,
    OpenAIConfig,
    OpenAITranscribeOptions,
    OpenAISynthesizeOptions,
    PlayHTConfig,
    PlayHTSynthesizeOptions,
    RevAIConfig,
    RevAITranscribeOptions,
    SpeechmaticsConfig,
    SpeechmaticsTranscribeOptions,
} from "@pico-brief/speech-services";

// ─── Provider-to-config maps ────────────────────────────────────────────────

/** Maps each transcription provider name to its credential/config type. */
export interface TranscribeProviderConfigMap {
    azure: AzureConfig;
    assemblyai: AssemblyAIConfig;
    deepgram: DeepgramConfig;
    elevenlabs: ElevenLabsConfig;
    google: GoogleConfig;
    openai: OpenAIConfig;
    revai: RevAIConfig;
    speechmatics: SpeechmaticsConfig;
}

/** Maps each synthesis provider name to its credential/config type. */
export interface SynthesizeProviderConfigMap {
    azure: AzureConfig;
    cartesia: CartesiaConfig;
    deepgram: DeepgramConfig;
    elevenlabs: ElevenLabsConfig;
    google: GoogleConfig;
    openai: OpenAIConfig;
    playht: PlayHTConfig;
}

// ─── Provider-to-options maps ───────────────────────────────────────────────

/** Maps each transcription provider name to its provider-specific options type. */
export interface TranscribeProviderOptionsMap {
    azure: AzureTranscribeOptions;
    assemblyai: AssemblyAITranscribeOptions;
    deepgram: DeepgramTranscribeOptions;
    elevenlabs: ElevenLabsTranscribeOptions;
    google: GoogleTranscribeOptions;
    openai: OpenAITranscribeOptions;
    revai: RevAITranscribeOptions;
    speechmatics: SpeechmaticsTranscribeOptions;
}

/** Maps each synthesis provider name to its provider-specific options type. */
export interface SynthesizeProviderOptionsMap {
    azure: AzureSynthesizeOptions;
    cartesia: CartesiaSynthesizeOptions;
    deepgram: DeepgramSynthesizeOptions;
    elevenlabs: ElevenLabsSynthesizeOptions;
    google: GoogleSynthesizeOptions;
    openai: OpenAISynthesizeOptions;
    playht: PlayHTSynthesizeOptions;
}

// ─── Transcribe parallel params ─────────────────────────────────────────────

/** Shared (provider-agnostic) fields for {@link TranscribeParallelParams}. */
type TranscribeParallelBase = {
    /** Raw audio data to transcribe. */
    audio: Buffer;
    /** Language hints for the provider (e.g. `["en"]`). */
    languages?: string[];
    /** Target duration of each audio chunk in seconds. @default 300 */
    targetChunkDuration?: number;
    /** Overlap between adjacent chunks in seconds, to avoid losing words at boundaries. @default 15 */
    chunkOverlap?: number;
    /** Absolute path (or command name) for the ffmpeg binary used to split audio. */
    ffmpegPath: string;
    /** Maximum time in milliseconds to keep retrying transient failures. @default 300000 */
    retryTimeoutMs?: number;
    /** Maximum number of chunks to transcribe in parallel at once. Unlimited by default. */
    maxConcurrency?: number;
    /** Signal to cancel the operation early. */
    signal?: AbortSignal;
    /** Called each time a chunk finishes. `completed` counts up to `total`. */
    onProgress?: (completed: number, total: number) => void;
};

/**
 * Parameters for {@link transcribeParallel}.
 *
 * This is a discriminated union — setting `provider` to e.g. `"openai"` narrows
 * `credentials` to `OpenAIConfig[]` and `providerOptions` to `OpenAITranscribeOptions`.
 */
export type TranscribeParallelParams = {
    [P in keyof TranscribeProviderConfigMap]: TranscribeParallelBase & {
        /** The speech-to-text provider to use. */
        provider: P;
        /** One or more credential objects for the chosen provider. Multiple credentials enable automatic rotation. */
        credentials: TranscribeProviderConfigMap[P][];
        /** Extra provider-specific options passed through to the underlying client. */
        providerOptions?: TranscribeProviderOptionsMap[P];
    };
}[keyof TranscribeProviderConfigMap];

// ─── Synthesize parallel params ─────────────────────────────────────────────

/** A single text chunk to be synthesized, with optional per-chunk overrides. */
export interface SynthesizeChunkInput {
    /** The text content to convert to speech. */
    text: string;
    /** Override the default gender for this chunk. */
    gender?: "male" | "female";
    /** Override the default voice ID/name for this chunk. */
    voice?: string;
    /** Override the default languages for this chunk. */
    languages?: string[];
    /** Override the default provider options for this chunk. Merged on top of the top-level `providerOptions`. */
    providerOptions?: Record<string, unknown>;
}

/** Metadata about a single synthesized chunk within the combined audio. */
export interface SynthesizeChunkResult {
    /** Zero-based index of this chunk in the original input array. */
    chunkIndex: number;
    /** Offset of this chunk within the combined audio, in seconds. */
    startTime: number;
    /** Duration of this chunk in seconds. */
    duration: number;
    /** The voice ID or name that was actually used. */
    voice: string;
    /** Language derived from the voice name or from the `languages` array. */
    language?: string;
    /** Audio format of this chunk (e.g. `"mp3"`). */
    format: string;
    /** The provider that produced this chunk. */
    provider: string;
}

/** The combined result returned by {@link synthesizeParallel}. */
export interface SynthesizeParallelResult {
    /** The concatenated audio data for all chunks. */
    audio: Buffer;
    /** Audio format of the combined output (e.g. `"mp3"`). */
    format: string;
    /** Per-chunk metadata including timing offsets and voices used. */
    chunks: SynthesizeChunkResult[];
}

/** Shared (provider-agnostic) fields for {@link SynthesizeParallelParams}. */
type SynthesizeParallelBase = {
    /** Array of text chunks to synthesize. */
    chunks: SynthesizeChunkInput[];
    /** Default voice gender applied to chunks that don't specify their own. */
    gender?: "male" | "female";
    /** Default voice ID/name applied to chunks that don't specify their own. */
    voice?: string;
    /** Default language hints applied to chunks that don't specify their own. */
    languages?: string[];
    /** Path to ffmpeg for concatenating chunk audio files. If omitted, `Buffer.concat` is used as a fallback. */
    ffmpegPath?: string;
    /** Maximum time in milliseconds to keep retrying transient failures. @default 300000 */
    retryTimeoutMs?: number;
    /** Maximum number of chunks to synthesize in parallel at once. Unlimited by default. */
    maxConcurrency?: number;
    /** Signal to cancel the operation early. */
    signal?: AbortSignal;
    /** Called each time a chunk finishes. `completed` counts up to `total`. */
    onProgress?: (completed: number, total: number) => void;
};

/**
 * Parameters for {@link synthesizeParallel}.
 *
 * This is a discriminated union — setting `provider` to e.g. `"elevenlabs"` narrows
 * `credentials` to `ElevenLabsConfig[]` and `providerOptions` to `ElevenLabsSynthesizeOptions`.
 */
export type SynthesizeParallelParams = {
    [P in keyof SynthesizeProviderConfigMap]: SynthesizeParallelBase & {
        /** The text-to-speech provider to use. */
        provider: P;
        /** One or more credential objects for the chosen provider. Multiple credentials enable automatic rotation. */
        credentials: SynthesizeProviderConfigMap[P][];
        /** Extra provider-specific options passed through to the underlying client. */
        providerOptions?: SynthesizeProviderOptionsMap[P];
    };
}[keyof SynthesizeProviderConfigMap];

// ─── Internal credential union aliases ──────────────────────────────────────

/** @internal Union of all transcription provider credential types. */
export type TranscribeCredential = TranscribeProviderConfigMap[keyof TranscribeProviderConfigMap];
/** @internal Union of all synthesis provider credential types. */
export type SynthesizeCredential = SynthesizeProviderConfigMap[keyof SynthesizeProviderConfigMap];
