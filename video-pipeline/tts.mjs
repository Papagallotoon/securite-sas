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

// Synthesises one mp3 per script line and measures its duration so the
// video renderer can time each segment exactly to the narration.
export async function synthesizeLines(lines, tmpDir) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const results = [];
  for (const line of lines) {
    const lineDir = path.join(tmpDir, line.id);
    fs.mkdirSync(lineDir, { recursive: true });
    const { audioFilePath } = await tts.toFile(lineDir, escapeForSsml(line.spoken), TTS_PROSODY);
    const duration = await getAudioDurationSeconds(audioFilePath);
    results.push({ ...line, audioPath: audioFilePath, duration });
  }

  tts.close();
  return results;
}
