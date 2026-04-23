import { generateWeeklyReview } from "../briefs/weekly.js";

async function main() {
  const review = await generateWeeklyReview();
  console.log(`Wrote ${review.relPath}\n`);
  console.log(review.body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
