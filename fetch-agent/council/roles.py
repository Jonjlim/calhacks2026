"""Role steps: one role's real work wrapped in its own task events.

The same step runs inside a specialist uAgent (emitting events for its own
actor) and as the Courier's local fallback (muted, because the Courier has
already reported the specialist's failure).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from . import archivist, keeper, muse
from . import scout as scout_mod
from .contracts import Analysis, DecorationSpec, KeeperReport, Listing, Memory, ScoutReport
from .events import EventSink

log = logging.getLogger("council.roles")

Researcher = Callable[[Analysis], Awaitable[ScoutReport]]


class StepFailed(Exception):
    """The role failed and has already reported it."""


class RoleSink:
    """Emits events for one actor; `live()` turning False silences late events."""

    def __init__(self, sink: EventSink | None, actor: str, live: Callable[[], bool] = lambda: True):
        self.sink = sink
        self.actor = actor
        self.live = live

    async def emit(self, status: str, result: dict[str, Any] | None = None) -> None:
        if self.sink is not None and self.live():
            await self.sink.emit(self.actor, status, result)


def muted(actor: str) -> RoleSink:
    return RoleSink(None, actor)


async def archivist_step(rs: RoleSink, memories: list[Memory], budget_minor: int | None = None, room_run: bool = False) -> Analysis:
    await rs.emit("started")
    try:
        analysis = await archivist.analyze(memories)
        if room_run and budget_minor is not None:
            # The room's explicit budget wins; otherwise keep what the Archivist read.
            analysis = analysis.model_copy(update={"budget_minor": budget_minor})
    except Exception as err:
        log.exception("archivist failed")
        await rs.emit("failed", {"error": f"Could not read the memories: {err}"})
        raise StepFailed(str(err)) from err
    await rs.emit("completed", {"summary": archivist.summary(analysis), "count": len(analysis.clues)})
    return analysis


async def muse_step(rs: RoleSink, analysis: Analysis, memory_ids: list[str]) -> list[DecorationSpec]:
    await rs.emit("started")
    try:
        specs = await muse.design_with_model(analysis, memory_ids)
    except Exception as err:
        await rs.emit("failed", {"error": f"Decoration design failed: {err}"})
        return []
    if not specs:
        await rs.emit("failed", {"error": "No memory clue to turn into a charm yet"})
        return []
    await rs.emit("completed", {"summary": ", ".join(f"{d.label} charm" for d in specs), "decorations": [d.model_dump() for d in specs]})
    return specs


async def scout_step(rs: RoleSink, analysis: Analysis, research: Researcher) -> ScoutReport:
    await rs.emit("started")
    try:
        report = await asyncio.wait_for(research(analysis), timeout=scout_mod.RESEARCH_TIMEOUT_S + 10)
    except asyncio.TimeoutError:
        report = ScoutReport(queries=tuple(scout_mod.queries_for(analysis)), error="Research timed out.")
    except Exception as err:
        report = ScoutReport(queries=tuple(scout_mod.queries_for(analysis)), error=f"Research failed: {str(err)[:120]}")
    if report.listings:
        await rs.emit("completed", {"summary": f"Found {len(report.listings)} real listings" + (f" for {', '.join(report.queries)}" if report.queries else ""), "count": len(report.listings), "cached": report.cached})
    else:
        await rs.emit("failed", {"error": report.error or "No listings found", "cached": report.cached})
    return report


async def keeper_step(rs: RoleSink, analysis: Analysis, listings: list[Listing]) -> KeeperReport:
    await rs.emit("started")
    try:
        report = keeper.check(analysis, listings)
        report = await keeper.explain_with_model(analysis, report)
    except Exception as err:
        await rs.emit("failed", {"error": f"Constraint check failed: {err}"})
        return KeeperReport()
    await rs.emit("completed", {"summary": keeper.summary(report), "count": len(report.kept)})
    return report


class LocalSpecialists:
    """All four specialists as in-process function calls (tests, and before the agents are up)."""

    def __init__(self, sink: EventSink, research: Researcher | None = None):
        self.sink = sink
        self.research = research

    async def archivist(self, memories: list[Memory], budget_minor: int | None, room_run: bool) -> Analysis:
        return await archivist_step(RoleSink(self.sink, "archivist"), memories, budget_minor, room_run)

    async def muse(self, analysis: Analysis, memory_ids: list[str]) -> list[DecorationSpec]:
        return await muse_step(RoleSink(self.sink, "muse"), analysis, memory_ids)

    async def scout(self, analysis: Analysis) -> ScoutReport:
        # Looked up at call time so a patched scout.research is honoured.
        return await scout_step(RoleSink(self.sink, "scout"), analysis, self.research or scout_mod.research_for(self.sink.run_id))

    async def keeper(self, analysis: Analysis, listings: list[Listing]) -> KeeperReport:
        return await keeper_step(RoleSink(self.sink, "keeper"), analysis, listings)
