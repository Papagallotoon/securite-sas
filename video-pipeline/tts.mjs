import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { TTS_VOICE, TTS_PROSODY } from "./config.mjs";
import { getAudioDurationSeconds } from "./ffprobe.mjs";

// The library inserts the text raw into an SSML template, so it must be
// escaped ourselves (product names/titles can contain "&", quotes, etc.)
function escapeForSsml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// The voice is "Multilingual": on its own it guesses the language of every
// sentence, so a line full of brand/product names (Juskys, Exclusivo Mezcla,
// Yankee Candle...) could come out with a Spanish or English accent. The
// <lang> element pins the whole line to French. If the Edge endpoint ever
// rejects it, the line is synthesised again the old way rather than failing.
const SSML_LANG = "fr-FR";
function frenchSsml(text) {
  const { pitch = "+0Hz", rate = "+0%", volume = "+0%" } = TTS_PROSODY || {};
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${SSML_LANG}">` +
    `<voice name="${TTS_VOICE}"><lang xml:lang="${SSML_LANG}">` +
    `<prosody pitch="${pitch}" rate="${rate}" volume="${volume}">${text}</prosody>` +
    `</lang></voice></speak>`
  );
}
async function synthFrench(tts, lineDir, text) {
  try {
    const res = await tts.rawToFile(lineDir, frenchSsml(text));
    if (fs.existsSync(res.audioFilePath) && fs.statSync(res.audioFilePath).size > 1000) return res;
    console.warn("TTS <lang> returned no audio, retrying without it");
  } catch (err) {
    console.warn("TTS <lang> rejected, retrying without it:", err.message);
  }
  return tts.toFile(lineDir, text, TTS_PROSODY);
}

// Synthesises one mp3 per script line and measures its duration so the
// video renderer can time each segment exactly to the narration.
export async function synthesizeLines(lines, tmpDir) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const results = [];
  for (const line of lines) {
    const lineDir = path.join(tmpDir, line.id);
    fs.mkdirSync(lineDir, { recursive: true });
    const { audioFilePath } = await synthFrench(tts, lineDir, escapeForSsml(line.spoken));
    const duration = await getAudioDurationSeconds(audioFilePath);
    results.push({ ...line, audioPath: audioFilePath, duration });
  }

  tts.close();
  return results;
}
