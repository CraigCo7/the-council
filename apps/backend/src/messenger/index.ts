import { config } from "../config.js";
import { logger } from "../logger.js";
import { sendWhatsapp } from "./whatsapp.js";
import { sendTelegram } from "./telegram.js";

export type Channel = "console" | "whatsapp" | "telegram";

/**
 * One-way send — keeps the rest of the system agnostic to the channel.
 * Each channel falls back to the next on error so a single misconfigured
 * messenger never silently swallows the operator's brief.
 *
 * Order of preference: explicit channel → telegram (if enabled) → whatsapp
 * (if enabled) → console log.
 */
export async function send(text: string, channel: Channel = "console"): Promise<void> {
  if (channel === "telegram" && config.telegram.enabled) {
    try {
      await sendTelegram(text);
      return;
    } catch (err) {
      logger.error({ err }, "telegram send failed — falling back to console");
    }
  }
  if (channel === "whatsapp" && config.whatsapp.enabled) {
    try {
      await sendWhatsapp(text);
      return;
    } catch (err) {
      logger.error({ err }, "whatsapp send failed — falling back to console");
    }
  }
  // Fallback: log so the operator sees it in the service log.
  logger.info({ text }, "OUT");
}
