// Turns an article JSON into a spoken script for the video. Purely
// template-based: no LLM call, no external dependency, nothing that can
// fail or cost money.
import { INTRO_BG_PATH } from "./config.mjs";

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

function isDimensionHeavy(text) {
  DIMENSION_TOKEN.lastIndex = 0;
  return DIMENSION_TOKEN.test(text);
}

function pickSpokenPro(pros = []) {
  return pros.find((p) => !isDimensionHeavy(p)) || null;
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

const RANK_INTROS = [
  "Premier coup de cœur",
  "En deuxième place",
  "Numéro trois",
  "On continue avec le numéro quatre",
  "Et pour finir, notre dernier choix",
];

export function buildScript(article) {
  const lines = [];
  // No curated "room" image pool for this niche yet — a plain brand
  // backdrop for intro/outro avoids repeating the same product photo
  // across every video.
  const coverImage = INTRO_BG_PATH;

  lines.push({
    id: "intro",
    spoken: clean(`${stripDimensionsForSpeech(article.title)} ! ${stripDimensionsForSpeech(article.excerpt)}`),
    caption: article.title,
    image: coverImage,
    fullBleed: true,
  });

  const products = article.products.slice(0, 5);

  products.forEach((product, i) => {
    const rank = i + 1;
    const spokenPro = pickSpokenPro(product.pros);
    const proSentence = spokenPro ? ` On l'apprécie pour : ${stripDimensionsForSpeech(spokenPro)}.` : "";
    lines.push({
      id: `product-${i}`,
      spoken: clean(
        `${RANK_INTROS[i]} : ${simplifyNameForSpeech(stripDimensionsForSpeech(product.name))}, à ${product.price}.${proSentence}`
      ),
      caption: `${rank}. ${product.name}\n${product.price}`,
      image: product.image,
      product,
    });
  });

  lines.push({
    id: "outro",
    spoken:
      "Alors, lequel est ton coup de cœur ? Tout est disponible sur Amazon, liens juste en dessous. " +
      "Petite précision : les prix peuvent avoir changé depuis la publication de cette vidéo. " +
      "Abonne-toi pour ne rater aucune sélection !",
    caption: "Liens en description",
    image: coverImage,
    fullBleed: true,
  });

  return lines;
}
