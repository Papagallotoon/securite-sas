# Tout produire en local, avec des modèles libres

Objectif : générer les images, la voix off, la musique et les clips vidéo sur
votre machine, sans service en ligne, puis monter la vidéo avec ffmpeg comme
aujourd'hui. Un seul outil sert de moteur : **ComfyUI**.

Matériel de référence : **RTX 3060 Ti (8 Go de VRAM)**, 16 Go de RAM.
Tout s'installe sur **E:**, où il reste de la place.

## Pourquoi ces modèles-là

Deux critères : tenir dans 8 Go de VRAM, et avoir une licence qui autorise
l'usage commercial (une chaîne monétisée en est un).

| Besoin | Modèle | Licence | Taille |
|---|---|---|---|
| Images | FLUX.1-schnell, version GGUF Q4_K_S | Apache 2.0 | ~7 Go |
| Vidéo | Wan 2.1 T2V 1.3B | Apache 2.0 | ~8 Go |
| Musique | ACE-Step, ou Stable Audio Open 1.0 | Apache 2.0 / Stability Community | ~8 Go |
| Voix off | Kokoro (rapide) ou Chatterbox multilingue | Apache 2.0 / MIT | 0,3 à 3 Go |
| Montage | ffmpeg (déjà installé) | LGPL | — |

À éviter, malgré leur popularité :

- **FLUX.1-dev** : licence non commerciale pour le modèle.
- **MusicGen** : poids en CC-BY-NC, donc non commercial.
- **XTTS-v2 (Coqui)** : licence CPML, non commerciale.
- **HunyuanVideo** : sa licence exclut l'Union européenne.

## Installation

### 1. ComfyUI

Téléchargez la version portable Windows (`ComfyUI_windows_portable_nvidia.7z`)
depuis les releases du dépôt officiel `comfyanonymous/ComfyUI`, et décompressez
sur `E:\IA\ComfyUI`. Lancez ensuite `run_nvidia_gpu.bat`.

L'interface s'ouvre sur `http://127.0.0.1:8188`.

### 2. Le gestionnaire d'extensions et le support GGUF

Dans ComfyUI, installez **ComfyUI-Manager**, puis, depuis le Manager,
**ComfyUI-GGUF** (nécessaire pour les modèles compressés, seuls à tenir
confortablement dans 8 Go).

### 3. Les fichiers du modèle d'image

À placer dans `E:\IA\ComfyUI\ComfyUI\models\` :

| Fichier | Dossier | Source (Hugging Face) |
|---|---|---|
| `flux1-schnell-Q4_K_S.gguf` | `unet\` | `city96/FLUX.1-schnell-gguf` |
| `t5-v1_1-xxl-encoder-Q5_K_M.gguf` | `clip\` | `city96/t5-v1_1-xxl-encoder-gguf` |
| `clip_l.safetensors` | `clip\` | `comfyanonymous/flux_text_encoders` |
| `ae.safetensors` | `vae\` | `black-forest-labs/FLUX.1-schnell` |

### 4. Le workflow

Dans ComfyUI, construisez un rendu FLUX schnell simple :
`UnetLoaderGGUF` → `DualCLIPLoaderGGUF` (type flux) → `CLIPTextEncode` →
`EmptyLatentImage` (1344 × 768) → `KSampler` (euler, simple, 4 étapes, cfg 1)
→ `VAEDecode` → `SaveImage`.

Faites une image d'essai, puis **Workflow → Export (API)** et enregistrez le
fichier sous :

```
video-pipeline\long\comfy\flux-schnell.json
```

## Générer toutes les images d'une vidéo

ComfyUI lancé, depuis le dossier `securite-sas` :

```
node video-pipeline/long/comfy-generate.mjs securite-maison-guide-complet-2026
```

Le script lit les prompts du fichier `prompts-flow-complet.txt`, les envoie un
par un, attend chaque rendu, et enregistre l'image **déjà nommée** dans le bon
dossier. Les images déjà présentes sont ignorées : on peut donc l'arrêter et le
relancer sans tout refaire.

Options utiles :

- `--from 12 --to 20` : ne générer qu'une partie.
- `COMFY_HOST=http://127.0.0.1:8188` : autre adresse de ComfyUI.
- `COMFY_WORKFLOW=...` : autre workflow que celui par défaut.

Puis le montage, comme d'habitude :

```
node video-pipeline/long/make-long-video.mjs video-pipeline/long/themes/securite-maison-guide-complet-2026.json
```

## Ordres de grandeur sur une RTX 3060 Ti

| Tâche | Durée |
|---|---|
| Une image 1344 × 768, FLUX schnell Q4 | 35 à 60 s |
| Les 45 images d'une vidéo | 30 à 45 min |
| Un clip vidéo de 5 s, Wan 2.1 1.3B en 480p | 5 à 8 min |
| Un morceau de musique | 1 à 2 min |
| La voix off d'une vidéo de 14 min | 2 à 5 min |

## Étapes suivantes (non installées pour l'instant)

1. **Voix off locale** : remplacer Edge TTS, qui passe par un serveur Microsoft,
   par Kokoro ou Chatterbox. Le pipeline changera d'un seul fichier.
2. **Musique** : ACE-Step pour des morceaux complets, Stable Audio Open pour des
   nappes d'ambiance.
3. **Clips vidéo** : Wan 2.1 pour les plans animés d'Histoires d'Argent.
