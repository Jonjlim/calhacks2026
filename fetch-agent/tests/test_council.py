import httpx
import pytest

from council.contracts import Memory, ScoutReport
from council.coordinator import memory_id_for, run_council
from council.events import ConvexSink, EventSink
from tests.fixtures import MAYA, POTTERY_LISTINGS


async def fake_research(analysis):
    return ScoutReport(listings=tuple(POTTERY_LISTINGS), queries=("pottery class",), source="convex")


async def failing_research(analysis):
    raise RuntimeError("network down")


def statuses(sink):
    return [(e["actor"], e["status"]) for e in sink.events]


async def test_full_council_run_emits_real_boundaries_and_recommends():
    sink = EventSink("run_test000001")
    mem = Memory(memory_id=memory_id_for(MAYA), text=MAYA)
    out = await run_council([mem], sink, research=fake_research)
    s = statuses(sink)
    assert s[0] == ("courier", "started") and s[-1] == ("courier", "completed")
    for actor in ("archivist", "muse", "scout", "keeper"):
        assert s.index((actor, "started")) < s.index((actor, "completed"))
    # Muse and Scout only begin after the Archivist has finished; Keeper after Scout.
    assert s.index(("archivist", "completed")) < s.index(("muse", "started"))
    assert s.index(("archivist", "completed")) < s.index(("scout", "started"))
    assert s.index(("scout", "completed")) < s.index(("keeper", "started"))
    # Sequence numbers are unique and monotonic; ids unique.
    assert [e["sequence"] for e in sink.events] == list(range(len(sink.events)))
    assert len({e["eventId"] for e in sink.events}) == len(sink.events)
    muse_done = next(e for e in sink.events if e["actor"] == "muse" and e["status"] == "completed")
    assert muse_done["result"]["decorations"][0]["assetId"] == "ceramic_charm"
    assert "https://example-shop.test/mug" in out.reply and "$34.00" in out.reply
    assert "Starter Kit" not in out.reply.split("Left out")[0]  # excluded, only mentioned as left out
    assert "Experience idea" in out.reply


async def test_scout_failure_is_reported_not_faked():
    sink = EventSink("run_test000002")
    out = await run_council([Memory(memory_id="mem_fail000001", text=MAYA)], sink, research=failing_research)
    s = statuses(sink)
    assert ("scout", "failed") in s and ("scout", "completed") not in s
    assert ("keeper", "completed") in s and s[-1] == ("courier", "failed")
    assert "No verified listings" in out.reply and "not verified products" in out.reply
    assert "https://" not in out.reply


async def test_convex_sink_registers_run_retries_and_authenticates():
    calls = []

    def handler(request: httpx.Request):
        calls.append((request.url.path, request.headers.get("authorization")))
        # First event delivery fails with 503, retry succeeds.
        if request.url.path == "/council/events" and sum(1 for c in calls if c[0] == "/council/events") == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"ok": True})

    sink = ConvexSink("run_test000003", "https://example.convex.site", "s3cret", source="web", demo_key="demo_abc123")
    sink._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await sink.open()
    await sink.emit("archivist", "started")
    await sink.flush()
    paths = [p for p, _ in calls]
    assert paths[0] == "/council/runs" and paths.count("/council/events") == 2
    assert all(auth == "Bearer s3cret" for _, auth in calls)


async def test_room_budget_is_server_owned_and_results_are_separate_from_events():
    class ResultSink(EventSink):
        payload = None
        async def results(self, payload):
            self.payload = payload

    sink = ResultSink("run_room000001")
    out = await run_council([Memory(memory_id="mem_budget0001", text=MAYA)], sink, research=fake_research, room_run=True, budget_minor=2000)
    assert out.analysis.budget_minor == 2000
    assert sink.payload is not None
    assert "kept" in sink.payload
    assert all("kept" not in e.get("result", {}) for e in sink.events)
    assert not any(v.listing.price_minor and v.listing.price_minor > 2000 for v in out.keeper.kept)
