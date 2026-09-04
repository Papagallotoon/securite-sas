import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT_DIR, PUBLIC_DIR, VIDEO_WIDTH, VIDEO_HEIGHT, FPS, CHIME_PATH, BRAND_NAME, TITLE_CARD_PATH, COLOR_GRADE } from "./config.mjs";
import { getAudioDurationSeconds } from "./ffprobe.mjs";

const execFileAsync = promisify(execFile);

// ffmpeg's filtergraph parser splits on ":" for option separators, which
// breaks on a Windows drive letter like "C:" even when escaped. Sidestepping
// this entirely: paths embedded *inside* the filter string (fontfile,
// textfile) are always given relative to ROOT_DIR, with the ffmpeg process
// itself run with cwd=ROOT_DIR — relative paths never contain a drive letter.
function toFilterPath(absPath) {
  return path.relative(ROOT_DIR, absPath).split(path.sep).join("/");
}

const CAPTION_MAX_CHARS_PER_LINE = 26;

// drawtext has no built-in word-wrap, and product names regularly overflow
// the 1080px frame at a readable font size — wrap manually, word by word,
// respecting any existing forced line breaks (name / price).
function wrapCaption(caption, maxChars = CAPTION_MAX_CHARS_PER_LINE) {
  return caption
    .split("\n")
    .flatMap((paragraph) => {
      const words = paragraph.split(" ");
      const wrapped = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxChars && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) wrapped.push(current);
      return wrapped;
    })
    .join("\n");
}

