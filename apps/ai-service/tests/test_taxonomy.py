"""The Python taxonomy must stay in lock-step with the shared TypeScript one.

Slugs are persisted in PostgreSQL (system categories) and returned by the API,
so a drift between the two definitions would silently break category mapping.
Names may differ (the API uses friendlier labels); slugs and types may not.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.taxonomy import EXPENSE_LABELS, INCOME_LABELS, LABELS, TAXONOMY

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]


def shared_types_taxonomy() -> list[tuple[str, str]]:
    source = (REPO_ROOT / "packages" / "shared-types" / "src" / "index.ts").read_text(
        encoding="utf-8"
    )
    block = re.search(r"AI_TAXONOMY[^=]*=\s*\[(.*?)\]\s*as const;", source, re.S)
    assert block, "AI_TAXONOMY block not found in shared-types"
    return re.findall(r"slug:\s*'([^']+)'[^}]*?type:\s*'([A-Z]+)'", block.group(1))


def test_python_and_typescript_taxonomies_match() -> None:
    typescript = shared_types_taxonomy()
    python = [(slug, meta["type"]) for slug, meta in TAXONOMY.items()]
    assert typescript == python


def test_taxonomy_shape() -> None:
    assert len(LABELS) == 11
    assert len(set(LABELS)) == len(LABELS)
    assert len(INCOME_LABELS) == 2
    assert len(EXPENSE_LABELS) == 9
    assert set(INCOME_LABELS) | set(EXPENSE_LABELS) == set(LABELS)
    for slug in LABELS:
        assert re.fullmatch(r"[a-z][a-z_]*", slug), slug
        assert TAXONOMY[slug]["type"] in {"INCOME", "EXPENSE"}
        assert TAXONOMY[slug]["name"].strip()
