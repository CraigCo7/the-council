import { anthropic, defaultsFor, logUsage } from "../llm/anthropic.js";
import { loadPrompt } from "./prompt-loader.js";

export type AnalystInput = {
  topic: string;
  context: string;
};

export async function consultStrategicAnalyst(input: AnalystInput): Promise<string> {
  const defaults = defaultsFor("strategic");
  const response = await anthropic.messages.create({
    ...defaults,
    system: [
      {
        type: "text",
        text: loadPrompt("strategic-analyst"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `# Topic\n${input.topic}\n\n# Context\n${input.context}`,
      },
    ],
  });

  logUsage("strategic-analyst", response.usage);

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");
  return text;
}