// A line's image is either a site-relative path ("/images/...", resolved
// against public/) or already a resolved absolute path under the project
// (room images picked from room-image.mjs). Note: Node's path.isAbsolute()
// is *not* a reliable discriminator here — "/images/foo.jpg" also counts as
// absolute on both POSIX and win32, so it's checked against ROOT_DIR instead.
function resolveImage(candidate) {
  if (!candidate) return null;
  if (candidate.startsWith(ROOT_DIR)) {
    return fs.existsSync(candidate) ? candidate : null;
  }
  const full = path.join(PUBLIC_DIR, candidate.replace(/^\//, ""));
  return fs.existsSync(full) ? full : null;
}

// Picks an image for a script line, falling back to the article cover or
// the first product photo so a missing file never aborts the whole run.
function resolveLineImage(line, article) {
  const candidates = [line.image, article.image, article.products?.[0]?.image];
  for (const candidate of candidates) {
    const resolved = resolveImage(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function findFontFile() {
  if (process.env.FONT_PATH && fs.existsSync(process.env.FONT_PATH)) {
    return process.env.FONT_PATH;
  }
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", // ubuntu (GitHub Actions runner)
    "C:\\Windows\\Fonts\\arialbd.ttf", // windows
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf", // macOS
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

async function renderSegment({ imagePath, audioPath, captionPath, duration, outPath, fontFile, fullBleed }) {
  const caption = toFilterPath(captionPath);
  const drawtextFont = fontFile ? `fontfile=${toFilterPath(fontFile)}` : `font=DejaVu Sans Bold`;

  let filter;
  if (fullBleed) {
    // Plain brand backdrop (solid color / vignette, not a product photo):
    // no blur+darken bg vs. sharp fg split here — on a near-flat image that
    // split left a visible rectangle seam where the two layers met.
    filter =
      `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},${COLOR_GRADE},` +
      `zoompan=z='min(zoom+0.0012,1.09)':d=1:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${FPS},setsar=1[zoomed];` +
      `[zoomed]drawtext=${drawtextFont}:textfile=${caption}:fontcolor=white:fontsize=48:` +
      `line_spacing=10:box=1:boxcolor=black@0.55:boxborderw=24:` +
      `x=(w-text_w)/2:y=h-th-180[v]`;
  } else {
    // Two layers so the product is never cropped: a blurred cover-fill
    // background (fills the vertical frame) behind a "contain"-fit foreground
    // (scaled down to fit entirely inside a safe area, never cut off). The
    // slow zoom is applied to the composited frame as a whole, with a low max
    // zoom, so the safe-area margin absorbs it instead of clipping the object.
    const safeW = Math.round(VIDEO_WIDTH * 0.92);
    const safeH = Math.round(VIDEO_HEIGHT * 0.86);

    filter =
      `[0:v]split=2[bg_src][fg_src];` +
      `[bg_src]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},gblur=sigma=30,eq=brightness=-0.15[bg];` +
      `[fg_src]scale=${safeW}:${safeH}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,${COLOR_GRADE}[composite];` +
      `[composite]zoompan=z='min(zoom+0.0012,1.09)':d=1:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${FPS},setsar=1[zoomed];` +
      `[zoomed]drawtext=${drawtextFont}:textfile=${caption}:fontcolor=white:fontsize=48:` +
      `line_spacing=10:box=1:boxcolor=black@0.55:boxborderw=24:` +
      `x=(w-text_w)/2:y=h-th-180[v]`;
  }

  const args = [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "16", // intermediate encode — kept near-lossless since concat re-encodes again
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-t", String(duration),
    outPath,
  ];

  await execFileAsync("ffmpeg", args, { cwd: ROOT_DIR, maxBuffer: 1024 * 1024 * 32 });
}

async function concatSegments(segmentPaths, outPath) {
  // The concat *demuxer* (file-list + "-c copy" or even re-encoded) turned
  // out to badly desync audio/video here — decoded output audio ran ~1.8x
  // longer than the video track. The concat *filter*, fed each segment as
  // its own -i input, joins them frame-accurately instead.
  const inputArgs = segmentPaths.flatMap((p) => ["-i", p]);
  const streams = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filter = `${streams}concat=n=${segmentPaths.length}:v=1:a=1[outv][outa]`;

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      ...inputArgs,
      "-filter_complex", filter,
      "-map", "[outv]",
      "-map", "[outa]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18",
      "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k",
      outPath,
    ],
    { cwd: ROOT_DIR, maxBuffer: 1024 * 1024 * 32 }
  );
}

// Renders one segment per script line (image + narration + on-screen
// caption), then concatenates them into the final vertical short.
export async function renderVideo({ lines, article, tmpDir, outPath }) {
  const fontFile = findFontFile();
  const segmentPaths = [];

  // Fixed brand bumper first, identical on every video — the one visual
  // constant that makes the channel recognizable regardless of topic.
  if (fs.existsSync(TITLE_CARD_PATH) && fs.existsSync(CHIME_PATH)) {
    const titleCaptionPath = path.join(tmpDir, "titlecard", "caption.txt");
    fs.mkdirSync(path.dirname(titleCaptionPath), { recursive: true });
    fs.writeFileSync(titleCaptionPath, "");

    const titleSegmentPath = path.join(tmpDir, "segment-titlecard.mp4");
    await renderSegment({
      imagePath: TITLE_CARD_PATH,
      audioPath: CHIME_PATH,
      captionPath: titleCaptionPath,
      duration: await getAudioDurationSeconds(CHIME_PATH),
      outPath: titleSegmentPath,
      fontFile,
      fullBleed: true,
    });
    segmentPaths.push(titleSegmentPath);
  }

  for (const [i, line] of lines.entries()) {
    const imagePath = resolveLineImage(line, article);
    if (!imagePath) {
      throw new Error(`No image found for line "${line.id}" (article ${article.slug})`);
    }

    const captionPath = path.join(tmpDir, line.id, "caption.txt");
    fs.writeFileSync(captionPath, wrapCaption(line.caption));

    const segmentPath = path.join(tmpDir, `segment-${i}.mp4`);
    await renderSegment({
      imagePath,
      audioPath: line.audioPath,
      captionPath,
      duration: line.duration,
      outPath: segmentPath,
      fontFile,
      fullBleed: line.fullBleed,
    });
    segmentPaths.push(segmentPath);
  }

  // Branded sign-off sting: same closing room shot held a beat longer, with
  // the site name on screen and a short audio chime instead of narration —
  // the little "hook" that makes it feel like a real channel outro.
  const lastLine = lines[lines.length - 1];
  const stingImage = resolveLineImage(lastLine, article);
  if (stingImage && fs.existsSync(CHIME_PATH)) {
    const stingCaptionPath = path.join(tmpDir, "sting", "caption.txt");
    fs.mkdirSync(path.dirname(stingCaptionPath), { recursive: true });
    fs.writeFileSync(stingCaptionPath, BRAND_NAME);

    const stingSegmentPath = path.join(tmpDir, "segment-sting.mp4");
    await renderSegment({
      imagePath: stingImage,
      audioPath: CHIME_PATH,
      captionPath: stingCaptionPath,
      duration: await getAudioDurationSeconds(CHIME_PATH),
      outPath: stingSegmentPath,
      fontFile,
      fullBleed: lastLine.fullBleed,
    });
    segmentPaths.push(stingSegmentPath);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await concatSegments(segmentPaths, outPath);

  return outPath;
}
