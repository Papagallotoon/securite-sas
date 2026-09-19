// Re-schedules an already uploaded video: sets it back to private with a
// publishAt date, so YouTube makes it public at the chosen time.
//   node video-pipeline/long/schedule-video.mjs <videoId> <ISO date>
import { google } from "googleapis";

const [videoId, publishAt] = process.argv.slice(2);
if (!videoId || !publishAt) {
  console.error("Usage : node video-pipeline/long/schedule-video.mjs <videoId> <date ISO>");
  process.exit(1);
}

const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth });

const res = await youtube.videos.update({
  part: ["status"],
  requestBody: {
    id: videoId,
    status: {
      privacyStatus: "private",
      publishAt: new Date(publishAt).toISOString(),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    },
  },
});
console.log(`Vidéo ${videoId} : ${res.data.status.privacyStatus}, publication programmée le ${res.data.status.publishAt}`);
