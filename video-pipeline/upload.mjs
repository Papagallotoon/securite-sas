import fs from "node:fs";
import { google } from "googleapis";
import { priceToNumber } from "./build-script.mjs";

function getAuthedClient() {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error(
      "Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN env vars. " +
        "Run `node video-pipeline/get-youtube-token.mjs` once locally to obtain them."
    );
  }
  const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
  return oauth2Client;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic per-article pick (not random) so re-runs / retries produce
// the same title instead of a different hook each time.
const HOOK_TEMPLATES = [
  (t) => `${t} 🔒`,
  (t) => `${t} — le n°1 va te surprendre`,
  (t) => `${t} ✅ (notre coup de cœur en dernier)`,
  (t) => `À voir avant d'acheter 👀 : ${t}`,
  (t) => `${t} 🏠 à shopper direct`,
];

function buildHookTitle(article) {
  const template = HOOK_TEMPLATES[hashString(article.slug) % HOOK_TEMPLATES.length];
  return `${template(article.title)} #Shorts`.slice(0, 100);
}

const RANK_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

// Extra keywords per product category, layered on top of the fixed base
// tags below — makes each video's tags match what people actually search
// for that topic, instead of every video carrying the same four generic
// words regardless of subject.
const CATEGORY_TAGS = {
  "camera-interieure": ["camera interieure", "camera surveillance maison"],
  "camera-exterieure": ["camera exterieure", "camera surveillance maison"],
  eclairage: ["projecteur solaire", "eclairage exterieur connecte"],
  detecteur: ["detecteur mouvement", "alarme maison sans fil"],
  serrure: ["serrure connectee", "serrure intelligente"],
  alarme: ["alarme maison", "systeme alarme connecte"],
  sonnette: ["sonnette video", "visiophone connecte"],
  "boite-a-cles": ["boite a cles connectee", "lockbox"],
  "cache-prise": ["securite enfant maison", "protection bebe maison"],
  "protection-angle": ["securite enfant maison", "protection bebe maison"],
  "verrou-enfant": ["securite enfant maison", "protection bebe maison"],
  "coffre-fort": ["coffre fort connecte", "coffre fort maison"],
  cadenas: ["cadenas connecte", "antivol velo bluetooth"],
  "barre-securite": ["barre de securite porte", "anti effraction fenetre"],
  "barriere-piscine": ["securite piscine", "protection noyade enfant"],
  "barriere-escalier": ["securite enfant maison", "barriere escalier bebe"],
};

function buildTags(article) {
  const base = ["securite maison", "maison connectee", "domotique", "shorts"];
  const fromCategories = [...new Set(article.products.map((p) => p.category))]
    .flatMap((cat) => CATEGORY_TAGS[cat] || []);
  return [...new Set([...base, ...fromCategories])];
}

// securite-sas slug -> matching article path on securitemaison-site (the
// French companion site — see New Aff/securitemaison-site). Every slug
// here MUST have a real article on that site; add the article there
// first (and deploy it) before adding its mapping here.
const SITE_ARTICLE_PATHS = {
  "top-5-cameras-securite-connectees": "/detection/cameras-de-securite-connectees",
  "top-5-eclairage-exterieur-connecte": "/perimeter/eclairage-exterieur-connecte",
  "top-5-detecteurs-alarme-diy": "/detection/detecteurs-pour-alarme-diy",
  "top-5-serrures-alarmes-connectees": "/perimeter/serrures-et-alarmes-connectees",
  "top-5-sonnettes-video-connectees": "/detection/sonnettes-video-connectees",
  "top-5-boites-a-cles-connectees": "/perimeter/boites-a-cles-connectees",
  "top-5-caches-prises-securite-enfant": "/family/caches-prises-securite-enfant",
  "top-5-coffres-forts-connectes": "/perimeter/coffres-forts-connectes",
  "top-5-detecteurs-bris-vitre-fenetre": "/detection/detecteurs-bris-vitre-fenetre",
  "top-5-interphones-video-connectes": "/detection/interphones-video-connectes",
  "top-5-alarmes-piscine-connectees": "/family/alarmes-piscine-connectees",
  "top-5-barrieres-securite-piscine": "/family/barrieres-securite-piscine",
  "top-5-barrieres-securite-escalier-enfant": "/family/barrieres-securite-escalier-enfant",
};
const SITE_DOMAIN = "https://securitemaison-site.vercel.app";

function buildDescription(article) {
  // Same cheapest-to-priciest order as the video (see build-script.mjs) so
  // the numbering here actually matches what's on screen.
  const links = [...article.products]
    .sort((a, b) => priceToNumber(a.price) - priceToNumber(b.price))
    .slice(0, 5)
    .map((p, i) => `${RANK_EMOJIS[i] || `${i + 1}.`} ${p.name} — ${p.price}\n🛒 ${p.affiliateUrl}`)
    .join("\n\n");

  const articlePath = SITE_ARTICLE_PATHS[article.slug];
  const siteLine = articlePath
    ? [`📖 Le comparatif complet : ${SITE_DOMAIN}${articlePath}`, ""]
    : [];

  return [
    article.excerpt,
    "",
    ...siteLine,
    "Les produits de la vidéo, dans l'ordre :",
    "",
    links,
    "",
    "Les prix sont ceux constatés au moment de la publication de cette vidéo et peuvent avoir changé depuis.",
    "",
    "#securitemaison #maisonconnectee #shorts",
  ].join("\n");
}

// Uploads the rendered short. privacyStatus defaults to "unlisted" so the
// first few runs can be checked in YouTube Studio before going public —
// pass YT_PRIVACY=public (env) once you trust the pipeline.
export async function uploadVideo({ videoPath, article }) {
  const auth = getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: buildHookTitle(article),
        description: buildDescription(article),
        tags: buildTags(article),
        categoryId: "26", // Howto & Style
      },
      status: {
        privacyStatus: process.env.YT_PRIVACY || "unlisted",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  return res.data;
}
