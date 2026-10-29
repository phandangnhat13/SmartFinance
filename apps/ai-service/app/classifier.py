"""Classifier wrapper used by the FastAPI application."""

from __future__ import annotations

import logging
from pathlib import Path

import joblib

from .taxonomy import CONFIDENCE_THRESHOLD, TAXONOMY
from .training import predict_proba_for_label, save_artifact, train_and_evaluate

logger = logging.getLogger(__name__)


class Classifier:
    def __init__(self, model_dir: Path, dataset_path: Path) -> None:
        self.model_dir = model_dir
        self.dataset_path = dataset_path
        self.artifact: dict | None = None
        self.error: str | None = None

    @property
    def ready(self) -> bool:
        return self.artifact is not None

    def load_or_train(self) -> None:
        model_path = self.model_dir / "model.joblib"
        try:
            if model_path.exists():
                self.artifact = joblib.load(model_path)
                logger.info("Loaded classifier artifact from %s", model_path)
                return
            if not self.dataset_path.exists():
                raise FileNotFoundError(
                    f"Model artifact and dataset are both missing ({model_path}, {self.dataset_path})"
                )
            logger.info("No artifact found - training on %s", self.dataset_path)
            self.artifact = train_and_evaluate(self.dataset_path)
            save_artifact(self.artifact, self.model_dir)
        except Exception as error:  # noqa: BLE001 - reported through /health
            self.error = str(error)
            logger.exception("Classifier could not be initialised")

    @property
    def threshold(self) -> float:
        if self.artifact is None:
            return CONFIDENCE_THRESHOLD
        return float(self.artifact.get("threshold", CONFIDENCE_THRESHOLD))

    def predict(self, description: str, transaction_type: str) -> dict:
        if self.artifact is None:
            raise RuntimeError("model_not_ready")
        pipeline = self.artifact["pipeline"]
        probabilities = predict_proba_for_label(pipeline, description)
        allowed = [
            slug
            for slug, meta in TAXONOMY.items()
            if meta["type"] == transaction_type
        ]
        filtered = {slug: probabilities.get(slug, 0.0) for slug in allowed}
        total = sum(filtered.values())
        if total <= 0:
            filtered = {slug: 1.0 / len(allowed) for slug in allowed}
        else:
            filtered = {slug: value / total for slug, value in filtered.items()}
        ranked = sorted(filtered.items(), key=lambda item: item[1], reverse=True)
        label, confidence = ranked[0]
        alternatives = [
            {"label": slug, "confidence": round(value, 4)} for slug, value in ranked[:3]
        ]
        return {
            "label": label,
            "confidence": round(confidence, 4),
            "isConfident": confidence >= self.threshold,
            "alternatives": alternatives,
            "modelName": self.artifact["modelName"],
            "modelVersion": self.artifact["modelVersion"],
        }

    def model_info(self) -> dict:
        if self.artifact is None:
            return {
                "modelName": None,
                "modelVersion": None,
                "trainedAt": None,
                "threshold": CONFIDENCE_THRESHOLD,
                "labels": [],
                "metrics": None,
                "dataset": None,
                "ready": False,
                "error": self.error,
            }
        return {
            "modelName": self.artifact["modelName"],
            "modelVersion": self.artifact["modelVersion"],
            "trainedAt": self.artifact["trainedAt"],
            "threshold": self.threshold,
            "labels": self.artifact["labels"],
            "metrics": self.artifact.get("metrics"),
            "dataset": self.artifact.get("dataset"),
            "ready": True,
            "error": None,
        }
