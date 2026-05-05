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
      const text = guardConfirmations(textFromContent(response.content), toolCalls);
      return { text, toolCalls, usage: totals };
    }

    if (response.stop_reason !== "tool_use") {
      logger.warn({ stop_reason: response.stop_reason }, "unexpected stop_reason");
      const text = guardConfirmations(textFromContent(response.content), toolCalls);
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
 * Strip forged confirmation prefixes when no successful matching tool call
 * happened in this turn.
 *
 * Background: an observed failure was Alfred replying `✓ Captured: …` for
 * messages where `create_task` was never invoked. The receipt looked real;
 * the task was never written. The prompt says don't do this, but prompts
 * drift. This is the durable invariant.
 *
 * Implementation: any LINE in the response that starts with `✓ Captured:`
 * or `✓ Updated:` is dropped if there's no successful create_task /
 * update_task tool call recorded in this turn. The remaining text is
 * preserved (so genuine context the operator should still see survives).
 * If the entire response was nothing but a forged receipt, we replace it
 * with a meta-message admitting the problem so the operator isn't
 * silently misled.
 */
export function guardConfirmations(
  text: string,
  toolCalls: ChiefOutput["toolCalls"],
): string {
  const ranCreate = toolCalls.some((t) => t.name === "create_task" && !t.is_error);
  const ranUpdate = toolCalls.some((t) => t.name === "update_task" && !t.is_error);

  // No forging possible if both happened — short-circuit.
  if (ranCreate && ranUpdate) return text;

  const lines = text.split("\n");
  const kept: string[] = [];
  let stripped = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!ranCreate && trimmed.startsWith("✓ Captured:")) {
      stripped++;
      continue;
    }
    if (!ranUpdate && trimmed.startsWith("✓ Updated:")) {
      stripped++;
      continue;
    }
    kept.push(line);
  }

  if (stripped === 0) return text;

  logger.warn(
    { stripped, ranCreate, ranUpdate, original: text.slice(0, 200) },
    "guarded forged confirmation prefix — agent claimed capture/update without running the tool",
  );

  const remaining = kept.join("\n").trim();
  const notice =
    "(Council) I claimed to capture or update something but did not actually call the tool. Re-issue the request to log it for real.";

  return remaining.length === 0 ? notice : `${notice}\n\n${remaining}`;
}
