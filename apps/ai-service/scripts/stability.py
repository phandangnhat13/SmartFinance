"""Measure how sensitive the reported scores are to the group split itself.

Protocol
--------
* Only the development data (train + validation) is used. The held-out test
  split is never touched here, so repeated resampling cannot leak information
  into the headline comparison.
* For each seed, ``StratifiedGroupKFold`` keeps every template group inside a
  single fold, so the split has the same anti-leakage property as the main
  train/validation/test split.
* Hyper-parameters and the abstention threshold stay fixed at the values chosen
  by ``scripts/evaluate_models.py``. This measures split variance, not tuning.
* Because the resampled pool contains the validation rows that were used to
  choose those values, this is a *conditional* variance check, not an unbiased
  estimate of the tuning procedure. ``scripts/nested_cv.py`` provides the
  nested estimate on the train split only.
* The keyword baseline is re-mined inside every fold from that fold's training
  rows only.

The report gives mean, standard deviation, min and max of accuracy, macro F1 and
weighted F1 across folds and seeds. A large standard deviation means a single
split should not be read as a precise estimate.

Usage:
    python apps/ai-service/scripts/stability.py
    python apps/ai-service/scripts/stability.py --seeds 42,7 --folds 5 --no-svc
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.evaluate_models import (  # noqa: E402
    DATA_DIR,
    build_keyword_rules,
    build_lr,
    build_svc,
    classify_keyword,
    load_rows,
    metrics,
    type_aware_predictions,
)

ARTIFACTS_DIR = ROOT / "artifacts" / "stability"
DEFAULT_FOLDS = 5
DEFAULT_SEEDS = "42,7,2026"
FALLBACK_C = 2.0


def describe(values: list[float]) -> dict:
    array = np.array(values, dtype=float)
    return {
        "mean": round(float(array.mean()), 4),
        "std": round(float(array.std(ddof=1)) if len(array) > 1 else 0.0, 4),
        "min": round(float(array.min()), 4),
        "max": round(float(array.max()), 4),
        "n": len(values),
    }


def load_best_c(path: Path, key: str = "bestC") -> float:
    if not path.exists():
        return FALLBACK_C
    try:
        return float(json.loads(path.read_text(encoding="utf-8")).get(key, FALLBACK_C))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return FALLBACK_C


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folds", type=int, default=DEFAULT_FOLDS)
    parser.add_argument("--seeds", default=DEFAULT_SEEDS)
    parser.add_argument("--no-svc", action="store_true", help="skip the calibrated LinearSVC")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    seeds = [int(seed) for seed in args.seeds.split(",") if seed.strip()]
    if not seeds:
        parser.error("--seeds must contain at least one integer")

    train_rows = load_rows(DATA_DIR / "training" / "train.csv")
    validation_rows = load_rows(DATA_DIR / "validation" / "validation.csv")
    rows = train_rows + validation_rows
    texts = [row["description"] for row in rows]
    truth = [row["label"] for row in rows]
    types = [row["type"] for row in rows]
    groups = [row["group"] for row in rows]

    selection_path = ROOT / "models" / "selection.json"
    best_c = load_best_c(selection_path, "bestC")
    best_svc_c = load_best_c(selection_path, "bestSvcC")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    per_method: dict[str, list[dict]] = {"keyword": [], "tfidf-lr": []}
    if not args.no_svc:
        per_method["tfidf-svc"] = []

    for seed in seeds:
        splitter = StratifiedGroupKFold(
            n_splits=args.folds, shuffle=True, random_state=seed
        )
        for fold, (train_index, validation_index) in enumerate(
            splitter.split(texts, truth, groups)
        ):
            fold_train_rows = [rows[index] for index in train_index]
            fold_texts = [texts[index] for index in validation_index]
            fold_truth = [truth[index] for index in validation_index]
            fold_types = [types[index] for index in validation_index]
            fold_train_texts = [texts[index] for index in train_index]
            fold_train_labels = [truth[index] for index in train_index]

            keyword_rules = build_keyword_rules(fold_train_rows)
            keyword_output = [
                classify_keyword(description, item_type, keyword_rules)
                for description, item_type in zip(fold_texts, fold_types, strict=True)
            ]
            scores = {
                "keyword": metrics(fold_truth, [label for label, _ in keyword_output]),
            }

            lr = build_lr(best_c)
            lr.fit(fold_train_texts, fold_train_labels)
            lr_predictions, _ = type_aware_predictions(lr, fold_texts, fold_types)
            scores["tfidf-lr"] = metrics(fold_truth, lr_predictions)

            if not args.no_svc:
                svc = build_svc(best_svc_c)
                svc.fit(fold_train_texts, fold_train_labels)
                svc_predictions, _ = type_aware_predictions(svc, fold_texts, fold_types)
                scores["tfidf-svc"] = metrics(fold_truth, svc_predictions)

            for method, score in scores.items():
                per_method[method].append(
                    {
                        "seed": seed,
                        "fold": fold,
                        "accuracy": score["accuracy"],
                        "macroF1": score["macroF1"],
                        "weightedF1": score["weightedF1"],
                    }
                )

    summary = {
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "protocol": {
            "data": "train + validation only (held-out test untouched)",
            "splitter": "StratifiedGroupKFold by template group",
            "seeds": seeds,
            "folds": args.folds,
            "fixedC": best_c,
            "fixedSvcC": best_svc_c,
            "tuningReuse": (
                "The pool includes validation rows that selected these C values; this is a "
                "conditional split-variance check, not an unbiased tuning estimate."
            ),
            "note": "Hyper-parameters are fixed; this measures split variance, not tuning.",
        },
        "methods": {
            method: {
                "accuracy": describe([point["accuracy"] for point in points]),
                "macroF1": describe([point["macroF1"] for point in points]),
                "weightedF1": describe([point["weightedF1"] for point in points]),
                "folds": points,
            }
            for method, points in per_method.items()
        },
    }

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = args.out or (ARTIFACTS_DIR / f"stability-{run_id}.json")
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    printable = {
        "runId": run_id,
        "output": str(out_path),
        "folds": args.folds,
        "seeds": seeds,
        "methods": {
            method: {
                "accuracy": stats["accuracy"],
                "macroF1": stats["macroF1"],
            }
            for method, stats in summary["methods"].items()
        },
    }
    print(json.dumps(printable, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
