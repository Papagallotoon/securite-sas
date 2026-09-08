import fs from "node:fs";
import path from "node:path";
import { ARTICLES_DIR, STATE_PATH } from "./config.mjs";

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { usedSlugs: [] };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// Always moves the slug to the *end* of usedSlugs, even on a repeat — this
// is what makes the rotation fallback in selectNextArticle() work: the
// least-recently-published topic is always usedSlugs[0], so cycling back
// through the catalog never repeats a topic until every other one has had
// its turn again.
export function markUsed(slug) {
  const state = loadState();
  state.usedSlugs = state.usedSlugs.filter((s) => s !== slug);
  state.usedSlugs.push(slug);
  saveState(state);
}

// Some catalog entries carry a placeholder price instead of a real one —
// never read that out loud or show it, drop the product instead.
function hasRealPrice(product) {
  return /\d/.test(product.price || "");
}

// Loads one specific article by slug regardless of whether it was already
// used — for redoing a video after fixing the article's content.
export function loadArticleBySlug(slug) {
  const file = path.join(ARTICLES_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  const article = JSON.parse(fs.readFileSync(file, "utf8"));
  article.products = (article.products || []).filter(hasRealPrice);
  if (article.products.length === 0) return null;
  return { slug, article };
}

// Child-safety topics (bébé-proofing) are outperforming the rest of the
// catalog — bump them ahead of the regular alphabetical queue instead of
// waiting for their turn. Remove a slug here once it's been published;
// anything not listed just falls back to the normal order below.
const PRIORITY_SLUGS = [
  "top-5-protections-angles-meubles-enfant",
  "top-5-verrous-securite-enfant-placards",
];

// Picks the next article that hasn't been turned into a video yet —
// priority slugs first (see above), then alphabetical order. Returns null
// once every article has been used at least once.
export function selectNextArticle() {
  const state = loadState();
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const bySlug = (slug) => {
    const file = `${slug}.json`;
    if (!files.includes(file)) return null;
    if (state.usedSlugs.includes(slug)) return null;
    const article = JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8"));
    article.products = (article.products || []).filter(hasRealPrice);
    if (article.products.length === 0) return null;
    return { slug, article };
  };

  for (const slug of PRIORITY_SLUGS) {
    const picked = bySlug(slug);
    if (picked) return picked;
  }

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    if (PRIORITY_SLUGS.includes(slug)) continue; // already tried above
    const picked = bySlug(slug);
    if (picked) return picked;
  }

  // Every topic has been published at least once — per the "3 videos/day,
  // no matter what" standing rule, skipping the day is no longer an
  // acceptable outcome here. Rotate back through already-published topics
  // instead, oldest-first (usedSlugs[0]). markUsed() always moves a slug to
  // the end of usedSlugs, so this naturally cycles the whole catalog before
  // any single topic repeats twice.
  for (const slug of state.usedSlugs) {
    const picked = loadArticleBySlug(slug);
    if (picked) return picked;
  }

  return null; // truly no article anywhere has a real-priced product
}
