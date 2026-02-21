import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Env vars ────────────────────────────────────────────────────────────────

const env = process.env;

// ─── Test audio ──────────────────────────────────────────────────────────────

const testAudioPath = path.join(__dirname, "fixtures", "test-audio.mp3");
const testAudio = fs.readFileSync(testAudioPath);

// ─── Results directory ───────────────────────────────────────────────────────

const resultsDir = path.join(__dirname, "results");

// Clean and recreate results directory at the start of each run
if (fs.existsSync(resultsDir)) {
    fs.rmSync(resultsDir, { recursive: true });
}
fs.mkdirSync(resultsDir, { recursive: true });

// ─── Provider credential helpers ─────────────────────────────────────────────

interface ProviderDef {
    name: string;
    envKeys: string[];
    credentials: () => Record<string, string | undefined>[];
    languages?: string[];
}

const transcribeProviders: ProviderDef[] = [
    {
        name: "openai",
        envKeys: ["OPENAI_API_KEY"],
        credentials: () => [{ apiKey: env.OPENAI_API_KEY }],
        languages: ["en"],
    },
    {
        name: "azure",
        envKeys: ["AZURE_SUBSCRIPTION_KEY", "AZURE_REGION"],
        credentials: () => [{ subscriptionKey: env.AZURE_SUBSCRIPTION_KEY, region: env.AZURE_REGION }],
        languages: ["en-US"],
    },
    {
        name: "assemblyai",
        envKeys: ["ASSEMBLYAI_API_KEY"],
        credentials: () => [{ apiKey: env.ASSEMBLYAI_API_KEY }],
        languages: ["en"],
    },
    {
        name: "deepgram",
        envKeys: ["DEEPGRAM_API_KEY"],
        credentials: () => [{ apiKey: env.DEEPGRAM_API_KEY }],
        languages: ["en"],
    },
    {
        name: "elevenlabs",
        envKeys: ["ELEVENLABS_API_KEY"],
        credentials: () => [{ apiKey: env.ELEVENLABS_API_KEY }],
        languages: ["en"],
    },
    {
        name: "google",
        envKeys: ["GOOGLE_API_KEY"],
        credentials: () => [{ apiKey: env.GOOGLE_API_KEY }],
        languages: ["en-US"],
    },
    {
        name: "revai",
        envKeys: ["REVAI_API_KEY"],
        credentials: () => [{ apiKey: env.REVAI_API_KEY }],
        languages: ["en"],
    },
    {
        name: "speechmatics",
        envKeys: ["SPEECHMATICS_API_KEY"],
        credentials: () => [{ apiKey: env.SPEECHMATICS_API_KEY }],
        languages: ["en"],
    },
];

