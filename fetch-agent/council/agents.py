"""The council's specialist uAgents and the Courier's client for them.

Archivist, Muse, Scout and Keeper are separate registered agents, each with
its own seed, address, README and protocol. The Courier asks them with
`ctx.send_and_receive`. If a specialist does not answer in time (or answers
with something invalid) the Courier reports that specialist as failed and
uses its local function instead, so a run never hangs on one agent.

Events: every agent of a run shares one EventSink when they live in the same
process (one Bureau), which keeps the per-run sequence numbers unique. A
specialist reached in another process opens its own sink for the run.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Callable

from uagents import Agent, Context, Protocol
from uagents_core.identity import Identity

from . import scout as scout_mod
from .contracts import Analysis, DecorationSpec, KeeperReport, Listing, Memory, ScoutReport
from .events import EventSink, sink_for
from .messages import (
    ArchivistRequest,
    ArchivistResult,
    KeeperRequest,
    KeeperResult,
    MemoryPayload,
    MuseRequest,
    MuseResult,
    RoleRequest,
    ScoutRequest,
    ScoutResult,
)
from .roles import RoleSink, StepFailed, archivist_step, keeper_step, muse_step, muted, scout_step

log = logging.getLogger("council.agents")

SPECIALISTS = ("archivist", "muse", "scout", "keeper")
ROLES = ("courier",) + SPECIALISTS
README_DIR = Path(__file__).resolve().parents[1] / "readmes"

DESCRIPTIONS = {
    "archivist": "Unwrap Archivist: reads memories about a gift recipient into structured clues (interests, wishes, budget, what they own).",
    "muse": "Unwrap Muse: turns a memory into a symbolic charm from Unwrap's approved decoration library.",
    "scout": "Unwrap Scout: researches real product listings with links and observed USD prices.",
    "keeper": "Unwrap Keeper: enforces budget, ownership and dislikes on real listings and explains every exclusion.",
}


def _timeout(name: str, default: float) -> int:
    return max(1, int(float(os.getenv(name, default))))


TIMEOUTS = {
    "archivist": _timeout("COUNCIL_ARCHIVIST_TIMEOUT_S", 25),
    "muse": _timeout("COUNCIL_MUSE_TIMEOUT_S", 20),
    "scout": _timeout("COUNCIL_SCOUT_TIMEOUT_S", scout_mod.RESEARCH_TIMEOUT_S + 20),
    "keeper": _timeout("COUNCIL_KEEPER_TIMEOUT_S", 20),
}


def seed_for(role: str, base: str | None = None) -> str:
    """`<ROLE>_SEED` if set, otherwise derived from AGENT_SEED.

    The Courier uses AGENT_SEED itself so it keeps the address the single
    coordinator agent was registered with.
    """
    explicit = os.getenv(f"{role.upper()}_SEED")
    if explicit:
        return explicit
    base = base or os.getenv("AGENT_SEED")
    if not base:
        raise RuntimeError("AGENT_SEED is not set. Put a long, private random phrase in fetch-agent/.env (see .env.example).")
    return base if role == "courier" else f"{base}::unwrap-council::{role}"


def address_for(role: str, base: str | None = None) -> str:
    return Identity.from_seed(seed_for(role, base), 0).address


# --- Shared run state (one process) --------------------------------------------

_active_sinks: dict[str, EventSink] = {}
_abandoned: set[tuple[str, str]] = set()


def register_run(sink: EventSink) -> None:
    _active_sinks[sink.run_id] = sink


def finish_run(run_id: str) -> None:
    _active_sinks.pop(run_id, None)
    for key in [k for k in _abandoned if k[0] == run_id]:
        _abandoned.discard(key)


def abandon(run_id: str, role: str) -> None:
    _abandoned.add((run_id, role))


def is_abandoned(run_id: str, role: str) -> bool:
    return (run_id, role) in _abandoned


async def _sink_for_request(req: RoleRequest) -> tuple[EventSink, bool]:
    shared = _active_sinks.get(req.run_id)
    if shared is not None:
        return shared, False
    sink = sink_for(req.run_id, source=req.source, demo_key=req.demo_key)
    if req.room_run:
        sink.room_run = True  # type: ignore[attr-defined]
    await sink.open()
    return sink, True


# --- Specialist agents -----------------------------------------------------------


def _role_sink(sink: EventSink, req: RoleRequest, role: str) -> RoleSink:
    return RoleSink(sink, role, live=lambda: not is_abandoned(req.run_id, role))


async def _serve(ctx: Context, sender: str, req: RoleRequest, role: str, work: Callable[[RoleSink], Any]) -> None:
    sink, owned = await _sink_for_request(req)
    try:
        result = await work(_role_sink(sink, req, role))
    finally:
        if owned:
            await sink.flush()
    await ctx.send(sender, result)


async def handle_archivist(ctx: Context, sender: str, req: ArchivistRequest) -> None:
    async def work(rs: RoleSink) -> ArchivistResult:
        try:
            memories = [Memory(memory_id=m.memory_id, text=m.text[:2000]) for m in req.memories]
            analysis = await archivist_step(rs, memories, req.budget_minor, req.room_run)
        except StepFailed as err:
            return ArchivistResult(run_id=req.run_id, ok=False, error=str(err)[:160])
        except ValueError as err:
            await rs.emit("failed", {"error": f"Invalid memories: {err}"})
            return ArchivistResult(run_id=req.run_id, ok=False, error=str(err)[:160])
        return ArchivistResult(run_id=req.run_id, ok=True, analysis=analysis.model_dump(mode="json"))

    await _serve(ctx, sender, req, "archivist", work)


async def handle_muse(ctx: Context, sender: str, req: MuseRequest) -> None:
    async def work(rs: RoleSink) -> MuseResult:
        specs = await muse_step(rs, Analysis.model_validate(req.analysis), req.memory_ids)
        return MuseResult(run_id=req.run_id, ok=bool(specs), decorations=[d.model_dump(mode="json") for d in specs])

    await _serve(ctx, sender, req, "muse", work)


async def handle_scout(ctx: Context, sender: str, req: ScoutRequest) -> None:
    analysis = Analysis.model_validate(req.analysis)

    async def room_research(_a: Analysis) -> ScoutReport:
        return await scout_mod.research_room(req.run_id)

    async def work(rs: RoleSink) -> ScoutResult:
        report = await scout_step(rs, analysis, room_research if req.room_run else scout_mod.research_for(req.run_id))
        return ScoutResult(run_id=req.run_id, ok=bool(report.listings), error=report.error, report=report.model_dump(mode="json"))

    await _serve(ctx, sender, req, "scout", work)


async def handle_keeper(ctx: Context, sender: str, req: KeeperRequest) -> None:
    analysis = Analysis.model_validate(req.analysis)
    listings = [Listing.model_validate(x) for x in req.listings]

    async def work(rs: RoleSink) -> KeeperResult:
        report = await keeper_step(rs, analysis, listings)
        return KeeperResult(run_id=req.run_id, ok=True, report=report.model_dump(mode="json"))

    await _serve(ctx, sender, req, "keeper", work)


HANDLERS = {
    "archivist": (ArchivistRequest, ArchivistResult, handle_archivist),
    "muse": (MuseRequest, MuseResult, handle_muse),
    "scout": (ScoutRequest, ScoutResult, handle_scout),
    "keeper": (KeeperRequest, KeeperResult, handle_keeper),
}


AVATAR_BASE = os.getenv("COUNCIL_AVATAR_BASE", "https://raw.githubusercontent.com/Jonjlim/calhacks2026/dev3/fetch-council/public/ai-council/avatars")


def avatar_url(role: str) -> str:
    return f"{AVATAR_BASE.rstrip('/')}/{role}.png"


def build_specialist(role: str, port: int, base_seed: str | None = None) -> Agent:
    request, result, handler = HANDLERS[role]
    agent = Agent(
        name=f"unwrap-council-{role}",
        seed=seed_for(role, base_seed),
        port=port,
        mailbox=True,
        publish_agent_details=True,
        readme_path=str(README_DIR / f"{role}.md"),
        description=DESCRIPTIONS[role],
        avatar_url=avatar_url(role),
        handle_messages_concurrently=True,
    )
    proto = Protocol(name=f"unwrap-council-{role}", version="0.1.0")
    proto.on_message(request, replies={result})(handler)
    agent.include(proto, publish_manifest=True)
    return agent


def build_specialists(port: int, base_seed: str | None = None) -> dict[str, Agent]:
    """Each specialist's port defaults to the shared Bureau port (`<ROLE>_PORT` overrides it)."""
    return {role: build_specialist(role, int(os.getenv(f"{role.upper()}_PORT", port)), base_seed) for role in SPECIALISTS}


