// Génère en local, avec ComfyUI, toutes les images d'une vidéo longue :
//   node video-pipeline/long/comfy-generate.mjs <slug> [--from 1] [--to 45]
//
// Lit les prompts dans images/<slug>/prompts-flow-complet.txt (les lignes
// "Nom : ..." suivies du prompt), envoie chaque prompt à ComfyUI, attend la
// fin du rendu et enregistre l'image sous le nom attendu par le montage.
// Rien ne sort de la machine : ComfyUI tourne en local, sur 127.0.0.1.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT_DIR } from "../config.mjs";

const HOST = process.env.COMFY_HOST || "http://127.0.0.1:8188";
const LONG_DIR = path.join(ROOT_DIR, "video-pipeline", "long");
const WORKFLOW = process.env.COMFY_WORKFLOW || path.join(LONG_DIR, "comfy", "flux-schnell.json");

// "Nom : Porte d'entrée 01" puis, à la ligne suivante, le prompt lui-même.
export function readPrompts(slug) {
  const file = path.join(LONG_DIR, "images", slug, "prompts-flow-complet.txt");
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  const out = [];
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith("Nom : ")) continue;
    const name = line.slice(6).trim();
    const prompt = (lines[i + 1] || "").trim();
    if (prompt) out.push({ name, prompt });
  }
  return out;
}

// Le workflow est un fichier exporté depuis ComfyUI ("Enregistrer (API)").
// On y remplace le texte du prompt et la graine, sans connaître sa structure :
// tout noeud CLIPTextEncode positif reçoit le prompt, tout champ "seed" ou
// "noise_seed" reçoit une valeur différente à chaque image.
function buildWorkflow(template, prompt, seed) {
  const wf = JSON.parse(JSON.stringify(template));
  for (const node of Object.values(wf)) {
    if (!node?.inputs) continue;
    if (node.class_type === "CLIPTextEncode" && typeof node.inputs.text === "string") {
      if (!/^\s*$/.test(node.inputs.text) && /(negative|worst|bad quality)/i.test(node.inputs.text)) continue;
      node.inputs.text = prompt;
    }
    if ("seed" in node.inputs) node.inputs.seed = seed;
    if ("noise_seed" in node.inputs) node.inputs.noise_seed = seed;
  }
  return wf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(route, init) {
  const res = await fetch(`${HOST}${route}`, init);
  if (!res.ok) throw new Error(`ComfyUI ${route} : ${res.status} ${await res.text()}`);
  return res;
}

async function generate(template, prompt, seed) {
  const body = JSON.stringify({ prompt: buildWorkflow(template, prompt, seed) });
  const { prompt_id } = await (await api("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json();

  // ComfyUI travaille en file d'attente : on interroge l'historique jusqu'à
  // ce que le rendu de CETTE demande soit terminé.
  for (let i = 0; i < 1800; i++) {
    await sleep(2000);
    const hist = await (await api(`/history/${prompt_id}`)).json();
    const entry = hist[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(`Rendu en erreur : ${JSON.stringify(entry.status.messages).slice(0, 400)}`);
    const images = Object.values(entry.outputs || {}).flatMap((o) => o.images || []);
    if (images.length) return images[0];
  }
  throw new Error("Rendu trop long (plus d'une heure), abandon.");
}

async function download(image, dest) {
  const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
  const res = await api(`/view?${q}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage : node video-pipeline/long/comfy-generate.mjs <slug> [--from 1] [--to 45]");
    process.exit(1);
  }
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : def;
  };

  if (!fs.existsSync(WORKFLOW)) {
    console.error(`Workflow introuvable : ${WORKFLOW}\nExportez-en un depuis ComfyUI (menu Workflow, "Export (API)") et enregistrez-le là.`);
    process.exit(1);
  }
  try {
    await api("/system_stats");
  } catch {
    console.error(`ComfyUI ne répond pas sur ${HOST}. Lancez-le d'abord, puis relancez cette commande.`);
    process.exit(1);
  }

  const template = JSON.parse(fs.readFileSync(WORKFLOW, "utf8"));
  const all = readPrompts(slug);
  const from = arg("--from", 1);
  const to = arg("--to", all.length);
  const outDir = path.join(LONG_DIR, "images", slug);
  console.log(`${all.length} prompts, génération de ${from} à ${to} → ${outDir}`);

  for (let i = from - 1; i < Math.min(to, all.length); i++) {
    const { name, prompt } = all[i];
    const dest = path.join(outDir, `${name}.png`);
    if (fs.existsSync(dest)) {
      console.log(`(${i + 1}/${all.length}) déjà là, ignoré : ${name}`);
      continue;
    }
    const started = Date.now();
    const image = await generate(template, prompt, Math.floor(Math.random() * 2 ** 31));
    await download(image, dest);
    console.log(`(${i + 1}/${all.length}) ${name} — ${Math.round((Date.now() - started) / 1000)} s`);
  }
  console.log("Terminé. Les images sont prêtes pour le montage.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
