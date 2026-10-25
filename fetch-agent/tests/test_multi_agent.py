import asyncio

import pytest

from council import agents as ca
from council import keeper, llm, muse
from council.contracts import Memory, ScoutReport
from council.coordinator import memory_id_for, run_council
from council.events import EventSink
from council.messages import REQUESTS, RESULTS, ArchivistRequest, ArchivistResult, MemoryPayload, MuseResult, ScoutResult
from tests.fixtures import JUDGE, MAYA, POTTERY_LISTINGS
from uagents import Model
from uagents_core.identity import Identity

SEED = "unit-test seed phrase that is long enough to be private"


def statuses(sink):
    return [(e["actor"], e["status"]) for e in sink.events]


class Status:
    def __init__(self, detail="Timeout waiting for response"):
        self.detail = detail


class Network:
    """Routes send_and_receive to the real specialist handlers, as the Bureau's dispatcher would."""

    def __init__(self, addresses, silent=(), research=None):
        self.by_address = {a: r for r, a in addresses.items()}
        self.silent = set(silent)
        self.calls = []

    def ctx(self):
        net = self

        class Ctx:
            async def send_and_receive(self, destination, message, response_type, timeout=30, sync=False):
                role = net.by_address[destination]
                net.calls.append((role, type(message).__name__, timeout))
                if role in net.silent:
                    return None, Status()
                replies = []

                class Reply:
                    async def send(self, to, msg):
                        replies.append(msg)

                await ca.HANDLERS[role][2](Reply(), "agent1qcourier", message)
                assert len(replies) == 1 and isinstance(replies[0], response_type)
                return replies[0], Status("delivered")

        return Ctx()


ADDRS = {r: ca.address_for(r, SEED) for r in ca.SPECIALISTS}


async def fake_research(analysis):
    return ScoutReport(listings=tuple(POTTERY_LISTINGS), queries=("pottery class",), source="convex")


@pytest.fixture(autouse=True)
def _research(monkeypatch):
    import council.scout as scout
    monkeypatch.setattr(scout, "research", fake_research)


async def run_networked(net, text=MAYA, run_id="run_net000001", timeouts=None):
    sink = EventSink(run_id)
    ca.register_run(sink)

    def factory(s):
        return ca.AgentSpecialists(net.ctx, ADDRS, s, timeouts=timeouts or {r: 5 for r in ca.SPECIALISTS})

    try:
        out = await run_council([Memory(memory_id=memory_id_for(text), text=text)], sink, specialists=factory)
    finally:
        ca.finish_run(run_id)
    return sink, out


# --- Message models ----------------------------------------------------------------


def test_message_models_are_distinct_typed_uagents_models():
    digests = {Model.build_schema_digest(m) for m in [*REQUESTS.values(), *RESULTS.values()]}
    assert len(digests) == 8
    req = ArchivistRequest(run_id="run_x00001", memories=[MemoryPayload(memory_id="mem_abcdef01", text="hi")], budget_minor=8000)
    back = ArchivistRequest.parse_raw(req.json())
    assert back == req and back.room_run is False and back.source == "asi1"
    with pytest.raises(ValueError):
        ArchivistResult(run_id="run_x00001")  # ok is required


# --- Addresses -------------------------------------------------------------------


def test_council_agents_get_distinct_addresses(monkeypatch):
    monkeypatch.setenv("AGENT_SEED", SEED)
    for role in ca.ROLES:
        monkeypatch.delenv(f"{role.upper()}_SEED", raising=False)
    built = ca.build_specialists(port=8299)
    addresses = {"courier": ca.address_for("courier"), **{r: a.address for r, a in built.items()}}
    assert len(set(addresses.values())) == len(ca.ROLES) == 5
    assert all(a.startswith("agent1q") for a in addresses.values())
    # The Courier keeps the original single-agent address; others match the printed ones.
    assert addresses["courier"] == Identity.from_seed(SEED, 0).address
    assert all(built[r].address == ca.address_for(r) for r in ca.SPECIALISTS)


def test_role_seed_override(monkeypatch):
    monkeypatch.setenv("AGENT_SEED", SEED)
    monkeypatch.setenv("SCOUT_SEED", "a different explicit scout seed phrase")
    assert ca.address_for("scout") == Identity.from_seed("a different explicit scout seed phrase", 0).address


def test_print_addresses_prints_no_seed(monkeypatch, capsys):
    monkeypatch.setenv("AGENT_SEED", SEED)
    import print_addresses
    print_addresses.main()
    out = capsys.readouterr().out
    assert SEED not in out and out.count("agent1q") == 5


# --- Orchestration -----------------------------------------------------------------


async def test_courier_orchestrates_specialist_agents():
    net = Network(ADDRS)
    sink, out = await run_networked(net)
    assert [c[0] for c in net.calls][:1] == ["archivist"] and {c[0] for c in net.calls} == set(ca.SPECIALISTS)
    s = statuses(sink)
    assert s[0] == ("courier", "started") and s[-1] == ("courier", "completed")
    for actor in ca.SPECIALISTS:
        assert s.index((actor, "started")) < s.index((actor, "completed"))
    assert s.index(("scout", "completed")) < s.index(("keeper", "started"))
    assert [e["sequence"] for e in sink.events] == list(range(len(sink.events)))
    assert "https://example-shop.test/mug" in out.reply and out.decorations[0].assetId == "ceramic_charm"


