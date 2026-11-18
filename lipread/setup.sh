#!/bin/sh
# One-time setup for lip reading: Python environment + Auto-AVSR model (~1.2 GB).
# Needs Python 3.12 and ffmpeg (macOS: brew install python@3.12 ffmpeg).
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
command -v "$PY" >/dev/null || { echo "Python 3.12 not found. Install it or set PYTHON=/path/to/python3.12"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found. Install it (macOS: brew install ffmpeg)."; exit 1; }
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
for name in LRS3_V_WER19.1 lm_en_subword; do
  mkdir -p "models/$name"
  for file in model.json model.pth; do
    if [ ! -s "models/$name/$file" ]; then
      echo "Downloading $name/$file"
      curl -fL --retry 3 -o "models/$name/$file" "https://huggingface.co/Amanvir/$name/resolve/main/$file"
    fi
  done
done
echo "Lip reading is ready. Start it with: npm run lipread"
