// Lists the channel's videos sorted by views, to pick which products a
// long-form video should feature. Run by the channel-stats workflow.
import { google } from "googleapis";

const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
const youtube = google.youtube({ version: "v3", auth });

const channel = await youtube.channels.list({ part: ["contentDetails", "snippet", "statistics"], mine: true });
const ch = channel.data.items[0];
console.log(`Chaîne : ${ch.snippet.title} — ${ch.statistics.subscriberCount} abonnés, ${ch.statistics.viewCount} vues`);
const uploads = ch.contentDetails.relatedPlaylists.uploads;

const ids = [];
let pageToken;
do {
  const res = await youtube.playlistItems.list({ part: ["contentDetails"], playlistId: uploads, maxResults: 50, pageToken });
  ids.push(...res.data.items.map((i) => i.contentDetails.videoId));
  pageToken = res.data.nextPageToken;
} while (pageToken);

const videos = [];
for (let i = 0; i < ids.length; i += 50) {
  const res = await youtube.videos.list({ part: ["snippet", "statistics", "contentDetails"], id: ids.slice(i, i + 50) });
  videos.push(...res.data.items);
}
videos.sort((a, b) => Number(b.statistics.viewCount || 0) - Number(a.statistics.viewCount || 0));
for (const v of videos) {
  const s = v.statistics;
  const links = (v.snippet.description.match(/amazon\.fr\/dp\/[A-Z0-9]+/g) || []).join(" ");
  console.log(`${s.viewCount}\t${s.likeCount || 0}\t${s.commentCount || 0}\t${v.snippet.publishedAt.slice(0, 10)}\t${v.id}\t${v.snippet.title}\t${links}`);
}