async def test_networked_and_local_runs_agree():
    _, networked = await run_networked(Network(ADDRS))
    local = await run_council([Memory(memory_id=memory_id_for(MAYA), text=MAYA)], EventSink("run_loc000001"))
    assert networked.reply == local.reply


@pytest.mark.parametrize("role", ["archivist", "muse", "keeper"])
async def test_specialist_timeout_falls_back_to_local_function(role):
    sink, out = await run_networked(Network(ADDRS, silent={role}))
    s = statuses(sink)
    failed = next(e for e in sink.events if e["actor"] == role and e["status"] == "failed")
    assert set(failed["result"]) == {"error"} and "local fallback" in failed["result"]["error"]
    assert (role, "completed") not in s
    # The local fallback still produced the real answer.
    assert s[-1] == ("courier", "completed") and "https://example-shop.test/mug" in out.reply


async def test_scout_timeout_is_reported_without_inventing_listings():
    sink, out = await run_networked(Network(ADDRS, silent={"scout"}))
    s = statuses(sink)
    assert ("scout", "failed") in s and ("scout", "completed") not in s
    assert s[-1] == ("courier", "failed") and "No verified listings" in out.reply and "https://" not in out.reply


async def test_late_events_from_an_abandoned_specialist_are_dropped():
    sink = EventSink("run_late00001")
    ca.register_run(sink)
    ca.abandon("run_late00001", "muse")
    rs = ca._role_sink(sink, ArchivistRequest(run_id="run_late00001", memories=[]), "muse")
    await rs.emit("completed", {"summary": "late"})
    ca.finish_run("run_late00001")
    assert sink.events == []


async def test_send_errors_are_treated_as_timeouts():
    class Broken:
        async def send_and_receive(self, *a, **k):
            raise ConnectionError("mailbox down")

    sink = EventSink("run_err000001")
    sp = ca.AgentSpecialists(lambda: Broken(), ADDRS, sink, timeouts={r: 1 for r in ca.SPECIALISTS})
    analysis = await sp.archivist([Memory(memory_id="mem_err0000001", text=JUDGE)], None, False)
    assert analysis.recipient == "Maya"
    assert sink.events[0]["actor"] == "archivist" and "mailbox down" in sink.events[0]["result"]["error"]


async def test_invalid_specialist_reply_is_not_trusted():
    class Liar:
        async def send_and_receive(self, destination, message, response_type, timeout=30):
            bad = [{"memoryId": "mem_maya000001", "jar": "wish", "assetId": "dragon_statue", "color": "terracotta", "placement": "front_ribbon", "label": "x"}]
            return MuseResult(run_id=message.run_id, ok=True, decorations=bad), Status("delivered")

    from council import archivist
    a = archivist.analyze_rules([Memory(memory_id="mem_maya000001", text="Maya wants to learn pottery.")])
    sink = EventSink("run_liar00001")
    specs = await ca.AgentSpecialists(lambda: Liar(), ADDRS, sink).muse(a, ["mem_maya000001"])
    assert specs[0].assetId == "ceramic_charm"
    assert statuses(sink) == [("muse", "failed")]


# --- ASI:One reasoning stays validated ------------------------------------------------


async def test_muse_model_may_only_pick_approved_assets(monkeypatch):
    from council import archivist
    a = archivist.analyze_rules([Memory(memory_id="mem_maya000001", text="Jo loves the smell of rain.")])
    monkeypatch.setattr(llm, "enabled", lambda: True)

    async def bad(*_a, **_k):
        return {"choices": [{"memoryId": "mem_maya000001", "assetId": "dragon_statue"}]}

    monkeypatch.setattr(llm, "ask_json", bad)
    assert (await muse.design_with_model(a, ["mem_maya000001"]))[0].assetId == "heart_charm"
    other = next(x["id"] for x in muse._ASSETS if x["id"] != "heart_charm")

    async def good(*_a, **_k):
        return {"choices": [{"memoryId": "mem_maya000001", "assetId": other}]}

    monkeypatch.setattr(llm, "ask_json", good)
    assert (await muse.design_with_model(a, ["mem_maya000001"]))[0].assetId == other


async def test_keeper_model_adds_notes_but_never_changes_decisions(monkeypatch):
    from council import archivist
    a = archivist.analyze_rules([Memory(memory_id="mem_maya000001", text=JUDGE)])
    base = keeper.check(a, POTTERY_LISTINGS)
    monkeypatch.setattr(llm, "enabled", lambda: True)

    async def notes(*_a, **_k):
        return {"notes": [{"index": 0, "why": "Handmade stoneware suits her love of pottery"}, {"index": 1, "why": "Only $5, a steal"}, {"index": 99, "why": "out of range note"}]}

    monkeypatch.setattr(llm, "ask_json", notes)
    out = await keeper.explain_with_model(a, base)
    assert [v.listing for v in out.kept] == [v.listing for v in base.kept] and out.excluded == base.excluded
    assert out.kept[0].notes[-1] == "Fit: Handmade stoneware suits her love of pottery"
    assert out.kept[1].notes == base.kept[1].notes


async def test_llm_is_off_without_a_key(monkeypatch):
    monkeypatch.delenv("ASI1_API_KEY", raising=False)
    assert not llm.enabled() and await llm.ask_json("hi") is None
