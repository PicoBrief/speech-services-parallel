# @pico-brief/speech-services-parallel

Transcribe audio to text and generate speech from text — fast — by running multiple requests at the same time.

This library takes long audio files, splits them into smaller pieces, and transcribes every piece in parallel. It does the same thing in reverse for text-to-speech: you give it chunks of text, it turns them all into audio at once, and stitches the results together into a single file. Under the hood it handles retries, rotates through your API keys so you don't hit rate limits, and lets you control how many requests run at once.

Built on top of [`@pico-brief/speech-services`](https://github.com/PicoBrief/speech-services).

## Supported Providers

| Provider | Speech-to-Text | Text-to-Speech |
|---|:---:|:---:|
| Azure | ✅ | ✅ |
| AssemblyAI | ✅ | |
| Cartesia | | ✅ |
| Deepgram | ✅ | ✅ |
| ElevenLabs | ✅ | ✅ |
| Google | ✅ | ✅ |
| OpenAI | ✅ | ✅ |
| PlayHT | | ✅ |
| Rev AI | ✅ | |
| Speechmatics | ✅ | |

## Install

```bash
npm install @pico-brief/speech-services-parallel
```

You also need [ffmpeg](https://ffmpeg.org/) installed on your system. It's used to split and join audio files.

## Requirements

- Node.js >= 18
- ffmpeg binary available on your system

## Quick Start

### Transcribe audio to text

```ts
import { transcribeParallel } from "@pico-brief/speech-services-parallel";
import { readFileSync } from "fs";

const audio = readFileSync("interview.mp3");

const result = await transcribeParallel({
  provider: "openai",
  credentials: [{ apiKey: "sk-..." }],
  targetChunkDuration: 300, // 5-minute chunks
  chunkOverlap: 30,         // 30 seconds of overlap
  audio,
  ffmpegPath: "ffmpeg",
});

console.log(result.text);
// "Hello and welcome to the show..."

console.log(result.duration);
// 1823.5 (seconds)

console.log(result.words);
// [{ word: "Hello", start: 0.0, end: 0.42 }, { word: "and", start: 0.42, end: 0.58 }, ...]
```

If the audio is longer than 5 minutes, it is automatically split into chunks and each chunk is transcribed in parallel. The results are merged back together with word-level timestamps.

### Generate speech from text

```ts
import { synthesizeParallel } from "@pico-brief/speech-services-parallel";
import { writeFileSync } from "fs";

const result = await synthesizeParallel({
  provider: "openai",
  credentials: [{ apiKey: "sk-..." }],
  chunks: [
    { text: "Chapter one. It was a dark and stormy night." },
    { text: "Chapter two. The sun rose over the hills." },
  ],
  ffmpegPath: "ffmpeg",
});

writeFileSync("audiobook.mp3", result.audio);

console.log(result.format);
// "mp3"

console.log(result.chunks);
// [{ chunkIndex: 0, startTime: 0, duration: 3.2, voice: "alloy", ... }, ...]
```

Each chunk of text is synthesized in parallel and the audio is concatenated into a single file.

## Basic Usage

### Picking a provider

Every call requires a `provider` name and a `credentials` array. The shape of each credential depends on the provider:

```ts
// OpenAI / Deepgram / ElevenLabs / Google / AssemblyAI / Rev AI / Cartesia
{ apiKey: "..." }

// Azure
{ subscriptionKey: "...", region: "eastus" }

// PlayHT
{ apiKey: "...", userId: "..." }

// Speechmatics
{ apiKey: "...", region: "eu" }  // region is optional
```

### Specifying a language

Pass a `languages` array to help the provider pick the right model or voice:

```ts
const result = await transcribeParallel({
  provider: "deepgram",
  credentials: [{ apiKey: "..." }],
  audio,
  ffmpegPath: "ffmpeg",
  languages: ["en"],
});
```

### Choosing a voice

For text-to-speech, set a default voice for all chunks, or override it per chunk:

```ts
const result = await synthesizeParallel({
  provider: "elevenlabs",
  credentials: [{ apiKey: "..." }],
  voice: "rachel",
  chunks: [
    { text: "Narrated by Rachel." },
    { text: "Except this part.", voice: "bella" }, // override for this chunk
    { text: "Back to Rachel." },
  ],
  ffmpegPath: "ffmpeg",
});
```

## Advanced Usage

### Credential rotation

If you have multiple API keys, pass them all in the `credentials` array. The library picks the least-recently-used key for each request and automatically rotates to another key when one hits a rate limit or fails:

```ts
const result = await transcribeParallel({
  provider: "openai",
  credentials: [
    { apiKey: "sk-key-1" },
    { apiKey: "sk-key-2" },
    { apiKey: "sk-key-3" },
  ],
  audio,
  ffmpegPath: "ffmpeg",
});
```

When a key fails, it goes into a cool-down period so it isn't immediately retried.

### Limiting concurrency

By default, all chunks are processed at the same time. If you want to limit how many run in parallel (for example, to stay under a provider's rate limit), use `maxConcurrency`:

```ts
const result = await synthesizeParallel({
  provider: "elevenlabs",
  credentials: [{ apiKey: "..." }],
  chunks: fiftyChunks,
  maxConcurrency: 5, // only 5 requests at a time
  ffmpegPath: "ffmpeg",
});
```

### Tracking progress

Pass an `onProgress` callback to get notified as chunks complete:

```ts
const result = await transcribeParallel({
  provider: "deepgram",
  credentials: [{ apiKey: "..." }],
  audio: longAudio,
  ffmpegPath: "ffmpeg",
  onProgress: (completed, total) => {
    console.log(`${completed}/${total} chunks done`);
  },
});
```

### Controlling chunk size

For transcription, the library splits audio into 5-minute chunks by default with a 15-second overlap between chunks (so words at the boundary aren't lost). You can change both values:

```ts
const result = await transcribeParallel({
  provider: "assemblyai",
  credentials: [{ apiKey: "..." }],
  audio,
  ffmpegPath: "ffmpeg",
  targetChunkDuration: 120, // 2-minute chunks
  chunkOverlap: 30,         // 30 seconds of overlap
});
```

### Retry timeout

Failed requests are retried automatically with exponential backoff. The default deadline is 5 minutes. You can change it:

```ts
const result = await synthesizeParallel({
  provider: "azure",
  credentials: [
    { subscriptionKey: "key-1", region: "eastus" },
    { subscriptionKey: "key-2", region: "westus" },
  ],
  chunks: textChunks,
  retryTimeoutMs: 10 * 60 * 1000, // 10 minutes
  ffmpegPath: "ffmpeg",
});
```

Errors like invalid API keys (401, 403) or bad input (400, 422) are **not** retried — only transient errors (429, 500, 502, 503, 504) are.

### Cancellation

Pass an `AbortSignal` to cancel an in-progress operation:

```ts
const controller = new AbortController();

const promise = transcribeParallel({
  provider: "google",
  credentials: [{ apiKey: "..." }],
  audio,
  ffmpegPath: "ffmpeg",
  signal: controller.signal,
});

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);
```

### Storage provider (for URL-based transcription)

Some providers require audio to be available at a URL rather than sent as a buffer — for example, Azure in batch mode or Google's async long-running recognition. You can supply a `storageProvider` to handle this automatically:

```ts
import type { StorageProvider } from "@pico-brief/speech-services-parallel";

const storageProvider: StorageProvider = {
  async upload(buffer, key) {
    // Upload to your cloud storage (Azure Blob, GCS, S3, etc.)
    // and return a URL the provider can fetch
    await blobClient.upload(buffer, key);
    return `https://mystorage.blob.core.windows.net/audio/${key}?${sasToken}`;
  },
  async delete(key) {
    // Clean up — called automatically after transcription completes
    await blobClient.delete(key);
  },
};

const result = await transcribeParallel({
  provider: "azure",
  credentials: [{ subscriptionKey: "...", region: "eastus" }],
  providerOptions: { mode: "batch" },
  audio,
  ffmpegPath: "ffmpeg",
  storageProvider,
});
```

Each audio chunk is uploaded before transcription and deleted in a `finally` block, so cleanup happens even if transcription fails. The upload happens outside the retry loop — if a chunk needs to be retried, it reuses the same URL.

If you use Azure with `mode: "batch"` and don't provide a `storageProvider`, the library throws an error immediately.

### Provider-specific options

Each provider supports extra options through `providerOptions`. These are passed directly to the underlying provider client:

```ts
const result = await synthesizeParallel({
  provider: "openai",
  credentials: [{ apiKey: "..." }],
  chunks: [
    { text: "High quality audio.", providerOptions: { model: "tts-1-hd" } },
    { text: "Standard quality.", providerOptions: { model: "tts-1" } },
  ],
  ffmpegPath: "ffmpeg",
});
```

You can also set default `providerOptions` at the top level, and override them per chunk.

### Using KeyManager directly

If you need credential rotation for your own code, you can use the `KeyManager` class on its own:

```ts
import { KeyManager } from "@pico-brief/speech-services-parallel";

const manager = new KeyManager(["key-1", "key-2", "key-3"]);

// Get the least-recently-used key
const key = manager.getKey();

try {
  await callSomeApi(key);
} catch (error) {
  // Put this key on cool-down so it isn't picked again right away
  manager.reportError(key);

  // Or set a custom cool-down (in milliseconds)
  manager.reportError(key, 60_000); // 1 minute
}
```

## API Reference

### `transcribeParallel(params)`

Transcribes audio with automatic chunking and parallel processing.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | `string` | Yes | — | Provider name (see supported providers above) |
| `credentials` | `ProviderConfig[]` | Yes | — | One or more credential objects for the provider |
| `audio` | `Buffer` | Yes | — | The audio data to transcribe |
| `ffmpegPath` | `string` | Yes | — | Path to the ffmpeg binary |
| `languages` | `string[]` | No | — | Language hints for the provider |
| `targetChunkDuration` | `number` | No | `300` | Target chunk length in seconds |
| `chunkOverlap` | `number` | No | `15` | Overlap between chunks in seconds |
| `retryTimeoutMs` | `number` | No | `300000` | Max time to keep retrying (ms) |
| `maxConcurrency` | `number` | No | — | Max parallel requests |
| `signal` | `AbortSignal` | No | — | Signal to cancel the operation |
| `onProgress` | `(completed, total) => void` | No | — | Progress callback |
| `providerOptions` | `object` | No | — | Provider-specific options |
| `storageProvider` | `StorageProvider` | No | — | Upload chunks to cloud storage for URL-based providers |

**Returns:** `Promise<TranscribeResult>` with `text`, `words`, `language`, and `duration`.

---

### `synthesizeParallel(params)`

Synthesizes multiple text chunks into audio in parallel.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | `string` | Yes | — | Provider name (see supported providers above) |
| `credentials` | `ProviderConfig[]` | Yes | — | One or more credential objects for the provider |
| `chunks` | `SynthesizeChunkInput[]` | Yes | — | Text chunks to synthesize |
| `ffmpegPath` | `string` | No | — | Path to ffmpeg (for concatenation) |
| `gender` | `"male" \| "female"` | No | — | Default voice gender |
| `voice` | `string` | No | — | Default voice ID or name |
| `languages` | `string[]` | No | — | Default language hints |
| `retryTimeoutMs` | `number` | No | `300000` | Max time to keep retrying (ms) |
| `maxConcurrency` | `number` | No | — | Max parallel requests |
| `signal` | `AbortSignal` | No | — | Signal to cancel the operation |
| `onProgress` | `(completed, total) => void` | No | — | Progress callback |
| `providerOptions` | `object` | No | — | Default provider-specific options |

**Returns:** `Promise<SynthesizeParallelResult>`

```ts
{
  audio: Buffer;       // The combined audio data
  format: string;      // Audio format (e.g. "mp3")
  chunks: [{
    chunkIndex: number;
    startTime: number; // Offset in combined audio (seconds)
    duration: number;  // Duration of this chunk (seconds)
    voice: string;     // Voice that was used
    language?: string;
    format: string;
    provider: string;
  }];
}
```

---

### `KeyManager<T>`

Generic credential rotation manager using a least-recently-used strategy.

```ts
new KeyManager(credentials: T[])  // requires at least one credential
manager.getKey(): T                // returns the least-recently-used credential
manager.reportError(key: T, coolDownMs?: number): void  // puts a key on cool-down
```

## License

MIT
