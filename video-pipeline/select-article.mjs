import fs from "node:fs";
import path from "node:path";
import { ARTICLES_DIR, STATE_PATH, REQUETES_PATH } from "./config.mjs";

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { usedSlugs: [] };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// Always moves the slug to the *end* of usedSlugs, even on a repeat — this
// is what makes the rotation fallback in selectNextArticleForType() work:
// the least-recently-published topic (of a given type) is always earliest
// in usedSlugs, so cycling back through the catalog never repeats a topic
// until every other one of that type has had its turn again.
export function markUsed(slug) {
  const state = loadState();
  state.usedSlugs = state.usedSlugs.filter((s) => s !== slug);
  state.usedSlugs.push(slug);
  state.lastRunAt = new Date().toISOString();
  saveState(state);
}

// The 5 intended daily slots (6h/9h30/13h/16h30/20h UTC) are 3h30 apart.
// cron-job.org's redundant trigger and GitHub's own native schedule can
// both fire for the same slot (near-simultaneously, or one delayed behind
// the other) — without a real time-based guard, each extra fire still
// produces a full extra video. 3h is short enough to never block a
// legitimate next slot, long enough to absorb any duplicate/delayed
// re-fire of the current one. Bypassed by FORCE_ARTICLE_SLUG, which is
// always a deliberate ask.
const MIN_HOURS_BETWEEN_RUNS = 3;

export function recentlyPublished() {
  const state = loadState();
  if (!state.lastRunAt) return false;
  const hoursSince = (Date.now() - new Date(state.lastRunAt).getTime()) / 3_600_000;
  return hoursSince < MIN_HOURS_BETWEEN_RUNS;
}

// --- Daily format mix (2 comparatif / 2 audible / 1 solo) ---------------
//
// "Comparatif" = the usual top-5 product roundup. "Audible" = a top-5
// books/audiobooks video (article.videoType: "audible" in its JSON — see
// top-5-livres-cybersecurite.json). "Solo" = a single-product spotlight —
// no dedicated content exists for this yet, so it's synthesized on the fly
// from one product picked out of the comparatif catalog (see
// buildSoloArticle below) instead of requiring dozens of hand-authored
// one-product articles.
// "requete" = a short answering one real Google/YouTube search query of the
// channel (see requetes.json, built from Search Console) — first slot of
// the day, falls back to the normal comparatif logic once the list is used up.
const FORMAT_SEQUENCE = ["requete", "comparatif", "audible", "comparatif", "solo"];

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date, matches cron's own clock
}

function getDailyCounts() {
  const state = loadState();
  if (!state.dailyCounts || state.dailyCounts.date !== todayKey()) {
    return { date: todayKey(), requete: 0, comparatif: 0, audible: 0, solo: 0 };
  }
  return state.dailyCounts;
}

// Which format slot today's run should fill, based on how many of each
// format have already gone out today (state.dailyCounts, reset at UTC
// midnight). Once the day's 5 slots are all filled (extra manual runs),
// keeps alternating comparatif/audible as a safe default rather than
// erroring.
export function nextFormatType() {
  const counts = getDailyCounts();
  const totalToday = (counts.requete || 0) + (counts.comparatif || 0) + (counts.audible || 0) + (counts.solo || 0);
  if (totalToday < FORMAT_SEQUENCE.length) return FORMAT_SEQUENCE[totalToday];
  return totalToday % 2 === 0 ? "comparatif" : "audible";
}

// Call once a video of the given type has actually been uploaded — keeps
// the day's format mix accurate even when a fallback substituted a
// different type than originally requested (see run.mjs).
export function recordPublishedType(type) {
  const state = loadState();
  const counts = getDailyCounts();
  counts[type] = (counts[type] || 0) + 1;
  state.dailyCounts = counts;
  saveState(state);
}

// Some catalog entries carry a placeholder price instead of a real one —
// never read that out loud or show it, drop the product instead.
function hasRealPrice(product) {
  return /\d/.test(product.price || "");
}

function articleType(article) {
  return article.videoType || "comparatif";
}

function readArticle(file) {
  const article = JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8"));
  article.products = (article.products || []).filter(hasRealPrice);
  return article;
}

