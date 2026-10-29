"""Training and evaluation for the transaction classifier.

Model: TF-IDF over character n-grams + multinomial Logistic Regression.
Character n-grams were chosen because they handle Vietnamese diacritics,
telex/no-diacritic typing and short merchant names without a tokenizer.

Evaluation protocol: 5-fold StratifiedGroupKFold grouped by sentence template.
The same template never appears in both train and test, so the scores measure
generalisation to unseen phrasings instead of memorisation of surface variants.
Metrics are computed from the pooled out-of-fold predictions. The saved model is
then fitted once on the full dataset.
"""

from __future__ import annotations

import csv
import json
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

from .taxonomy import TAXONOMY

MODEL_NAME = "tfidf-char-logreg"
MODEL_VERSION = "baseline-tfidf-lr-v1"
RANDOM_STATE = 42
CV_FOLDS = 5


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


def _build_pipeline() -> Pipeline:
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
                    C=2.0,
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


def train_and_evaluate(csv_path: Path) -> dict:
    dataset = load_dataset(csv_path)
    labels = sorted({*dataset.labels})

    cross_validation = StratifiedGroupKFold(
        n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE
    )
    out_of_fold = cross_val_predict(
        _build_pipeline(),
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

    # Final artifact: same pipeline fitted on every available example.
    pipeline = _build_pipeline()
    pipeline.fit(dataset.descriptions, dataset.labels)
    return {
        "pipeline": pipeline,
        "modelName": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "labels": list(pipeline.classes_),
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
    "load_dataset",
    "predict_proba_for_label",
    "save_artifact",
    "train_and_evaluate",
]
