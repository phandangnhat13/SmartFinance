"""FastAPI service for transaction category classification."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException

from .classifier import Classifier
from .schemas import (
    BatchClassifyRequest,
    BatchClassifyResponse,
    ClassifyRequest,
    ClassifyResponse,
)

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.environ.get("AI_MODEL_DIR", BASE_DIR / "models"))
DATASET_PATH = Path(os.environ.get("AI_DATASET_PATH", BASE_DIR / "data" / "training_data.csv"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    classifier = Classifier(MODEL_DIR, DATASET_PATH)
    classifier.load_or_train()
    app.state.classifier = classifier
    yield


app = FastAPI(
    title="Smart Finance AI Service",
    version="0.1.0",
    description=(
        "Dịch vụ phân loại mô tả giao dịch. Kết quả chỉ là đề xuất, người dùng "
        "luôn có thể chấp nhận hoặc sửa lại trong ứng dụng."
    ),
    lifespan=lifespan,
)


def get_classifier() -> Classifier:
    classifier: Classifier = app.state.classifier
    return classifier


@app.get("/health")
def health() -> dict:
    classifier = get_classifier()
    return {
        "status": "ok" if classifier.ready else "degraded",
        "modelReady": classifier.ready,
        "modelVersion": (
            classifier.artifact["modelVersion"] if classifier.artifact else None
        ),
        "error": classifier.error,
    }


@app.get("/model-info")
def model_info() -> dict:
    return get_classifier().model_info()


@app.post("/classify", response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> dict:
    classifier = get_classifier()
    if not classifier.ready:
        raise HTTPException(status_code=503, detail="model_not_ready")
    return classifier.predict(request.description, request.type)


@app.post("/classify/batch", response_model=BatchClassifyResponse)
def classify_batch(request: BatchClassifyRequest) -> dict:
    classifier = get_classifier()
    if not classifier.ready:
        raise HTTPException(status_code=503, detail="model_not_ready")
    results = [
        classifier.predict(item.description, item.type) for item in request.items
    ]
    return {"results": results}
