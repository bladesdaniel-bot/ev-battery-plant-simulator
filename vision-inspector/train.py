from anomalib.data import MVTecAD
from anomalib.engine import Engine
from anomalib.models import Patchcore

if __name__ == "__main__":
    datamodule = MVTecAD(root="./datasets/MVTecAD", category="metal_nut", num_workers=0)
    model = Patchcore()
    engine = Engine()
    engine.fit(datamodule=datamodule, model=model)
    engine.test(datamodule=datamodule, model=model)
