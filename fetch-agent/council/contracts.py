"""Shared council contracts (mirror of lib/council/contracts.ts).

The decoration library is read from the same JSON file the web app uses, so
the coordinator can only ever produce asset IDs, colours, jars and placement
slots that the frontend knows how to render.
"""

from __future__ import annotations

import json
import re
from urllib.parse import urlsplit
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LIBRARY_PATH = Path(__file__).resolve().parents[2] / "lib" / "council" / "library.json"
LIBRARY = json.loads(LIBRARY_PATH.read_text())

Actor = Literal["archivist", "muse", "scout", "keeper", "courier"]
Status = Literal["started", "completed", "failed"]

TASKS: dict[str, str] = {
    "archivist": "analyze_memories",
    "muse": "design_decoration",
    "scout": "research_gifts",
    "keeper": "check_constraints",
    "courier": "deliver_recommendations",
}

ASSET_IDS = {a["id"] for a in LIBRARY["assets"]}
COLORS = set(LIBRARY["colors"])
PLACEMENTS: list[str] = list(LIBRARY["placements"])
JARS = set(LIBRARY["jars"])

_SLUG = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Memory(Strict):
    """One contribution about the recipient (a chat request counts as one memory)."""

    memory_id: str
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("memory_id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not _SLUG.match(v):
            raise ValueError("memory_id must be a 6-64 char slug")
        return v


ClueKind = Literal["interest", "wish", "preference", "ownership", "dislike"]


class Clue(Strict):
    kind: ClueKind
    phrase: str = Field(min_length=1, max_length=80)
    memory_id: str


class Analysis(Strict):
    """Archivist output: structured clues every downstream role reads."""

    recipient: str | None = None
    occasion: str | None = None
    budget_minor: int | None = Field(default=None, ge=0)
    clues: tuple[Clue, ...] = ()
    uncertainties: tuple[str, ...] = ()

    def of(self, *kinds: str) -> list[Clue]:
        return [c for c in self.clues if c.kind in kinds]


class DecorationSpec(Strict):
    memoryId: str
    jar: str
    assetId: str
    color: str
    placement: str
    label: str = Field(min_length=1, max_length=32)

    @field_validator("memoryId")
    @classmethod
    def _memory(cls, v: str) -> str:
        if not _SLUG.match(v):
            raise ValueError("memoryId must be a 6-64 char slug")
        return v

    @field_validator("jar")
    @classmethod
    def _jar(cls, v: str) -> str:
        if v not in JARS:
            raise ValueError(f"unknown jar {v}")
        return v

    @field_validator("assetId")
    @classmethod
    def _asset(cls, v: str) -> str:
        if v not in ASSET_IDS:
            raise ValueError(f"unapproved asset {v}")
        return v

    @field_validator("color")
    @classmethod
    def _color(cls, v: str) -> str:
        if v not in COLORS:
            raise ValueError(f"unknown colour {v}")
        return v

    @field_validator("placement")
    @classmethod
    def _placement(cls, v: str) -> str:
        if v not in PLACEMENTS:
            raise ValueError(f"unknown placement {v}")
        return v


class Listing(Strict):
    """A real, observed product listing. Never constructed from model output."""

    title: str
    source_url: str
    price_minor: int | None = None
    price_status: Literal["observed", "unknown"] = "unknown"
    currency: Literal["USD"] = "USD"
    seller: str | None = None
    image_url: str | None = None
    retrieved_at: int
    explanation: str | None = None

    @field_validator("source_url")
    @classmethod
    def _url(cls, v: str) -> str:
        # Real shopping links can carry raw spaces in their query (e.g. q=pottery class);
        # keep them byte-identical (Convex matches approvals by exact URL), but require https + a host.
        parts = urlsplit(v)
        if parts.scheme != "https" or not parts.hostname or any(c in parts.netloc for c in " \t\n"):
            raise ValueError("listings need an https source URL")
        return v


class Verdict(Strict):
    listing: Listing
    notes: tuple[str, ...] = ()


class Exclusion(Strict):
    title: str
    reason: str


class KeeperReport(Strict):
    kept: tuple[Verdict, ...] = ()
    excluded: tuple[Exclusion, ...] = ()
    hard_rules: tuple[str, ...] = ()
    soft_notes: tuple[str, ...] = ()


class ScoutReport(Strict):
    listings: tuple[Listing, ...] = ()
    queries: tuple[str, ...] = ()
    source: Literal["convex", "apify", "none"] = "none"
    cached: bool = False
    error: str | None = None
