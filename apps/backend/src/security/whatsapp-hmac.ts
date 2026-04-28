import crypto from "node:crypto";

/**
 * Verify Meta's `X-Hub-Signature-256` header against the raw request body.
 *
 * Meta sends every webhook with `X-Hub-Signature-256: sha256=<hex>` where
 * <hex> is HMAC-SHA256(appSecret, rawBody). Without this check, the
 * /webhooks/whatsapp endpoint is wide open — anyone could spoof inbound
 * messages and use this service to run arbitrary agent loops on your
 * Anthropic budget.
 *
 * The comparison is constant-time to avoid timing oracles.
 *
 * @param rawBody the EXACT bytes Meta sent — re-serialized JSON will not match
 * @param signatureHeader value of the `x-hub-signature-256` header
 * @param appSecret the App Secret from Meta for Developers → App settings → Basic
 * @returns true if the signature matches, false otherwise
 */
export function verifyWhatsappSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();

  // timingSafeEqual throws if the buffers are different lengths — guard first.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
