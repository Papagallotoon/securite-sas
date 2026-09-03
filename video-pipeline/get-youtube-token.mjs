// One-time local helper: run `node video-pipeline/get-youtube-token.mjs`
// after creating a Google Cloud OAuth "Desktop app" client, to get the
// refresh token the automated pipeline needs. You only run this yourself,
// once, on your own machine — nothing here runs in CI.
import http from "node:http";
import { google } from "googleapis";

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Set YT_CLIENT_ID and YT_CLIENT_SECRET env vars first (from your Google Cloud OAuth client), then re-run this script.\n" +
      "Example (PowerShell):\n" +
      '  $env:YT_CLIENT_ID="..."; $env:YT_CLIENT_SECRET="..."; node video-pipeline/get-youtube-token.mjs'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/youtube.upload"],
});

console.log("\nOpen this URL in your browser and authorize the app with the YouTube channel's Google account:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect back to ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Authorization failed: ${error}. You can close this tab.`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Authorization complete. You can close this tab and return to the terminal.");

    console.log("Success! Add these as GitHub repo secrets (Settings -> Secrets and variables -> Actions):\n");
    console.log(`YT_CLIENT_ID=${clientId}`);
    console.log(`YT_CLIENT_SECRET=${clientSecret}`);
    console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token}`);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Token exchange failed, check the terminal.");
    console.error("Token exchange failed:", err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
