// Turns an article JSON into a spoken script for the video. Purely
// template-based: no LLM call, no external dependency, nothing that can
// fail or cost money.
import fs from "node:fs";
import { ARTICLES_DIR, INTRO_BG_PATH, SITUATION_IMAGES } from "./config.mjs";

function clean(text) {
  return text.replace(/\s+/g, " ").trim();
}

// The TTS voice reads "cm"/"mm"/"kg" abbreviations awkwardly, and dimensions
// aren't useful read aloud anyway — strip them from anything destined for
// narration. Captions (on-screen text) keep the original, unstripped wording.
const PAREN_WITH_DIMENSION = /\([^()]*\d[^()]*(?:cm|mm|kg|cl|ml|m)[^()]*\)/gi;
const DIMENSION_TOKEN = /(?:[ØøΦ]|D(?=\d))?\s?\d[\d.,/x×\s]*\s?(cm|mm|kg|cl|ml|m)\b\.?/gi;

function stripDimensionsForSpeech(text) {
  return clean(
    text
      .replace(PAREN_WITH_DIMENSION, "")
      .replace(DIMENSION_TOKEN, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+([,.:;])/g, "$1")
      .replace(/,\s*,/g, ",")
  );
}

// A handful of brand/model names read badly by French TTS no matter how
// they're capitalized (glued English or invented compounds) — spell them
// out explicitly rather than hoping the generic camelCase split below is
// enough.
const PRONUNCIATION_FIXES = [[/\bIntelliTAG\b/gi, "Intelli Tag"], [/\bSwitchBot\b/gi, "Switch Bot"]];

// Glued CamelCase compounds ("SwitchBot", "IntelliTAG") get read as one
// mangled word — split on the lowercase→uppercase boundary so TTS treats
// them as two separate words instead.
function splitCamelCase(text) {
  return text.replace(/([a-zàâäéèêëïîôöùûüç])([A-Z])/g, "$1 $2");
}

function fixPronunciation(text) {
  let result = text;
  for (const [pattern, replacement] of PRONUNCIATION_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return splitCamelCase(result);
}

const MAX_SPOKEN_NAME_WORDS = 8;

// Product names are written for a listing, not for being read aloud —
// strip invented/foreign brand suffixes, fix known mispronunciations, and
// cap the length. Captions keep the full original name.
function simplifyNameForSpeech(name) {
  let cleaned = name
    .replace(/\s*[-–]\s*[A-Za-z][\w'.]*$/, "")
    .replace(/^(?:[A-Z]{2,}[A-Z0-9]*\s+)+/, "");

  const TRAILING_STOPWORDS = new Set(["à", "de", "du", "des", "en", "et", "avec", "la", "le", "les", "un", "une"]);
  let words = cleaned.trim().split(/\s+/);
  if (words.length > MAX_SPOKEN_NAME_WORDS) {
    words = words.slice(0, MAX_SPOKEN_NAME_WORDS);
    while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1].toLowerCase())) {
      words.pop();
    }
    cleaned = words.join(" ");
  }
  return fixPronunciation(cleaned.trim() || name);
}

// A short, spoken-friendly cut of a product's first listed advantage — only
// used in "comparatif" format, where the video needs to say *why* each
// product differs, not just its name and price.
function shortAdvantage(product) {
  const pro = product.pros?.[0];
  if (!pro) return null;
  const words = pro.split(/\s+/).slice(0, 6).join(" ");
  return fixPronunciation(clean(words));
}

export function priceToNumber(price) {
  const match = (price || "").match(/[\d.,]+/);
  if (!match) return Infinity;
  return parseFloat(match[0].replace(/\./g, "").replace(",", "."));
}

// Budget-tier framing (cheapest → priciest), with varied sentence shapes
// per slot instead of one rigid "{tag} : {name}, à {price} !" template
// repeated five times — reads more like a person talking, less like a
// list being read out. "comparatif" articles append a short advantage
// clause so the viewer hears *why* each pick differs, not just its price.
const MIDDLE_TEMPLATES = [
  (name, price) => `Ensuite, ${name}, pour ${price} !`,
  (name, price) => `On continue avec ${name}, à ${price} !`,
  (name, price) => `Et voici ${name}, à ${price} !`,
];

function productSentence(product, i, total, isComparatif) {
  const name = simplifyNameForSpeech(stripDimensionsForSpeech(product.name));
  const price = product.price;
  let sentence;
  if (i === 0) sentence = `On commence petit budget, avec ${name}, à seulement ${price}`;
  else if (i === total - 1) sentence = `Et si tu veux mettre le prix, ${name}, à ${price}`;
  else sentence = MIDDLE_TEMPLATES[(i - 1) % MIDDLE_TEMPLATES.length](name, price).replace(/\s*!$/, "");

  if (isComparatif) {
    const advantage = shortAdvantage(product);
    if (advantage) return `${sentence} : ${advantage} !`;
  }
  return `${sentence} !`;
}

