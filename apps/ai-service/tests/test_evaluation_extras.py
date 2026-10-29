"""Calibration, error-analysis and stability helpers.

These functions feed the evaluation report, so mistakes here would show up as
misleading numbers. They are tested with hand-computed values.
"""

from __future__ import annotations

import pytest

from scripts.evaluate_models import calibration_report, error_analysis
from scripts.stability import describe


def test_calibration_is_zero_for_perfectly_calibrated_predictions() -> None:
    report = calibration_report(
        truth=["food", "food", "transport", "transport"],
        predictions=["food", "food", "transport", "transport"],
        confidences=[0.9, 0.9, 0.9, 0.9],
        bins=10,
    )
    # All four predictions are correct and all share the 0.9 confidence bin, so
    # empirical accuracy (1.0) is not equal to mean confidence (0.9) -- a small
    # ECE is expected. A bin whose accuracy equals its confidence has zero gap.
    assert report["expectedCalibrationError"] == pytest.approx(0.1, abs=1e-4)
    assert report["brierScore"] == pytest.approx(0.01, abs=1e-4)

    perfect = calibration_report(
        truth=["food", "transport"],
        predictions=["food", "transport"],
        confidences=[1.0, 1.0],
        bins=10,
    )
    assert perfect["expectedCalibrationError"] == pytest.approx(0.0, abs=1e-4)
    assert perfect["brierScore"] == pytest.approx(0.0, abs=1e-4)


def test_calibration_detects_overconfidence() -> None:
    report = calibration_report(
        truth=["food", "transport", "food", "transport"],
        predictions=["food", "food", "transport", "transport"],
        confidences=[0.9, 0.9, 0.9, 0.9],
        bins=10,
    )
    # Every row lands in the 0.9 bin; half are correct, so accuracy 0.5.
    assert report["expectedCalibrationError"] == pytest.approx(0.4, abs=1e-4)
    assert report["brierScore"] == pytest.approx(0.41, abs=1e-4)
    populated = [row for row in report["table"] if row["count"]]
    assert populated == [
        {
            "lower": 0.9,
            "upper": 1.0,
            "count": 4,
            "accuracy": 0.5,
            "avgConfidence": 0.9,
        }
    ]


def test_calibration_handles_empty_input() -> None:
    report = calibration_report([], [], [], bins=10)
    assert report["expectedCalibrationError"] is None
    assert report["brierScore"] is None
    assert report["table"] == []


def test_error_analysis_counts_pairs_and_labels() -> None:
    report = error_analysis(
        truth=["food", "food", "salary"],
        predictions=["food", "transport", "food"],
        confidences=[0.9, 0.6, 0.55],
        descriptions=["cà phê", "ăn tối", "nhận lương"],
        max_examples=2,
    )
    assert report["misclassified"] == 2
    assert report["total"] == 3
    assert report["confusionPairs"] == [
        {"trueLabel": "food", "predictedLabel": "transport", "count": 1},
        {"trueLabel": "salary", "predictedLabel": "food", "count": 1},
    ]
    food = next(row for row in report["perLabel"] if row["label"] == "food")
    assert food == {"label": "food", "support": 2, "errors": 1, "errorRate": 0.5}
    assert [example["text"] for example in report["examples"]] == ["ăn tối", "nhận lương"]
    assert report["examples"][0]["confidence"] == 0.6


def test_error_analysis_respects_example_cap() -> None:
    report = error_analysis(
        truth=["food"] * 5,
        predictions=["transport"] * 5,
        confidences=[0.4] * 5,
        descriptions=[f"row {index}" for index in range(5)],
        max_examples=2,
    )
    assert len(report["examples"]) == 2


def test_stability_describe_reports_spread() -> None:
    stats = describe([1.0, 0.5])
    assert stats["mean"] == 0.75
    assert stats["std"] == pytest.approx(0.3536, abs=1e-4)
    assert stats["min"] == 0.5
    assert stats["max"] == 1.0
    assert stats["n"] == 2

    single = describe([0.7])
    assert single["std"] == 0.0
