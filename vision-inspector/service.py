r"""Vision inspection service for the EV battery plant simulator.

Run from the vision-inspector folder:  .\.venv\Scripts\python.exe service.py
"""
import base64
import io
import random
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from matplotlib import colormaps
from PIL import Image

from anomalib.data import PredictDataset
from anomalib.engine import Engine
from anomalib.models import Patchcore

from inspection import PASS_BELOW, REJECT_ABOVE, verdict

PORT = 8091
TEST_DIR = Path("datasets/MVTecAD/metal_nut/test")
CKPT = max(Path("results").rglob("model.ckpt"), key=lambda p: p.stat().st_mtime)

model = Patchcore(visualizer=False)
engine = Engine()
lock = threading.Lock()  # one inspection at a time
images = sorted(TEST_DIR.rglob("*.png"))


def score_image(path: Path, load_weights: bool = False):
    with lock:
        batch = engine.predict(
            model=model,
            dataset=PredictDataset(path=path),
            ckpt_path=CKPT if load_weights else None,
        )[0]
    return float(batch.pred_score[0]), batch.anomaly_map[0].squeeze().cpu().numpy()


def to_png_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def heatmap_overlay(photo: Image.Image, amap: np.ndarray) -> Image.Image:
    colored = (colormaps["jet"](np.clip(amap, 0, 1))[:, :, :3] * 255).astype(np.uint8)
    heat = Image.fromarray(colored).resize(photo.size)
    return Image.blend(photo, heat, alpha=0.45)


@asynccontextmanager
async def lifespan(app):
    score_image(images[0], load_weights=True)  # load the weights once at startup
    print(f"\nVision inspector ready on http://localhost:{PORT}\n")
    yield


app = FastAPI(title="Vision inspector", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "images": len(images), "pass_below": PASS_BELOW, "reject_above": REJECT_ABOVE}


@app.get("/inspect")
def inspect(image: str | None = None):
    if image:
        path = TEST_DIR / image
        if path.resolve().parent.parent != TEST_DIR.resolve() or not path.is_file():
            raise HTTPException(404, f"No test image named {image}")
    else:
        path = random.choice(images)

    score, amap = score_image(path)
    photo = Image.open(path).convert("RGB").resize((256, 256))
    return {
        "image": f"{path.parent.name}/{path.name}",
        "truth": path.parent.name,
        "score": round(score, 3),
        "verdict": verdict(score),
        "photo": to_png_base64(photo),
        "heatmap": to_png_base64(heatmap_overlay(photo, amap)),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)