// Loads one specific article by slug regardless of whether it was already
// used — for redoing a video after fixing the article's content.
export function loadArticleBySlug(slug) {
  const requete = loadRequetes().find((r) => r.slug === slug);
  if (requete) return buildRequeteArticle(requete);
  const file = path.join(ARTICLES_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  const article = readArticle(`${slug}.json`);
  if (article.products.length === 0) return null;
  return { slug, article };
}

// Child-safety topics (bébé-proofing) are outperforming the rest of the
// catalog — bump them ahead of the regular alphabetical queue instead of
// waiting for their turn. Remove a slug here once it's been published;
// anything not listed just falls back to the normal order below. Only
// applies within the "comparatif" type.
const PRIORITY_SLUGS = [
  "top-5-protections-angles-meubles-enfant",
  "top-5-verrous-securite-enfant-placards",
];

// Picks the next UNUSED article of a given format type (priority slugs
// first for "comparatif", then alphabetical order). Returns null once every
// article of this type has already been published — never republishes an
// already-used topic as if it were new; run.mjs is responsible for trying
// another type or a solo spotlight instead of calling this again with the
// same type. (Previously this rotated back through already-published topics
// of the same type as a "never skip a slot" fallback — that produced literal
// duplicate re-uploads on channels whose catalog is smaller than the daily
// slot count, e.g. spdb republishing the same top-5 video 2 days apart. Fixed
// 2026-09-12.)
export function selectNextArticleForType(type) {
  const state = loadState();
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const bySlug = (slug) => {
    const file = `${slug}.json`;
    if (!files.includes(file)) return null;
    if (state.usedSlugs.includes(slug)) return null;
    const article = readArticle(file);
    if (articleType(article) !== type) return null;
    if (article.products.length === 0) return null;
    return { slug, article };
  };

  if (type === "comparatif") {
    for (const slug of PRIORITY_SLUGS) {
      const picked = bySlug(slug);
      if (picked) return { ...picked, actualType: type };
    }
  }

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    if (type === "comparatif" && PRIORITY_SLUGS.includes(slug)) continue; // already tried above
    const picked = bySlug(slug);
    if (picked) return { ...picked, actualType: type };
  }

  return null; // every article of this type has already been published
}

// "Solo" videos spotlight a single product instead of a top-5 — rather
// than requiring a whole separate catalog of one-product articles, pick
// one product out of the existing comparatif catalog and wrap it in a
// synthetic single-product article. state.soloIndex rotates deterministically
// through every (article, product) pair so the same product isn't spotlit
// every time.
export function buildSoloArticle() {
  const state = loadState();
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const pool = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const article = readArticle(file);
    if (articleType(article) === "audible") continue; // solo spotlights a physical product
    for (const product of article.products) {
      pool.push({ sourceSlug: slug, sourceArticle: article, product });
    }
  }
  if (pool.length === 0) return null;

  const soloIndex = state.soloIndex || 0;
  const pick = pool[soloIndex % pool.length];
  state.soloIndex = soloIndex + 1;
  saveState(state);

  // upload.mjs's buildHookTitle() needs article.slug — hashString(article.slug)
  // throws mid-upload otherwise (a real bug hit in production on 2026-09-13
  // on the sibling deco-site repo: the video rendered fine but the upload
  // crashed, so nothing got published). Point at the source article's real
  // slug so SITE_ARTICLE_PATHS[article.slug] also resolves to a real,
  // relevant page (the full comparison this product came from) instead of
  // silently omitting the site link.
  const article = {
    title: pick.product.name,
    slug: pick.sourceSlug,
    excerpt: pick.sourceArticle.excerpt,
    hookSubject: pick.product.name,
    format: "coup-de-coeur",
    products: [pick.product],
  };
  return {
    slug: `solo-${pick.sourceSlug}-${pick.product.affiliateUrl?.match(/\/dp\/([A-Z0-9]+)/i)?.[1] || soloIndex}`,
    article,
    actualType: "solo",
  };
}

// --- "requete" shorts (one real search query answered in ~30 s) ----------
export function loadRequetes() {
  if (!fs.existsSync(REQUETES_PATH)) return [];
  return JSON.parse(fs.readFileSync(REQUETES_PATH, "utf8").replace(/^\uFEFF/, ""));
}

// Wraps one requetes.json entry into an article the rest of the pipeline
// understands. article.slug stays the SOURCE article's slug so upload.mjs
// finds the matching site page (SITE_ARTICLE_PATHS) and hashes stay stable.
export function buildRequeteArticle(r) {
  const file = path.join(ARTICLES_DIR, `${r.source}.json`);
  if (!fs.existsSync(file)) return null;
  const source = readArticle(`${r.source}.json`);
  const pick = source.products.find((p) => p.name.toLowerCase().includes(r.pick.toLowerCase())) || source.products[0];
  if (!pick) return null;
  const article = {
    videoType: "requete",
    slug: r.source,
    title: r.title,
    hook: r.hook,
    tips: r.tips,
    keywords: r.keywords || [],
    excerpt: [r.title, "", ...r.tips.map(([spoken]) => `✅ ${spoken}`)].join("\n"),
    gallery: source.products.filter((p) => p !== pick).map((p) => p.image),
    products: [pick],
  };
  return { slug: r.slug, article, actualType: "requete" };
}

// Next requete not published yet, in file order (sorted by potential).
export function selectNextRequete() {
  const state = loadState();
  for (const r of loadRequetes()) {
    if (state.usedSlugs.includes(r.slug)) continue;
    const picked = buildRequeteArticle(r);
    if (picked) return picked;
  }
  return null;
}
