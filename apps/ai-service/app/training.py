"""Training entry point for the transaction classifier.

Model: TF-IDF over character n-grams + multinomial Logistic Regression.
Character n-grams were chosen because they handle Vietnamese diacritics,
telex/no-diacritic typing and short merchant names without a tokenizer.

Selection is performed by ``scripts/evaluate_models.py`` on the validation split
(``models/selection.json``): it chooses the regularisation strength C and the
abstention threshold. This module fits the deployable artifact on
train + validation and never touches the held-out test split for tuning.

If no selection file exists, the module falls back to grouped cross-validation
on the supplied dataset and the default threshold from ``taxonomy.py``.

The saved artifact contains the fitted pipeline, the threshold and the
evaluation metrics, so serving code does not duplicate any constants.
"""

from __future__ import annotations

import csv
import hashlib
import json
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline

from .taxonomy import CONFIDENCE_THRESHOLD, TAXONOMY

# scikit-learn 1.6 passes `iprint` to SciPy's lbfgs, which newer SciPy no longer
# accepts. It is harmless but noisy, so silence only that exact message.
warnings.filterwarnings("ignore", message="Unknown solver options: iprint")

MODEL_NAME = "tfidf-char-logreg"
MODEL_VERSION = "tfidf-char-lr-v2"
RANDOM_STATE = 42
CV_FOLDS = 5
DEFAULT_C = 2.0


@dataclass
class Dataset:
    descriptions: list[str]
    labels: list[str]
    groups: list[str]


def load_dataset(csv_path: Path) -> Dataset:
    descriptions: list[str] = []
    labels: list[str] = []
    groups: list[str] = []
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            description = (row.get("description") or "").strip()
            label = (row.get("label") or "").strip()
            if not description or label not in TAXONOMY:
                continue
            descriptions.append(description)
            labels.append(label)
            groups.append((row.get("group") or description).strip())
    if not descriptions:
        raise ValueError(f"Dataset {csv_path} is empty or invalid")
    return Dataset(descriptions, labels, groups)


def _build_pipeline(c_value: float = DEFAULT_C) -> Pipeline:
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(2, 5),
                    min_df=1,
                    sublinear_tf=True,
                    lowercase=True,
                ),
            ),
            (
                "clf",
                LogisticRegression(
                    C=c_value,
                    max_iter=3000,
                    class_weight="balanced",
                    random_state=RANDOM_STATE,
                ),
            ),
        ]
    )


def compute_metrics(truth: list[str], predictions: list[str], labels: list[str]) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        truth, predictions, labels=labels, zero_division=0
    )
    per_class = [
        {
            "label": label,
            "precision": round(float(precision[index]), 4),
            "recall": round(float(recall[index]), 4),
            "f1": round(float(f1[index]), 4),
            "support": int(support[index]),
        }
        for index, label in enumerate(labels)
    ]
    matrix = confusion_matrix(truth, predictions, labels=labels)
    return {
        "accuracy": round(float(accuracy_score(truth, predictions)), 4),
        "macroF1": round(float(f1_score(truth, predictions, average="macro", zero_division=0)), 4),
        "weightedF1": round(
            float(f1_score(truth, predictions, average="weighted", zero_division=0)), 4
        ),
        "perClass": per_class,
        "confusionMatrix": {
            "labels": labels,
            "matrix": [[int(value) for value in row] for row in matrix.tolist()],
        },
    }


def load_selection(model_dir: Path) -> dict | None:
    path = model_dir / "selection.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def dataset_fingerprint(files: list[Path]) -> str | None:
    if not files or not all(path.exists() for path in files):
        return None
    joined = "".join(hashlib.sha256(path.read_bytes()).hexdigest() for path in files)
    return hashlib.sha256(joined.encode("ascii")).hexdigest()


def train_and_evaluate(
    csv_path: Path,
    selection: dict | None = None,
    dataset_files: list[Path] | None = None,
) -> dict:
    dataset = load_dataset(csv_path)
    c_value = float(selection.get("bestC", DEFAULT_C)) if selection else DEFAULT_C
    threshold = (
        float(selection.get("threshold", CONFIDENCE_THRESHOLD)) if selection else CONFIDENCE_THRESHOLD
    )

    pipeline = _build_pipeline(c_value)
    pipeline.fit(dataset.descriptions, dataset.labels)
    labels = list(pipeline.classes_)

    metrics: dict
    if selection and selection.get("testMetrics"):
        test_metrics = selection["testMetrics"]
        metrics = {
            "accuracy": test_metrics["accuracy"],
            "macroF1": test_metrics["macroF1"],
            "weightedF1": test_metrics["weightedF1"],
            "protocol": (
                "held-out template-group test split; C and threshold selected on validation "
                "by scripts/evaluate_models.py"
            ),
            "datasetSize": len(dataset.descriptions),
            "validation": selection.get("validationMetrics"),
            "test": test_metrics,
            "paraphrase": selection.get("paraphraseMetrics"),
            "atSelectedThresholdOnTest": selection.get("atSelectedThresholdOnTest"),
        }
    else:
        cross_validation = StratifiedGroupKFold(
            n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE
        )
        out_of_fold = cross_val_predict(
            _build_pipeline(c_value),
            dataset.descriptions,
            dataset.labels,
            groups=dataset.groups,
            cv=cross_validation,
            n_jobs=1,
        )
        metrics = compute_metrics(dataset.labels, list(out_of_fold), labels)
        metrics.update(
            {
                "datasetSize": len(dataset.descriptions),
                "protocol": (
                    f"{CV_FOLDS}-fold StratifiedGroupKFold by template group; "
                    "metrics from pooled out-of-fold predictions"
                ),
            }
        )

    return {
        "pipeline": pipeline,
        "modelName": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "labels": labels,
        "threshold": threshold,
        "selectionRunId": (selection or {}).get("runId"),
        "dataset": {
            "fingerprint": dataset_fingerprint(dataset_files or []),
            "splits": (selection or {}).get("datasetSplits"),
            "size": len(dataset.descriptions),
        },
        "metrics": metrics,
    }


def save_artifact(artifact: dict, model_dir: Path) -> Path:
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "model.joblib"
    joblib.dump(artifact, model_path)
    metrics_path = model_dir / "metrics.json"
    metrics_path.write_text(
        json.dumps(
            {
                "modelName": artifact["modelName"],
                "modelVersion": artifact["modelVersion"],
                "trainedAt": artifact["trainedAt"],
                "threshold": artifact["threshold"],
                "selectionRunId": artifact.get("selectionRunId"),
                "dataset": artifact.get("dataset"),
                "metrics": artifact["metrics"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return model_path


def predict_proba_for_label(pipeline: Pipeline, description: str) -> dict[str, float]:
    probabilities = pipeline.predict_proba([description])[0]
    return {
        str(label): float(probability)
        for label, probability in zip(pipeline.classes_, probabilities, strict=True)
    }


__all__ = [
    "Dataset",
    "MODEL_NAME",
    "MODEL_VERSION",
    "compute_metrics",
    "dataset_fingerprint",
    "load_dataset",
    "load_selection",
    "predict_proba_for_label",
    "save_artifact",
    "train_and_evaluate",
]
