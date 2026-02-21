import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyError } from "../dist/errors.js";
import { SpeechServiceError } from "@pico-brief/speech-services";

describe("classifyError", () => {
    it("non-SpeechServiceError is retryable", () => {
        assert.equal(classifyError(new Error("network failure")), "retryable");
        assert.equal(classifyError("string error"), "retryable");
        assert.equal(classifyError(null), "retryable");
    });

    describe("terminal codes", () => {
        for (const code of ["INVALID_INPUT", "UNKNOWN_PROVIDER", "NOT_CONFIGURED", "VOICE_NOT_FOUND"]) {
            it(`${code} is terminal`, () => {
                assert.equal(
                    classifyError(new SpeechServiceError("err", code, "openai")),
                    "terminal",
                );
            });
        }
    });

    describe("terminal HTTP statuses", () => {
        for (const status of [400, 401, 403, 404, 422]) {
            it(`HTTP ${status} is terminal`, () => {
                assert.equal(
                    classifyError(new SpeechServiceError("err", "API_ERROR", "openai", status)),
                    "terminal",
                );
            });
        }
    });

    describe("retryable HTTP statuses", () => {
        for (const status of [429, 500, 502, 503, 504]) {
            it(`HTTP ${status} is retryable`, () => {
                assert.equal(
                    classifyError(new SpeechServiceError("err", "API_ERROR", "openai", status)),
                    "retryable",
                );
            });
        }
    });

    it("unknown code without status is retryable", () => {
        assert.equal(
            classifyError(new SpeechServiceError("err", "SOME_NEW_CODE", "openai")),
            "retryable",
        );
    });
});
