// Turns an article JSON into a spoken script for the video. Purely
// template-based: no LLM call, no external dependency, nothing that can
// fail or cost money.
import { INTRO_BG_PATH, SITUATION_IMAGES } from "./config.mjs";

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

// Budget-tier framing (cheapest → priciest) instead of a flat numbered
// countdown — closer to how real "best of" videos are structured.
const MIDDLE_INTROS = ["Un super compromis", "Le chouchou testé et approuvé", "Une valeur sûre"];

function budgetIntro(i, total) {
  if (i === 0) return "Petit budget";
  if (i === total - 1) return "Et en haut de gamme";
  return MIDDLE_INTROS[(i - 1) % MIDDLE_INTROS.length];
}

// A quick "in situation" cutaway after the product's own studio photo, for
// categories with a real contextual photo sourced (see config.mjs) — skips
// cleanly for categories without one yet instead of guessing.
const SITUATION_PHRASES = {
  "camera-exterieure": "Parfaite en extérieur !",
  serrure: "Idéale sur votre porte !",
};

// Short, punchy hooks — kept generic enough to fit any article title, no
// LLM needed. Deterministic per slug so re-renders stay consistent.
const HOOK_TEMPLATES = [
  (t) => `${t} ? On a trouvé les meilleures options !`,
  (t) => `Tu veux ${t.toLowerCase()} sans te ruiner ? Regarde ça !`,
  (t) => `5 pépites testées et approuvées pour ${t.toLowerCase()} !`,
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function buildScript(article, { coverImage } = {}) {
  const lines = [];
  const cover = coverImage || INTRO_BG_PATH;

  // Very short hook intro — the video targets ~45s total, no room for a
  // full excerpt read-out here.
  const hookSubject = article.hookSubject || "sécuriser sa maison";
  const hookTemplate = HOOK_TEMPLATES[hashString(article.slug) % HOOK_TEMPLATES.length];
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
      spoken: clean(
        `${budgetIntro(i, products.length)} : ${simplifyNameForSpeech(stripDimensionsForSpeech(product.name))}, à ${product.price} !`
      ),
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
    spoken:
      "Ton coup de cœur ? Liens Amazon en description, prix au moment de la publication. Abonne-toi !",
    caption: "Liens en description",
    image: cover,
    fullBleed: true,
  });

  return lines;
}
