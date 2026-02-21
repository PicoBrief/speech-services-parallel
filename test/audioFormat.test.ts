import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAudioFormat, audioFormatToExtension } from "../dist/audioFormat.js";

describe("detectAudioFormat", () => {
    it("detects FLAC", () => {
        const buf = Buffer.alloc(12);
        buf.write("fLaC", 0);
        assert.equal(detectAudioFormat(buf), "flac");
    });

    it("detects OGG", () => {
        const buf = Buffer.alloc(12);
        buf.write("OggS", 0);
        assert.equal(detectAudioFormat(buf), "ogg");
    });

    it("detects WAV", () => {
        const buf = Buffer.alloc(12);
        buf.write("RIFF", 0);
        buf.write("WAVE", 8);
        assert.equal(detectAudioFormat(buf), "wav");
    });

    it("detects M4A (ftyp at offset 4)", () => {
        const buf = Buffer.alloc(12);
        buf.write("ftyp", 4);
        assert.equal(detectAudioFormat(buf), "m4a");
    });

    it("detects MP3 by frame sync", () => {
        const buf = Buffer.alloc(12);
        buf[0] = 0xFF;
        buf[1] = 0xFB; // 0xE0 bits set
        assert.equal(detectAudioFormat(buf), "mp3");
    });

    it("detects MP3 by ID3 tag", () => {
        const buf = Buffer.alloc(12);
        buf.write("ID3", 0);
        assert.equal(detectAudioFormat(buf), "mp3");
    });

    it("returns unknown for unrecognized data", () => {
        const buf = Buffer.alloc(12);
        assert.equal(detectAudioFormat(buf), "unknown");
    });

    it("returns unknown for short buffer (< 12 bytes)", () => {
        assert.equal(detectAudioFormat(Buffer.alloc(4)), "unknown");
    });
});

describe("audioFormatToExtension", () => {
    it("returns format string for known formats", () => {
        assert.equal(audioFormatToExtension("mp3"), "mp3");
        assert.equal(audioFormatToExtension("wav"), "wav");
        assert.equal(audioFormatToExtension("ogg"), "ogg");
        assert.equal(audioFormatToExtension("flac"), "flac");
        assert.equal(audioFormatToExtension("m4a"), "m4a");
    });

    it("falls back to mp3 for unknown", () => {
        assert.equal(audioFormatToExtension("unknown"), "mp3");
    });
});
