import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, defaultsFor, logUsage } from "../llm/anthropic.js";
import { toolDefinitions } from "../tools/definitions.js";
import { dispatchTool } from "../tools/dispatch.js";
import { loadPrompt } from "./prompt-loader.js";
import { logger } from "../logger.js";

const MAX_ITERATIONS = 8;

export type ChiefInput = {
  userMessage: string;
  conversationId?: string;
  priorHistory?: Anthropic.MessageParam[];
};

export type ChiefOutput = {
  text: string;
  toolCalls: Array<{ name: string; input: unknown; result: string; is_error?: boolean }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read: number;
    cache_create: number;
  };
};

/**
 * Chief of Staff: manual tool-use loop. Streams are overkill for v1; this is
 * a transactional request/response flow that returns the final text.
 */
export async function runChiefOfStaff(input: ChiefInput): Promise<ChiefOutput> {
  const defaults = defaultsFor("routine");
  const tools = toolDefinitions();
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: loadPrompt("chief-of-staff"),
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    ...(input.priorHistory ?? []),
    { role: "user", content: input.userMessage },
  ];

  const toolCalls: ChiefOutput["toolCalls"] = [];
  let totals = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_create: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      ...defaults,
      system,
      tools,
      messages,
    });
    logUsage(`chief-of-staff:iter${i}`, defaults.model, response.usage);
    totals.input_tokens += response.usage.input_tokens;
    totals.output_tokens += response.usage.output_tokens;
    totals.cache_read += response.usage.cache_read_input_tokens ?? 0;
    totals.cache_create += response.usage.cache_creation_input_tokens ?? 0;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = composeFinalText(textFromContent(response.content), toolCalls);
      return { text, toolCalls, usage: totals };
    }

    if (response.stop_reason !== "tool_use") {
      logger.warn({ stop_reason: response.stop_reason }, "unexpected stop_reason");
      const text = composeFinalText(textFromContent(response.content), toolCalls);
      return { text, toolCalls, usage: totals };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await dispatchTool(block.name, block.input);
      toolCalls.push({
        name: block.name,
        input: block.input,
        result: result.content,
        is_error: result.is_error,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error ?? false,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Chief of Staff exceeded ${MAX_ITERATIONS} iterations`);
}

function textFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Strip ANY `✓ Captured:` / `✓ Updated:` line the model produced. The
 * model is no longer responsible for writing receipts — `composeFinalText`
 * synthesizes them from real tool results below. Stripping is unconditional
 * because a model-written receipt is, at best, redundant with the
 * synthesized one and, at worst, a forged claim about something that
 * didn't happen. The data lives in `toolCalls`; trust that, not the prose.
 *
 * Returns the text with receipt-prefixed lines removed.
 */
export function stripModelReceipts(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let stripped = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("✓ Captured:") || trimmed.startsWith("✓ Updated:")) {
      stripped++;
      continue;
    }
    kept.push(line);
  }
  if (stripped > 0) {
    logger.warn(
      { stripped, sample: text.slice(0, 200) },
      "stripped model-written receipt prefix — receipts are now code-generated",
    );
  }
  return kept.join("\n").trim();
}

/**
 * Build a deterministic receipt line from a successful create_task or
 * update_task tool result. Returns null for any other tool, errored
 * results, or malformed payloads. Format matches the prior model-emitted
 * shape for visual continuity:
 *
 *   ✓ Captured: <title> [<Project> · <Priority> · <Deadline>]
 *   ✓ Updated:  <title> [<Project> · <Priority> · <Deadline>]
 *
 * Deadline renders as the ISO date when set (the messenger humanizes it
 * to "Month Day Year" before delivery) or "no deadline" when null.
 */
export function receiptFor(call: ChiefOutput["toolCalls"][number]): string | null {
  if (call.is_error) return null;
  if (call.name !== "create_task" && call.name !== "update_task") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as { ok?: boolean; task?: Record<string, unknown> };
  if (!r.ok || !r.task) return null;

  const t = r.task;
  const title = String(t.title ?? "").trim();
  const project = String(t.project ?? "").trim();
  const priority = String(t.priority ?? "").trim();
  const deadline = t.deadline ? String(t.deadline) : "no deadline";
  if (!title || !project || !priority) return null;

  const verb = call.name === "create_task" ? "Captured" : "Updated";
  return `✓ ${verb}: ${title} [${project} · ${priority} · ${deadline}]`;
}

/**
 * Compose the final text the user sees: synthesized receipts (one per
 * successful create/update tool call) on top, then any commentary the
 * model produced (with its own receipt attempts stripped). This is the
 * Option B fix — the model never writes the receipt; the system does,
 * from data the dispatcher actually persisted.
 */
export function composeFinalText(
  modelText: string,
  toolCalls: ChiefOutput["toolCalls"],
): string {
  const receipts = toolCalls
    .map(receiptFor)
    .filter((r): r is string => r !== null);

  const commentary = stripModelReceipts(modelText);

  if (receipts.length === 0) return commentary;
  if (commentary.length === 0) return receipts.join("\n");
  return `${receipts.join("\n")}\n\n${commentary}`;
}
