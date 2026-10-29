from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_model() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["modelReady"] is True
        assert body["status"] == "ok"


def test_classify_expense() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/classify",
            json={"description": "grab bike đi làm buổi sáng", "type": "EXPENSE"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["label"] == "transport"
        assert 0 <= body["confidence"] <= 1
        assert body["alternatives"]


def test_classify_respects_type() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/classify",
            json={"description": "nhận lương tháng 10", "type": "INCOME"},
        )
        assert response.status_code == 200
        assert response.json()["label"] == "salary"


def test_batch_and_validation() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/classify/batch",
            json={
                "items": [
                    {"description": "ăn phở bò", "type": "EXPENSE"},
                    {"description": "đổ xăng xe máy", "type": "EXPENSE"},
                ]
            },
        )
        assert response.status_code == 200
        assert len(response.json()["results"]) == 2

        invalid = client.post(
            "/classify",
            json={"description": "   ", "type": "EXPENSE"},
        )
        assert invalid.status_code == 422
