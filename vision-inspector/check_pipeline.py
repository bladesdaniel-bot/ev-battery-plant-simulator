import time
from pathlib import Path

from anomalib.data import PredictDataset
from anomalib.engine import Engine
from anomalib.models import Patchcore

if __name__ == "__main__":
    ckpt = max(Path("results").rglob("model.ckpt"), key=lambda p: p.stat().st_mtime)
    model = Patchcore()
    engine = Engine()
    test_dir = Path("datasets/MVTecAD/metal_nut/test")

    expected = {
        "good/016.png": 0.499,
        "scratch/000.png": 0.500,
        "color/004.png": 0.363,
        "bent/007.png": 0.541,
    }
    results = []
    for i, (name, want) in enumerate(expected.items()):
        start = time.perf_counter()
        batches = engine.predict(
            model=model,
            dataset=PredictDataset(path=test_dir / name),
            ckpt_path=ckpt if i == 0 else None,  # load weights once, then reuse
        )
        ms = (time.perf_counter() - start) * 1000
        score = float(batches[0].pred_score[0])
        results.append(f"{name}: score={score:.3f}  expected {want:.3f}  ({ms:.0f} ms)")

    print()
    for line in results:
        print(line)