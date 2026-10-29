"""Metric, threshold-selection and keyword-baseline helpers.

These are pure functions, so they are exercised without fitting a model. They
guard the parts of the protocol that are easy to get wrong: type-aware labels,
coverage/risk bookkeeping and choosing the threshold on validation only.
"""

from __future__ import annotations

import pytest

from scripts.evaluate_models import (
    LABELS,
    at_threshold,
    build_keyword_rules,
    choose_threshold,
    classify_keyword,
    metrics,
    selective_curve,
)


def rows(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"description": text, "label": label} for text, label in pairs]


def test_selective_curve_tracks_coverage_and_risk() -> None:
    curve = selective_curve(
        truth=["food", "food"],
        predictions=["food", "transport"],
        confidences=[0.9, 0.4],
    )
    by_threshold = {point["threshold"]: point for point in curve}

    assert by_threshold[0.0]["coverage"] == 1.0
    assert by_threshold[0.0]["selectiveAccuracy"] == 0.5
    assert by_threshold[0.5]["coverage"] == 0.5
    assert by_threshold[0.5]["selectiveAccuracy"] == 1.0
    assert by_threshold[0.5]["selectiveRisk"] == 0.0
    assert by_threshold[0.95]["coverage"] == 0.0
    assert by_threshold[0.95]["selectiveAccuracy"] is None

    coverages = [point["coverage"] for point in curve]
    assert coverages == sorted(coverages, reverse=True)


def test_choose_threshold_prefers_coverage_above_target() -> None:
    curve = [
        {"threshold": 0.1, "coverage": 0.9, "selectiveAccuracy": 0.7, "selectiveRisk": 0.3},
        {"threshold": 0.3, "coverage": 0.6, "selectiveAccuracy": 0.82, "selectiveRisk": 0.18},
        {"threshold": 0.5, "coverage": 0.4, "selectiveAccuracy": 0.9, "selectiveRisk": 0.1},
        {"threshold": 0.7, "coverage": 0.1, "selectiveAccuracy": 0.95, "selectiveRisk": 0.05},
    ]
    choice = choose_threshold(curve, target=0.8)
    assert choice["threshold"] == 0.3
    assert choice["validationCoverage"] == 0.6
    assert "selective accuracy >= 0.8" in choice["reason"]


def test_choose_threshold_falls_back_when_target_unreachable() -> None:
    curve = [
        {"threshold": 0.1, "coverage": 0.9, "selectiveAccuracy": 0.5, "selectiveRisk": 0.5},
        {"threshold": 0.5, "coverage": 0.2, "selectiveAccuracy": 0.75, "selectiveRisk": 0.25},
        {"threshold": 0.9, "coverage": 0.0, "selectiveAccuracy": None, "selectiveRisk": None},
    ]
    choice = choose_threshold(curve, target=0.95)
    assert choice["threshold"] == 0.1
    assert "no threshold met the target" in choice["reason"]


def test_at_threshold_handles_empty_selection() -> None:
    result = at_threshold(
        truth=["food"], predictions=["food"], confidences=[0.4], threshold=0.5
    )
    assert result["coverage"] == 0.0
    assert result["selectiveAccuracy"] is None
    assert result["acceptedCount"] == 0

    selected = at_threshold(
        truth=["food", "salary"],
        predictions=["food", "food"],
        confidences=[0.8, 0.9],
        threshold=0.5,
    )
    assert selected["coverage"] == 1.0
    assert selected["selectiveAccuracy"] == 0.5
    assert selected["selectiveRisk"] == 0.5


def test_metrics_reports_every_taxonomy_label() -> None:
    result = metrics(["food", "food", "salary"], ["food", "transport", "salary"])
    assert len(result["perClass"]) == len(LABELS)
    assert {row["label"] for row in result["perClass"]} == set(LABELS)
    assert sum(row["support"] for row in result["perClass"]) == 3

    matrix = result["confusionMatrix"]
    assert matrix["labels"] == LABELS
    assert len(matrix["matrix"]) == len(LABELS)
    assert all(len(row) == len(LABELS) for row in matrix["matrix"])
    assert sum(sum(row) for row in matrix["matrix"]) == 3
    assert 0 <= result["accuracy"] <= 1
    assert 0 <= result["macroF1"] <= 1
    assert 0 <= result["weightedF1"] <= 1


def test_keyword_rules_need_repeated_phrases() -> None:
    rules = build_keyword_rules(
        rows(
            ("cà phê sáng", "food"),
            ("cà phê chiều", "food"),
            ("đổ xăng xe máy", "transport"),
        )
    )
    food_phrases = {phrase for phrase, _ in rules["food"]}
    transport_phrases = {phrase for phrase, _ in rules["transport"]}
    assert "ca phe" in food_phrases
    # A phrase seen in a single training document is not a rule.
    assert "do xang" not in transport_phrases
    assert all(weight >= 0 for _, weight in rules["food"])


def test_keyword_classifier_is_type_aware_and_falls_back() -> None:
    rules = build_keyword_rules(
        rows(
            ("cà phê sáng", "food"),
            ("cà phê chiều", "food"),
            ("lương tháng mười", "salary"),
            ("lương tháng chín", "salary"),
        )
    )

    label, confidence = classify_keyword("cà phê sáng", "EXPENSE", rules)
    assert label == "food"
    assert 0.4 <= confidence <= 0.95

    # The food phrase must not leak into an INCOME prediction.
    label, _ = classify_keyword("cà phê sáng", "INCOME", rules)
    assert label in {"salary", "income_other"}

    assert classify_keyword("xyz qwerty", "EXPENSE", rules) == ("other", pytest.approx(0.2))
    assert classify_keyword("xyz qwerty", "INCOME", rules)[0] == "income_other"
