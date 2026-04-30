import { config } from "../config.js";

/**
 * Convert the small subset of Markdown the agent emits into Telegram-flavored
 * HTML. We use HTML rather than MarkdownV2 because MarkdownV2's escape list
 * is brutal (`_*[]()~\`>#+-=|{}.!` all need escaping outside code blocks);
 * HTML only requires escaping `&`, `<`, `>` in user content.
 *
 * Order matters: HTML-escape the raw chars FIRST so a literal `<3` from the
 * agent doesn't collide with the `<b>` tags we're about to insert. Then the
 * Markdown→HTML transforms insert raw tags into the now-safe text.
 *
 * Supported transforms:
 * - `**bold**`     → `<b>bold</b>`
 * - `` `code` ``   → `<code>code</code>`
 *
 * Headers and bullets pass through unchanged — Telegram renders them as
 * plain text, which reads fine on mobile.
 */
export function mdToTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>");
}

/**
 * Telegram Bot API outbound send.
 *
 * Endpoint: POST https://api.telegram.org/bot{token}/sendMessage
 * Auth: the bot token is part of the URL — no header.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 */
export async function sendTelegram(text: string): Promise<void> {
  if (!config.telegram.enabled) {
    throw new Error("Telegram is disabled — set TELEGRAM_ENABLED=true and provide bot credentials.");
  }
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("Telegram requires both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  // Render Markdown bold/code as Telegram HTML, trim to the 4096-char cap.
  const rendered = mdToTelegramHtml(text).slice(0, 4096);
  const body = {
    chat_id: config.telegram.chatId,
    text: rendered,
    parse_mode: "HTML",
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
