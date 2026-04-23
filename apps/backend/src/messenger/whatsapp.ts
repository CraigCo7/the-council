import { config } from "../config.js";

/**
 * Phase 3: Meta WhatsApp Cloud API direct send.
 *
 * API: POST https://graph.facebook.com/v21.0/{phone-number-id}/messages
 * Auth: Bearer access token.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * For v1 we stub this — the shape below is how Phase 3 will wire up.
 * The rest of the system already calls messenger.send(text, "whatsapp");
 * enabling WhatsApp is a matter of setting WHATSAPP_ENABLED=true and
 * providing the credentials.
 */
export async function sendWhatsapp(text: string): Promise<void> {
  if (!config.whatsapp.enabled) {
    throw new Error("WhatsApp is disabled — set WHATSAPP_ENABLED=true and provide credentials.");
  }

  const url = `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: config.whatsapp.toNumber,
    type: "text",
    text: { body: text.slice(0, 4096) },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
  }
}
