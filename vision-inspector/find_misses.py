from pathlib import Path
from anomalib.data import MVTecAD
from anomalib.engine import Engine
from anomalib.models import Patchcore

if __name__ == "__main__":
    ckpt = max(Path("results").rglob("model.ckpt"), key=lambda p: p.stat().st_mtime)
    datamodule = MVTecAD(root="./datasets/MVTecAD", category="metal_nut", num_workers=0)
    batches = Engine().predict(model=Patchcore(), datamodule=datamodule, ckpt_path=ckpt)

    rows = []
    for b in batches:
        for path, score, label, pred in zip(b.image_path, b.pred_score, b.gt_label, b.pred_label):
            p = Path(path)
            rows.append((f"{p.parent.name}/{p.name}", float(score), int(label), int(pred)))

    wrong = [r for r in rows if r[2] != r[3]]
    print(f"\n{len(wrong)} of {len(rows)} parts judged wrong at threshold 0.5")
    for name, score, label, pred in wrong:
        kind = "false reject" if label == 0 else "escape"
        print(f"  {kind}: {name}  score={score:.3f}")

    good = sorted([r for r in rows if r[2] == 0], key=lambda r: r[1], reverse=True)
    bad = sorted([r for r in rows if r[2] == 1], key=lambda r: r[1])
    print("\nMost suspicious good parts:")
    for r in good[:3]:
        print(f"  {r[0]}  score={r[1]:.3f}")
    print("Least suspicious defective parts:")
    for r in bad[:3]:
        print(f"  {r[0]}  score={r[1]:.3f}")
