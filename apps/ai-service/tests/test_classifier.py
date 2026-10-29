"""Serving artifact and classifier behaviour.

The artifact under ``models/`` is the one the API actually consumes, so these
tests assert that it carries the metadata the docs promise: a threshold chosen
on validation, dataset provenance and evaluation metrics for the exact version.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.classifier import Classifier
from app.taxonomy import CONFIDENCE_THRESHOLD, EXPENSE_LABELS, INCOME_LABELS, TAXONOMY

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"


@pytest.fixture(scope="module")
def classifier() -> Classifier:
    instance = Classifier(MODEL_DIR, ROOT / "data" / "training_data.csv")
    instance.load_or_train()
    return instance


def test_artifact_loads_with_provenance(classifier: Classifier) -> None:
    assert classifier.ready is True
    assert classifier.error is None
    artifact = classifier.artifact
    assert artifact is not None

    metrics_file = json.loads((MODEL_DIR / "metrics.json").read_text(encoding="utf-8"))
    selection = json.loads((MODEL_DIR / "selection.json").read_text(encoding="utf-8"))

    assert artifact["modelName"] == metrics_file["modelName"] == selection["modelName"]
    assert artifact["modelVersion"] == metrics_file["modelVersion"] == selection["modelVersion"]
    assert artifact["threshold"] == metrics_file["threshold"] == selection["threshold"]
    assert 0 < artifact["threshold"] <= 1

    dataset = artifact["dataset"]
    assert len(dataset["fingerprint"]) == 64
    assert set(dataset["fingerprint"]) <= set("0123456789abcdef")
    # The deployable model is fit on train + validation; test and paraphrase are
    # recorded for provenance but never used for fitting.
    splits = dataset["splits"]
    assert dataset["size"] == splits["train"] + splits["validation"]

    metrics = artifact["metrics"]
    assert 0 <= metrics["accuracy"] <= 1
    assert 0 <= metrics["macroF1"] <= 1
    assert metrics["validation"] is not None
    assert "held-out" in metrics["protocol"]


def test_classifier_threshold_comes_from_artifact(classifier: Classifier) -> None:
    assert classifier.artifact is not None
    assert classifier.threshold == classifier.artifact["threshold"]
    info = classifier.model_info()
    assert info["ready"] is True
    assert info["threshold"] == classifier.threshold
    assert set(info["labels"]) == set(TAXONOMY)
    assert info["metrics"]["accuracy"] == classifier.artifact["metrics"]["accuracy"]


def test_predict_is_type_aware(classifier: Classifier) -> None:
    expense = classifier.predict("cà phê sáng", "EXPENSE")
    assert expense["label"] in EXPENSE_LABELS
    assert 0 < expense["confidence"] <= 1
    assert len(expense["alternatives"]) == 3
    confidences = [item["confidence"] for item in expense["alternatives"]]
    assert confidences == sorted(confidences, reverse=True)
    assert all(item["label"] in EXPENSE_LABELS for item in expense["alternatives"])

    income = classifier.predict("nhận lương tháng 10", "INCOME")
    assert income["label"] in INCOME_LABELS
    assert all(item["label"] in INCOME_LABELS for item in income["alternatives"])


def test_is_confident_uses_selected_threshold(classifier: Classifier) -> None:
    result = classifier.predict("ăn phở bò", "EXPENSE")
    assert result["isConfident"] == (result["confidence"] >= classifier.threshold)
    assert result["modelName"] == "tfidf-char-logreg"
    assert result["modelVersion"] == "tfidf-char-lr-v2"


def test_unloaded_classifier_defaults_and_refuses() -> None:
    empty = Classifier(MODEL_DIR, ROOT / "data" / "training_data.csv")
    assert empty.ready is False
    assert empty.threshold == CONFIDENCE_THRESHOLD
    with pytest.raises(RuntimeError, match="model_not_ready"):
        empty.predict("cà phê", "EXPENSE")
    info = empty.model_info()
    assert info["ready"] is False
    assert info["threshold"] == CONFIDENCE_THRESHOLD
