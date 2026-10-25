"""Typed uAgents messages between the Courier and the four specialists.

Envelope fields are typed; nested payloads are the JSON form of the strict
contracts in `council.contracts` and are re-validated on receipt, so a
malformed reply is treated as a specialist failure, never trusted.
"""

from __future__ import annotations

from typing import Any

from uagents import Model


class RoleRequest(Model):
    run_id: str
    source: str = "asi1"
    demo_key: str | None = None
    room_run: bool = False


class RoleResult(Model):
    run_id: str
    ok: bool
    error: str | None = None


class MemoryPayload(Model):
    memory_id: str
    text: str


class ArchivistRequest(RoleRequest):
    memories: list[MemoryPayload]
    budget_minor: int | None = None


class ArchivistResult(RoleResult):
    analysis: dict[str, Any] | None = None


class MuseRequest(RoleRequest):
    analysis: dict[str, Any]
    memory_ids: list[str]


class MuseResult(RoleResult):
    decorations: list[dict[str, Any]] = []


class ScoutRequest(RoleRequest):
    analysis: dict[str, Any]


class ScoutResult(RoleResult):
    report: dict[str, Any]


class KeeperRequest(RoleRequest):
    analysis: dict[str, Any]
    listings: list[dict[str, Any]]


class KeeperResult(RoleResult):
    report: dict[str, Any]


REQUESTS: dict[str, type[RoleRequest]] = {"archivist": ArchivistRequest, "muse": MuseRequest, "scout": ScoutRequest, "keeper": KeeperRequest}
RESULTS: dict[str, type[RoleResult]] = {"archivist": ArchivistResult, "muse": MuseResult, "scout": ScoutResult, "keeper": KeeperResult}
