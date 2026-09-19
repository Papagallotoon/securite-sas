// Uploads a finished long-form video to the Sécurité Maison YouTube channel.
//   node video-pipeline/long/upload-long.mjs <video.mp4> <theme.json> <description.txt> [thumbnail.jpg]
// Uses the same YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN as the
// Shorts pipeline. Declares the video as containing synthetic (AI) media, as
// YouTube requires for realistic AI-generated imagery.
import fs from "node:fs";
import { google } from "googleapis";

const [videoPath, themePath, descriptionPath, thumbnailPath] = process.argv.slice(2);
if (!videoPath || !themePath || !descriptionPath) {
  console.error("Usage : node video-pipeline/long/upload-long.mjs <video.mp4> <theme.json> <description.txt> [miniature.jpg]");
  process.exit(1);
}

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error("Variables YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN manquantes.");
  process.exit(1);
}

const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));
// The description file starts with the title line (kept for copy-paste); drop it.
const description = fs.readFileSync(descriptionPath, "utf8").split("\n").slice(2).join("\n").trim().slice(0, 5000);

const auth = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
auth.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth });

const res = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: {
      title: theme.title.slice(0, 100),
      description,
      tags: theme.tags || [],
      categoryId: "26", // Howto & Style
      defaultLanguage: "fr",
      defaultAudioLanguage: "fr",
    },
    status: {
      privacyStatus: process.env.YT_PRIVACY || "public",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    },
  },
  media: { body: fs.createReadStream(videoPath) },
});

const id = res.data.id;
console.log(`Vidéo publiée : https://youtube.com/watch?v=${id} (${res.data.status?.privacyStatus})`);

if (thumbnailPath && fs.existsSync(thumbnailPath)) {
  try {
    await youtube.thumbnails.set({ videoId: id, media: { body: fs.createReadStream(thumbnailPath) } });
    console.log("Miniature ajoutée.");
  } catch (err) {
    console.error("Miniature refusée (la vidéo reste publiée) :", err?.response?.data?.error?.message || err.message);
  }
}
