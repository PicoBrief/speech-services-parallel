/**
 * Audio format detection by inspecting file magic bytes.
 *
 * Used to determine the correct file extension when writing temporary chunk
 * files to disk. Supports FLAC, OGG, WAV, M4A/MP4, and MP3 (including ID3-tagged files).
 */

/** Recognized audio formats, plus `"unknown"` as a fallback. */
export type AudioFormat = "mp3" | "wav" | "ogg" | "flac" | "m4a" | "unknown";

/**
 * Detects the audio format of a buffer by inspecting its leading bytes (magic bytes).
 *
 * @param buffer - Raw audio data (at least 12 bytes for reliable detection).
 * @returns The detected {@link AudioFormat}, or `"unknown"` if no signature matches.
 */
export function detectAudioFormat(buffer: Buffer): AudioFormat {
    if (buffer.length < 12) return "unknown";

    // FLAC: starts with "fLaC" (0x66 0x4C 0x61 0x43)
    if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
        return "flac";
    }

    // OGG: starts with "OggS" (0x4F 0x67 0x67 0x53)
    if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
        return "ogg";
    }

    // WAV: starts with "RIFF" at offset 0 and "WAVE" at offset 8
    if (
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45
    ) {
        return "wav";
    }

    // M4A/MP4: "ftyp" at offset 4 (0x66 0x74 0x79 0x70)
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        return "m4a";
    }

    // MP3: either a frame sync word (0xFF followed by 0xE0+) or an ID3 tag header ("ID3")
    if (
        (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) ||
        (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)
    ) {
        return "mp3";
    }

    return "unknown";
}

/**
 * Maps an {@link AudioFormat} to a file extension string.
 * Falls back to `"mp3"` for `"unknown"` formats.
 *
 * @param format - The detected audio format.
 * @returns A file extension string (without the leading dot).
 */
export function audioFormatToExtension(format: AudioFormat): string {
    if (format === "unknown") return "mp3";
    return format;
}
