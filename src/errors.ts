/**
 * Error classification for deciding whether to retry a failed request.
 *
 * Errors are classified as either **terminal** (do not retry — the request
 * is fundamentally invalid) or **retryable** (transient failure that may
 * succeed on a subsequent attempt, possibly with a different credential).
 *
 * Classification rules:
 * - Known `SpeechServiceError` codes like `INVALID_INPUT` or `VOICE_NOT_FOUND` → terminal
 * - HTTP 400, 401, 403, 404, 422 → terminal (bad request or bad credentials)
 * - HTTP 429, 500, 502, 503, 504 → retryable (rate limit or server error)
 * - Unknown errors (not a `SpeechServiceError`) → retryable (safer to retry)
 */

import { SpeechServiceError } from "@pico-brief/speech-services";

/** Error codes that indicate a permanent, non-retryable problem. */
const TERMINAL_CODES = new Set([
    "INVALID_INPUT",
    "UNKNOWN_PROVIDER",
    "NOT_CONFIGURED",
    "VOICE_NOT_FOUND",
]);

/** HTTP status codes that indicate a permanent client error. */
const TERMINAL_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

/** HTTP status codes that indicate a transient server-side problem. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Classifies an error as `"terminal"` (do not retry) or `"retryable"`.
 *
 * Non-`SpeechServiceError` exceptions default to `"retryable"` since they may
 * be caused by transient issues like network timeouts.
 *
 * @param error - The caught error to classify.
 * @returns `"terminal"` if the error should not be retried, `"retryable"` otherwise.
 */
export function classifyError(error: unknown): "terminal" | "retryable" {
    if (!(error instanceof SpeechServiceError)) return "retryable";

    if (TERMINAL_CODES.has(error.code)) return "terminal";

    if (error.statusCode !== undefined) {
        if (TERMINAL_STATUS_CODES.has(error.statusCode)) return "terminal";
        if (RETRYABLE_STATUS_CODES.has(error.statusCode)) return "retryable";
    }

    return "retryable";
}
