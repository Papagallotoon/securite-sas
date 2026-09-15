// Publishes a rendered short to TikTok through the Content Posting API
// (Direct Post, FILE_UPLOAD). Needs TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET /
// TIKTOK_REFRESH_TOKEN — the refresh token comes from get-tiktok-token.mjs.
import fs from "node:fs";

const API = "https://open.tiktokapis.com/v2";

async function tiktokJson(url, { token, body, form } = {}) {
  const headers = {};
  let payload;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else {
    headers["Content-Type"] = "application/json; charset=UTF-8";
    payload = JSON.stringify(body ?? {});
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: "POST", headers, body: payload });
  const json = await res.json().catch(() => ({}));
  // Content Posting endpoints report failures in json.error.code ("ok" on
  // success); the OAuth endpoint uses a top-level json.error string instead.
  const apiError = typeof json.error === "string" ? json.error : json.error?.code !== "ok" && json.error?.code;
  if (!res.ok || apiError) {
    throw new Error(`TikTok API ${url} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function getAccessToken() {
  const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN } = process.env;
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET || !TIKTOK_REFRESH_TOKEN) {
    throw new Error(
      "Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REFRESH_TOKEN env vars. " +
        "Run `node video-pipeline/get-tiktok-token.mjs` once locally to obtain the refresh token."
    );
  }
  const json = await tiktokJson(`${API}/oauth/token/`, {
    form: {
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: TIKTOK_REFRESH_TOKEN,
    },
  });
  // CI can't rewrite its own secret: if TikTok ever rotates the refresh token,
  // say so loudly so it gets updated before the old one expires.
  if (json.refresh_token && json.refresh_token !== TIKTOK_REFRESH_TOKEN) {
    console.warn("TikTok returned a new refresh token — update the TIKTOK_REFRESH_TOKEN secret with get-tiktok-token.mjs.");
  }
  return json.access_token;
}

export function buildTikTokCaption(article) {
  return [
    `${article.title} 🔒`,
    "",
    "Comparatif complet et liens produits sur securitemaison-site.vercel.app",
    "",
    "#securitemaison #maisonconnectee #securite #alarme #bonplan",
  ].join("\n");
}

async function waitForPublish(token, publishId) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const { data } = await tiktokJson(`${API}/post/publish/status/fetch/`, {
      token,
      body: { publish_id: publishId },
    });
    if (data.status === "PUBLISH_COMPLETE") return data;
    if (data.status === "FAILED") throw new Error(`TikTok publish failed: ${data.fail_reason}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`TikTok publish ${publishId} still processing after 5 minutes`);
}

export async function uploadToTikTok({ videoPath, article }) {
  const token = await getAccessToken();

  // Direct Post requires the privacy level to be one the creator actually
  // allows; unaudited apps are limited to SELF_ONLY until TikTok's review.
  const { data: creator } = await tiktokJson(`${API}/post/publish/creator_info/query/`, { token });
  const wanted = process.env.TIKTOK_PRIVACY || "SELF_ONLY";
  const privacy = creator.privacy_level_options?.includes(wanted) ? wanted : "SELF_ONLY";
  if (privacy !== wanted) console.warn(`TikTok privacy "${wanted}" not allowed for this account yet — posting as SELF_ONLY.`);

  const size = fs.statSync(videoPath).size;
  // Files under 5 MB must go up as one chunk; all our shorts are ~1-3 MB.
  const init = await tiktokJson(`${API}/post/publish/video/init/`, {
    token,
    body: {
      post_info: {
        title: buildTikTokCaption(article),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
    },
  });
  const { publish_id, upload_url } = init.data;

  const put = await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Range": `bytes 0-${size - 1}/${size}`,
    },
    body: fs.readFileSync(videoPath),
  });
  if (!put.ok) throw new Error(`TikTok video upload failed (${put.status}): ${await put.text()}`);

  const status = await waitForPublish(token, publish_id);
  return { publishId: publish_id, privacy, postIds: status.publicaly_available_post_id || [] };
}
