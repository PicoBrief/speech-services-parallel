/**
 * Factory for creating speech service clients from a provider name and credential.
 *
 * This is a thin wrapper around `createSpeechClient` from `@pico-brief/speech-services`
 * that maps a `(provider, credential)` pair to the config shape expected by the
 * underlying library.
 */

import { createSpeechClient } from "@pico-brief/speech-services";
import type { SpeechClient, ClientConfig } from "@pico-brief/speech-services";

/**
 * Creates a {@link SpeechClient} from a provider name and its corresponding credential object.
 *
 * The credential must match the config type for that provider from `@pico-brief/speech-services`:
 *
 * | Provider       | Config Type          | Shape                                         |
 * |----------------|----------------------|-----------------------------------------------|
 * | `azure`        | `AzureConfig`        | `{ region: string; subscriptionKey: string }`  |
 * | `playht`       | `PlayHTConfig`       | `{ userId: string; apiKey: string }`           |
 * | `speechmatics` | `SpeechmaticsConfig` | `{ apiKey: string; region?: string }`          |
 * | All others     | `*Config`            | `{ apiKey: string }`                           |
 *
 * @param provider - The provider name (e.g. `"openai"`, `"azure"`).
 * @param credential - The credential object for that provider.
 * @returns A configured {@link SpeechClient} ready for transcription or synthesis calls.
 */
export function createClientFromCredential(provider: string, credential: object): SpeechClient {
    return createSpeechClient({ [provider]: credential } as ClientConfig);
}
