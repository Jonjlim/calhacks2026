"""Unwrap Gift Council — Fetch.ai multi-agent council (Agent Chat Protocol, ASI:One).

Five registered uAgents run in one process (a uAgents Bureau):

  Courier   — public coordinator: ASI:One chat, the website's REST entry point
  Archivist — memories → structured clues        (ASI:One-assisted)
  Muse      — memory → approved charm             (ASI:One-assisted)
  Scout     — real product research
  Keeper    — budget / ownership / dislike checks (ASI:One-explained)

The Courier orchestrates the specialists with typed messages
(`council/messages.py`) and `ctx.send_and_receive`; every agent emits its
own task events to Convex so the AI Council avatars animate from real work.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from uagents import Agent, Bureau, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from council import agents as council_agents
from council.contracts import Memory
from council.coordinator import memory_id_for, run_council
from council.events import EventSink, sink_for
from council.scout import research_room

load_dotenv(Path(__file__).with_name(".env"))
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

if not os.getenv("AGENT_SEED"):
    raise RuntimeError("AGENT_SEED is not set. Put a long, private random phrase in fetch-agent/.env (see .env.example).")

# Hosts such as Render inject PORT; the Bureau's HTTP server (REST + inspector) binds to it.
PORT = int(os.getenv("PORT", os.getenv("AGENT_PORT", "8001")))
AGENT_SECRET = os.getenv("COUNCIL_AGENT_SECRET", "")

agent = Agent(
    name=os.getenv("AGENT_NAME", "unwrap-gift-council"),
    seed=council_agents.seed_for("courier"),
    port=PORT,
    mailbox=True,  # reachable from Agentverse / ASI:One through the mailbox
    publish_agent_details=True,
    readme_path=str(Path(__file__).with_name("README.md")),
    description="Unwrap Gift Council: finds real, budget-checked gifts from what friends remember about someone.",
    handle_messages_concurrently=True,
)
courier = agent

specialists = council_agents.build_specialists(port=PORT)
ADDRESSES = {role: a.address for role, a in specialists.items()}

# Until the Bureau has started the specialists' message loops, runs use the
# in-process role functions (also the path unit tests exercise).
_network = {"ready": False}


def _use_agents() -> bool:
    return _network["ready"] and os.getenv("COUNCIL_MODE", "agents") != "local"


async def run_with_council(memories: list[Memory], sink: EventSink, **kwargs) -> object:
    if not _use_agents():
        return await run_council(memories, sink, **kwargs)
    council_agents.register_run(sink)

    def factory(s: EventSink) -> council_agents.AgentSpecialists:
        return council_agents.AgentSpecialists(
            courier._build_context, ADDRESSES, s,
            source=getattr(s, "source", "asi1"), demo_key=getattr(s, "demo_key", None), room_run=kwargs.get("room_run", False),
        )

    try:
        return await run_council(memories, sink, specialists=factory, **kwargs)
    finally:
        council_agents.finish_run(sink.run_id)


chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    text = "".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
    if not text:
        reply = "Tell me about the person and your budget, e.g. “Find a birthday gift for Maya. She loves pottery, already has a beginner kit, and our budget is $80.”"
    else:
        run_id = "run_" + uuid.uuid4().hex[:20]
        outcome = await run_with_council([Memory(memory_id=memory_id_for(text), text=text[:2000])], sink_for(run_id, source="asi1"))
        reply = outcome.reply
    await ctx.send(sender, ChatMessage(content=[TextContent(type="text", text=reply), EndSessionContent(type="end-session")]))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat_proto, publish_manifest=True)


# --- Website entry point ------------------------------------------------------


class MemoryIn(Model):
    memoryId: str
    text: str


class RunRequest(Model):
    secret: str
    runId: str
    demoKey: str = ""
    roomRun: bool = False
    budgetMinor: int | None = None
    memories: list[MemoryIn]


class RunAccepted(Model):
    ok: bool
    runId: str
    error: str | None = None
    agentAddress: str | None = None


_running: set[asyncio.Task] = set()
_active_runs: dict[str, asyncio.Task] = {}


@agent.on_rest_post("/council/run", RunRequest, RunAccepted)
async def start_run(ctx: Context, req: RunRequest) -> RunAccepted:
    if not AGENT_SECRET or not hmac.compare_digest(req.secret, AGENT_SECRET):
        return RunAccepted(ok=False, runId=req.runId, error="unauthorized")
    if req.runId in _active_runs:
        return RunAccepted(ok=True, runId=req.runId, agentAddress=agent.address)
    if not req.runId.startswith("run_") or len(req.runId) > 64 or len(req.memories) > 100:
        return RunAccepted(ok=False, runId=req.runId, error="invalid request")
    try:
        memories = [Memory(memory_id=m.memoryId, text=m.text[:2000]) for m in req.memories]
    except ValueError as err:
        return RunAccepted(ok=False, runId=req.runId, error=f"invalid memories: {err}"[:160])
    if not memories:
        return RunAccepted(ok=False, runId=req.runId, error="no memories")
    # Return immediately; progress arrives through Convex events.
    sink = sink_for(req.runId, source="web", demo_key=None if req.roomRun else req.demoKey)
    if req.roomRun:
        sink.room_run = True
    async def room_research(_analysis):
        return await research_room(req.runId)
    task = asyncio.create_task(run_with_council(memories, sink, research=room_research if req.roomRun else None, budget_minor=req.budgetMinor, room_run=req.roomRun))
    _active_runs[req.runId] = task
    task.add_done_callback(lambda _: _active_runs.pop(req.runId, None))
    _running.add(task)
    task.add_done_callback(_running.discard)
    return RunAccepted(ok=True, runId=req.runId, agentAddress=agent.address)


class Health(Model):
    ok: bool


@agent.on_rest_get("/health", Health)
async def health(ctx: Context) -> Health:
    return Health(ok=True)


@agent.on_event("startup")
async def startup(ctx: Context):
    _network["ready"] = True
    ctx.logger.info("Council agents: " + ", ".join(f"{role}={addr}" for role, addr in {"courier": agent.address, **ADDRESSES}.items()))


@agent.on_event("shutdown")
async def shutdown(ctx: Context):
    if _running:
        _, pending = await asyncio.wait(_running, timeout=15)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


def build_bureau() -> Bureau:
    # REST handlers are copied into the Bureau's server when agents are added,
    # so this must run after every on_rest_* decorator above.
    return Bureau(agents=[agent, *specialists.values()], port=PORT)


if __name__ == "__main__":
    build_bureau().run()
