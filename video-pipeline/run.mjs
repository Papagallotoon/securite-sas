import fs from "node:fs";
import path from "node:path";
import {
  selectNextArticleForType,
  buildSoloArticle,
  loadArticleBySlug,
  markUsed,
  recentlyPublished,
  nextFormatType,
  recordPublishedType,
} from "./select-article.mjs";
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

  let picked;
  if (forcedSlug) {
    picked = loadArticleBySlug(forcedSlug);
  } else {
    // Daily format mix: 2 comparatif / 2 audible / 1 solo, per the standing
    // rule — nextFormatType() says which slot today's run should fill.
    const targetType = nextFormatType();
    picked = targetType === "solo" ? buildSoloArticle() : selectNextArticleForType(targetType);
    // The target type may be out of fresh content (nothing authored yet, or
    // its catalog is fully used up for now) — try the other comparatif/
    // audible type fresh, then a solo spotlight, rather than ever calling
    // selectNextArticleForType again for the same type: that would either
    // return null again, or — before 2026-09-12 — silently re-upload an
    // already-published topic as if it were new.
    if (!picked && targetType !== "solo") {
      const altType = targetType === "comparatif" ? "audible" : "comparatif";
      console.log(`No fresh "${targetType}" article available — trying "${altType}" instead.`);
      picked = selectNextArticleForType(altType);
    }
    if (!picked) {
      console.log("No fresh comparatif/audible article left — falling back to a solo spotlight.");
      picked = buildSoloArticle();
    }
  }
  if (!picked) {
    console.log(
      forcedSlug
        ? `Article "${forcedSlug}" not found or has no product with a real price.`
        : "No fresh content available anywhere (comparatif, audible, solo) — skipping this run rather than republishing a duplicate."
    );
    return;
  }
  const { slug, article, actualType } = picked;
  console.log(`Selected article: ${slug}${actualType ? ` (type: ${actualType})` : ""}`);

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
  if (actualType) recordPublishedType(actualType);
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