const synthesizeProviders: ProviderDef[] = [
    {
        name: "openai",
        envKeys: ["OPENAI_API_KEY"],
        credentials: () => [{ apiKey: env.OPENAI_API_KEY }],
    },
    {
        name: "azure",
        envKeys: ["AZURE_SUBSCRIPTION_KEY", "AZURE_REGION"],
        credentials: () => [{ subscriptionKey: env.AZURE_SUBSCRIPTION_KEY, region: env.AZURE_REGION }],
    },
    {
        name: "cartesia",
        envKeys: ["CARTESIA_API_KEY"],
        credentials: () => [{ apiKey: env.CARTESIA_API_KEY }],
    },
    {
        name: "deepgram",
        envKeys: ["DEEPGRAM_API_KEY"],
        credentials: () => [{ apiKey: env.DEEPGRAM_API_KEY }],
    },
    {
        name: "elevenlabs",
        envKeys: ["ELEVENLABS_API_KEY"],
        credentials: () => [{ apiKey: env.ELEVENLABS_API_KEY }],
    },
    {
        name: "google",
        envKeys: ["GOOGLE_API_KEY"],
        credentials: () => [{ apiKey: env.GOOGLE_API_KEY }],
    },
    {
        name: "playht",
        envKeys: ["PLAYHT_API_KEY", "PLAYHT_USER_ID"],
        credentials: () => [{ apiKey: env.PLAYHT_API_KEY, userId: env.PLAYHT_USER_ID }],
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasEnvKeys(keys: string[]): boolean {
    return keys.every(k => env[k]);
}

function missingMessage(providerName: string, keys: string[]): string {
    const missing = keys.filter(k => !env[k]).join(", ");
    return `${providerName}: skipped (missing ${missing})`;
}

function firstAvailable(providers: ProviderDef[]): ProviderDef | null {
    return providers.find(p => hasEnvKeys(p.envKeys)) ?? null;
}

function formatTs(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

interface TranscribeWord {
    text: string;
    startTime: number;
    endTime: number;
    confidence?: number;
}

interface TranscribeResult {
    text: string;
    words: TranscribeWord[];
    language: string;
    duration: number;
}

interface SynthesizeChunkResult {
    chunkIndex: number;
    startTime: number;
    duration: number;
    voice: string;
    language?: string;
    format: string;
    provider: string;
}

interface SynthesizeResult {
    audio: Buffer;
    format: string;
    chunks: SynthesizeChunkResult[];
}

function saveTranscribeResult(filename: string, result: TranscribeResult): void {
    const lines: string[] = [];
    lines.push(`Language: ${result.language}`);
    lines.push(`Duration: ${formatTs(result.duration)}`);
    lines.push("");
    lines.push("─── Full Text ───");
    lines.push(result.text);
    lines.push("");
    lines.push("─── Word Timestamps ───");
    lines.push("Start      End        Word");
    lines.push("─────────  ─────────  ────────────────────");
    for (const w of result.words) {
        const conf = w.confidence !== undefined ? `  (${(w.confidence * 100).toFixed(0)}%)` : "";
        lines.push(`${formatTs(w.startTime)}  ${formatTs(w.endTime)}  ${w.text}${conf}`);
    }
    fs.writeFileSync(path.join(resultsDir, filename), lines.join("\n") + "\n");
}

function saveSynthesizeResult(filename: string, audio: Buffer, format: string, chunks: SynthesizeChunkResult[]): void {
    // Save audio file
    fs.writeFileSync(path.join(resultsDir, `${filename}.${format}`), audio);

    // Save metadata
    const lines: string[] = [];
    lines.push(`Format: ${format}`);
    lines.push(`Audio size: ${audio.length} bytes`);
    lines.push(`Chunks: ${chunks.length}`);
    lines.push("");
    lines.push("─── Chunk Details ───");
    lines.push("Index  Start      Duration   Voice                Provider");
    lines.push("─────  ─────────  ─────────  ───────────────────  ────────────");
    for (const c of chunks) {
        lines.push(
            `${String(c.chunkIndex).padEnd(5)}  ` +
            `${formatTs(c.startTime)}  ` +
            `${formatTs(c.duration)}  ` +
            `${c.voice.padEnd(19)}  ` +
            `${c.provider}`
        );
    }
    fs.writeFileSync(path.join(resultsDir, `${filename}.txt`), lines.join("\n") + "\n");
}

// ─── Per-provider: single-chunk synthesize ───────────────────────────────────

describe("integration: synthesizeParallel", () => {
    for (const provider of synthesizeProviders) {
        const available = hasEnvKeys(provider.envKeys);

        if (!available) {
            console.log(missingMessage(`synthesizeParallel/${provider.name}`, provider.envKeys));
        }

        it(`${provider.name}`, { skip: !available, timeout: 30_000 }, async () => {
            const { synthesizeParallel } = await import("../dist/index.js");

            const result: SynthesizeResult = await synthesizeParallel({
                provider: provider.name,
                credentials: provider.credentials(),
                chunks: [{ text: "Hello world" }],
                languages: ["en-US"],
            });

            assert.ok(Buffer.isBuffer(result.audio), "result.audio should be a Buffer");
            assert.ok(result.audio.length > 0, "audio should not be empty");
            assert.ok(typeof result.format === "string", "format should be a string");
            assert.ok(Array.isArray(result.chunks), "chunks should be an array");
            assert.equal(result.chunks.length, 1);

            saveSynthesizeResult(
                `synthesize_${provider.name}_single-chunk`,
                result.audio,
                result.format,
                result.chunks,
            );
        });
    }
});

// ─── Per-provider: single-chunk transcribe ───────────────────────────────────

describe("integration: transcribeParallel", () => {
    for (const provider of transcribeProviders) {
        const available = hasEnvKeys(provider.envKeys);

        if (!available) {
            console.log(missingMessage(`transcribeParallel/${provider.name}`, provider.envKeys));
        }

        it(`${provider.name}`, { skip: !available, timeout: 180_000 }, async () => {
            const { transcribeParallel } = await import("../dist/index.js");

            const result: TranscribeResult = await transcribeParallel({
                provider: provider.name,
                credentials: provider.credentials(),
                audio: testAudio,
                ffmpegPath: "ffmpeg",
                languages: provider.languages,
                retryTimeoutMs: 120_000,
            });

            assert.ok(typeof result.text === "string", "text should be a string");
            assert.ok(result.text.length > 0, "text should not be empty");
            assert.ok(Array.isArray(result.words), "words should be an array");
            assert.ok(typeof result.language === "string", "language should be a string");
            assert.ok(typeof result.duration === "number", "duration should be a number");
            assert.ok(result.duration > 0, "duration should be positive");

            saveTranscribeResult(`transcribe_${provider.name}_single-chunk.txt`, result);
        });
    }
});

// ─── Multi-chunk synthesize ──────────────────────────────────────────────────

describe("integration: multi-chunk synthesize", () => {
    const provider = firstAvailable(synthesizeProviders);
    const available = !!provider;

    if (!available) {
        console.log("multi-chunk synthesize: skipped (no synthesize provider configured)");
    }

    it("synthesizes multiple chunks and concatenates audio", { skip: !available, timeout: 60_000 }, async () => {
        const { synthesizeParallel } = await import("../dist/index.js");

        const result: SynthesizeResult = await synthesizeParallel({
            provider: provider!.name,
            credentials: provider!.credentials(),
            chunks: [
                { text: "This is the first sentence." },
                { text: "This is the second sentence." },
                { text: "This is the third sentence." },
            ],
            languages: ["en-US"],
        });

        assert.ok(Buffer.isBuffer(result.audio));
        assert.ok(result.audio.length > 0);
        assert.equal(result.chunks.length, 3);

        for (let i = 1; i < result.chunks.length; i++) {
            assert.ok(
                result.chunks[i].startTime >= result.chunks[i - 1].startTime,
                `chunk ${i} startTime should be >= chunk ${i - 1} startTime`,
            );
        }

        for (const chunk of result.chunks) {
            assert.ok(chunk.duration > 0, `chunk ${chunk.chunkIndex} should have positive duration`);
            assert.equal(chunk.provider, provider!.name);
        }

        saveSynthesizeResult(
            `synthesize_${provider!.name}_multi-chunk`,
            result.audio,
            result.format,
            result.chunks,
        );
    });
});

// ─── Multi-chunk transcribe (forces ffmpeg splitting + merge) ────────────────

describe("integration: multi-chunk transcribe", () => {
    const provider = firstAvailable(transcribeProviders);
    const available = !!provider;

    if (!available) {
        console.log("multi-chunk transcribe: skipped (no transcribe provider configured)");
    }

    it("splits audio into chunks via ffmpeg and merges results", { skip: !available, timeout: 120_000 }, async () => {
        const { transcribeParallel } = await import("../dist/index.js");

        const result: TranscribeResult = await transcribeParallel({
            provider: provider!.name,
            credentials: provider!.credentials(),
            audio: testAudio,
            ffmpegPath: "ffmpeg",
            languages: provider!.languages,
            targetChunkDuration: 3,
        });

        assert.ok(typeof result.text === "string");
        assert.ok(Array.isArray(result.words));
        assert.ok(typeof result.language === "string");
        assert.ok(typeof result.duration === "number");

        saveTranscribeResult(`transcribe_${provider!.name}_multi-chunk.txt`, result);
    });
});

// ─── onProgress callback ─────────────────────────────────────────────────────

describe("integration: onProgress callback", () => {
    const synthProvider = firstAvailable(synthesizeProviders);
    const transcribeProvider = firstAvailable(transcribeProviders);

    if (!synthProvider) {
        console.log("onProgress/synthesize: skipped (no synthesize provider configured)");
    }
    if (!transcribeProvider) {
        console.log("onProgress/transcribe: skipped (no transcribe provider configured)");
    }

    it("synthesize fires onProgress for each chunk", { skip: !synthProvider, timeout: 60_000 }, async () => {
        const { synthesizeParallel } = await import("../dist/index.js");

        const progressCalls: { completed: number; total: number }[] = [];
        const result: SynthesizeResult = await synthesizeParallel({
            provider: synthProvider!.name,
            credentials: synthProvider!.credentials(),
            chunks: [
                { text: "First." },
                { text: "Second." },
            ],
            languages: ["en-US"],
            onProgress: (completed: number, total: number) => progressCalls.push({ completed, total }),
        });

        assert.equal(progressCalls.length, 2);
        assert.equal(progressCalls[0].total, 2);
        assert.equal(progressCalls[1].total, 2);
        assert.equal(progressCalls[progressCalls.length - 1].completed, 2);

        saveSynthesizeResult(
            `synthesize_${synthProvider!.name}_onProgress`,
            result.audio,
            result.format,
            result.chunks,
        );
    });

    it("transcribe fires onProgress for each chunk", { skip: !transcribeProvider, timeout: 120_000 }, async () => {
        const { transcribeParallel } = await import("../dist/index.js");

        const progressCalls: { completed: number; total: number }[] = [];
        const result: TranscribeResult = await transcribeParallel({
            provider: transcribeProvider!.name,
            credentials: transcribeProvider!.credentials(),
            audio: testAudio,
            ffmpegPath: "ffmpeg",
            languages: transcribeProvider!.languages,
            targetChunkDuration: 3,
            onProgress: (completed: number, total: number) => progressCalls.push({ completed, total }),
        });

        assert.ok(progressCalls.length >= 2, "should have at least 2 progress calls");
        assert.equal(progressCalls[progressCalls.length - 1].completed, progressCalls[0].total);

        saveTranscribeResult(`transcribe_${transcribeProvider!.name}_onProgress.txt`, result);
    });
});

// ─── Abort / cancellation ────────────────────────────────────────────────────

describe("integration: abort signal", () => {
    const provider = firstAvailable(synthesizeProviders);
    const available = !!provider;

    if (!available) {
        console.log("abort signal: skipped (no synthesize provider configured)");
    }

    it("aborts synthesize mid-operation", { skip: !available, timeout: 15_000 }, async () => {
        const { synthesizeParallel } = await import("../dist/index.js");

        const ac = new AbortController();
        ac.abort();

        await assert.rejects(
            () => synthesizeParallel({
                provider: provider!.name,
                credentials: provider!.credentials(),
                chunks: [{ text: "This should not complete." }],
                languages: ["en-US"],
                signal: ac.signal,
            }),
            /abort/i,
        );
    });

    it("aborts transcribe mid-operation", { skip: !available, timeout: 15_000 }, async () => {
        const { transcribeParallel } = await import("../dist/index.js");

        const ac = new AbortController();
        ac.abort();

        await assert.rejects(
            () => transcribeParallel({
                provider: provider!.name,
                credentials: provider!.credentials(),
                audio: testAudio,
                ffmpegPath: "ffmpeg",
                signal: ac.signal,
            }),
            /abort/i,
        );
    });
});
