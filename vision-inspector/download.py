from pathlib import Path
from anomalib.data import MVTecAD

root = Path("./datasets/MVTecAD")
datamodule = MVTecAD(root=root, category="metal_nut")
datamodule.prepare_data()  # downloads the dataset if it's missing

base = root / "metal_nut"
for split in ["train", "test"]:
    for folder in sorted((base / split).iterdir()):
        count = len(list(folder.glob("*.png")))
        print(f"{split}/{folder.name}: {count} images")
