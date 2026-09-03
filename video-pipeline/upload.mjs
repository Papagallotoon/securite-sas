import fs from "node:fs";
import { google } from "googleapis";

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
  (t) => `Stop scroll 🛑 : ${t}`,
  (t) => `${t} 🏠 à shopper direct`,
];

function buildHookTitle(article) {
  const template = HOOK_TEMPLATES[hashString(article.slug) % HOOK_TEMPLATES.length];
  return `${template(article.title)} #Shorts`.slice(0, 100);
}

const RANK_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

function buildDescription(article) {
  const links = article.products
    .slice(0, 5)
    .map((p, i) => `${RANK_EMOJIS[i] || `${i + 1}.`} ${p.name} — ${p.price}\n🛒 ${p.affiliateUrl}`)
    .join("\n\n");

  return [
    article.excerpt,
    "",
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
        tags: ["securite maison", "domotique", "maison connectee", "shorts"],
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
