// One-time local helper: gets the TikTok refresh token the pipeline needs.
// TikTok only accepts https redirect URIs (no localhost), so the redirect
// lands on securitemaison-site's /tiktok-callback page, which just displays
// the code — paste it back here to finish the exchange.
import crypto from "node:crypto";
import readline from "node:readline/promises";

const REDIRECT_URI = "https://securitemaison-site.vercel.app/tiktok-callback";
// Keys pasted from the portal often carry stray spaces or quotes, which
// TikTok rejects with a bare "client_key" error.
const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "");
const clientKey = clean(process.env.TIKTOK_CLIENT_KEY);
const clientSecret = clean(process.env.TIKTOK_CLIENT_SECRET);

if (!clientKey || !clientSecret) {
  console.error(
    "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET env vars first (from the TikTok developer portal), then re-run.\n" +
      "Example (PowerShell):\n" +
      '  $env:TIKTOK_CLIENT_KEY="..."; $env:TIKTOK_CLIENT_SECRET="..."; node video-pipeline/get-tiktok-token.mjs'
  );
  process.exit(1);
}

console.log(`Client key utilisée : ${clientKey.slice(0, 4)}…${clientKey.slice(-3)} (${clientKey.length} caractères)`);
if (!/^[A-Za-z0-9]+$/.test(clientKey)) {
  console.error("La Client key contient des caractères inattendus (espace, guillemet...) — recopiez-la depuis le portail.");
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const authUrl =
  "https://www.tiktok.com/v2/auth/authorize/?" +
  new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: "user.info.basic,video.publish",
    redirect_uri: REDIRECT_URI,
    state,
  });

console.log("\nOpen this URL, log in with the Sécurité Maison TikTok account and authorize the app:\n");
console.log(authUrl);
console.log("\nThe page you land on shows a code — copy it.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = decodeURIComponent((await rl.question("Paste the code here: ")).trim());
rl.close();

const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  }),
});
const json = await res.json();

if (!res.ok || json.error) {
  console.error("Token exchange failed (codes expire after a few minutes — retry quickly):", json);
  process.exit(1);
}

console.log(`\nSuccess! Granted scopes: ${json.scope}`);
console.log("Add this as the GitHub repo secret TIKTOK_REFRESH_TOKEN:\n");
console.log(json.refresh_token);
console.log(`\n(valid ~${Math.round(json.refresh_expires_in / 86400)} days)`);
