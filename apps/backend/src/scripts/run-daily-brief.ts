import { generateDailyBrief } from "../briefs/daily.js";

async function main() {
  const brief = await generateDailyBrief();
  console.log(`Wrote ${brief.relPath}\n`);
  console.log(brief.body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
