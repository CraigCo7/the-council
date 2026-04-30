import { config } from "../config.js";

/**
 * Telegram Bot API outbound send.
 *
 * Endpoint: POST https://api.telegram.org/bot{token}/sendMessage
 * Auth: the bot token is part of the URL — no header.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 *
 * Plain text only for now — Telegram supports MarkdownV2 but the escape
 * surface is wide (`_*[]()~\`>#+-=|{}.!`). Worth adding later if the brief
 * formatting warrants it; not worth the foot-gun for v1.
 */
export async function sendTelegram(text: string): Promise<void> {
  if (!config.telegram.enabled) {
    throw new Error("Telegram is disabled — set TELEGRAM_ENABLED=true and provide bot credentials.");
  }
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("Telegram requires both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const body = {
    chat_id: config.telegram.chatId,
    // Telegram message text limit is 4096 chars.
    text: text.slice(0, 4096),
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${errText}`);
  }
}
