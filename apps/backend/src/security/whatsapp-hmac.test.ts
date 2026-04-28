import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyWhatsappSignature } from "./whatsapp-hmac.js";

const SECRET = "test-app-secret-do-not-use-in-prod";

function sign(secret: string, body: Buffer): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWhatsappSignature", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");

  it("accepts a valid signature", () => {
    expect(verifyWhatsappSignature(body, sign(SECRET, body), SECRET)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    expect(verifyWhatsappSignature(body, sign("other", body), SECRET)).toBe(false);
  });

  it("rejects a signature for a different body (tampering)", () => {
    const tampered = Buffer.from('{"object":"x"}', "utf8");
    expect(verifyWhatsappSignature(tampered, sign(SECRET, body), SECRET)).toBe(false);
  });

  it("rejects when header is missing", () => {
    expect(verifyWhatsappSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects when header lacks the sha256= prefix", () => {
    const bare = sign(SECRET, body).slice("sha256=".length);
    expect(verifyWhatsappSignature(body, bare, SECRET)).toBe(false);
  });

  it("rejects when header is not valid hex", () => {
    expect(verifyWhatsappSignature(body, "sha256=zzzz", SECRET)).toBe(false);
  });

  it("rejects when app secret is empty (closed by default)", () => {
    expect(verifyWhatsappSignature(body, sign(SECRET, body), "")).toBe(false);
  });
});
