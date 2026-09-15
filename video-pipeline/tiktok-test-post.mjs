// Posts one existing MP4 to TikTok — for testing the integration and
// recording the demo video TikTok's app review requires. Needs the same
// TIKTOK_* env vars as the pipeline.
// Usage: node video-pipeline/tiktok-test-post.mjs "path/to/video.mp4" "Titre de la vidéo"
import { uploadToTikTok } from "./tiktok-upload.mjs";

const [videoPath, title = "Top 5 produits sécurité maison"] = process.argv.slice(2);
if (!videoPath) {
  console.error('Usage: node video-pipeline/tiktok-test-post.mjs "chemin/video.mp4" "Titre"');
  process.exit(1);
}

console.log(`Envoi de ${videoPath} sur TikTok...`);
const result = await uploadToTikTok({ videoPath, article: { title } });
console.log(`Publié ! publish_id: ${result.publishId} — visibilité: ${result.privacy}`);
