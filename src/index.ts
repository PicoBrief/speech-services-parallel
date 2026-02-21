/**
 * @module @pico-brief/speech-services-parallel
 *
 * Parallel orchestration for Speech-to-Text and Text-to-Speech operations.
 *
 * This module re-exports the two main entry points — {@link transcribeParallel}
 * and {@link synthesizeParallel} — along with the {@link KeyManager} class for
 * standalone credential rotation, and every public type used by the API.
 */

export { transcribeParallel } from "./transcribeParallel.js";
export { synthesizeParallel } from "./synthesizeParallel.js";
export { KeyManager } from "./KeyManager.js";

export type {
    TranscribeParallelParams,
    SynthesizeParallelParams,
    SynthesizeParallelResult,
    SynthesizeChunkInput,
    SynthesizeChunkResult,
} from "./types.js";

export type { ChunkBoundary } from "./merge.js";
