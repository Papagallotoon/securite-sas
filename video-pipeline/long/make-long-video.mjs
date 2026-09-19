// Builds one long-form inspiration video from a theme file:
//   node video-pipeline/long/make-long-video.mjs video-pipeline/long/themes/<slug>.json
// Images come from video-pipeline/long/images/<slug>/<section dir>/ (drop
// Google Flow exports there, in any order/format), or from an explicit
// "images" list per section. Writes the MP4 and a ready-to-paste YouTube
// description (chapters + clickable "shop the look" links) to out/long/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { ROOT_DIR, ARTICLES_DIR, TTS_VOICE } from "../config.mjs";
import { SITE_ARTICLE_PATHS, SITE_DOMAIN } from "../upload.mjs";
import { getAudioDurationSeconds } from "../ffprobe.mjs";
import { renderLongVideo, formatTimestamp } from "./render-long.mjs";

const escapeSsml = (t) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Optional voice-over: <theme>.narration.json maps "<section dir>/<file name>"
// to the sentence spoken over that image. Same voice as the Shorts, with a
// slightly slower, calmer prosody suited to a long relaxed video.
async function attachNarration(themeFile, theme, sections, tmpDir) {
  const narrationFile = themeFile.replace(/\.json$/, ".narration.json");
  if (!fs.existsSync(narrationFile)) return;
  const { prosody, items } = JSON.parse(fs.readFileSync(narrationFile, "utf8"));
  const used = new Set();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  let count = 0;
  for (const section of sections) {
    for (const item of section.images) {
      const key = `${section.dir}/${path.basename(item.path)}`;
      const text = items[key];
      if (!text) {
        console.warn(`Pas de commentaire pour ${key}`);
        continue;
      }
      used.add(key);
      const dir = path.join(tmpDir, "voice", String(count).padStart(3, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const { audioFilePath } = await tts.toFile(dir, escapeSsml(text), prosody);
      item.voice = audioFilePath;
      item.voiceDuration = await getAudioDurationSeconds(audioFilePath);
      process.stdout.write(`\rVoix générées : ${++count}`);
    }
  }
  tts.close();
  process.stdout.write("\n");
  const orphans = Object.keys(items).filter((k) => !used.has(k));
  if (orphans.length) console.warn(`Commentaires sans image correspondante : ${orphans.join(", ")}`);
}

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const LONG_DIR = path.join(ROOT_DIR, "video-pipeline", "long");

const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The CTA image is named without its extension, since Flow exports may be
// .jpg, .jpeg or .png.
const sameImage = (a, b) => a.replace(IMAGE_EXT, "") === b.replace(IMAGE_EXT, "");

// Flow exports are often dumped into a single folder: move every image whose
// file name starts with a section's folder name ("02-tons-chauds…") or its
// title ("Japandi aux tons chauds…") into that section's folder.
export function sortDroppedImages(theme) {
  const base = path.join(LONG_DIR, "images", theme.slug);
  if (!fs.existsSync(base)) return;
  const dirs = [base, ...theme.sections.map((s) => path.join(base, s.dir))];
  for (const s of theme.sections) fs.mkdirSync(path.join(base, s.dir), { recursive: true });
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f))) {
      const name = normalize(file.replace(IMAGE_EXT, ""));
      const target = theme.sections.find((s) => name.startsWith(normalize(s.dir)) || name.startsWith(normalize(s.title)));
      if (!target) continue;
      const dest = path.join(base, target.dir, file);
      if (path.join(dir, file) !== dest && !fs.existsSync(dest)) fs.renameSync(path.join(dir, file), dest);
    }
  }
}

function resolveSectionImages(theme, section) {
  // Explicit list: paths relative to the repo root, or { path, card } for a
  // product slide (card: { name, price }).
  if (section.images?.length)
    return section.images.map((e) => (typeof e === "string" ? { path: path.resolve(ROOT_DIR, e) } : { ...e, path: path.resolve(ROOT_DIR, e.path) }));
  const dir = path.join(LONG_DIR, "images", theme.slug, section.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f))
    .sort()
    .map((f) => ({ path: path.join(dir, f) }));
}

function shopTheLook(slugs, perArticle = 2) {
  const blocks = [];
  for (const slug of slugs || []) {
    const file = path.join(ARTICLES_DIR, `${slug}.json`);
    if (!fs.existsSync(file) || !SITE_ARTICLE_PATHS[slug]) continue;
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    const url = `${SITE_DOMAIN}${SITE_ARTICLE_PATHS[slug]}?utm_source=youtube&utm_medium=video_longue`;
    const products = (a.products || [])
      .filter((p) => p.affiliateUrl && /\d/.test(p.price || ""))
      .slice(0, perArticle)
      .map((p) => `   • ${p.name} (${p.price}) : ${p.affiliateUrl}`);
    blocks.push([`▶ ${a.title} : ${url}`, ...products].join("\n"));
  }
  return blocks.join("\n\n");
}

