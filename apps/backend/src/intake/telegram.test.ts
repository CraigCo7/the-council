import { describe, it, expect } from "vitest";
import { extractTelegramMessage, verifyTelegramSecret } from "./telegram.js";

describe("extractTelegramMessage", () => {
  it("returns the text message for a typical update", () => {
    const payload = {
      update_id: 99,
      message: {
        message_id: 1,
        from: { id: 42, first_name: "Craig" },
        chat: { id: 42, type: "private" },
        date: 1714500000,
        text: "hi bot",
      },
    };
    const out = extractTelegramMessage(payload);
    expect(out).not.toBeNull();
    expect(out!.updateId).toBe(99);
    expect(out!.message.text).toBe("hi bot");
    expect(out!.message.chat.id).toBe(42);
  });

  it("returns null when there is no message field (edited/callback updates)", () => {
    const payload = {
      update_id: 100,
      edited_message: { message_id: 1, chat: { id: 42, type: "private" }, text: "edit" },
    };
    expect(extractTelegramMessage(payload)).toBeNull();
  });

  it("returns null for non-text messages (photo, voice, sticker)", () => {
    const payload = {
      update_id: 101,
      message: {
        message_id: 2,
        chat: { id: 42, type: "private" },
        date: 1,
        photo: [{ file_id: "abc" }],
      },
    };
    expect(extractTelegramMessage(payload)).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(extractTelegramMessage(null)).toBeNull();
    expect(extractTelegramMessage({})).toBeNull();
    expect(extractTelegramMessage("not an object")).toBeNull();
    expect(extractTelegramMessage({ update_id: "not a number" })).toBeNull();
  });
});

describe("verifyTelegramSecret", () => {
  const secret = "abc123-this-is-the-shared-secret-not-real";

  it("accepts the matching secret", () => {
    expect(verifyTelegramSecret(secret, secret)).toBe(true);
  });

  it("rejects a different secret of the same length", () => {
    const wrong = "xyz123-this-is-the-shared-secret-not-real";
    expect(verifyTelegramSecret(wrong, secret)).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(verifyTelegramSecret("short", secret)).toBe(false);
    expect(verifyTelegramSecret(secret + "x", secret)).toBe(false);
  });

  it("rejects when provided header is missing", () => {
    expect(verifyTelegramSecret(undefined, secret)).toBe(false);
  });

  it("fail-closed when expected secret is empty", () => {
    expect(verifyTelegramSecret(secret, "")).toBe(false);
    expect(verifyTelegramSecret("", "")).toBe(false);
  });
});
