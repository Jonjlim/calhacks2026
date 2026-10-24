"""Muse — memory → symbolic gift decoration.

Turns each memory's clues into a DecorationSpec chosen from the approved
library (lib/council/library.json): a pottery memory becomes a terracotta
ceramic charm, a reading memory a little book, and so on. It never invents
assets; anything unmatched becomes the library's fallback memory charm.
Placement is a stable function of the memory, so re-running a memory always
asks for the same slot (Convex resolves any collision when it persists).
"""

from __future__ import annotations

import hashlib
import re

from .contracts import LIBRARY, PLACEMENTS, Analysis, Clue, DecorationSpec

_ASSETS = LIBRARY["assets"]
_FALLBACK = next(a for a in _ASSETS if a["id"] == LIBRARY["fallbackAsset"])


def _words(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower())}


def pick_asset(clues: list[Clue]) -> dict:
    """Best library asset for these clues; wishes count double, then interests, then preferences."""
    weight = {"wish": 2.0, "interest": 1.5, "preference": 1.0}
    best, best_score = _FALLBACK, 0.0
    for asset in _ASSETS:
        keys = {k.rstrip("s") for k in asset["keywords"]}
        if not keys:
            continue
        score = sum(weight.get(c.kind, 0) for c in clues if keys & _words(c.phrase))
        if score > best_score:
            best, best_score = asset, score
    return best


def jar_for(clues: list[Clue]) -> str:
    kinds = {c.kind for c in clues}
    if "wish" in kinds:
        return "wish"
    if kinds & {"interest", "preference"}:
        return "interest"
    return "moment"


def placement_for(memory_id: str) -> str:
    digest = hashlib.sha256(memory_id.encode()).digest()
    return PLACEMENTS[digest[0] % len(PLACEMENTS)]


def design(analysis: Analysis, memory_ids: list[str]) -> list[DecorationSpec]:
    """One validated decoration per memory that carries positive clues."""
    specs: list[DecorationSpec] = []
    for mid in memory_ids:
        clues = [c for c in analysis.clues if c.memory_id == mid and c.kind in ("wish", "interest", "preference")]
        if not clues:
            continue
        asset = pick_asset(clues)
        specs.append(
            DecorationSpec(
                memoryId=mid,
                jar=jar_for(clues),
                assetId=asset["id"],
                color=asset["color"],
                placement=placement_for(mid),
                label=asset["label"],
            )
        )
    return specs
