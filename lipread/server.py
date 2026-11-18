"""Lip-reading service for SignTalk (English, Auto-AVSR model via Chaplin).

Runs on 127.0.0.1 only. The Node server proxies /api/lipread/* here, so the
browser never talks to this process directly.

    lipread/.venv/bin/python lipread/server.py      (LIPREAD_PORT, LIPREAD_DEVICE)

POST /recognize   body: a short silent video (webm or mp4), at most 12 MB / 20 s
                  -> {"text": "...", "seconds": 1.2, "frames": 75}
GET  /status      -> {"ready": true, "device": "mps", "language": "en"}
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time
from configparser import ConfigParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
# Apple GPUs (MPS) lack max_pool3d, used once in the 3D front-end; run that op on the CPU.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

MAX_BYTES = 12 * 1024 * 1024
MAX_SECONDS = 20
MODELS = HERE / "models"


def pick_device() -> str:
    wanted = os.environ.get("LIPREAD_DEVICE", "").strip()
    if wanted:
        return wanted
    if torch.cuda.is_available():
        return "cuda:0"
    # Apple GPUs (MPS) were measured slower than the M3 CPU for this model's
    # beam search (9 s vs 3.4 s for a 3 s clip), so Macs use the CPU unless
    # LIPREAD_DEVICE=mps is set.
    return "cpu"


def write_config() -> str:
    """Chaplin's LRS3_V_WER19.1.ini with model paths pointing at lipread/models."""
    config = ConfigParser()
    config.read(HERE / "configs" / "LRS3_V_WER19.1.ini")
    config.set("model", "model_path", str(MODELS / "LRS3_V_WER19.1" / "model.pth"))
    config.set("model", "model_conf", str(MODELS / "LRS3_V_WER19.1" / "model.json"))
    config.set("model", "rnnlm", str(MODELS / "lm_en_subword" / "model.pth"))
    config.set("model", "rnnlm_conf", str(MODELS / "lm_en_subword" / "model.json"))
    # Beam width barely changes speed on an M3 (3.0 s at 40 vs 2.8 s at 10), so keep Chaplin's 40.
    config.set("decode", "beam_size", os.environ.get("LIPREAD_BEAM", "40"))
    path = Path(tempfile.gettempdir()) / "signtalk-lipread.ini"
    with open(path, "w") as f:
        config.write(f)
    return str(path)


class Recognizer:
    def __init__(self) -> None:
        self.device = pick_device()
        self.lock = threading.Lock()
        self.pipeline = None
        self.error = ""

    def load(self) -> None:
        try:
            from pipelines.pipeline import InferencePipeline

            started = time.perf_counter()
            self.pipeline = InferencePipeline(
                write_config(), detector="mediapipe", face_track=True, device=self.device
            )
            print(f"lipread: model ready on {self.device} in {time.perf_counter() - started:.1f}s",
                  flush=True)
        except Exception as e:  # keep serving /status with the reason
            self.error = f"{type(e).__name__}: {e}"
            print(f"lipread: model failed to load: {self.error}", flush=True)

    def __call__(self, video: Path) -> str:
        assert self.pipeline is not None
        with self.lock, torch.no_grad():
            return self.pipeline(str(video)).strip()


def normalise(source: Path, target: Path) -> None:
    """Re-encode to constant 25 fps, silent, at most 640 px wide (what the model expects)."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", str(MAX_SECONDS), "-an",
         "-vf", "fps=25,scale='min(640,iw)':-2", "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p", str(target)],
        check=True, timeout=60, capture_output=True,
    )


recognizer = Recognizer()
app = FastAPI(title="SignTalk lip reading", docs_url=None, redoc_url=None)


@app.get("/status")
def status() -> JSONResponse:
    return JSONResponse({
        "ready": recognizer.pipeline is not None,
        "loading": recognizer.pipeline is None and not recognizer.error,
        "error": recognizer.error or None,
        "device": recognizer.device,
        "language": "en",
        "model": "Auto-AVSR LRS3_V_WER19.1",
    })


@app.post("/recognize")
async def recognize(request: Request) -> JSONResponse:
    if recognizer.pipeline is None:
        return JSONResponse({"error": "lipread_loading"}, status_code=503)
    body = await request.body()
    if not body:
        return JSONResponse({"error": "invalid_video"}, status_code=400)
    if len(body) > MAX_BYTES:
        return JSONResponse({"error": "file_too_large"}, status_code=413)
    with tempfile.TemporaryDirectory(prefix="signtalk-lipread-") as tmp:
        raw, clip = Path(tmp) / "input.bin", Path(tmp) / "clip.mp4"
        raw.write_bytes(body)
        try:
            normalise(raw, clip)
        except (subprocess.SubprocessError, OSError):
            return JSONResponse({"error": "invalid_video"}, status_code=400)
        started = time.perf_counter()
        try:
            import asyncio

            text = await asyncio.to_thread(recognizer, clip)
        except (AssertionError, ValueError) as e:
            if "detect" in str(e).lower() or "crop" in str(e).lower():
                return JSONResponse({"error": "no_face"}, status_code=422)
            print(f"lipread: recognition failed: {e!r}", flush=True)
            return JSONResponse({"error": "recognition_failed"}, status_code=500)
        except Exception as e:
            print(f"lipread: recognition failed: {e!r}", flush=True)
            return JSONResponse({"error": "recognition_failed"}, status_code=500)
        return JSONResponse({"text": text, "seconds": round(time.perf_counter() - started, 2)})


if __name__ == "__main__":
    threading.Thread(target=recognizer.load, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("LIPREAD_PORT", "5340")),
                log_level="warning")
