"""Train, compare and evaluate three transaction-classification methods.

Methods
-------
1. keyword      keyword/rule baseline with phrases mined from the *training*
                split only (no manual inspection of the test set)
2. tfidf-lr     TF-IDF char n-grams + Logistic Regression
3. tfidf-svc    TF-IDF char n-grams + LinearSVC with sigmoid calibration

Protocol
--------
* The core template bank is split by whole template group into train,
  validation and test, so no phrasing is shared between splits.
* Hyper-parameters and the abstention threshold are selected on validation.
* The held-out test split is used once, for the headline comparison.
* The `paraphrase` set (separate hand-written template bank and seed) is reported
  separately as a robustness check. It is never used for tuning and is not an
  out-of-distribution benchmark.
* Predictions are type-aware: INCOME items only receive INCOME labels and
  EXPENSE items only EXPENSE labels, mirroring the FastAPI service.
* Every run writes a timestamped artifact directory with metrics, confusion
  matrices and reproducibility metadata.

Usage:
    python apps/ai-service/scripts/evaluate_models.py
    python apps/ai-service/scripts/evaluate_models.py --no-report
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import re
import subprocess
import sys
import unicodedata
import warnings
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import sklearn  # noqa: E402
from sklearn.calibration import CalibratedClassifierCV  # noqa: E402
from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
    precision_score,
)
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.svm import LinearSVC  # noqa: E402

# scikit-learn 1.6 passes `iprint` to SciPy's lbfgs, which newer SciPy no longer
# accepts. It is harmless but noisy, so silence only that exact message.
warnings.filterwarnings("ignore", message="Unknown solver options: iprint")

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
DATA_DIR = ROOT / "data"
EXPERIMENTS_DIR = ROOT / "artifacts" / "experiments"
MODEL_NAME = "tfidf-char-logreg"
MODEL_VERSION = "tfidf-char-lr-v2"
SEED = 42
SELECTIVE_ACCURACY_TARGET = 0.80
THRESHOLD_GRID = [round(value / 100, 2) for value in range(0, 100, 5)]
STOP_PHRASES = {
    "hom nay", "sang nay", "chieu nay", "tuan nay", "hom qua", "tuan truoc",
    "thang nay", "ky truoc", "quy nay", "nam nay", "cua", "cho", "va", "voi",
    "tai", "qua", "tren", "duoi", "mot", "cac", "nha", "moi", "ra", "vao",
}

sys.path.insert(0, str(ROOT))
from app.taxonomy import TAXONOMY  # noqa: E402

LABELS = list(TAXONOMY)
LABELS_BY_TYPE = {
    "INCOME": [label for label in LABELS if TAXONOMY[label]["type"] == "INCOME"],
    "EXPENSE": [label for label in LABELS if TAXONOMY[label]["type"] == "EXPENSE"],
}


# ---------------------------------------------------------------------------
# Text helpers + learned keyword baseline
# ---------------------------------------------------------------------------
def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).replace(
        "đ", "d"
    ).replace("Đ", "D")


def keyword_key(text: str) -> str:
    text = strip_accents(text).lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def phrases_of(text: str) -> set[str]:
    tokens = keyword_key(text).split()
    phrases = set(tokens)
    phrases.update(f"{first} {second}" for first, second in zip(tokens, tokens[1:]))
    return {phrase for phrase in phrases if len(phrase) >= 3 and phrase not in STOP_PHRASES}


def build_keyword_rules(rows: list[dict[str, str]]) -> dict[str, list[tuple[str, float]]]:
    """Mine discriminative words/bigrams from training rows only."""
    label_documents: Counter[str] = Counter()
    phrase_documents: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        label = row["label"]
        label_documents[label] += 1
        for phrase in phrases_of(row["description"]):
            phrase_documents[phrase][label] += 1

    total_documents = sum(label_documents.values())
    rules: dict[str, list[tuple[str, float]]] = {}
    for label in LABELS:
        label_total = label_documents[label]
        if label_total == 0:
            rules[label] = []
            continue
        candidates: list[tuple[float, str]] = []
        for phrase, counts in phrase_documents.items():
            label_df = counts[label]
            if label_df < 2:
                continue
            other_df = sum(counts.values()) - label_df
            if other_df > label_df * 0.75:
                continue
            purity = label_df / (label_df + other_df)
            coverage = label_df / label_total
            specificity = 1 - other_df / max(1, total_documents - label_total)
            weight = coverage * purity * specificity
            candidates.append((weight, phrase))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        rules[label] = [(phrase, round(weight, 4)) for weight, phrase in candidates[:14]]
    return rules


def classify_keyword(
    description: str, item_type: str, rules: dict[str, list[tuple[str, float]]]
) -> tuple[str, float]:
    present = phrases_of(description)
    scores = {
        label: sum(weight for phrase, weight in rules[label] if phrase in present)
        for label in LABELS_BY_TYPE[item_type]
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_label, top_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    if top_score == 0:
        return ("other" if item_type == "EXPENSE" else "income_other"), 0.2
    confidence = top_score / (top_score + second_score) if top_score + second_score else 0.5
    return top_label, float(min(0.95, max(0.4, confidence)))


# ---------------------------------------------------------------------------
# Data + metrics helpers
# ---------------------------------------------------------------------------
def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        if row["label"] not in TAXONOMY:
            raise ValueError(f"Unknown label {row['label']!r} in {path}")
        if row["type"] != TAXONOMY[row["label"]]["type"]:
            raise ValueError(f"Type mismatch for {row['id']} in {path}")
    return rows


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_latest_stability() -> dict | None:
    """Return the most recent ``scripts/stability.py`` artifact, if any.

    Stability resampling is a separate (slower) command; the report embeds its
    summary when the artifact is present so the numbers come from one file.
    """
    directory = ROOT / "artifacts" / "stability"
    if not directory.exists():
        return None
    files = sorted(directory.glob("stability-*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_latest_nested_cv() -> dict | None:
    """Return the most recent ``scripts/nested_cv.py`` artifact, if any."""
    directory = ROOT / "artifacts" / "nested_cv"
    if not directory.exists():
        return None
    files = sorted(directory.glob("nested_cv-*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build_lr(c_value: float) -> Pipeline:
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
                    random_state=SEED,
                ),
            ),
        ]
    )


def build_svc(c_value: float) -> Pipeline:
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
                CalibratedClassifierCV(
                    estimator=LinearSVC(C=c_value, class_weight="balanced", random_state=SEED),
                    method="sigmoid",
                    cv=3,
                ),
            ),
        ]
    )


def type_aware_predictions(
    pipeline: Pipeline, descriptions: list[str], types: list[str]
) -> tuple[list[str], list[float]]:
    probabilities = pipeline.predict_proba(descriptions)
    classes = list(pipeline.classes_)
    predictions: list[str] = []
    confidences: list[float] = []
    for row, item_type in zip(probabilities, types, strict=True):
        allowed = set(LABELS_BY_TYPE[item_type])
        adjusted = np.array([value if label in allowed else 0.0 for label, value in zip(classes, row)])
        total = float(adjusted.sum())
        if total <= 0:
            adjusted = np.array([1.0 if label in allowed else 0.0 for label in classes])
            total = float(adjusted.sum())
        adjusted = adjusted / total
        best = int(adjusted.argmax())
        predictions.append(classes[best])
        confidences.append(float(adjusted[best]))
    return predictions, confidences


def metrics(truth: list[str], predictions: list[str]) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        truth, predictions, labels=LABELS, zero_division=0
    )
    per_class = [
        {
            "label": label,
            "precision": round(float(precision[index]), 4),
            "recall": round(float(recall[index]), 4),
            "f1": round(float(f1[index]), 4),
            "support": int(support[index]),
        }
        for index, label in enumerate(LABELS)
    ]
    weighted = precision_recall_fscore_support(truth, predictions, average="weighted", zero_division=0)
    matrix = confusion_matrix(truth, predictions, labels=LABELS)
    return {
        "accuracy": round(float(accuracy_score(truth, predictions)), 4),
        "macroPrecision": round(
            float(precision_score(truth, predictions, labels=LABELS, average="macro", zero_division=0)),
            4,
        ),
        "macroRecall": round(float(recall.mean()), 4),
        "macroF1": round(float(f1_score(truth, predictions, average="macro", zero_division=0)), 4),
        "weightedPrecision": round(float(weighted[0]), 4),
        "weightedRecall": round(float(weighted[1]), 4),
        "weightedF1": round(float(weighted[2]), 4),
        "perClass": per_class,
        "confusionMatrix": {
            "labels": LABELS,
            "matrix": [[int(value) for value in row] for row in matrix.tolist()],
        },
    }


def bootstrap_uncertainty(
    truth: list[str],
    predictions_by_method: dict[str, list[str]],
    groups: list[str],
    n_boot: int = 2000,
    seed: int = SEED,
) -> dict:
    """Cluster bootstrap over template groups for the held-out test.

    Rows inside one template group are paraphrases of each other and are not
    independent, so resampling rows would understate the interval. Resampling
    whole groups keeps that correlation. The same resample is used for every
    method, which makes the paired differences meaningful.
    """
    unique_groups = sorted(set(groups))
    indices_by_group: defaultdict[str, list[int]] = defaultdict(list)
    for index, group in enumerate(groups):
        indices_by_group[group].append(index)

    def score(truth_sample: list[str], predictions: list[str]) -> tuple[float, float]:
        return (
            float(accuracy_score(truth_sample, predictions)),
            float(f1_score(truth_sample, predictions, average="macro", zero_division=0)),
        )

    point = {
        method: {
            "accuracy": round(score(truth, predictions)[0], 4),
            "macroF1": round(score(truth, predictions)[1], 4),
        }
        for method, predictions in predictions_by_method.items()
    }
    samples: dict[str, dict[str, list[float]]] = {
        method: {"accuracy": [], "macroF1": []} for method in predictions_by_method
    }
    pairs = [
        ("tfidf-lr", "tfidf-svc"),
        ("tfidf-lr", "keyword"),
    ]
    paired_samples: dict[str, dict[str, list[float]]] = {
        f"{left} vs {right}": {"accuracy": [], "macroF1": []} for left, right in pairs
    }

    rng = np.random.default_rng(seed)
    for _ in range(n_boot):
        sampled_groups = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        sample_indices = [
            index
            for group in sampled_groups
            for index in indices_by_group[str(group)]
        ]
        sample_truth = [truth[index] for index in sample_indices]
        sample_scores: dict[str, tuple[float, float]] = {}
        for method, predictions in predictions_by_method.items():
            sample_predictions = [predictions[index] for index in sample_indices]
            sample_scores[method] = score(sample_truth, sample_predictions)
            samples[method]["accuracy"].append(sample_scores[method][0])
            samples[method]["macroF1"].append(sample_scores[method][1])
        for left, right in pairs:
            for metric_index, metric in enumerate(("accuracy", "macroF1")):
                paired_samples[f"{left} vs {right}"][metric].append(
                    sample_scores[left][metric_index] - sample_scores[right][metric_index]
                )

    def interval(values: list[float]) -> dict:
        array = np.array(values, dtype=float)
        return {
            "lower": round(float(np.percentile(array, 2.5)), 4),
            "upper": round(float(np.percentile(array, 97.5)), 4),
            "mean": round(float(array.mean()), 4),
        }

    return {
        "method": "cluster bootstrap over template groups",
        "resamples": n_boot,
        "seed": seed,
        "groups": len(unique_groups),
        "point": point,
        "intervals": {
            method: {
                metric: interval(values) for metric, values in metrics_for_method.items()
            }
            for method, metrics_for_method in samples.items()
        },
        "pairedDifferences": {
            name: {
                "accuracy": {
                    **interval(values["accuracy"]),
                    "probabilityLeftBetter": round(
                        float(np.mean(np.array(values["accuracy"]) > 0)), 4
                    ),
                },
                "macroF1": {
                    **interval(values["macroF1"]),
                    "probabilityLeftBetter": round(
                        float(np.mean(np.array(values["macroF1"]) > 0)), 4
                    ),
                },
            }
            for name, values in paired_samples.items()
        },
    }


def selective_curve(truth: list[str], predictions: list[str], confidences: list[float]) -> list[dict]:
    curve: list[dict] = []
    for threshold in THRESHOLD_GRID:
        selected = [index for index, value in enumerate(confidences) if value >= threshold]
        coverage = round(len(selected) / len(truth), 4) if truth else 0.0
        selective_accuracy = None
        if selected:
            correct = sum(1 for index in selected if predictions[index] == truth[index])
            selective_accuracy = round(correct / len(selected), 4)
        curve.append(
            {
                "threshold": threshold,
                "coverage": coverage,
                "selectiveAccuracy": selective_accuracy,
                "selectiveRisk": None if selective_accuracy is None else round(1 - selective_accuracy, 4),
            }
        )
    return curve


def choose_threshold(curve: list[dict], target: float = SELECTIVE_ACCURACY_TARGET) -> dict:
    eligible = [
        point
        for point in curve
        if point["selectiveAccuracy"] is not None and point["selectiveAccuracy"] >= target
    ]
    if eligible:
        chosen = max(eligible, key=lambda point: (point["coverage"], point["selectiveAccuracy"]))
        reason = f"highest coverage with selective accuracy >= {target}"
    else:
        chosen = max(curve, key=lambda point: (point["selectiveAccuracy"] or 0.0) * point["coverage"])
        reason = "no threshold met the target; highest coverage x selective accuracy"
    return {
        "threshold": chosen["threshold"],
        "reason": reason,
        "validationCoverage": chosen["coverage"],
        "validationSelectiveAccuracy": chosen["selectiveAccuracy"],
        "validationSelectiveRisk": chosen["selectiveRisk"],
    }


def at_threshold(
    truth: list[str], predictions: list[str], confidences: list[float], threshold: float
) -> dict:
    selected = [index for index, value in enumerate(confidences) if value >= threshold]
    correct = sum(1 for index in selected if predictions[index] == truth[index])
    return {
        "threshold": threshold,
        "coverage": round(len(selected) / len(truth), 4),
        "selectiveAccuracy": round(correct / len(selected), 4) if selected else None,
        "selectiveRisk": round(1 - correct / len(selected), 4) if selected else None,
        "acceptedCount": len(selected),
        "totalCount": len(truth),
    }


def calibration_report(
    truth: list[str], predictions: list[str], confidences: list[float], bins: int = 10
) -> dict:
    """Top-label reliability: equal-width bins over the predicted confidence.

    Expected calibration error (ECE) and the Brier score are computed on the
    confidence of the *predicted* label, which is exactly the value the product
    compares against the abstention threshold.
    """
    if not truth:
        return {
            "bins": bins,
            "expectedCalibrationError": None,
            "brierScore": None,
            "table": [],
        }

    counts = [0] * bins
    correct = [0] * bins
    confidence_sum = [0.0] * bins
    brier_total = 0.0
    for label, prediction, confidence in zip(truth, predictions, confidences, strict=True):
        index = min(bins - 1, max(0, int(confidence * bins)))
        counts[index] += 1
        confidence_sum[index] += confidence
        correct[index] += int(prediction == label)
        brier_total += (confidence - (1.0 if prediction == label else 0.0)) ** 2

    table: list[dict] = []
    ece = 0.0
    for index in range(bins):
        count = counts[index]
        entry = {
            "lower": round(index / bins, 2),
            "upper": round((index + 1) / bins, 2),
            "count": count,
            "accuracy": round(correct[index] / count, 4) if count else None,
            "avgConfidence": round(confidence_sum[index] / count, 4) if count else None,
        }
        if count:
            ece += count / len(truth) * abs(entry["accuracy"] - entry["avgConfidence"])
        table.append(entry)

    return {
        "bins": bins,
        "expectedCalibrationError": round(ece, 4),
        "brierScore": round(brier_total / len(truth), 4),
        "table": table,
    }


def error_analysis(
    truth: list[str],
    predictions: list[str],
    confidences: list[float],
    descriptions: list[str] | None = None,
    max_examples: int = 40,
) -> dict:
    """Summarise which classes and class pairs the model confuses."""
    per_label: list[dict] = []
    for label in LABELS:
        support = sum(1 for value in truth if value == label)
        errors = sum(
            1
            for value, prediction in zip(truth, predictions, strict=True)
            if value == label and prediction != label
        )
        per_label.append(
            {
                "label": label,
                "support": support,
                "errors": errors,
                "errorRate": round(errors / support, 4) if support else None,
            }
        )

    pair_counts = Counter(
        (value, prediction)
        for value, prediction in zip(truth, predictions, strict=True)
        if value != prediction
    )
    confusion_pairs = [
        {"trueLabel": true_label, "predictedLabel": predicted, "count": count}
        for (true_label, predicted), count in pair_counts.most_common(12)
    ]

    examples: list[dict] = []
    if descriptions is not None:
        for description, value, prediction, confidence in zip(
            descriptions, truth, predictions, confidences, strict=True
        ):
            if value == prediction or len(examples) >= max_examples:
                continue
            examples.append(
                {
                    "text": description,
                    "trueLabel": value,
                    "predictedLabel": prediction,
                    "confidence": round(float(confidence), 4),
                }
            )

    return {
        "misclassified": sum(pair_counts.values()),
        "total": len(truth),
        "perLabel": per_label,
        "confusionPairs": confusion_pairs,
        "examples": examples,
    }


def plot_reliability(report: dict, title: str, path: Path) -> None:
    points = [row for row in report["table"] if row["count"]]
    figure, axis = plt.subplots(figsize=(6, 5))
    axis.plot([0, 1], [0, 1], linestyle="--", color="grey", label="perfect calibration")
    if points:
        axis.plot(
            [row["avgConfidence"] for row in points],
            [row["accuracy"] for row in points],
            marker="o",
            color="#1d4ed8",
            label="observed",
        )
    axis.set(
        xlim=(0, 1),
        ylim=(0, 1),
        xlabel="Mean predicted confidence",
        ylabel="Empirical accuracy",
        title=title,
    )
    axis.legend(loc="upper left")
    axis.grid(alpha=0.25)
    figure.tight_layout()
    figure.savefig(path, dpi=150)
    plt.close(figure)


def plot_confusion(matrix: dict, title: str, path: Path) -> None:
    values = np.array(matrix["matrix"])
    labels = matrix["labels"]
    figure, axis = plt.subplots(figsize=(11, 9))
    image = axis.imshow(values, interpolation="nearest", cmap="Blues")
    figure.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    axis.set(
        xticks=np.arange(len(labels)),
        yticks=np.arange(len(labels)),
        xticklabels=labels,
        yticklabels=labels,
        ylabel="True label",
        xlabel="Predicted label",
        title=title,
    )
    plt.setp(axis.get_xticklabels(), rotation=45, ha="right")
    half = values.max() / 2 if values.size else 0
    for row in range(values.shape[0]):
        for column in range(values.shape[1]):
            axis.text(
                column,
                row,
                str(values[row, column]),
                ha="center",
                va="center",
                color="white" if values[row, column] > half else "black",
                fontsize=8,
            )
    figure.tight_layout()
    figure.savefig(path, dpi=150)
    plt.close(figure)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-report", action="store_true", help="skip docs/AI_EVALUATION_REPORT.md")
    args = parser.parse_args()

    train_rows = load_rows(DATA_DIR / "training" / "train.csv")
    validation_rows = load_rows(DATA_DIR / "validation" / "validation.csv")
    test_rows = load_rows(DATA_DIR / "evaluation" / "test.csv")
    paraphrase_rows = load_rows(DATA_DIR / "evaluation" / "paraphrase.csv")

    def texts(rows: list[dict[str, str]]) -> list[str]:
        return [row["description"] for row in rows]

    def labels(rows: list[dict[str, str]]) -> list[str]:
        return [row["label"] for row in rows]

    def types(rows: list[dict[str, str]]) -> list[str]:
        return [row["type"] for row in rows]

    train_texts, train_labels = texts(train_rows), labels(train_rows)
    validation_texts, validation_labels, validation_types = (
        texts(validation_rows),
        labels(validation_rows),
        types(validation_rows),
    )

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = EXPERIMENTS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    dataset_files = [
        DATA_DIR / "training" / "train.csv",
        DATA_DIR / "validation" / "validation.csv",
        DATA_DIR / "evaluation" / "test.csv",
        DATA_DIR / "evaluation" / "paraphrase.csv",
    ]
    metadata = {
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "scikitLearn": sklearn.__version__,
        "numpy": np.__version__,
        "gitCommit": git_commit(),
        "dataset": {
            "files": {path.as_posix(): sha256(path) for path in dataset_files},
            "fingerprint": hashlib.sha256(
                "".join(sha256(path) for path in dataset_files).encode("ascii")
            ).hexdigest(),
            "splits": {
                "train": len(train_rows),
                "validation": len(validation_rows),
                "test": len(test_rows),
                "paraphrase": len(paraphrase_rows),
            },
        },
        "protocol": {
            "typeAware": True,
            "hyperparametersSelectedOn": "validation",
            "thresholdSelectedOn": "validation",
            "testUsedFor": "final evaluation after model lock; never used for selection",
            "testPreviouslyObserved": True,
            "testNote": (
                "The held-out test split has been reported in earlier research rounds, so it is "
                "no longer a pristine single-use holdout. It remains excluded from every "
                "selection decision; nested cross-validation on train only estimates the "
                "procedure without touching it."
            ),
            "thresholdGrid": THRESHOLD_GRID,
            "selectiveAccuracyTarget": SELECTIVE_ACCURACY_TARGET,
            "uncertainty": "cluster bootstrap over template groups (2,000 resamples)",
        },
    }

    # 1) Keyword rules mined from training rows only.
    keyword_rules = build_keyword_rules(train_rows)

    # 2) Logistic Regression: select C on validation.
    lr_search: list[dict] = []
    best_lr = None
    for c_value in (0.5, 1.0, 2.0, 4.0):
        pipeline = build_lr(c_value)
        pipeline.fit(train_texts, train_labels)
        predictions, _ = type_aware_predictions(pipeline, validation_texts, validation_types)
        score = metrics(validation_labels, predictions)
        lr_search.append({"C": c_value, "macroF1": score["macroF1"], "accuracy": score["accuracy"]})
        if best_lr is None or (score["macroF1"], score["accuracy"]) > (
            best_lr["macroF1"],
            best_lr["accuracy"],
        ):
            best_lr = {
                "C": c_value,
                "macroF1": score["macroF1"],
                "accuracy": score["accuracy"],
                "pipeline": pipeline,
            }
    assert best_lr is not None

    # 3) Calibrated LinearSVC: select C on validation.
    svc_search: list[dict] = []
    best_svc = None
    for c_value in (0.25, 0.5, 1.0, 2.0):
        pipeline = build_svc(c_value)
        pipeline.fit(train_texts, train_labels)
        predictions, _ = type_aware_predictions(pipeline, validation_texts, validation_types)
        score = metrics(validation_labels, predictions)
        svc_search.append({"C": c_value, "macroF1": score["macroF1"], "accuracy": score["accuracy"]})
        if best_svc is None or (score["macroF1"], score["accuracy"]) > (
            best_svc["macroF1"],
            best_svc["accuracy"],
        ):
            best_svc = {
                "C": c_value,
                "macroF1": score["macroF1"],
                "accuracy": score["accuracy"],
                "pipeline": pipeline,
            }
    assert best_svc is not None

    # Threshold selection for the deployed LR model, using validation only.
    lr_validation_predictions, lr_validation_confidences = type_aware_predictions(
        best_lr["pipeline"], validation_texts, validation_types
    )
    lr_validation_metrics = metrics(validation_labels, lr_validation_predictions)
    lr_curve = selective_curve(validation_labels, lr_validation_predictions, lr_validation_confidences)
    threshold_choice = choose_threshold(lr_curve)
    lr_validation_calibration = calibration_report(
        validation_labels, lr_validation_predictions, lr_validation_confidences
    )
    lr_validation_errors = error_analysis(
        validation_labels, lr_validation_predictions, lr_validation_confidences
    )

    # Final models fit on train + validation.
    combined_texts = train_texts + validation_texts
    combined_labels = train_labels + validation_labels
    final_lr = build_lr(best_lr["C"])
    final_lr.fit(combined_texts, combined_labels)
    final_svc = build_svc(best_svc["C"])
    final_svc.fit(combined_texts, combined_labels)

    evaluation_sets = {"test": test_rows, "paraphrase": paraphrase_rows}
    results: dict[str, dict] = {
        "keyword": {
            "displayName": "Keyword rules (mined baseline)",
            "hyperparameters": {
                "phrasesPerLabel": 14,
                "ruleCount": sum(len(rules) for rules in keyword_rules.values()),
                "source": "train split only",
            },
            "sets": {},
        },
        "tfidf-lr": {
            "displayName": "TF-IDF + Logistic Regression",
            "hyperparameters": {"bestC": best_lr["C"], "search": lr_search},
            "sets": {},
        },
        "tfidf-svc": {
            "displayName": "TF-IDF + calibrated LinearSVC",
            "hyperparameters": {"bestC": best_svc["C"], "search": svc_search},
            "sets": {},
        },
    }

    evaluated: dict[str, dict[str, tuple[list[str], list[float]]]] = {
        "keyword": {},
        "tfidf-lr": {},
        "tfidf-svc": {},
    }

    for set_name, rows in evaluation_sets.items():
        set_texts, set_labels, set_types = texts(rows), labels(rows), types(rows)

        keyword_output = [
            classify_keyword(row["description"], row["type"], keyword_rules) for row in rows
        ]
        keyword_predictions = [label for label, _ in keyword_output]
        keyword_confidences = [confidence for _, confidence in keyword_output]
        evaluated["keyword"][set_name] = (keyword_predictions, keyword_confidences)
        results["keyword"]["sets"][set_name] = {
            "metrics": metrics(set_labels, keyword_predictions),
            "thresholdCurve": selective_curve(set_labels, keyword_predictions, keyword_confidences),
        }

        for key, pipeline in (("tfidf-lr", final_lr), ("tfidf-svc", final_svc)):
            predictions, confidences = type_aware_predictions(pipeline, set_texts, set_types)
            evaluated[key][set_name] = (predictions, confidences)
            results[key]["sets"][set_name] = {
                "metrics": metrics(set_labels, predictions),
                "thresholdCurve": selective_curve(set_labels, predictions, confidences),
            }
            if key == "tfidf-lr" and set_name == "test":
                results[key]["atSelectedThresholdOnTest"] = at_threshold(
                    set_labels, predictions, confidences, threshold_choice["threshold"]
                )
            if key == "tfidf-lr" and set_name == "paraphrase":
                results[key]["atSelectedThresholdOnParaphrase"] = at_threshold(
                    set_labels, predictions, confidences, threshold_choice["threshold"]
                )

    results["tfidf-lr"]["validation"] = {
        "metrics": lr_validation_metrics,
        "thresholdCurve": lr_curve,
        "selectedThreshold": threshold_choice,
        "calibration": lr_validation_calibration,
        "errorAnalysis": lr_validation_errors,
    }

    # Calibration and error analysis for the deployed model on both eval sets.
    lr_calibration: dict[str, dict] = {"validation": lr_validation_calibration}
    lr_error_analysis: dict[str, dict] = {}
    for set_name, rows in evaluation_sets.items():
        set_labels = labels(rows)
        predictions, confidences = evaluated["tfidf-lr"][set_name]
        lr_calibration[set_name] = calibration_report(set_labels, predictions, confidences)
        lr_error_analysis[set_name] = error_analysis(
            set_labels, predictions, confidences, descriptions=texts(rows)
        )
        results["tfidf-lr"]["sets"][set_name]["calibration"] = lr_calibration[set_name]
        results["tfidf-lr"]["sets"][set_name]["errorAnalysis"] = lr_error_analysis[set_name]

    # Uncertainty on the held-out test. Group-level resampling keeps template
    # paraphrases together, and every method uses the same resamples so the
    # paired differences are meaningful.
    test_truth = labels(test_rows)
    test_groups = [row["group"] for row in test_rows]
    uncertainty = bootstrap_uncertainty(
        test_truth,
        {
            "keyword": evaluated["keyword"]["test"][0],
            "tfidf-lr": evaluated["tfidf-lr"]["test"][0],
            "tfidf-svc": evaluated["tfidf-svc"]["test"][0],
        },
        test_groups,
    )

    misclassified_payload = {
        "provenance": (
            "Synthetic Vietnamese transaction descriptions from the held-out template-group "
            "test split. Contains no real user data."
        ),
        "model": MODEL_VERSION,
        "runId": run_id,
        "threshold": threshold_choice["threshold"],
        "summary": {
            "misclassified": lr_error_analysis["test"]["misclassified"],
            "total": lr_error_analysis["test"]["total"],
            "confusionPairs": lr_error_analysis["test"]["confusionPairs"],
            "perLabel": lr_error_analysis["test"]["perLabel"],
        },
        "examples": lr_error_analysis["test"]["examples"],
    }
    (run_dir / "misclassified_tfidf-lr_test.json").write_text(
        json.dumps(misclassified_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Confusion matrices + PNGs for every model and evaluation set.
    for key in ("keyword", "tfidf-lr", "tfidf-svc"):
        for set_name in ("test", "paraphrase"):
            plot_confusion(
                results[key]["sets"][set_name]["metrics"]["confusionMatrix"],
                f"{results[key]['displayName']} — {set_name} set",
                run_dir / f"confusion_matrix_{key}_{set_name}.png",
            )

    for set_name in ("validation", "test"):
        plot_reliability(
            lr_calibration[set_name],
            f"TF-IDF + Logistic Regression — reliability ({set_name})",
            run_dir / f"reliability_tfidf-lr_{set_name}.png",
        )

    stability = load_latest_stability()
    nested_cv = load_latest_nested_cv()
    payload = {
        "metadata": metadata,
        "keywordRules": keyword_rules,
        "results": results,
        "selectedThreshold": threshold_choice,
        "uncertainty": uncertainty,
        "stability": stability,
        "nestedCv": nested_cv,
    }
    (run_dir / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    joblib.dump(final_lr, run_dir / "tfidf_lr_pipeline.joblib")

    # Consumed by app/training.py so the serving artifact uses the selected
    # hyper-parameter and threshold without duplicating the selection logic.
    selection = {
        "modelName": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "selectedAt": metadata["generatedAt"],
        "runId": run_id,
        "bestC": best_lr["C"],
        "bestSvcC": best_svc["C"],
        "svcSearch": svc_search,
        "threshold": threshold_choice["threshold"],
        "thresholdSelection": threshold_choice,
        "datasetFingerprint": metadata["dataset"]["fingerprint"],
        "datasetSplits": metadata["dataset"]["splits"],
        "trainedOn": "train+validation",
        "validationMetrics": lr_validation_metrics,
        "testMetrics": results["tfidf-lr"]["sets"]["test"]["metrics"],
        "paraphraseMetrics": results["tfidf-lr"]["sets"]["paraphrase"]["metrics"],
        "atSelectedThresholdOnTest": results["tfidf-lr"]["atSelectedThresholdOnTest"],
        "calibration": {
            set_name: {
                "expectedCalibrationError": report["expectedCalibrationError"],
                "brierScore": report["brierScore"],
            }
            for set_name, report in lr_calibration.items()
        },
        "errorAnalysis": {
            "validation": {
                "misclassified": lr_validation_errors["misclassified"],
                "total": lr_validation_errors["total"],
            },
            "test": {
                "misclassified": lr_error_analysis["test"]["misclassified"],
                "total": lr_error_analysis["test"]["total"],
                "confusionPairs": lr_error_analysis["test"]["confusionPairs"],
            },
        },
    }
    models_dir = ROOT / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    (models_dir / "selection.json").write_text(
        json.dumps(selection, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    summary = {
        "runId": run_id,
        "runDir": str(run_dir),
        "selectedThreshold": threshold_choice,
        "calibration": {
            set_name: {
                "ece": report["expectedCalibrationError"],
                "brier": report["brierScore"],
            }
            for set_name, report in lr_calibration.items()
        },
        "misclassifiedTest": {
            "count": lr_error_analysis["test"]["misclassified"],
            "total": lr_error_analysis["test"]["total"],
            "topPairs": lr_error_analysis["test"]["confusionPairs"][:3],
        },
        "comparison": {
            set_name: {
                key: {
                    "accuracy": results[key]["sets"][set_name]["metrics"]["accuracy"],
                    "macroPrecision": results[key]["sets"][set_name]["metrics"]["macroPrecision"],
                    "macroRecall": results[key]["sets"][set_name]["metrics"]["macroRecall"],
                    "macroF1": results[key]["sets"][set_name]["metrics"]["macroF1"],
                    "weightedF1": results[key]["sets"][set_name]["metrics"]["weightedF1"],
                }
                for key in ("keyword", "tfidf-lr", "tfidf-svc")
            }
            for set_name in ("test", "paraphrase")
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if not args.no_report:
        report_path = REPO_ROOT / "docs" / "AI_EVALUATION_REPORT.md"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(_render_report(payload), encoding="utf-8")
        print(f"Wrote {report_path}")
    return 0


def _render_report(payload: dict) -> str:
    metadata = payload["metadata"]
    results = payload["results"]
    threshold = payload["selectedThreshold"]
    lines: list[str] = []
    lines.append("# AI Evaluation Report — Smart Finance")
    lines.append("")
    lines.append(f"**Run**: `{metadata['runId']}` · **Generated**: {metadata['generatedAt']}")
    lines.append("")
    lines.append(
        "Fully synthetic Vietnamese transaction descriptions. The core template bank is split by "
        "whole template group into train/validation/test; the paraphrase set (separate hand-written "
        "template bank and seed) is a robustness check, not an out-of-distribution benchmark. "
        "Hyper-parameters and the abstention threshold were selected on validation only."
    )
    lines.append("")
    lines.append("## 1. Dataset and reproducibility")
    lines.append("")
    lines.append("| Split | Rows | Purpose |")
    lines.append("| --- | ---: | --- |")
    lines.append(f"| train | {metadata['dataset']['splits']['train']} | fit models |")
    lines.append(f"| validation | {metadata['dataset']['splits']['validation']} | choose C and abstention threshold |")
    lines.append(f"| test (held-out groups) | {metadata['dataset']['splits']['test']} | headline comparison |")
    lines.append(f"| paraphrase (separate bank) | {metadata['dataset']['splits']['paraphrase']} | robustness only |")
    lines.append("")
    lines.append(f"- Dataset fingerprint (SHA-256): `{metadata['dataset']['fingerprint']}`")
    lines.append(
        f"- Seed: `{metadata['seed']}` · Python {metadata['python']} · "
        f"scikit-learn {metadata['scikitLearn']} · NumPy {metadata['numpy']}"
    )
    lines.append(f"- Git commit: `{metadata['gitCommit']}`")
    lines.append("- Predictions are type-aware (INCOME labels for INCOME items, EXPENSE labels for EXPENSE items).")
    lines.append("")
    lines.append("## 2. Held-out test comparison")
    lines.append("")
    lines.append("| Method | Accuracy | Macro precision | Macro recall | Macro F1 | Weighted F1 |")
    lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
    for key in ("keyword", "tfidf-lr", "tfidf-svc"):
        score = results[key]["sets"]["test"]["metrics"]
        lines.append(
            f"| {results[key]['displayName']} | {score['accuracy']:.4f} | {score['macroPrecision']:.4f} | "
            f"{score['macroRecall']:.4f} | {score['macroF1']:.4f} | {score['weightedF1']:.4f} |"
        )
    lines.append("")
    uncertainty = payload.get("uncertainty")
    if uncertainty:
        lines.append("### Uncertainty on this single split")
        lines.append("")
        lines.append(
            f"Cluster bootstrap over the {uncertainty['groups']} template groups "
            f"({uncertainty['resamples']:,} resamples, seed {uncertainty['seed']}). Rows inside a "
            "group are paraphrases and are resampled together, so the interval is wider than a "
            "naive row bootstrap."
        )
        lines.append("")
        lines.append("| Method | Accuracy | 95% interval | Macro F1 | 95% interval |")
        lines.append("| --- | ---: | ---: | ---: | ---: |")
        for key in ("keyword", "tfidf-lr", "tfidf-svc"):
            point = uncertainty["point"][key]
            interval = uncertainty["intervals"][key]
            accuracy_interval = interval["accuracy"]
            macro_interval = interval["macroF1"]
            lines.append(
                f"| {results[key]['displayName']} | {point['accuracy']:.4f} | "
                f"{accuracy_interval['lower']:.4f}–{accuracy_interval['upper']:.4f} | "
                f"{point['macroF1']:.4f} | "
                f"{macro_interval['lower']:.4f}–{macro_interval['upper']:.4f} |"
            )
        lines.append("")
        lines.append("Paired differences from the same resamples:")
        lines.append("")
        lines.append("| Comparison | Accuracy difference | Macro F1 difference | P(left better) |")
        lines.append("| --- | ---: | ---: | ---: |")
        for name, values in uncertainty["pairedDifferences"].items():
            accuracy = values["accuracy"]
            macro = values["macroF1"]
            lines.append(
                f"| {name.replace(' vs ', ' − ')} | {accuracy['mean']:+.4f} "
                f"[{accuracy['lower']:+.4f}, {accuracy['upper']:+.4f}] | "
                f"{macro['mean']:+.4f} [{macro['lower']:+.4f}, {macro['upper']:+.4f}] | "
                f"{accuracy['probabilityLeftBetter']:.1%} (accuracy) |"
            )
        lines.append("")
        lines.append(
            "A positive difference means the left method is better. Intervals that cross zero "
            "mean this 200-row split does not establish a winner."
        )
        lines.append("")
    lines.append("## 3. Paraphrase set (not used for tuning)")
    lines.append("")
    lines.append("| Method | Accuracy | Macro precision | Macro recall | Macro F1 | Weighted F1 |")
    lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
    for key in ("keyword", "tfidf-lr", "tfidf-svc"):
        score = results[key]["sets"]["paraphrase"]["metrics"]
        lines.append(
            f"| {results[key]['displayName']} | {score['accuracy']:.4f} | {score['macroPrecision']:.4f} | "
            f"{score['macroRecall']:.4f} | {score['macroF1']:.4f} | {score['weightedF1']:.4f} |"
        )
    lines.append("")
    lines.append("## 4. Selected abstention threshold (validation only)")
    lines.append("")
    lines.append(f"- Threshold: **{threshold['threshold']:.2f}** — {threshold['reason']}")
    lines.append(
        f"- Validation coverage: **{threshold['validationCoverage']:.1%}**, selective accuracy "
        f"**{threshold['validationSelectiveAccuracy']:.1%}**, selective risk "
        f"**{threshold['validationSelectiveRisk']:.1%}**"
    )
    accepted = results["tfidf-lr"]["atSelectedThresholdOnTest"]
    paraphrased = results["tfidf-lr"]["atSelectedThresholdOnParaphrase"]
    lines.append(
        f"- Held-out test at this threshold: coverage **{accepted['coverage']:.1%}** "
        f"({accepted['acceptedCount']}/{accepted['totalCount']}), selective accuracy "
        f"**{accepted['selectiveAccuracy']:.1%}**, selective risk **{accepted['selectiveRisk']:.1%}**"
    )
    lines.append(
        f"- Paraphrase set at this threshold: coverage **{paraphrased['coverage']:.1%}** "
        f"({paraphrased['acceptedCount']}/{paraphrased['totalCount']}), selective accuracy "
        f"**{paraphrased['selectiveAccuracy']:.1%}**, selective risk **{paraphrased['selectiveRisk']:.1%}**"
    )
    lines.append("")
    lines.append(
        "Selection rule (fixed before looking at test): choose the lowest threshold on the grid "
        f"whose validation selective accuracy is at least {payload['metadata']['protocol']['selectiveAccuracyTarget']:.0%}; "
        "among those, take the one with the highest coverage. Ties fall back to the point that "
        "maximises coverage x selective accuracy."
    )
    lines.append("")
    lines.append("Validation coverage / selective accuracy / selective risk for every threshold:")
    lines.append("")
    lines.append("| Threshold | Coverage | Selective accuracy | Selective risk |")
    lines.append("| ---: | ---: | ---: | ---: |")
    for point in results["tfidf-lr"]["validation"]["thresholdCurve"]:
        accuracy = point["selectiveAccuracy"]
        risk = point["selectiveRisk"]
        lines.append(
            f"| {point['threshold']:.2f} | {point['coverage']:.1%} | "
            f"{'—' if accuracy is None else f'{accuracy:.1%}'} | "
            f"{'—' if risk is None else f'{risk:.1%}'} |"
        )
    lines.append("")
    lines.append(
        "Items below the threshold are returned as `low_confidence`; the UI never applies a "
        "suggestion without explicit user confirmation."
    )
    lines.append("")
    lines.append("## 5. Confidence calibration — TF-IDF + Logistic Regression")
    lines.append("")
    lines.append(
        "Top-label calibration with equal-width bins over the predicted confidence. ECE is the "
        "count-weighted gap between mean confidence and empirical accuracy; the Brier score is "
        "the mean squared error of the confidence against the 0/1 outcome."
    )
    lines.append("")
    calibration_reports = {
        "validation": results["tfidf-lr"]["validation"]["calibration"],
        "test": results["tfidf-lr"]["sets"]["test"]["calibration"],
    }
    lines.append("| Split | ECE | Brier score | Bins with data |")
    lines.append("| --- | ---: | ---: | ---: |")
    for set_name, report in calibration_reports.items():
        populated = sum(1 for row in report["table"] if row["count"])
        lines.append(
            f"| {set_name} | {report['expectedCalibrationError']:.4f} | "
            f"{report['brierScore']:.4f} | {populated}/{report['bins']} |"
        )
    lines.append("")
    lines.append("Reliability table (validation):")
    lines.append("")
    lines.append("| Bin | Rows | Mean confidence | Accuracy | Gap |")
    lines.append("| --- | ---: | ---: | ---: | ---: |")
    for row in results["tfidf-lr"]["validation"]["calibration"]["table"]:
        if not row["count"]:
            continue
        gap = abs(row["accuracy"] - row["avgConfidence"])
        lines.append(
            f"| {row['lower']:.2f}–{row['upper']:.2f} | {row['count']} | "
            f"{row['avgConfidence']:.4f} | {row['accuracy']:.4f} | {gap:.4f} |"
        )
    lines.append("")
    lines.append("Reliability table (held-out test):")
    lines.append("")
    lines.append("| Bin | Rows | Mean confidence | Accuracy | Gap |")
    lines.append("| --- | ---: | ---: | ---: | ---: |")
    for row in results["tfidf-lr"]["sets"]["test"]["calibration"]["table"]:
        if not row["count"]:
            continue
        gap = abs(row["accuracy"] - row["avgConfidence"])
        lines.append(
            f"| {row['lower']:.2f}–{row['upper']:.2f} | {row['count']} | "
            f"{row['avgConfidence']:.4f} | {row['accuracy']:.4f} | {gap:.4f} |"
        )
    lines.append("")
    lines.append(
        "The threshold is chosen on the validation split only; calibration is reported, not "
        "optimised, so it is a diagnostic rather than a tuning signal. Several bins hold fewer "
        "than 10 rows, so a single bin's gap is noisy."
    )
    lines.append("")
    lines.append("## 6. Per-class results — TF-IDF + Logistic Regression (held-out test)")
    lines.append("")
    lines.append("| Label | Precision | Recall | F1 | Support |")
    lines.append("| --- | ---: | ---: | ---: | ---: |")
    for row in results["tfidf-lr"]["sets"]["test"]["metrics"]["perClass"]:
        lines.append(
            f"| {row['label']} | {row['precision']:.4f} | {row['recall']:.4f} | "
            f"{row['f1']:.4f} | {row['support']} |"
        )
    lines.append("")
    lines.append("## 7. Error analysis — held-out test")
    lines.append("")
    errors = results["tfidf-lr"]["sets"]["test"]["errorAnalysis"]
    lines.append(
        f"{errors['misclassified']} of {errors['total']} test rows are misclassified "
        f"({errors['misclassified'] / errors['total']:.1%})."
    )
    lines.append("")
    lines.append("Most frequent confusion pairs (true → predicted):")
    lines.append("")
    lines.append("| True | Predicted | Count |")
    lines.append("| --- | --- | ---: |")
    for pair in errors["confusionPairs"]:
        lines.append(f"| {pair['trueLabel']} | {pair['predictedLabel']} | {pair['count']} |")
    lines.append("")
    lines.append("Error rate per class:")
    lines.append("")
    lines.append("| Label | Support | Errors | Error rate |")
    lines.append("| --- | ---: | ---: | ---: |")
    for row in errors["perLabel"]:
        rate = "—" if row["errorRate"] is None else f"{row['errorRate']:.1%}"
        lines.append(f"| {row['label']} | {row['support']} | {row['errors']} | {rate} |")
    lines.append("")
    lines.append(
        "A sample of misclassified rows is written to "
        "`misclassified_tfidf-lr_test.json` in the run directory. These are synthetic "
        "descriptions generated by the repository; no user data is included."
    )
    lines.append("")
    lines.append("| Description (synthetic) | True | Predicted | Confidence |")
    lines.append("| --- | --- | --- | ---: |")
    for example in errors["examples"][:15]:
        text = example["text"].replace("|", "\\|")
        lines.append(
            f"| {text} | {example['trueLabel']} | {example['predictedLabel']} | "
            f"{example['confidence']:.2f} |"
        )
    lines.append("")
    stability = payload.get("stability")
    if stability:
        protocol = stability["protocol"]
        lines.append("## 8. Split stability (development data only)")
        lines.append("")
        lines.append(
            f"`scripts/stability.py` resamples train + validation with "
            f"{protocol['folds']}-fold StratifiedGroupKFold for seeds "
            f"{', '.join(str(seed) for seed in protocol['seeds'])}. Hyper-parameters are fixed at "
            f"the values chosen on validation (LR C={protocol['fixedC']}, "
            f"SVC C={protocol.get('fixedSvcC', protocol['fixedC'])}); the held-out test split is "
            "never used."
        )
        lines.append("")
        lines.append(
            "**Caveat:** train + validation includes the validation rows that selected those "
            "hyper-parameters, so this is a conditional split-variance check, not an unbiased "
            "estimate of the tuning procedure. Section 9 reports the nested estimate."
        )
        lines.append("")
        lines.append(
            "| Method | Accuracy mean ± std | Accuracy min–max | Macro F1 mean ± std | "
            "Macro F1 min–max | Weighted F1 mean ± std |"
        )
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        for key, stats in stability["methods"].items():
            accuracy = stats["accuracy"]
            macro = stats["macroF1"]
            weighted = stats["weightedF1"]
            lines.append(
                f"| {results[key]['displayName']} | "
                f"{accuracy['mean']:.4f} ± {accuracy['std']:.4f} | "
                f"{accuracy['min']:.4f}–{accuracy['max']:.4f} | "
                f"{macro['mean']:.4f} ± {macro['std']:.4f} | "
                f"{macro['min']:.4f}–{macro['max']:.4f} | "
                f"{weighted['mean']:.4f} ± {weighted['std']:.4f} |"
            )
        lines.append("")
        lines.append(
            "The spread is wide because each fold holds out a small number of template groups. "
            "Treat the single held-out test score as one draw from this distribution, not as a "
            "precise estimate."
        )
        lines.append("")
    nested = payload.get("nestedCv")
    if nested:
        protocol = nested["protocol"]
        lines.append("## 9. Nested cross-validation (train split only)")
        lines.append("")
        lines.append(
            f"`scripts/nested_cv.py` uses {protocol['outerFolds']} outer folds and "
            f"{protocol['innerFolds']} inner folds of StratifiedGroupKFold for seeds "
            f"{', '.join(str(seed) for seed in protocol['seedValues'])}. Data: "
            f"{protocol['data']}. The inner loop selects C and the abstention threshold; the "
            "outer fold is scored once with the selected configuration."
        )
        lines.append("")
        lines.append(
            "| Method | Accuracy mean ± std | Macro F1 mean ± std | Weighted F1 mean ± std | "
            "Coverage | Selective risk |"
        )
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        for key, stats in nested["methods"].items():
            accuracy = stats["pooledBySeed"]["accuracy"]
            macro = stats["pooledBySeed"]["macroF1"]
            weighted = stats["pooledBySeed"]["weightedF1"]
            coverage = stats["coverage"]
            risk = stats["selectiveRisk"]
            lines.append(
                f"| {results[key]['displayName']} | "
                f"{accuracy['mean']:.4f} ± {accuracy['std']:.4f} | "
                f"{macro['mean']:.4f} ± {macro['std']:.4f} | "
                f"{weighted['mean']:.4f} ± {weighted['std']:.4f} | "
                f"{coverage['mean']:.1%} | "
                f"{'—' if risk['n'] == 0 else f'{risk['mean']:.1%}'} |"
            )
        lines.append("")
        lines.append(
            "Pooled-by-seed spreads are small because the three seeds reuse the same rows. "
            "Per-fold spread (15 outer folds) is the more honest split-uncertainty view:"
        )
        lines.append("")
        lines.append(
            "| Method | Accuracy per fold | Macro F1 per fold | Weighted F1 per fold |"
        )
        lines.append("| --- | ---: | ---: | ---: |")
        for key, stats in nested["methods"].items():
            accuracy = stats["perFold"]["accuracy"]
            macro = stats["perFold"]["macroF1"]
            weighted = stats["perFold"]["weightedF1"]
            lines.append(
                f"| {results[key]['displayName']} | "
                f"{accuracy['mean']:.4f} ± {accuracy['std']:.4f} | "
                f"{macro['mean']:.4f} ± {macro['std']:.4f} | "
                f"{weighted['mean']:.4f} ± {weighted['std']:.4f} |"
            )
        lines.append("")
        selection_lines = []
        for key, stats in nested["methods"].items():
            frequency = stats.get("selectionFrequency") or {}
            if frequency:
                chosen = ", ".join(
                    f"C={value} ×{count}" for value, count in frequency.items()
                )
                selection_lines.append(f"- {results[key]['displayName']}: {chosen}")
        if selection_lines:
            lines.append("Selected C across outer folds:")
            lines.append("")
            lines.extend(selection_lines)
            lines.append("")
        lines.append(
            "These are procedure estimates on 992 training rows, not the production model's "
            "score. They are expected to be lower than the held-out test score because each "
            "outer fold trains on fewer rows. They are also the honest check against concluding "
            "superiority from one split."
        )
        lines.append("")
    lines.append("## 10. Hyper-parameter search (validation macro F1)")
    lines.append("")
    lines.append("| Model | C | Validation macro F1 | Validation accuracy |")
    lines.append("| --- | ---: | ---: | ---: |")
    for key, name in (("tfidf-lr", "Logistic Regression"), ("tfidf-svc", "LinearSVC")):
        for point in results[key]["hyperparameters"]["search"]:
            lines.append(
                f"| {name} | {point['C']} | {point['macroF1']:.4f} | {point['accuracy']:.4f} |"
            )
    lines.append("")
    lines.append("## 11. Confusion matrices and reliability diagrams")
    lines.append("")
    lines.append(f"PNG files are in `artifacts/experiments/{metadata['runId']}/`:")
    for key in ("keyword", "tfidf-lr", "tfidf-svc"):
        for set_name in ("test", "paraphrase"):
            lines.append(f"- `confusion_matrix_{key}_{set_name}.png`")
    lines.append("- `reliability_tfidf-lr_validation.png`")
    lines.append("- `reliability_tfidf-lr_test.png`")
    lines.append("")
    lines.append("## 12. Limitations")
    lines.append("")
    lines.append("- All data is synthetic; absolute scores do not estimate accuracy on real users.")
    lines.append("- The paraphrase set is written by hand and shares vocabulary and label definitions with training.")
    lines.append("- The keyword baseline is mined from train only, but remains a simple rule system.")
    lines.append(
        "- Calibration is measured for the deployed Logistic Regression only; the SVC probabilities "
        "come from sigmoid calibration on 3 internal folds and are reported without an ECE."
    )
    lines.append(
        "- The development-set folds are small, so the split-stability interval is wide; the held-out "
        "test score is a single draw, not a precise estimate."
    )
    lines.append(
        "- The held-out test has been observed in earlier research rounds. It is not used for "
        "selection here, but it is no longer a pristine single-use holdout."
    )
    lines.append(
        "- Calibration bins are equal-width and only 200 test rows are available; several bins "
        "hold a handful of rows. ECE and Brier are diagnostics, not precise probabilities."
    )
    lines.append(
        "- Nested cross-validation uses the 992-row train split only, so it estimates a "
        "lower-data regime and is not directly comparable to the production model's test score."
    )
    lines.append("- Feedback data from users is not yet used for training (consent-gated export exists).")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())

