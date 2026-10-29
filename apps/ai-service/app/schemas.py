from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ClassifyRequest(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    type: Literal["INCOME", "EXPENSE"]

    @field_validator("description")
    @classmethod
    def description_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("description không được để trống")
        return cleaned


class BatchClassifyRequest(BaseModel):
    items: list[ClassifyRequest] = Field(min_length=1, max_length=50)


class Alternative(BaseModel):
    label: str
    confidence: float


class ClassifyResponse(BaseModel):
    label: str
    confidence: float
    isConfident: bool
    alternatives: list[Alternative]
    modelName: str
    modelVersion: str


class BatchClassifyResponse(BaseModel):
    results: list[ClassifyResponse]
