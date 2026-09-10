import fs from "node:fs";
import path from "node:path";
import { selectNextArticle, loadArticleBySlug, markUsed, recentlyPublished } from "./select-article.mjs";
import { buildScript } from "./build-script.mjs";
import { synthesizeLines } from "./tts.mjs";
import { renderVideo } from "./render.mjs";
import { uploadVideo } from "./upload.mjs";
import { sendPostedEmail } from "./notify.mjs";
import { TMP_DIR, OUT_DIR } from "./config.mjs";

async function main() {
  // FORCE_ARTICLE_SLUG lets you redo one specific video instead of
  // advancing to the next unused article in the queue.
  const forcedSlug = process.env.FORCE_ARTICLE_SLUG;

  // cron-job.org's redundant trigger and GitHub's own native schedule can
  // both fire for the same 7h/12h/17h slot — bail out early (before any
  // TTS/render/upload work) if we already published recently, instead of
  // producing a real extra video every time an automated trigger overlaps.
  if (!forcedSlug && recentlyPublished()) {
    console.log("A video was already published recently — skipping this run to avoid a duplicate/extra publish.");
    return;
  }

  const picked = forcedSlug ? loadArticleBySlug(forcedSlug) : selectNextArticle();
  if (!picked) {
    console.log(
      forcedSlug
        ? `Article "${forcedSlug}" not found or has no product with a real price.`
        : "No unused article left in content/ — nothing to do this run."
    );
    return;
  }
  const { slug, article } = picked;
  console.log(`Selected article: ${slug}`);

  const runTmpDir = path.join(TMP_DIR, slug);
  fs.rmSync(runTmpDir, { recursive: true, force: true });
  fs.mkdirSync(runTmpDir, { recursive: true });

  const scriptLines = buildScript(article);
  console.log(`Built script with ${scriptLines.length} lines`);

  const linesWithAudio = await synthesizeLines(scriptLines, runTmpDir);
  console.log("Voice-over generated for all lines");

  const outPath = path.join(OUT_DIR, `${slug}.mp4`);
  await renderVideo({ lines: linesWithAudio, article, tmpDir: runTmpDir, outPath });
  console.log(`Video rendered: ${outPath}`);

  if (process.env.SKIP_UPLOAD === "1") {
    console.log("SKIP_UPLOAD=1 set — skipping YouTube upload (local test run).");
  } else {
    const result = await uploadVideo({ videoPath: outPath, article });
    const videoUrl = `https://youtube.com/watch?v=${result.id}`;
    console.log(`Uploaded: ${videoUrl} (privacy: ${result.status?.privacyStatus})`);
    await sendPostedEmail({ article, videoUrl });
  }

  markUsed(slug);
  console.log(`Marked "${slug}" as used.`);

  if (process.env.KEEP_TMP !== "1") {
    fs.rmSync(runTmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  if (err?.response?.data) {
    console.error("API error response:", JSON.stringify(err.response.data, null, 2));
  }
  console.error(err);
  process.exit(1);
});
