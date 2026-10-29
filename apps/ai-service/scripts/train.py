"""Train the classifier, save the artifact and print evaluation metrics.

Uses ``models/selection.json`` (written by ``scripts/evaluate_models.py``) for
the selected C and abstention threshold. Without that file it falls back to
grouped cross-validation and the default threshold.

Usage:
    python apps/ai-service/scripts/evaluate_models.py   # selection + report
    python apps/ai-service/scripts/train.py             # deployable artifact
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.training import load_selection, save_artifact, train_and_evaluate  # noqa: E402

DATASET = ROOT / "data" / "training_data.csv"
MODEL_DIR = ROOT / "models"
DATASET_FILES = [
    ROOT / "data" / "training" / "train.csv",
    ROOT / "data" / "validation" / "validation.csv",
    ROOT / "data" / "evaluation" / "test.csv",
    ROOT / "data" / "evaluation" / "paraphrase.csv",
]


def main() -> None:
    selection = load_selection(MODEL_DIR)
    artifact = train_and_evaluate(DATASET, selection=selection, dataset_files=DATASET_FILES)
    path = save_artifact(artifact, MODEL_DIR)
    metrics = artifact["metrics"]
    print(f"Saved model to {path}")
    print(
        json.dumps(
            {
                "modelVersion": artifact["modelVersion"],
                "threshold": artifact["threshold"],
                "selectionRunId": artifact.get("selectionRunId"),
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
