"""Nested cross-validation for the transaction classifier.

Why this script exists
----------------------
``scripts/evaluate_models.py`` selects ``C`` and the abstention threshold on the
validation split, then reports a single held-out test score.
``scripts/stability.py`` resamples train + validation with a *fixed* ``C``; that
is a split-variance check, but it reuses rows that were already used for tuning,
so it is not an unbiased estimate of the model-selection procedure.

This script measures the whole procedure without touching the held-out test
split and without reusing the validation rows that picked the final ``C``:

* **Data**: the train split only (992 rows). Validation selected the production
  ``C`` and threshold, so it is excluded here; the held-out test is never read.
* **Outer loop**: StratifiedGroupKFold by template group, repeated for seeds
  42, 7 and 2026.
* **Inner loop**: on each outer-training fold, a second StratifiedGroupKFold
  selects ``C`` by pooled out-of-fold macro F1 (tie-break: accuracy) and then
  selects the abstention threshold by the same rule used in production
  (coverage is maximised subject to selective accuracy >= 0.80).
* **Evaluation**: the chosen configuration is refit on the full outer-training
  fold and scored once on the outer-test fold. Nothing from the outer-test fold
  influences the choice.

The headline numbers are therefore an estimate of the *procedure* on data that
was not used to choose the production hyper-parameters. The held-out test split
remains the final, single evaluation after the model is locked.

Usage:
    python apps/ai-service/scripts/nested_cv.py
    python apps/ai-service/scripts/nested_cv.py --no-svc --seeds 42 --folds 3
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
from sklearn.model_selection import StratifiedGroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.evaluate_models import (  # noqa: E402
    DATA_DIR,
    SELECTIVE_ACCURACY_TARGET,
    THRESHOLD_GRID,
    build_keyword_rules,
    build_lr,
    build_svc,
    calibration_report,
    choose_threshold,
    classify_keyword,
    error_analysis,
    git_commit,
    load_rows,
    metrics,
    selective_curve,
    sha256,
    type_aware_predictions,
)

ARTIFACTS_DIR = ROOT / "artifacts" / "nested_cv"
DEFAULT_FOLDS = 5
DEFAULT_INNER_FOLDS = 3
DEFAULT_SEEDS = "42,7,2026"
LR_GRID = (0.5, 1.0, 2.0, 4.0)
SVC_GRID = (0.25, 0.5, 1.0, 2.0)
KEYWORD_THRESHOLD = 0.50


def describe(values: list[float]) -> dict:
    array = np.array(values, dtype=float)
    return {
        "mean": round(float(array.mean()), 4),
        "std": round(float(array.std(ddof=1)) if len(array) > 1 else 0.0, 4),
        "min": round(float(array.min()), 4),
        "max": round(float(array.max()), 4),
        "n": len(values),
    }


def selective_from_flags(
    truth: list[str],
    predictions: list[str],
    selected: list[bool],
    policy: str = "per-fold threshold selected by inner CV",
) -> dict:
    accepted = [index for index, flag in enumerate(selected) if flag]
    correct = sum(1 for index in accepted if predictions[index] == truth[index])
    return {
        "thresholdPolicy": policy,
        "coverage": round(len(accepted) / len(truth), 4) if truth else 0.0,
        "selectiveAccuracy": round(correct / len(accepted), 4) if accepted else None,
        "selectiveRisk": round(1 - correct / len(accepted), 4) if accepted else None,
        "acceptedCount": len(accepted),
        "totalCount": len(truth),
    }


def fit_configuration(
    builder,
    c_value: float,
    train_texts: list[str],
    train_labels: list[str],
    texts: list[str],
    types: list[str],
) -> tuple[list[str], list[float]]:
    pipeline = builder(c_value)
    pipeline.fit(train_texts, train_labels)
    return type_aware_predictions(pipeline, texts, types)


def choose_hyperparameters(
    builder,
    grid: tuple[float, ...],
    outer_train_rows: list[dict[str, str]],
    seed: int,
    inner_folds: int,
) -> dict:
    """Select C with an inner grouped CV on the outer-training rows only."""
    texts = [row["description"] for row in outer_train_rows]
    labels = [row["label"] for row in outer_train_rows]
    types = [row["type"] for row in outer_train_rows]
    groups = [row["group"] for row in outer_train_rows]

    splitter = StratifiedGroupKFold(
        n_splits=inner_folds, shuffle=True, random_state=seed + 1
    )
    folds = list(splitter.split(texts, labels, groups))

    candidates: list[dict] = []
    best: dict | None = None
    for c_value in grid:
        oof_predictions: list[str | None] = [None] * len(texts)
        oof_confidences: list[float | None] = [None] * len(texts)
        fold_scores: list[dict] = []
        for inner_train, inner_validation in folds:
            inner_train_texts = [texts[index] for index in inner_train]
            inner_train_labels = [labels[index] for index in inner_train]
            inner_texts = [texts[index] for index in inner_validation]
            inner_types = [types[index] for index in inner_validation]
            predictions, confidences = fit_configuration(
                builder,
                c_value,
                inner_train_texts,
                inner_train_labels,
                inner_texts,
                inner_types,
            )
            for position, index in enumerate(inner_validation):
                oof_predictions[index] = predictions[position]
                oof_confidences[index] = confidences[position]
            fold_scores.append(
                metrics([labels[index] for index in inner_validation], predictions)
            )

        assert all(value is not None for value in oof_predictions)
        assert all(value is not None for value in oof_confidences)
        pooled_predictions = [value for value in oof_predictions if value is not None]
        pooled_confidences = [float(value) for value in oof_confidences if value is not None]
        pooled_score = metrics(labels, pooled_predictions)
        candidate = {
            "C": c_value,
            "macroF1": pooled_score["macroF1"],
            "accuracy": pooled_score["accuracy"],
            "weightedF1": pooled_score["weightedF1"],
            "foldMacroF1": describe([score["macroF1"] for score in fold_scores]),
            "foldAccuracy": describe([score["accuracy"] for score in fold_scores]),
            "oofPredictions": pooled_predictions,
            "oofConfidences": pooled_confidences,
        }
        candidates.append(candidate)
        if best is None or (candidate["macroF1"], candidate["accuracy"]) > (
            best["macroF1"],
            best["accuracy"],
        ):
            best = candidate

    assert best is not None
    curve = selective_curve(labels, best["oofPredictions"], best["oofConfidences"])
    threshold = choose_threshold(curve, SELECTIVE_ACCURACY_TARGET)
    return {
        "C": best["C"],
        "threshold": threshold,
        "innerCandidateScores": [
            {key: value for key, value in candidate.items() if not key.startswith("oof")}
            for candidate in candidates
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folds", type=int, default=DEFAULT_FOLDS)
    parser.add_argument("--inner-folds", type=int, default=DEFAULT_INNER_FOLDS)
    parser.add_argument("--seeds", default=DEFAULT_SEEDS)
    parser.add_argument("--no-svc", action="store_true", help="skip the calibrated LinearSVC")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    seeds = [int(seed) for seed in args.seeds.split(",") if seed.strip()]
    if not seeds:
        parser.error("--seeds must contain at least one integer")
    if args.folds < 2 or args.inner_folds < 2:
        parser.error("--folds and --inner-folds must be at least 2")

    # Deliberately only the train split. Validation picked the production C and
    # threshold; the held-out test is reserved for the final locked evaluation.
    rows = load_rows(DATA_DIR / "training" / "train.csv")
    texts = [row["description"] for row in rows]
    truth = [row["label"] for row in rows]
    types = [row["type"] for row in rows]
    groups = [row["group"] for row in rows]

    dataset_files = [
        DATA_DIR / "training" / "train.csv",
        DATA_DIR / "validation" / "validation.csv",
        DATA_DIR / "evaluation" / "test.csv",
        DATA_DIR / "evaluation" / "paraphrase.csv",
    ]
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    methods = ["keyword", "tfidf-lr"] + ([] if args.no_svc else ["tfidf-svc"])

    per_fold: dict[str, list[dict]] = {method: [] for method in methods}
    per_seed: dict[int, dict[str, list[dict]]] = {
        seed: {method: [] for method in methods} for seed in seeds
    }
    selection: dict[str, Counter[float]] = {
        "tfidf-lr": Counter(),
        **({} if args.no_svc else {"tfidf-svc": Counter()}),
    }

    for seed in seeds:
        outer = StratifiedGroupKFold(
            n_splits=args.folds, shuffle=True, random_state=seed
        )
        for fold, (train_index, test_index) in enumerate(
            outer.split(texts, truth, groups)
        ):
            outer_train_rows = [rows[index] for index in train_index]
            outer_train_texts = [texts[index] for index in train_index]
            outer_train_labels = [truth[index] for index in train_index]
            test_texts = [texts[index] for index in test_index]
            test_truth = [truth[index] for index in test_index]
            test_types = [types[index] for index in test_index]

            # Baseline: rules mined inside this outer-training fold only.
            keyword_rules = build_keyword_rules(outer_train_rows)
            keyword_output = [
                classify_keyword(description, item_type, keyword_rules)
                for description, item_type in zip(test_texts, test_types, strict=True)
            ]
            keyword_predictions = [label for label, _ in keyword_output]
            keyword_confidences = [confidence for _, confidence in keyword_output]
            keyword_score = metrics(test_truth, keyword_predictions)
            keyword_selected = [
                confidence >= KEYWORD_THRESHOLD for confidence in keyword_confidences
            ]

            record = {
                "seed": seed,
                "fold": fold,
                "trainRows": len(train_index),
                "testRows": len(test_index),
                "keyword": {
                    "metrics": keyword_score,
                    "atThreshold": selective_from_flags(
                        test_truth,
                        keyword_predictions,
                        keyword_selected,
                        policy=f"fixed {KEYWORD_THRESHOLD:.2f}",
                    ),
                },
            }
            per_fold["keyword"].append(
                {
                    "seed": seed,
                    "fold": fold,
                    "accuracy": keyword_score["accuracy"],
                    "macroF1": keyword_score["macroF1"],
                    "weightedF1": keyword_score["weightedF1"],
                }
            )
            per_seed[seed]["keyword"].append(
                {
                    "index": test_index,
                    "truth": test_truth,
                    "predictions": keyword_predictions,
                    "confidences": keyword_confidences,
                    "selected": keyword_selected,
                }
            )

            for method, builder, grid in (
                ("tfidf-lr", build_lr, LR_GRID),
                *((("tfidf-svc", build_svc, SVC_GRID),) if not args.no_svc else ()),
            ):
                choice = choose_hyperparameters(
                    builder, grid, outer_train_rows, seed + fold, args.inner_folds
                )
                predictions, confidences = fit_configuration(
                    builder,
                    float(choice["C"]),
                    outer_train_texts,
                    outer_train_labels,
                    test_texts,
                    test_types,
                )
                selected = [
                    confidence >= choice["threshold"]["threshold"]
                    for confidence in confidences
                ]
                score = metrics(test_truth, predictions)
                record[method] = {
                    "C": choice["C"],
                    "threshold": choice["threshold"]["threshold"],
                    "metrics": score,
                    "atThreshold": selective_from_flags(test_truth, predictions, selected),
                    "innerCandidateScores": choice["innerCandidateScores"],
                }
                per_fold[method].append(
                    {
                        "seed": seed,
                        "fold": fold,
                        "C": choice["C"],
                        "threshold": choice["threshold"]["threshold"],
                        "accuracy": score["accuracy"],
                        "macroF1": score["macroF1"],
                        "weightedF1": score["weightedF1"],
                        "coverage": record[method]["atThreshold"]["coverage"],
                        "selectiveRisk": record[method]["atThreshold"]["selectiveRisk"],
                    }
                )
                per_seed[seed][method].append(
                    {
                        "index": test_index,
                        "truth": test_truth,
                        "predictions": predictions,
                        "confidences": confidences,
                        "selected": selected,
                        "threshold": choice["threshold"]["threshold"],
                        "C": choice["C"],
                    }
                )
                selection[method][float(choice["C"])] += 1

            # Store the fold record for the archive (without repeating metrics
            # already present in the per-method arrays).
            per_fold.setdefault("folds", []).append(record)

    pooled: dict[str, dict] = {}
    for seed in seeds:
        pooled[seed] = {}
        for method in methods:
            pieces = sorted(per_seed[seed][method], key=lambda piece: min(piece["index"]))
            ordered: list[dict] = []
            for piece in pieces:
                ordered.extend(
                    {
                        "truth": piece["truth"][position],
                        "prediction": piece["predictions"][position],
                        "confidence": piece["confidences"][position],
                        "selected": piece["selected"][position],
                    }
                    for position in range(len(piece["index"]))
                )
            pooled_truth = [row["truth"] for row in ordered]
            pooled_predictions = [row["prediction"] for row in ordered]
            pooled_confidences = [row["confidence"] for row in ordered]
            pooled_selected = [row["selected"] for row in ordered]
            score = metrics(pooled_truth, pooled_predictions)
            calibration = calibration_report(
                pooled_truth, pooled_predictions, pooled_confidences
            )
            pooled[seed][method] = {
                "metrics": score,
                "calibration": calibration,
                "atThreshold": selective_from_flags(
                    pooled_truth, pooled_predictions, pooled_selected
                ),
                "predictionCount": len(ordered),
            }

    # Illustrative per-class error analysis on one pooled seed, not a selection
    # signal. Seed 42 is the repository's primary seed.
    primary_seed = seeds[0]
    error_reports: dict[str, dict] = {}
    for method in methods:
        pieces = sorted(per_seed[primary_seed][method], key=lambda piece: min(piece["index"]))
        ordered = []
        for piece in pieces:
            ordered.extend(
                {
                    "truth": piece["truth"][position],
                    "prediction": piece["predictions"][position],
                    "confidence": piece["confidences"][position],
                }
                for position in range(len(piece["index"]))
            )
        error_reports[method] = error_analysis(
            [row["truth"] for row in ordered],
            [row["prediction"] for row in ordered],
            [row["confidence"] for row in ordered],
        )

    summary: dict[str, dict] = {}
    for method in methods:
        pooled_scores = [pooled[seed][method]["metrics"] for seed in seeds]
        fold_scores = per_fold[method]
        summary[method] = {
            "pooledBySeed": {
                metric: describe([score[metric] for score in pooled_scores])
                for metric in ("accuracy", "macroF1", "weightedF1")
            },
            "perFold": {
                metric: describe([score[metric] for score in fold_scores])
                for metric in ("accuracy", "macroF1", "weightedF1")
            },
            "coverage": describe(
                [pooled[seed][method]["atThreshold"]["coverage"] for seed in seeds]
            ),
            "selectiveRisk": describe(
                [
                    pooled[seed][method]["atThreshold"]["selectiveRisk"]
                    for seed in seeds
                    if pooled[seed][method]["atThreshold"]["selectiveRisk"] is not None
                ]
            ),
            "selectionFrequency": {
                str(c_value): count for c_value, count in sorted(selection.get(method, {}).items())
            },
        }

    payload = {
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "metadata": {
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
                "usedForThisRun": ["training/train.csv"],
                "rowsUsed": len(rows),
            },
            "primarySeed": primary_seed,
        },
        "protocol": {
            "data": "train split only; validation and held-out test are not read",
            "why": (
                "validation selected the production C and threshold, so including it "
                "would make the outer estimate reuse tuning data"
            ),
            "outerSplitter": "StratifiedGroupKFold by template group",
            "outerFolds": args.folds,
            "seedValues": seeds,
            "innerSplitter": "StratifiedGroupKFold by template group",
            "innerFolds": args.inner_folds,
            "cGrids": {"tfidf-lr": list(LR_GRID), "tfidf-svc": list(SVC_GRID)},
            "selectionMetric": "pooled inner out-of-fold macro F1 (tie-break: accuracy)",
            "thresholdTarget": SELECTIVE_ACCURACY_TARGET,
            "thresholdGrid": THRESHOLD_GRID,
            "keywordThreshold": KEYWORD_THRESHOLD,
            "testUsage": "none; held-out test remains for the final locked evaluation",
        },
        "methods": summary,
        "pooledBySeed": {
            str(seed): {
                method: pooled[seed][method] for method in methods
            }
            for seed in seeds
        },
        "errorAnalysis": error_reports,
        "perFold": per_fold,
    }

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = args.out or (ARTIFACTS_DIR / f"nested_cv-{run_id}.json")
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    printable = {
        "runId": run_id,
        "output": str(out_path),
        "data": payload["protocol"]["data"],
        "outerFolds": args.folds,
        "innerFolds": args.inner_folds,
        "seeds": seeds,
        "methods": {
            method: {
                "accuracy": summary[method]["pooledBySeed"]["accuracy"],
                "macroF1": summary[method]["pooledBySeed"]["macroF1"],
                "weightedF1": summary[method]["pooledBySeed"]["weightedF1"],
                "coverage": summary[method]["coverage"],
                "selectiveRisk": summary[method]["selectiveRisk"],
                "selectionFrequency": summary[method]["selectionFrequency"],
            }
            for method in methods
        },
    }
    print(json.dumps(printable, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
