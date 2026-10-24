"""Courier's orchestration of the five-role council.

    archivist ─┬─ muse  ──────────────┐
               └─ scout ── keeper ────┴─ courier

Each role emits `started` when it really begins and `completed` / `failed`
when it really ends. Muse and Scout are independent and run concurrently.
A Scout failure does not stop the run: the Keeper still checks constraints
and the Courier explains honestly that no verified listings were found.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from . import archivist, courier, keeper, muse
from . import scout as scout_mod
from .contracts import Analysis, DecorationSpec, KeeperReport, Memory, ScoutReport
from .events import EventSink

log = logging.getLogger("council")

Researcher = Callable[[Analysis], Awaitable[ScoutReport]]


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


async def run_council(memories: list[Memory], sink: EventSink, research: Researcher | None = None, budget_minor: int | None = None, room_run: bool = False) -> CouncilOutcome:
    research = research or scout_mod.research
    await sink.open()
    await sink.emit("courier", "started", {"summary": f"Coordinating {len(memories)} memor{'y' if len(memories) == 1 else 'ies'}"})
    try:
        # --- Archivist ---------------------------------------------------------
        await sink.emit("archivist", "started")
        try:
            analysis = await archivist.analyze(memories)
            if room_run:
                analysis = analysis.model_copy(update={"budget_minor": budget_minor})
        except Exception as err:
            log.exception("archivist failed")
            await sink.emit("archivist", "failed", {"error": f"Could not read the memories: {err}"})
            await sink.emit("courier", "failed", {"error": "Memory analysis failed"})
            return CouncilOutcome(reply="Sorry — I couldn't read those memories. Could you rephrase them?", ok=False)
        await sink.emit("archivist", "completed", {"summary": archivist.summary(analysis), "count": len(analysis.clues)})

        # --- Muse and Scout, concurrently --------------------------------------
        async def run_muse() -> list[DecorationSpec]:
            await sink.emit("muse", "started")
            try:
                specs = muse.design(analysis, [m.memory_id for m in memories])
            except Exception as err:
                await sink.emit("muse", "failed", {"error": f"Decoration design failed: {err}"})
                return []
            if not specs:
                await sink.emit("muse", "failed", {"error": "No memory clue to turn into a charm yet"})
                return []
            await sink.emit("muse", "completed", {"summary": ", ".join(f"{d.label} charm" for d in specs), "decorations": [d.model_dump() for d in specs]})
            return specs

        async def run_scout() -> ScoutReport:
            await sink.emit("scout", "started")
            try:
                report = await asyncio.wait_for(research(analysis), timeout=scout_mod.RESEARCH_TIMEOUT_S + 10)
            except asyncio.TimeoutError:
                report = ScoutReport(queries=tuple(scout_mod.queries_for(analysis)), error="Research timed out.")
            except Exception as err:
                report = ScoutReport(queries=tuple(scout_mod.queries_for(analysis)), error=f"Research failed: {str(err)[:120]}")
            if report.listings:
                await sink.emit("scout", "completed", {"summary": f"Found {len(report.listings)} real listings" + (f" for {', '.join(report.queries)}" if report.queries else ""), "count": len(report.listings), "cached": report.cached})
            else:
                await sink.emit("scout", "failed", {"error": report.error or "No listings found", "cached": report.cached})
            return report

        decorations, scouted = await asyncio.gather(run_muse(), run_scout())

        # --- Keeper ------------------------------------------------------------
        await sink.emit("keeper", "started")
        try:
            report = keeper.check(analysis, list(scouted.listings))
        except Exception as err:
            await sink.emit("keeper", "failed", {"error": f"Constraint check failed: {err}"})
            report = KeeperReport()
        else:
            await sink.emit("keeper", "completed", {"summary": keeper.summary(report), "count": len(report.kept)})

        # --- Courier -------------------------------------------------------------
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
