"""Council task events.

`emit()` is called at real execution boundaries only (a role actually
starting, finishing or failing). Each event gets a unique id and a per-run
sequence. Delivery to Convex is fire-and-forget with retries — Convex
deduplicates by eventId, so a retry can never double-apply — and a slow or
missing network never blocks or fails the agent's actual work.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from typing import Any

import httpx

from .contracts import TASKS

log = logging.getLogger("council.events")

_SITE_SHAPE = re.compile(r"^https://[a-z0-9-]+\.convex\.site$")
# Per-run Convex site, so one agent process can serve several deployments.
# Keyed by run id because specialist agents handle a run in separate tasks.
_run_sites: dict[str, str] = {}


def allowed_sites() -> set[str]:
    raw = os.getenv("COUNCIL_ALLOWED_SITES") or os.getenv("CONVEX_SITE_URL") or ""
    return {s.strip().rstrip("/") for s in raw.split(",") if s.strip()}


def check_callback_site(site: str | None) -> str | None:
    """The run's site if allowed; None for no override. Raises ValueError when not allowed."""
    if site is None:
        return None
    site = site.strip().rstrip("/")
    if not _SITE_SHAPE.match(site) or site not in allowed_sites():
        raise ValueError("callback not allowed")
    return site


def register_site(run_id: str, site: str | None) -> None:
    if site:
        _run_sites[run_id] = site


def release_site(run_id: str) -> None:
    _run_sites.pop(run_id, None)


def run_site(run_id: str) -> str | None:
    return _run_sites.get(run_id)


def site_for(run_id: str | None) -> str | None:
    """The run's callback site, else the default CONVEX_SITE_URL."""
    site = _run_sites.get(run_id) if run_id else None
    return site or (os.getenv("CONVEX_SITE_URL") or "").rstrip("/") or None


class EventSink:
    """Base sink: assigns ids and sequence numbers, records events locally."""

    def __init__(self, run_id: str):
        self.run_id = run_id
        self._seq = 0
        self._lock = asyncio.Lock()
        self.events: list[dict[str, Any]] = []

    async def emit(self, actor: str, status: str, result: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self._lock:
            seq = self._seq
            self._seq += 1
        event = {
            "eventId": "ev_" + uuid.uuid4().hex[:24],
            "runId": self.run_id,
            "actor": actor,
            "task": TASKS[actor],
            "status": status,
            "sequence": seq,
            "timestamp": int(time.time() * 1000),
            **({"result": _trim(result)} if result else {}),
        }
        self.events.append(event)
        log.info("[%s] %s.%s %s", self.run_id, actor, status, (result or {}).get("summary", ""))
        await self.deliver(event)
        return event

    async def deliver(self, event: dict[str, Any]) -> None:  # overridden by ConvexSink
        return None

    async def open(self) -> None:
        return None

    async def results(self, payload: dict[str, Any]) -> None:
        return None

    async def flush(self) -> None:
        return None


def _trim(result: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in result.items() if v is not None}
    for k in ("summary", "error"):
        if k in out:
            out[k] = str(out[k])[: 200 if k == "summary" else 160]
    return out


class ConvexSink(EventSink):
    """Posts events to the trusted Convex ingest endpoint."""

    def __init__(self, run_id: str, site_url: str, secret: str, source: str = "asi1", demo_key: str | None = None, attempts: int = 4):
        super().__init__(run_id)
        self.site = site_url.rstrip("/")
        self.url = self.site + "/council/events"
        self.source = source
        self.demo_key = demo_key
        self.secret = secret
        self.attempts = attempts
        self._client = httpx.AsyncClient(timeout=5.0)
        self._pending: set[asyncio.Task] = set()
        self.room_run = False

    async def open(self) -> None:
        """Registers the run (idempotent; web runs are usually created by the app first)."""
        body = {"runId": self.run_id, "source": self.source, **({"demoKey": self.demo_key} if self.demo_key else {})}
        try:
            r = await self._client.post(self.site + "/council/runs", json=body, headers={"Authorization": f"Bearer {self.secret}"})
            r.raise_for_status()
            self._seq = int(r.json().get("nextSequence", 0))
        except httpx.HTTPError as err:
            log.warning("Convex unreachable; events stay local for run %s (%s)", self.run_id, err)

    async def deliver(self, event: dict[str, Any]) -> None:
        task = asyncio.create_task(self._send(event))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _send(self, event: dict[str, Any]) -> None:
        delay = 0.3
        for attempt in range(self.attempts):
            try:
                r = await self._client.post(self.url, json=event, headers={"Authorization": f"Bearer {self.secret}"})
                if r.status_code < 500:
                    if r.status_code >= 400:
                        log.warning("Convex rejected %s.%s: %s", event["actor"], event["status"], r.text[:200])
                    return
            except httpx.HTTPError as err:
                log.debug("event delivery attempt %d failed: %s", attempt + 1, err)
            await asyncio.sleep(delay)
            delay *= 3
        log.warning("Gave up delivering %s.%s for run %s", event["actor"], event["status"], self.run_id)

    async def results(self, payload: dict[str, Any]) -> None:
        if not self.room_run:
            return
        # Charm events must be persisted before the final run status is computed.
        if self._pending:
            await asyncio.gather(*list(self._pending))
        for attempt in range(self.attempts):
            try:
                response = await self._client.post(self.site + "/council/results", json={"runId": self.run_id, **payload}, headers={"Authorization": f"Bearer {self.secret}"})
                response.raise_for_status()
                return
            except httpx.HTTPError:
                if attempt == self.attempts - 1:
                    raise RuntimeError("Could not save recommendations. Resume the existing request.") from None
                await asyncio.sleep(0.3 * (attempt + 1))

    async def flush(self) -> None:
        if self._pending:
            await asyncio.wait(self._pending, timeout=15)
        await self._client.aclose()


def sink_for(run_id: str, source: str = "asi1", demo_key: str | None = None) -> EventSink:
    """Convex sink when configured, otherwise local-only (events still logged).

    ASI:One chats have no Unwrap room. If COUNCIL_BROADCAST_KEY is set, their
    events are mirrored under that demo key so a /council page can watch the
    council work live; no room id is ever invented.
    """
    site, secret = site_for(run_id), os.getenv("COUNCIL_INGEST_SECRET")
    if source == "asi1":
        demo_key = demo_key or os.getenv("COUNCIL_BROADCAST_KEY") or None
    return ConvexSink(run_id, site, secret, source, demo_key) if site and secret else EventSink(run_id)
