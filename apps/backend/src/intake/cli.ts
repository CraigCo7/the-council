import readline from "node:readline";
import { runChiefOfStaff } from "../agents/chief-of-staff.js";

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const history: { role: "user" | "assistant"; content: string }[] = [];

  console.log("The Council — CLI. Ctrl+C to exit. '/' prefixed commands are special.\n");

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

    try {
      const output = await runChiefOfStaff({ userMessage: text });
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
