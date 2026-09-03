import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const ARTICLES_DIR = path.join(ROOT_DIR, "content");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const STATE_PATH = path.join(__dirname, "state.json");
export const TMP_DIR = path.join(__dirname, "tmp");
export const OUT_DIR = path.join(__dirname, "out");

export const BRAND_NAME = "Sécurité SAS";
export const CHIME_PATH = path.join(__dirname, "assets", "chime.mp3");
// Solid brand-color backdrop for intro/outro, instead of reusing a product
// photo each time (no themed image pool for this niche yet, and reusing
// the same product shot repeatedly looked repetitive).
export const INTRO_BG_PATH = path.join(__dirname, "assets", "intro-bg.png");
// Multilingual-generation neural voice — sounds noticeably warmer/more
// natural than the older single-locale neural voices (e.g. DeniseNeural).
export const TTS_VOICE = "fr-FR-VivienneMultilingualNeural";
// A high rate makes speech hard to follow — most of the "energy" comes
// from pitch instead, at a pace still comfortable to understand.
export const TTS_PROSODY = { rate: "+3%", pitch: "+7%" };

// Real, free-license contextual photos (Unsplash), one per product category,
// used as a quick "in situation" cutaway after that product's own studio
// photo. Categories without a sourced photo yet just skip the cutaway.
export const SITUATION_IMAGES = {
  "camera-exterieure": path.join(__dirname, "assets", "situations", "camera-exterieure.jpg"),
  serrure: path.join(__dirname, "assets", "situations", "serrure.jpg"),
};
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const FPS = 30;

// Optional: when set, the intro/outro backdrop is generated per-video with
// OpenAI instead of the flat INTRO_BG_PATH — falls back to it automatically
// if the key is missing or the API call fails, so a bad day never breaks
// the unattended cron run.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
export const OPENAI_IMAGE_MODEL = "gpt-image-1.5";
