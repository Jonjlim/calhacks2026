import json

import httpx
import pytest

import council.events as events
import council.scout as scout
from council.events import ConvexSink, check_callback_site, register_site, release_site, sink_for
from council.scout import research_room

DEV, PROD = "https://cool-bat-724.convex.site", "https://striped-alpaca-645.convex.site"


@pytest.fixture
def sites(monkeypatch):
    monkeypatch.setenv("CONVEX_SITE_URL", DEV)
    monkeypatch.setenv("COUNCIL_INGEST_SECRET", "s3cret")
    monkeypatch.setenv("COUNCIL_ALLOWED_SITES", f"{DEV}, {PROD}/")
    yield
    events._run_sites.clear()


def test_allowlist_accepts_exact_sites(sites):
    assert check_callback_site(None) is None
    assert check_callback_site(PROD) == PROD
    assert check_callback_site(PROD + "/") == PROD


@pytest.mark.parametrize("site", [
    "https://evil-1.convex.site",
    "http://striped-alpaca-645.convex.site",
    "https://striped-alpaca-645.convex.site.evil.test",
    "https://striped-alpaca-645.convex.cloud",
    "https://striped-alpaca-645.convex.site/council",
])
def test_allowlist_rejects_others(sites, site):
    with pytest.raises(ValueError, match="callback not allowed"):
        check_callback_site(site)


def test_allowlist_defaults_to_convex_site_url(monkeypatch):
    monkeypatch.setenv("CONVEX_SITE_URL", DEV + "/")
    monkeypatch.delenv("COUNCIL_ALLOWED_SITES", raising=False)
    assert check_callback_site(DEV) == DEV
    with pytest.raises(ValueError):
        check_callback_site(PROD)


def test_sink_uses_run_site_and_default_otherwise(sites):
    register_site("run_prod00001", PROD)
    sink = sink_for("run_prod00001", source="web")
    assert isinstance(sink, ConvexSink) and sink.url == PROD + "/council/events"
    assert sink_for("run_asi000001").site == DEV
    release_site("run_prod00001")
    assert sink_for("run_prod00001").site == DEV


@pytest.mark.asyncio
async def test_scout_callbacks_use_run_site(sites, monkeypatch, tmp_path):
    cache_cls = scout._Cache
    monkeypatch.setattr(scout, "_Cache", lambda: cache_cls(tmp_path / "cache.json"))
    register_site("run_prod00002", PROD)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"ok": True, "listings": []})

    real = httpx.AsyncClient
    monkeypatch.setattr(scout.httpx, "AsyncClient", lambda *a, **k: real(transport=httpx.MockTransport(handler), **k))
    await research_room("run_prod00002")
    from council import archivist
    from council.contracts import Memory
    analyze = lambda t: archivist.analyze_rules([Memory(memory_id="mem_test000001", text=t)])
    await scout.research_for("run_prod00002")(analyze("She loves pottery."))
    await scout.research_for("run_other0001")(analyze("She loves hiking."))
    assert seen[0] == PROD + "/council/room-research"
    assert seen[1] == PROD + "/council/research"
    assert seen[-1] == DEV + "/council/research"


@pytest.mark.asyncio
async def test_start_run_rejects_unlisted_callback(sites, monkeypatch):
    import agent
    monkeypatch.setattr(agent, "AGENT_SECRET", "agent-secret")
    req = agent.RunRequest(secret="agent-secret", runId="run_reject0001", callbackSite="https://evil-1.convex.site", memories=[agent.MemoryIn(memoryId="mem_test000001", text="Loves pottery")])
    out = await agent.start_run(None, req)
    assert out.ok is False and out.error == "callback not allowed"
    assert "run_reject0001" not in events._run_sites
