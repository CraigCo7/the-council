import { config } from "../config.js";
import { logger } from "../logger.js";
import { sendWhatsapp } from "./whatsapp.js";

export type Channel = "console" | "whatsapp";

/**
 * One-way send — keeps the rest of the system agnostic to the channel.
 * v1 defaults to console; Phase 3 adds WhatsApp.
 */
export async function send(text: string, channel: Channel = "console"): Promise<void> {
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