// "featured": [{ slug, asin }] — the few products worth putting right at the
// top of the description, looked up in their comparison article.
function featuredProducts(list) {
  const lines = [];
  for (const { slug, asin } of list || []) {
    const file = path.join(ARTICLES_DIR, `${slug}.json`);
    if (!fs.existsSync(file)) continue;
    const p = JSON.parse(fs.readFileSync(file, "utf8")).products.find((x) => x.affiliateUrl.includes(asin));
    if (p) lines.push(`${lines.length + 1}. ${p.name} (${p.price}) : ${p.affiliateUrl}`);
  }
  return lines.join("\n");
}

// SEO layout modelled on top-ranking decor channels: a keyword headline, the
// first hashtags (YouTube shows the first 3 above the title), chapters, what
// the video covers, shop-the-look links, a long-tail keyword paragraph, then
// disclosures. Hashtags are capped well under YouTube's 60 limit, beyond
// which it ignores every hashtag on the video.
export function buildDescription(theme, chapters) {
  const seo = theme.seo || {};
  const tags = (theme.hashtags || []).slice(0, 25).map((h) => `#${h}`);
  const lines = [];
  if (seo.headline) lines.push(seo.headline, tags.slice(0, 4).join(" "), "");
  const featured = featuredProducts(theme.featured);
  if (featured) lines.push(seo.featuredTitle || "⭐ LES PRODUITS ESSENTIELS :", featured, "");
  lines.push(theme.intro, "", "⏱ CHAPITRES", ...chapters.map((c) => `${formatTimestamp(c.time)} ${c.title}`));
  if (seo.covers?.length) lines.push("", "📌 DANS CETTE VIDÉO :", ...seo.covers.map((c) => `• ${c}`));
  const shop = shopTheLook(theme.shop, theme.shopProductsPerArticle);
  if (shop) lines.push("", seo.shopTitle || "🛒 NOS SÉLECTIONS :", "", shop);
  if (seo.keywords) lines.push("", seo.keywords);
  lines.push(
    "",
    seo.subscribe || "🔔 Abonnez-vous et likez la vidéo pour plus de conseils chaque semaine !",
    `🏠 Tous nos comparatifs : ${SITE_DOMAIN}`,
    "",
    "Images d'illustration générées par intelligence artificielle.",
    "Certains liens sont des liens d'affiliation Amazon : nous touchons une petite commission sur vos achats, sans surcoût pour vous. Les prix peuvent avoir changé depuis la publication.",
    "",
    tags.join(" ")
  );
  return lines.join("\n").slice(0, 5000);
}

async function main() {
  const themeFile = process.argv[2];
  if (!themeFile) {
    console.error("Usage : node video-pipeline/long/make-long-video.mjs <fichier-theme.json>");
    process.exit(1);
  }
  const theme = JSON.parse(fs.readFileSync(path.resolve(themeFile), "utf8"));
  if (theme.introLogo) theme.introLogo = path.resolve(ROOT_DIR, theme.introLogo);
  sortDroppedImages(theme);

  const sections = theme.sections
    .map((s) => ({
      ...s,
      images: resolveSectionImages(theme, s).map((img) => ({
        ...img,
        cta: theme.cta && sameImage(theme.cta.image, `${s.dir}/${path.basename(img.path)}`) ? theme.cta.text : undefined,
      })),
    }))
    .filter((s) => s.images.length);
  const missing = theme.sections.filter((s) => !sections.find((x) => x.title === s.title));
  if (missing.length) console.warn(`Sections sans image, ignorées : ${missing.map((s) => s.title).join(", ")}`);
  if (sections.length < 3) {
    console.error("Il faut au moins 3 sections avec des images (YouTube exige 3 chapitres minimum).");
    process.exit(1);
  }

  const outDir = path.join(ROOT_DIR, "video-pipeline", "out", "long");
  const outPath = path.join(outDir, `${theme.slug}.mp4`);
  const tmpDir = path.join(ROOT_DIR, "video-pipeline", "tmp", `long-${theme.slug}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const imageCount = sections.reduce((n, s) => n + s.images.length, 0);
  console.log(`${sections.length} sections, ${imageCount} images → ${outPath}`);
  await attachNarration(path.resolve(themeFile), theme, sections, tmpDir);
  const { duration, chapters, withMusic } = await renderLongVideo({ theme: { ...theme, sections }, outPath, tmpDir });

  const description = buildDescription(theme, chapters);
  fs.writeFileSync(path.join(outDir, `${theme.slug}.description.txt`), `${theme.title}\n\n${description}\n`);
  console.log(`Vidéo : ${formatTimestamp(duration)} ${withMusic ? "avec musique" : "SANS musique (ajoutez des pistes dans video-pipeline/assets/music/)"}`);
  console.log(`Description : ${path.join(outDir, `${theme.slug}.description.txt`)}`);
  if (process.env.KEEP_TMP !== "1") fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
