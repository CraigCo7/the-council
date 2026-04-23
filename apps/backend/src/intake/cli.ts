import readline from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";
import { config } from "../config.js";
import { loadPrompt } from "../agents/prompt-loader.js";

// Rough tokenization estimate — good enough for the cache-threshold diagnostic.
// Claude's tokenizer averages ~3.5 chars/token for English prose; we under-
// estimate slightly (use 4) so we don't over-promise cache activation.
const CHARS_PER_TOKEN = 4;
// Published minimum cacheable prefix per model. Shorter prefixes silently
// skip the cache write (no error, just cache_creation_input_tokens: 0).
const CACHE_MIN: Record<string, number> = {
  "claude-opus-4-7": 4096,
  "claude-opus-4-6": 4096,
  "claude-opus-4-5": 4096,
  "claude-haiku-4-5": 4096,
  "claude-sonnet-4-6": 2048,
  "claude-sonnet-4-5": 1024,
};

function printBootBanner(): void {
  const promptChars = loadPrompt("chief-of-staff").length;
  const approxPromptTokens = Math.round(promptChars / CHARS_PER_TOKEN);
  const routineModel = config.anthropic.models.routine;
  const minPrefix = CACHE_MIN[routineModel] ?? 4096;
  // System + tools (~500 tokens for our six tools) is the cacheable prefix.
  const approxPrefix = approxPromptTokens + 500;
  const willCache = approxPrefix >= minPrefix;

  console.log("The Council — CLI");
  console.log(`  operator:        ${config.operator.name} · ${config.operator.timezone}`);
  console.log(`  routine (router):${routineModel}`);
  console.log(`  brief:           ${config.anthropic.models.brief}`);
  console.log(`  strategic:       ${config.anthropic.models.strategic}`);
  console.log(
    `  prompt cache:    ${willCache ? "expected to activate" : "WILL NOT ACTIVATE"} — ` +
      `prefix ≈ ${approxPrefix} tok vs ${minPrefix} tok min for ${routineModel}`,
  );
  if (!willCache) {
    console.log(
      "                   → switch MODEL_ROUTINE to claude-sonnet-4-6 in .env, or bulk the prompt.",
    );
  }
  console.log("  Ctrl+C to exit. '/exit', '/history', '/reset' are special.\n");
}

async function main(): Promise<void> {
  printBootBanner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Full conversation history passed to the model on each turn. We keep only
  // user text and assistant text — tool_use / tool_result blocks stay inside
  // the single-turn loop in chief-of-staff and aren't persisted here. The
  // model sees that "a task was captured" via the assistant's text reply and
  // can re-query via list_tasks if it needs structured state.
  const history: Anthropic.MessageParam[] = [];

  const prompt = () =>
    new Promise<string>((resolve) => rl.question("> ", (answer) => resolve(answer.trim())));

  while (true) {
    const text = await prompt();
    if (!text) continue;

    if (text === "/exit" || text === "/quit") break;
    if (text === "/history") {
      console.log(JSON.stringify(history, null, 2));
      continue;
    }
    if (text === "/reset") {
      history.length = 0;
      console.log("(history cleared)\n");
      continue;
    }

    try {
      const output = await runChiefOfStaff({ userMessage: text, priorHistory: history });
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: output.text });
      console.log(`\n${output.text}\n`);
      if (output.toolCalls.length > 0) {
        const errs = output.toolCalls.filter((t) => t.is_error);
        console.log(
          `[tools: ${output.toolCalls.length} call(s)${errs.length ? `, ${errs.length} error(s)` : ""}]\n`,
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
