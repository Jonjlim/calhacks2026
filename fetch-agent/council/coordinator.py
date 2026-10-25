"""Courier's orchestration of the council.

    archivist ─┬─ muse  ──────────────┐
               └─ scout ── keeper ────┴─ courier

The Courier emits its own `started` / `completed` / `failed` events. Each
specialist emits its own events where its work really happens: inside its
own uAgent (`council.agents.AgentSpecialists`) or, without the agent network,
in-process (`council.roles.LocalSpecialists`). Muse and Scout run
concurrently. A Scout failure does not stop the run: the Keeper still checks
constraints and the Courier explains honestly that no verified listings were
found.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Callable, Protocol

from . import courier
from .contracts import Analysis, DecorationSpec, KeeperReport, Listing, Memory, ScoutReport
from .events import EventSink
from .roles import LocalSpecialists, Researcher, StepFailed

log = logging.getLogger("council")


class Specialists(Protocol):
    async def archivist(self, memories: list[Memory], budget_minor: int | None, room_run: bool) -> Analysis: ...
    async def muse(self, analysis: Analysis, memory_ids: list[str]) -> list[DecorationSpec]: ...
    async def scout(self, analysis: Analysis) -> ScoutReport: ...
    async def keeper(self, analysis: Analysis, listings: list[Listing]) -> KeeperReport: ...


SpecialistsFactory = Callable[[EventSink], Specialists]


@dataclass
class CouncilOutcome:
    reply: str
    analysis: Analysis | None = None
    decorations: list[DecorationSpec] = field(default_factory=list)
    scout: ScoutReport | None = None
    keeper: KeeperReport | None = None
    ok: bool = True


def memory_id_for(text: str) -> str:
    return "mem_" + hashlib.sha256(text.strip().encode()).hexdigest()[:20]


async def run_council(
    memories: list[Memory],
    sink: EventSink,
    research: Researcher | None = None,
    budget_minor: int | None = None,
    room_run: bool = False,
    specialists: SpecialistsFactory | None = None,
) -> CouncilOutcome:
    council: Specialists = specialists(sink) if specialists else LocalSpecialists(sink, research)
    await sink.open()
    await sink.emit("courier", "started", {"summary": f"Coordinating {len(memories)} memor{'y' if len(memories) == 1 else 'ies'}"})
    try:
        try:
            analysis = await council.archivist(memories, budget_minor, room_run)
        except StepFailed:
            await sink.emit("courier", "failed", {"error": "Memory analysis failed"})
            return CouncilOutcome(reply="Sorry — I couldn't read those memories. Could you rephrase them?", ok=False)

        decorations, scouted = await asyncio.gather(council.muse(analysis, [m.memory_id for m in memories]), council.scout(analysis))
        report = await council.keeper(analysis, list(scouted.listings))

        reply = courier.compose(analysis, scouted, report, decorations)
        await sink.results({
            "kept": [{"sourceUrl": v.listing.source_url, "notes": list(v.notes)} for v in report.kept],
            "excluded": [x.model_dump() for x in report.excluded],
            "cached": scouted.cached,
            **({"error": scouted.error[:160]} if scouted.error else {}),
        })
        await sink.emit("courier", "completed" if report.kept else "failed", {"summary": courier.summary(report), "count": len(report.kept)})
        return CouncilOutcome(reply=reply, analysis=analysis, decorations=decorations, scout=scouted, keeper=report)
    except Exception as err:  # last resort: never leave the run hanging in "started"
        log.exception("council run failed")
        await sink.emit("courier", "failed", {"error": f"Run failed: {str(err)[:120]}"})
        return CouncilOutcome(reply="Something went wrong while the council was working. Please try again.", ok=False)
    finally:
        await sink.flush()
