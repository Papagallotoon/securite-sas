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

const MAX_SPOKEN_NAME_WORDS = 8;

// Product names are written for a listing, not for being read aloud —
// strip invented/foreign brand suffixes and cap the length. Captions keep
// the full original name.
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
  return cleaned.trim() || name;
}

export function priceToNumber(price) {
  const match = (price || "").match(/[\d.,]+/);
  if (!match) return Infinity;
  return parseFloat(match[0].replace(/\./g, "").replace(",", "."));
}

// Budget-tier framing (cheapest → priciest), with varied sentence shapes
// per slot instead of one rigid "{tag} : {name}, à {price} !" template
// repeated five times — reads more like a person talking, less like a
// list being read out.
const MIDDLE_TEMPLATES = [
  (name, price) => `Ensuite, ${name}, pour ${price} !`,
  (name, price) => `On continue avec ${name}, à ${price} !`,
  (name, price) => `Et voici ${name}, à ${price} !`,
];

function productSentence(product, i, total) {
  const name = simplifyNameForSpeech(stripDimensionsForSpeech(product.name));
  const price = product.price;
  if (i === 0) return `On commence petit budget, avec ${name}, à seulement ${price} !`;
  if (i === total - 1) return `Et si tu veux mettre le prix, ${name}, à ${price} !`;
  return MIDDLE_TEMPLATES[(i - 1) % MIDDLE_TEMPLATES.length](name, price);
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
// tells them nothing. Several sentence shapes, picked deterministically
// per article so re-renders stay consistent but different articles don't
// all sound identical.
const HOOK_TEMPLATES = [
  (t) => `Aujourd'hui : ${t} !`,
  (t) => `On a testé pour toi ${t} !`,
  (t) => `Voici ${t}, notre sélection du jour !`,
  (t) => `Tu cherches ${t} ? T'es au bon endroit !`,
  (t) => `5 pépites parmi ${t} !`,
  (t) => `On a trouvé pour toi ${t} !`,
];

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

export function buildScript(article, { coverImage } = {}) {
  const lines = [];
  const cover = coverImage || INTRO_BG_PATH;

  // Very short hook intro — the video targets ~45s total, no room for a
  // full excerpt read-out here.
  const hookSubject = article.hookSubject || "les meilleurs produits pour sécuriser sa maison";
  const hookTemplate = HOOK_TEMPLATES[articleIndex(article.slug) % HOOK_TEMPLATES.length];
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
      spoken: clean(productSentence(product, i, products.length)),
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

  lines.push({
    id: "outro",
    spoken: "Alors, lequel est ton coup de cœur ? Tous les liens sont juste en dessous. Abonne-toi pour la suite !",
    caption: "Liens en description",
    image: cover,
    fullBleed: true,
  });

  return lines;
}