// Wraps up a "comparatif" video with a one-line takeaway comparing the
// cheapest and priciest picks — the "petite conclusion" a comparison format
// needs that a simple favorites list doesn't.
function comparatifConclusion(products) {
  const cheapest = products[0];
  const priciest = products[products.length - 1];
  const cheapName = simplifyNameForSpeech(stripDimensionsForSpeech(cheapest.name));
  const premiumName = simplifyNameForSpeech(stripDimensionsForSpeech(priciest.name));
  return `En résumé : ${cheapName} pour un premier prix malin, ${premiumName} si tu veux le haut de gamme !`;
}

// A quick "in situation" cutaway after the product's own studio photo, for
// categories with a real contextual photo sourced (see config.mjs) — skips
// cleanly for categories without one yet instead of guessing.
const SITUATION_PHRASES = {
  "camera-exterieure": "Parfaite en extérieur !",
  "camera-interieure": "Discrète dans votre salon !",
  serrure: "Idéale sur votre porte !",
  alarme: "Juste à côté de l'entrée !",
};

// Hooks name the topic explicitly (hookSubject, e.g. "les meilleures
// sonnettes connectées pour ta porte") so the viewer knows in the first
// second what the video is about — a generic hook fitted to any topic
// tells them nothing. Two pools by format so a comparison video sounds
// like a comparison and a favorites video sounds like a favorites pick,
// picked deterministically per article so re-renders stay consistent but
// different articles don't all sound identical.
const HOOK_TEMPLATES = {
  "coup-de-coeur": [
    (t) => `Aujourd'hui, nos coups de cœur parmi ${t} !`,
    (t) => `On a testé pour toi ${t} !`,
    (t) => `Voici ${t}, notre sélection du jour !`,
    (t) => `Tu cherches ${t} ? T'es au bon endroit !`,
  ],
  comparatif: [
    (t) => `On compare pour toi ${t} !`,
    (t) => `${t} : on t'aide à choisir !`,
    (t) => `5 pépites parmi ${t}, comparatif complet !`,
    (t) => `On a trouvé pour toi ${t}, lequel est fait pour toi ?`,
  ],
};

// A hash-based pick collides too easily across a handful of slugs (4 of the
// first 5 articles landed on the same template by chance) — this article's
// stable alphabetical position among all content files round-robins through
// the templates instead, guaranteeing even coverage as the catalog grows.
function articleIndex(slug) {
  const files = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const i = files.indexOf(`${slug}.json`);
  return i === -1 ? 0 : i;
}

export function buildScript(article, { coverImage, outroImage } = {}) {
  const lines = [];
  const cover = coverImage || INTRO_BG_PATH;
  const outroCover = outroImage || cover;

  // "comparatif" articles get a comparison clause per product and a short
  // conclusion; "coup-de-coeur" (the default) stays a punchy favorites list.
  // Not every video needs to argue a case — alternating keeps the channel
  // varied instead of forcing a spec-sheet tone onto every topic.
  const format = article.format === "comparatif" ? "comparatif" : "coup-de-coeur";
  const isComparatif = format === "comparatif";

  const hookSubject = article.hookSubject || "les meilleurs produits pour sécuriser sa maison";
  const hookPool = HOOK_TEMPLATES[format];
  const hookTemplate = hookPool[articleIndex(article.slug) % hookPool.length];
  lines.push({
    id: "intro",
    spoken: clean(hookTemplate(hookSubject)),
    caption: article.title,
    image: cover,
    fullBleed: true,
  });

  const products = [...article.products].sort((a, b) => priceToNumber(a.price) - priceToNumber(b.price)).slice(0, 5);

  products.forEach((product, i) => {
    lines.push({
      id: `product-${i}`,
      spoken: clean(productSentence(product, i, products.length, isComparatif)),
      caption: `${product.name}\n${product.price}`,
      image: product.image,
      product,
    });

    const situationImage = SITUATION_IMAGES[product.category];
    const situationPhrase = SITUATION_PHRASES[product.category];
    if (situationImage && situationPhrase) {
      lines.push({
        id: `product-${i}-situation`,
        spoken: situationPhrase,
        caption: "En situation",
        image: situationImage,
      });
    }
  });

  if (isComparatif) {
    lines.push({
      id: "conclusion",
      spoken: clean(comparatifConclusion(products)),
      caption: "Notre avis",
      image: outroCover,
      fullBleed: true,
    });
  }

  lines.push({
    id: "outro",
    spoken: "Alors, lequel est ton coup de cœur ? Tous les liens sont juste en dessous. Abonne-toi pour la suite !",
    caption: "Liens en description",
    image: outroCover,
    fullBleed: true,
  });

  return lines;
}
