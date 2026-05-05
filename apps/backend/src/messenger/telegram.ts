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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Convert ISO calendar dates (YYYY-MM-DD) to "Month Day Year" for human
 * readability on Telegram. The vault stays ISO (sortable, queryable, plays
 * nice with Obsidian Dataview); only outbound chat gets the friendly form.
 *
 * Excludes ISO datetimes (e.g. `2026-05-06T12:00:00+08:00`) — the trailing
 * `T` triggers the negative lookahead. Alfred rarely shows datetimes in
 * conversation, but the guard prevents `created_at`/`updated_at` from
 * being mangled in the rare case the model surfaces them.
 *
 * Also excludes dates immediately preceded by `-` (so the date *inside*
 * a task ID like `T-20260506-foo` is unaffected — though task IDs use a
 * compact YYYYMMDD form anyway, this is belt-and-suspenders).
 *
 * @example
 *   humanizeDates("Deadline: 2026-05-06 (TODAY)")
 *   // → "Deadline: May 6 2026 (TODAY)"
 */
export function humanizeDates(text: string): string {
  return text.replace(
    /(?<![-\d])(\d{4})-(\d{2})-(\d{2})(?!T|\d|-)/g,
    (match, y, mo, d) => {
      const monthIdx = parseInt(mo, 10) - 1;
      const dayNum = parseInt(d, 10);
      if (monthIdx < 0 || monthIdx > 11) return match;
      if (dayNum < 1 || dayNum > 31) return match;
      return `${MONTHS[monthIdx]} ${dayNum} ${y}`;
    },
  );
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
  // Render Markdown bold/code as Telegram HTML, then humanize ISO dates.
  // Order: HTML transform first (it inserts tags), date humanizer second
  // (it operates on plain digit patterns, unaffected by surrounding tags).
  // Trim to the 4096-char cap last.
  const rendered = humanizeDates(mdToTelegramHtml(text)).slice(0, 4096);
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
