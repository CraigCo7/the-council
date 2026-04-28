// WhatsApp text messages cap at 4096 chars. Leave headroom for a header
// and a "see vault" suffix.
const WHATSAPP_MAX = 3500;

/**
 * Format a brief/review body for WhatsApp delivery: prepend a header,
 * truncate cleanly at a newline if the body is too long, and append a
 * pointer to the vault file for the full version.
 */
export function fitForWhatsappBody(args: {
  header: string;
  body: string;
  vaultRel: string;
}): string {
  const { header, body, vaultRel } = args;
  const suffix = `\n\n(full version in vault: ${vaultRel})`;
  const budget = WHATSAPP_MAX - header.length - suffix.length;
  if (body.length <= budget) return `${header}\n\n${body}`;
  let cut = body.lastIndexOf("\n", budget);
  if (cut < budget - 200) cut = budget; // newline too far back; hard cut
  return `${header}\n\n${body.slice(0, cut).trimEnd()}…${suffix}`;
}
