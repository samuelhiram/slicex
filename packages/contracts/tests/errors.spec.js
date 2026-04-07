import { it, expect } from "vitest";
import { makeErrorEnvelope, statusForError, ApiError } from "../src/errors";
it("creates an error envelope", () => {
    const env = makeErrorEnvelope("INPUT_VALIDATION_FAILED", "Bad input", {
        field: "x",
    });
    expect(env).toHaveProperty("code", "INPUT_VALIDATION_FAILED");
    expect(env).toHaveProperty("message", "Bad input");
});
it("maps status correctly", () => {
    expect(statusForError("INPUT_VALIDATION_FAILED")).toBe(400);
    expect(statusForError("TIMELINE_NOT_FOUND")).toBe(404);
});
it("ApiError provides envelope and status", () => {
    const e = new ApiError("TIMELINE_NOT_FOUND", "Not found");
    expect(e.toEnvelope()).toHaveProperty("code", "TIMELINE_NOT_FOUND");
    expect(e.status()).toBe(404);
});
