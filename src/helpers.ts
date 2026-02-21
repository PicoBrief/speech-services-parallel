/**
 * Small utility functions shared across the library.
 */

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used for backoff delays between retry attempts.
 *
 * @param ms - Number of milliseconds to sleep.
 */
export function sleepAsync(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates a random alphanumeric string, used for creating unique temporary file prefixes.
 *
 * @param length - Length of the string to generate. @default 12
 * @returns A lowercase alphanumeric string of the given length.
 */
export function generateRandomString(length = 12): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/**
 * Converts seconds to `HH:MM:SS.mmm` format for ffmpeg `-ss` / `-to` arguments.
 *
 * @param seconds - Time value in seconds (can include fractions).
 * @returns A zero-padded timestamp string like `"01:23:45.678"`.
 *
 * @example
 * ```ts
 * formatTimestamp(3661.5); // "01:01:01.500"
 * ```
 */
export function formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = s.toFixed(3).padStart(6, "0");
    return `${hh}:${mm}:${ss}`;
}

/**
 * Normalizes an unknown thrown value to a human-readable string message.
 *
 * @param error - The caught value (may be an `Error`, a string, or anything else).
 * @returns The error's message, the string itself, or `String(error)`.
 */
export function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}

/**
 * Safely extracts an `ArrayBuffer` from a Node.js `Buffer`.
 *
 * Node.js `Buffer` objects may share an underlying `ArrayBuffer` (from the
 * memory pool), so a naive `.buffer` access can return data from other buffers.
 * This function slices to the exact byte range owned by `buf`.
 *
 * @param buf - The Node.js Buffer to convert.
 * @returns A standalone `ArrayBuffer` containing only `buf`'s data.
 */
export function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
