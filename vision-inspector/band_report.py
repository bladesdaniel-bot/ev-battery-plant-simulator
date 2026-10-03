from collections import Counter
from pathlib import Path
from anomalib.data import MVTecAD
from anomalib.engine import Engine
from anomalib.models import Patchcore
from inspection import verdict

if __name__ == "__main__":
    ckpt = max(Path("results").rglob("model.ckpt"), key=lambda p: p.stat().st_mtime)
    datamodule = MVTecAD(root="./datasets/MVTecAD", category="metal_nut", num_workers=0)
    batches = Engine().predict(model=Patchcore(), datamodule=datamodule, ckpt_path=ckpt)

    counts = Counter()
    review = []
    for b in batches:
        for path, score, label in zip(b.image_path, b.pred_score, b.gt_label):
            truth = "defective" if int(label) else "good"
            v = verdict(float(score))
            counts[(truth, v)] += 1
            if v == "REVIEW":
                p = Path(path)
                review.append(f"{p.parent.name}/{p.name}  score={float(score):.3f}")

    for truth in ["good", "defective"]:
        print(f"{truth:>9}: " + "  ".join(f"{v}={counts[(truth, v)]}" for v in ["PASS", "REVIEW", "REJECT"]))
    print(f"\nSent to manual review ({len(review)}):")
    for line in review:
        print("  " + line)
