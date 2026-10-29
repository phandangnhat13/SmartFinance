"""Train the classifier, save the artifact and print evaluation metrics.

Usage:
    python apps/ai-service/scripts/train.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.training import save_artifact, train_and_evaluate  # noqa: E402

DATASET = ROOT / "data" / "training_data.csv"
MODEL_DIR = ROOT / "models"


def main() -> None:
    artifact = train_and_evaluate(DATASET)
    path = save_artifact(artifact, MODEL_DIR)
    metrics = artifact["metrics"]
    print(f"Saved model to {path}")
    print(
        json.dumps(
            {
                "accuracy": metrics["accuracy"],
                "macroF1": metrics["macroF1"],
                "weightedF1": metrics["weightedF1"],
                "datasetSize": metrics["datasetSize"],
                "protocol": metrics["protocol"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