# --- The Courier's side ------------------------------------------------------------


class AgentSpecialists:
    """Asks each specialist agent; falls back to the local function after a timeout."""

    def __init__(self, ctx_factory: Callable[[], Any], addresses: dict[str, str], sink: EventSink, source: str = "asi1", demo_key: str | None = None, room_run: bool = False, timeouts: dict[str, int] | None = None):
        self.ctx_factory = ctx_factory
        self.addresses = addresses
        self.sink = sink
        self.scope = {"run_id": sink.run_id, "source": source, "demo_key": demo_key, "room_run": room_run}
        self.timeouts = timeouts or TIMEOUTS

    async def _ask(self, role: str, message: RoleRequest, result_type: type) -> Any | None:
        timeout = self.timeouts[role]
        detail = f"no reply within {timeout}s"
        try:
            # A fresh context per call gives each request its own session, so
            # concurrent runs never collide on a pending response.
            reply, status = await self.ctx_factory().send_and_receive(self.addresses[role], message, response_type=result_type, timeout=timeout)
            if isinstance(reply, result_type) and reply.run_id == message.run_id:
                log.info("[%s] %s agent replied (ok=%s)", message.run_id, role, reply.ok)
                return reply
            if reply is None and getattr(status, "detail", None):
                detail = str(status.detail)[:80]
        except Exception as err:
            detail = str(err)[:80] or type(err).__name__
        await self._fail(role, f"{role.capitalize()} agent did not answer ({detail}); the Courier used its local fallback.")
        return None

    async def _fail(self, role: str, error: str) -> None:
        abandon(self.sink.run_id, role)
        log.warning("[%s] %s", self.sink.run_id, error)
        # Convex validates event results strictly, so the fallback is described in `error` only.
        await self.sink.emit(role, "failed", {"error": error})

    async def archivist(self, memories: list[Memory], budget_minor: int | None, room_run: bool) -> Analysis:
        msg = ArchivistRequest(**self.scope, memories=[MemoryPayload(memory_id=m.memory_id, text=m.text) for m in memories], budget_minor=budget_minor)
        reply = await self._ask("archivist", msg, ArchivistResult)
        if reply is not None:
            if not reply.ok:
                raise StepFailed(reply.error or "archivist failed")
            try:
                return Analysis.model_validate(reply.analysis)
            except ValueError:
                await self._fail("archivist", "Archivist agent sent an invalid analysis; the Courier used its local fallback.")
        return await archivist_step(muted("archivist"), memories, budget_minor, room_run)

    async def muse(self, analysis: Analysis, memory_ids: list[str]) -> list[DecorationSpec]:
        msg = MuseRequest(**self.scope, analysis=analysis.model_dump(mode="json"), memory_ids=memory_ids)
        reply = await self._ask("muse", msg, MuseResult)
        if reply is not None:
            try:
                return [DecorationSpec.model_validate(d) for d in reply.decorations]
            except ValueError:
                await self._fail("muse", "Muse agent sent an unapproved decoration; the Courier used its local fallback.")
        return await muse_step(muted("muse"), analysis, memory_ids)

    async def scout(self, analysis: Analysis) -> ScoutReport:
        msg = ScoutRequest(**self.scope, analysis=analysis.model_dump(mode="json"))
        reply = await self._ask("scout", msg, ScoutResult)
        if reply is not None:
            try:
                return ScoutReport.model_validate(reply.report)
            except ValueError:
                await self._fail("scout", "Scout agent sent invalid listings; they were discarded.")
        # No second search in its place: research may be paid and has already had its full time budget.
        return ScoutReport(queries=tuple(scout_mod.queries_for(analysis)), error="The Scout agent did not answer, so no listings were verified.")

    async def keeper(self, analysis: Analysis, listings: list[Listing]) -> KeeperReport:
        msg = KeeperRequest(**self.scope, analysis=analysis.model_dump(mode="json"), listings=[x.model_dump(mode="json") for x in listings])
        reply = await self._ask("keeper", msg, KeeperResult)
        if reply is not None:
            try:
                return KeeperReport.model_validate(reply.report)
            except ValueError:
                await self._fail("keeper", "Keeper agent sent an invalid report; the Courier used its local fallback.")
        return await keeper_step(muted("keeper"), analysis, listings)
