import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateRandomString,
    formatTimestamp,
    extractErrorMessage,
    bufferToArrayBuffer,
} from "../dist/helpers.js";

describe("generateRandomString", () => {
    it("returns default length of 12", () => {
        const s = generateRandomString();
        assert.equal(s.length, 12);
    });

    it("returns specified length", () => {
        assert.equal(generateRandomString(5).length, 5);
        assert.equal(generateRandomString(20).length, 20);
    });

    it("contains only lowercase letters and digits", () => {
        const s = generateRandomString(100);
        assert.match(s, /^[a-z0-9]+$/);
    });
});

describe("formatTimestamp", () => {
    it("formats 0 seconds", () => {
        assert.equal(formatTimestamp(0), "00:00:00.000");
    });

    it("formats seconds only", () => {
        assert.equal(formatTimestamp(5), "00:00:05.000");
    });

    it("formats minutes and seconds", () => {
        assert.equal(formatTimestamp(65), "00:01:05.000");
    });

    it("formats hours", () => {
        assert.equal(formatTimestamp(3661), "01:01:01.000");
    });

    it("formats fractional seconds", () => {
        assert.equal(formatTimestamp(1.5), "00:00:01.500");
    });
});

describe("extractErrorMessage", () => {
    it("extracts message from Error instance", () => {
        assert.equal(extractErrorMessage(new Error("boom")), "boom");
    });

    it("returns string directly", () => {
        assert.equal(extractErrorMessage("oops"), "oops");
    });

    it("converts unknown types with String()", () => {
        assert.equal(extractErrorMessage(42), "42");
        assert.equal(extractErrorMessage(null), "null");
        assert.equal(extractErrorMessage(undefined), "undefined");
    });
});

describe("bufferToArrayBuffer", () => {
    it("converts a basic buffer", () => {
        const buf = Buffer.from([1, 2, 3, 4]);
        const ab = bufferToArrayBuffer(buf);
        assert.ok(ab instanceof ArrayBuffer);
        assert.equal(ab.byteLength, 4);
        const view = new Uint8Array(ab);
        assert.deepEqual([...view], [1, 2, 3, 4]);
    });

    it("handles pooled buffer with offset", () => {
        // Buffer.from(string) may share an internal ArrayBuffer pool
        const full = Buffer.from("hello world");
        const sub = full.subarray(6, 11); // "world"
        const ab = bufferToArrayBuffer(sub);
        assert.equal(ab.byteLength, 5);
        const view = new Uint8Array(ab);
        assert.equal(String.fromCharCode(...view), "world");
    });
});
