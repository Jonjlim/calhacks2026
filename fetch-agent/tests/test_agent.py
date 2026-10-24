import importlib
import os

from uagents_core.contrib.protocols.chat import chat_protocol_spec


def test_agent_registers_the_chat_protocol(monkeypatch):
    monkeypatch.setenv("AGENT_SEED", "unit-test seed phrase that is long enough to be private")
    monkeypatch.setenv("AGENT_PORT", "8199")
    mod = importlib.import_module("agent")
    assert chat_protocol_spec.name == "AgentChatProtocol" and chat_protocol_spec.version == "0.3.0"
    assert mod.chat_proto.digest in mod.agent.protocols
    assert mod.agent.address.startswith("agent1")


class FakeCtx:
    def __init__(self):
        self.sent = []

        class L:
            def info(self, *a, **k): pass
            exception = warning = info

        self.logger = L()

    async def send(self, to, msg):
        self.sent.append((to, msg))


async def test_chat_handler_acks_then_replies_with_end_session(monkeypatch):
    monkeypatch.setenv("AGENT_SEED", "unit-test seed phrase that is long enough to be private")
    mod = importlib.import_module("agent")
    from council.contracts import ScoutReport
    from tests.fixtures import JUDGE, POTTERY_LISTINGS
    from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, TextContent

    async def fake_research(analysis):
        return ScoutReport(listings=tuple(POTTERY_LISTINGS), queries=("handmade pottery",), source="convex")

    import council.scout as scout
    monkeypatch.setattr(scout, "research", fake_research)
    ctx = FakeCtx()
    await mod.handle_chat(ctx, "agent1qsender", ChatMessage(content=[TextContent(type="text", text=JUDGE)]))
    (_, ack), (_, reply) = ctx.sent
    assert isinstance(ack, ChatAcknowledgement)
    text = next(c.text for c in reply.content if isinstance(c, TextContent))
    assert any(isinstance(c, EndSessionContent) for c in reply.content)
    assert "Gift ideas for Maya" in text and "https://example-shop.test/mug" in text
