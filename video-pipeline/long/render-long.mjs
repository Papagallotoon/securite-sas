// Long-form 16:9 slideshow videos (YouTube "normal" videos, not Shorts):
// slow zoom on each image, crossfades, a title at the start of each section,
// optional background music. Agnostic to where the images come from (Google
// Flow exports, Gemini/Imagen API, photos...): it just takes image paths.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT_DIR, SITE_BRAND_CAPTION } from "../config.mjs";

const exec = promisify(execFile);
const W = 1920;
const H = 1080;
const FPS = 30;
const XFADE = 1.2; // crossfade length, seconds
const MAX_XFADE_INPUTS = 25; // keep each ffmpeg filtergraph a manageable size

const MUSIC_DIR = path.join(ROOT_DIR, "video-pipeline", "assets", "music");

// ffmpeg's filter parser chokes on Windows drive letters ("C:"), so every
// path embedded in a filter is made relative to ROOT_DIR and ffmpeg runs
// with cwd=ROOT_DIR (same trick as render.mjs).
const rel = (p) => path.relative(ROOT_DIR, p).split(path.sep).join("/");

function findFont() {
  const candidates = [
    process.env.FONT_PATH,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

async function ffmpeg(args) {
  await exec("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: ROOT_DIR, maxBuffer: 1 << 26 });
}

// Brand opener: the logo (drawn on its own flat background) centred on a
// canvas of the same colour, fading in from black with a slow push-in.
// With `crop` (0-1), only the centre of the logo image is kept, cut into a
// circle: for a round emblem drawn on a textured background, which would
// otherwise show as a visible square. `text` is written under it.
async function renderIntroCard({ logo, color, duration, outPath, crop, text, textColor, font, tmpDir }) {
  const frames = Math.round(duration * FPS);
  let source = logo;
  if (crop) {
    source = path.join(tmpDir, "intro-logo.png");
    await ffmpeg([
      "-i", rel(logo),
      "-vf", `crop=iw*${crop}:ih*${crop},scale=1200:1200,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip((W/2-2-hypot(X-W/2,Y-H/2))/3,0,1)'`,
      "-frames:v", "1", rel(source),
    ]);
  }
  const logoHeight = Math.round(H * 2 * (text ? 0.6 : 0.9));
  let graph =
    `color=c=${color}:s=${W * 2}x${H * 2}:r=${FPS}:d=${duration}[bg];` +
    `[0:v]scale=-2:${logoHeight}[lg];` +
    `[bg][lg]overlay=(W-w)/2:(H-h)/2-${text ? Math.round(H * 0.12) : 0}:shortest=1`;
  if (text) {
    const textFile = path.join(tmpDir, "intro-text.txt");
    fs.writeFileSync(textFile, text);
    const fontOpt = font ? `fontfile=${rel(font)}` : "font=Sans";
    graph += `,drawtext=${fontOpt}:textfile=${rel(textFile)}:fontsize=${Math.round(H * 0.12)}:fontcolor=${textColor || "white"}:x=(w-tw)/2:y=h*0.8`;
  }
  graph +=
    `,zoompan=z='1+0.05*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},` +
    `fade=t=in:st=0:d=1,format=yuv420p[v]`;
  await ffmpeg([
    "-framerate", String(FPS), "-loop", "1", "-t", String(duration), "-i", rel(source),
    "-filter_complex", graph,
    "-map", "[v]", "-t", String(duration), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    rel(outPath),
  ]);
}

async function renderClip({ image, duration, label, zoomIn, outPath, tmpDir, index, font, cta, logo, ctaColor = "0x4C5C54" }) {
  const frames = Math.round(duration * FPS);
  // Any aspect ratio in: blurred cover background + contained foreground, so
  // portrait or square images never get cropped awkwardly.
  const compose =
    `[0:v]split[a][b];` +
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,scale=${W * 2}:${H * 2},setsar=1[big];`;
  const z = zoomIn ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`;
  let chain =
    compose +
    `[big]zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
    `eq=saturation=1.05:contrast=1.03`;

  const fontOpt = font ? `fontfile=${rel(font)}` : "font=Sans";
  const brandFile = path.join(tmpDir, "brand.txt");
  fs.writeFileSync(brandFile, SITE_BRAND_CAPTION);
  chain += `,drawtext=${fontOpt}:textfile=${rel(brandFile)}:fontsize=26:fontcolor=white@0.7:x=w-tw-40:y=h-th-34:shadowcolor=black@0.5:shadowx=2:shadowy=2`;

  if (label) {
    const labelFile = path.join(tmpDir, `label-${index}.txt`);
    fs.writeFileSync(labelFile, label);
    const alpha = `if(lt(t,0.8),t/0.8,if(lt(t,4.2),1,if(lt(t,5),(5-t)/0.8,0)))`;
    chain += `,drawtext=${fontOpt}:textfile=${rel(labelFile)}:fontsize=58:fontcolor=white:alpha='${alpha}':x=80:y=h-220:box=1:boxcolor=black@0.45:boxborderw=24`;
  }
  // Mid-video reminder: small logo + "subscribe / like" banner top-left,
  // fading in and out while the matching sentence is spoken.
  const inputs = ["-i", rel(image)];
  if (cta && logo) {
    const ctaFile = path.join(tmpDir, `cta-${index}.txt`);
    fs.writeFileSync(ctaFile, cta);
    const show = `between(t,1,${Math.min(duration - 1, 9)})`;
    const ctaAlpha = `if(lt(t,1),0,if(lt(t,1.6),(t-1)/0.6,if(lt(t,${Math.min(duration - 1, 9) - 0.6}),1,max(0,(${Math.min(duration - 1, 9)}-t)/0.6))))`;
    chain += `,drawtext=${fontOpt}:textfile=${rel(ctaFile)}:fontsize=46:fontcolor=white:alpha='${ctaAlpha}':x=250:y=108:box=1:boxcolor=${ctaColor}@0.92:boxborderw=26[pre];`;
    chain += `[1:v]crop=iw*0.62:ih*0.62,scale=150:150,format=rgba,fade=t=in:st=1:d=0.6:alpha=1,fade=t=out:st=${Math.min(duration - 1, 9) - 0.6}:d=0.6:alpha=1[lg];`;
    chain += `[pre][lg]overlay=70:70:enable='${show}',format=yuv420p[v]`;
    inputs.push("-loop", "1", "-t", String(duration), "-i", rel(logo));
  } else {
    chain += `,format=yuv420p[v]`;
  }

  await ffmpeg([
    ...inputs,
    "-filter_complex", chain,
    "-map", "[v]",
    "-t", String(duration),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    rel(outPath),
  ]);
}

// Wraps a product name into short lines for drawtext (which has no wrapping).
function wrapText(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4).join("\n");
}

// Product slide: the packshot on a white card on the left, name and price on
// the right, over the brand colour, with a slow push-in.
async function renderProductClip({ image, duration, outPath, tmpDir, index, font, card, color, accent }) {
  const frames = Math.round(duration * FPS);
  const fontOpt = font ? `fontfile=${rel(font)}` : "font=Sans";
  const nameFile = path.join(tmpDir, `card-name-${index}.txt`);
  const priceFile = path.join(tmpDir, `card-price-${index}.txt`);
  const hintFile = path.join(tmpDir, `card-hint-${index}.txt`);
  fs.writeFileSync(nameFile, wrapText(card.name, 26));
  fs.writeFileSync(priceFile, card.price || "");
  fs.writeFileSync(hintFile, card.hint || "Lien dans la description");
  const brandFile = path.join(tmpDir, "brand.txt");
  fs.writeFileSync(brandFile, SITE_BRAND_CAPTION);
  // Built at 2x then zoompanned down, like the photo clips, for a smooth zoom.
  const S = 2;
  const box = 820 * S;
  const graph =
    `color=c=${color}:s=${W * S}x${H * S}:r=${FPS}:d=${duration}[bg];` +
    `[0:v]scale=${(box - 80 * S)}:${(box - 80 * S)}:force_original_aspect_ratio=decrease,pad=${box}:${box}:(ow-iw)/2:(oh-ih)/2:color=white[pk];` +
    `[bg][pk]overlay=${110 * S}:${(H * S - box) / 2}:shortest=1,` +
    `drawbox=x=${1010 * S}:y=${300 * S}:w=${8 * S}:h=${470 * S}:color=${accent}:t=fill,` +
    `drawtext=${fontOpt}:textfile=${rel(nameFile)}:fontsize=${50 * S}:line_spacing=${14 * S}:fontcolor=white:x=${1060 * S}:y=${300 * S},` +
    `drawtext=${fontOpt}:textfile=${rel(priceFile)}:fontsize=${92 * S}:fontcolor=${accent}:x=${1060 * S}:y=${620 * S},` +
    `drawtext=${fontOpt}:textfile=${rel(hintFile)}:fontsize=${32 * S}:fontcolor=white@0.7:x=${1060 * S}:y=${740 * S},` +
    `drawtext=${fontOpt}:textfile=${rel(brandFile)}:fontsize=${26 * S}:fontcolor=white@0.6:x=w-tw-${40 * S}:y=h-th-${34 * S},` +
    `zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p[v]`;
  await ffmpeg([
    "-framerate", String(FPS), "-loop", "1", "-t", String(duration), "-i", rel(image),
    "-filter_complex", graph,
    "-map", "[v]", "-t", String(duration), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    rel(outPath),
  ]);
}

// Chains clips with crossfades. Returns the merged file's duration.
async function xfadeMerge(clips, outPath) {
  if (clips.length === 1) {
    fs.copyFileSync(clips[0].file, outPath);
    return clips[0].duration;
  }
  const inputs = clips.flatMap((c) => ["-i", rel(c.file)]);
  let graph = "";
  let prev = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].duration - XFADE;
    const out = i === clips.length - 1 ? "[v]" : `[x${i}]`;
    graph += `${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}${out};`;
    prev = out;
  }
  await ffmpeg([...inputs, "-filter_complex", graph.slice(0, -1), "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), rel(outPath)]);
  return clips.reduce((s, c) => s + c.duration, 0) - XFADE * (clips.length - 1);
}

async function mergeAll(clips, tmpDir, depth = 0) {
  if (clips.length <= MAX_XFADE_INPUTS) {
    const out = path.join(tmpDir, `merge-${depth}-final.mp4`);
    return { file: out, duration: await xfadeMerge(clips, out) };
  }
  const groups = [];
  for (let i = 0; i < clips.length; i += MAX_XFADE_INPUTS) groups.push(clips.slice(i, i + MAX_XFADE_INPUTS));
  const merged = [];
  for (const [g, group] of groups.entries()) {
    const out = path.join(tmpDir, `merge-${depth}-${g}.mp4`);
    merged.push({ file: out, duration: await xfadeMerge(group, out) });
  }
  return mergeAll(merged, tmpDir, depth + 1);
}

function musicTracks() {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f))
    .sort()
    .map((f) => path.join(MUSIC_DIR, f));
}

// Mixes the optional voice-over (one file per clip, placed at its clip's start
// on the final timeline) over looping background music. The music drops to a
// quiet bed when there's narration so the voice stays clearly intelligible.
export async function addAudio(videoFile, duration, outPath, tmpDir, voices) {
  const tracks = musicTracks();
  const inputs = ["-i", rel(videoFile)];
  const parts = [];
  const mixLabels = [];
  let n = 1;

  if (tracks.length) {
    // Join the tracks into one finite bed first, then loop that plain file,
    // bounded by -t: looping the concat demuxer directly never terminated
    // cleanly once dozens of voice inputs were mixed in.
    const list = path.join(tmpDir, "music.txt");
    fs.writeFileSync(list, tracks.map((t) => `file '${t.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    const bed = path.join(tmpDir, "music-bed.wav");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", rel(list), "-ar", "44100", "-ac", "2", rel(bed)]);
    inputs.push("-stream_loop", "-1", "-t", duration.toFixed(2), "-i", rel(bed));
    const fadeOut = Math.max(0, duration - 5).toFixed(2);
    const level = voices.length ? 0.16 : 0.8;
    parts.push(`[${n}:a]volume=${level},afade=t=in:d=3,afade=t=out:st=${fadeOut}:d=5,aresample=44100[music]`);
    mixLabels.push("[music]");
    n++;
  }

  for (const [i, v] of voices.entries()) {
    inputs.push("-i", rel(v.file));
    const ms = Math.round(v.start * 1000);
    parts.push(`[${n}:a]aresample=44100,adelay=${ms}|${ms}[v${i}]`);
    mixLabels.push(`[v${i}]`);
    n++;
  }

  if (!mixLabels.length) {
    await ffmpeg(["-i", rel(videoFile), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "copy", "-c:a", "aac", rel(outPath)]);
    return false;
  }

  const graph =
    parts.join(";") +
    `;${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]`;
  await ffmpeg([
    ...inputs,
    "-filter_complex", graph,
    "-map", "0:v", "-map", "[a]",
    "-t", duration.toFixed(2),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    rel(outPath),
  ]);
  return tracks.length > 0;
}

// Voice starts a moment after the crossfade into its image settles, and the
// image lingers briefly after the sentence ends before fading to the next.
const VOICE_LEAD = 0.8;
const VOICE_TAIL = 1.0;

// theme: { sections: [{ title, images: [absPath | { path, voice?, voiceDuration? }] }], imageSeconds? }
export async function renderLongVideo({ theme, outPath, tmpDir }) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const font = findFont();
  const seconds = theme.imageSeconds || 7;

  const clips = [];
  const chapters = [];
  const voices = [];
  let timeline = 0;
  let index = 0;

  if (theme.introLogo) {
    const duration = theme.introSeconds || 4.5;
    clips.push({ intro: true, duration, index });
    timeline += duration - XFADE;
    index++;
  }

  for (const section of theme.sections) {
    section.images.forEach((entry, i) => {
      const item = typeof entry === "string" ? { path: entry } : entry;
      const duration = item.voice ? Math.max(seconds, VOICE_LEAD + item.voiceDuration + VOICE_TAIL + XFADE) : seconds;
      // YouTube requires the first chapter at 0:00, so it also covers the intro.
      if (i === 0) chapters.push({ time: chapters.length ? timeline : 0, title: section.title });
      if (item.voice) voices.push({ file: item.voice, start: timeline + VOICE_LEAD });
      clips.push({ image: item.path, duration, label: i === 0 ? section.title : null, index, cta: item.cta, card: item.card });
      timeline += duration - XFADE;
      index++;
    });
  }

  for (const clip of clips) {
    clip.file = path.join(tmpDir, `clip-${String(clip.index).padStart(4, "0")}.mp4`);
    if (clip.intro) {
      await renderIntroCard({
        logo: theme.introLogo,
        color: theme.introColor || "0x4C5C54",
        duration: clip.duration,
        outPath: clip.file,
        crop: theme.introCrop,
        text: theme.introText,
        textColor: theme.introTextColor,
        font,
        tmpDir,
      });
    } else if (clip.card) {
      await renderProductClip({ ...clip, outPath: clip.file, tmpDir, font, color: theme.cardColor || "0x0B1422", accent: theme.cardAccent || "0x3CC8F5" });
    } else {
      await renderClip({ ...clip, zoomIn: clip.index % 2 === 0, outPath: clip.file, tmpDir, font, logo: theme.introLogo, ctaColor: theme.ctaColor });
    }
    process.stdout.write(`\rClips rendus : ${clip.index + 1}/${clips.length}`);
  }
  process.stdout.write("\n");

  const merged = await mergeAll(clips, tmpDir);
  const withMusic = await addAudio(merged.file, merged.duration, outPath, tmpDir, voices);
  return { duration: merged.duration, chapters, withMusic };
}

export function formatTimestamp(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
