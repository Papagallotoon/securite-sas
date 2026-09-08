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
// Fixed brand bumper shown at the very start of every video, identical
// every time — the one recognizable element that doesn't vary with the
// topic (unlike the AI-generated cover, which is per-article on purpose).
export const TITLE_CARD_PATH = path.join(__dirname, "assets", "title-card.png");
// Subtle cool/blue push applied to every image in every video, so the
// channel has a consistent visual signature even though the underlying
// photos vary a lot from one topic to the next.
export const COLOR_GRADE = "eq=saturation=1.06:contrast=1.05,colorbalance=bm=0.06:gm=0.01:bh=0.03";
// Multilingual-generation neural voice — sounds noticeably warmer/more
// natural than the older single-locale neural voices (e.g. DeniseNeural).
export const TTS_VOICE = "fr-FR-VivienneMultilingualNeural";
// A high rate makes speech hard to follow — most of the "energy" comes
// from pitch instead, at a pace still comfortable to understand.
export const TTS_PROSODY = { rate: "+3%", pitch: "+7%" };

// One contextual "in situation" photo per product category, used as a
// quick cutaway after that product's own studio photo. camera-exterieure
// and serrure are real free-license photos (Unsplash); camera-interieure
// and alarme are OpenAI-generated (no good free-license match found).
// Categories without an image here just skip the cutaway.
export const SITUATION_IMAGES = {
  "camera-exterieure": path.join(__dirname, "assets", "situations", "camera-exterieure.jpg"),
  "camera-interieure": path.join(__dirname, "assets", "situations", "camera-interieure.jpg"),
  serrure: path.join(__dirname, "assets", "situations", "serrure.jpg"),
  alarme: path.join(__dirname, "assets", "situations", "alarme.jpg"),
};
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const FPS = 30;
