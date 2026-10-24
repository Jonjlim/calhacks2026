import pytest

from council import archivist, keeper, muse
from council.contracts import DecorationSpec, Memory
from council.scout import _Cache, _live_product_url, normalize_apify, queries_for
from tests.fixtures import JUDGE, MAYA, NOW, POTTERY_LISTINGS


def analyze(text: str, mid: str = "mem_maya000001"):
    return archivist.analyze_rules([Memory(memory_id=mid, text=text)])


def test_archivist_parses_the_judge_request():
    a = analyze(JUDGE)
    assert (a.recipient, a.occasion, a.budget_minor) == ("Maya", "birthday", 8000)
    assert [c.phrase for c in a.of("interest")] == ["pottery"]
    assert [c.phrase for c in a.of("ownership")] == ["beginner kit"]
    assert [c.phrase for c in a.of("preference")] == ["handmade"]


def test_archivist_parses_the_demo_memory():
    a = analyze(MAYA)
    assert a.budget_minor == 8000
    assert {c.phrase for c in a.of("interest")} == {"pottery", "handmade crafts"}
    assert [c.phrase for c in a.of("wish")] == ["pottery class"]
    assert "Occasion not mentioned." in a.uncertainties


def test_archivist_flags_missing_budget_and_dislikes():
    a = analyze("Sam enjoys gardening but hates scented candles.")
    assert a.budget_minor is None and any("budget" in u for u in a.uncertainties)
    assert [c.phrase for c in a.of("dislike")] == ["scented candles"]


def test_muse_turns_pottery_into_a_ceramic_charm():
    a = analyze("Maya wants to learn pottery.")
    [spec] = muse.design(a, ["mem_maya000001"])
    assert (spec.jar, spec.assetId, spec.color, spec.label) == ("wish", "ceramic_charm", "terracotta", "Pottery")
    # Stable placement: same memory, same slot.
    assert muse.design(a, ["mem_maya000001"])[0].placement == spec.placement


def test_muse_falls_back_to_the_memory_charm_and_skips_empty_memories():
    a = analyze("Jo loves the smell of rain.")
    [spec] = muse.design(a, ["mem_maya000001"])
    assert spec.assetId == "heart_charm"
    assert muse.design(analyze("We met in 2019."), ["mem_maya000001"]) == []


def test_decoration_specs_reject_unapproved_values():
    good = dict(memoryId="mem_maya000001", jar="wish", assetId="ceramic_charm", color="terracotta", placement="front_ribbon", label="Pottery")
    DecorationSpec(**good)
    for bad in ({"assetId": "dragon_statue"}, {"placement": "inside_box"}, {"jar": "secrets"}, {"color": "neon"}, {"memoryId": "x"}):
        with pytest.raises(ValueError):
            DecorationSpec(**{**good, **bad})


def test_keeper_applies_budget_ownership_and_preferences():
    r = keeper.check(analyze(JUDGE), POTTERY_LISTINGS)
    kept = [v.listing.title for v in r.kept]
    reasons = {e.title: e.reason for e in r.excluded}
    assert kept[0].startswith("Handmade Stoneware")  # matches the handmade preference
    assert "already own" in reasons["Pottery Starter Kit for Beginners, Air Dry Clay Set"]
    assert "over the $80 budget" in reasons["Electric Pottery Wheel 350W"]
    glaze = next(v for v in r.kept if v.listing.title.startswith("Pottery Glaze"))
    assert any("not observed" in n for n in glaze.notes)
    assert any("Observed price" in h for h in r.hard_rules) and r.soft_notes


def test_scout_queries_lead_with_wishes():
    assert queries_for(analyze(MAYA)) == ["pottery class", "pottery"]
    # A stated "handmade" preference steers the interest query.
    assert queries_for(analyze("Maya loves pottery and prefers handmade things.")) == ["handmade pottery"]


def test_apify_normalisation_is_strict():
    rows = [{"search_parameters": {"gl": "us"}, "shopping_results": [
        {"title": "Clay Mug", "product_link": "https://shop.test/a", "price": "$24.00", "extracted_price": 24.0, "source": "Etsy"},
        {"title": "Range", "product_link": "https://shop.test/b", "price": "$10–$20"},
        {"title": "Mismatch", "product_link": "https://shop.test/c", "price": "$30.00", "extracted_price": 31.0},
        {"title": "Insecure", "product_link": "http://shop.test/d", "price": "$5.00"},
        {"title": "Euro", "product_link": "https://shop.test/e", "price": "€5", "currency": "EUR"},
    ]}]
    out = normalize_apify(rows, NOW)
    by = {x.title: x for x in out}
    assert by["Clay Mug"].price_minor == 2400 and by["Clay Mug"].price_status == "observed"
    assert by["Range"].price_minor is None and by["Mismatch"].price_minor is None
    assert "Insecure" not in by and "Euro" not in by


def test_research_cache_round_trip(tmp_path):
    cache = _Cache(tmp_path / "r.json")
    assert cache.get("pottery class", 8000) is None
    cache.put("pottery class", 8000, [POTTERY_LISTINGS[0].model_copy(update={"source_url": "https://www.etsy.com/listing/test-record"})])
    [hit] = cache.get("Pottery Class ", 8000)
    assert hit.retrieved_at == NOW  # original observation time is kept


@pytest.mark.parametrize("url", [
    "https://shop.example.com/mug", "https://example.org/item", "https://shop.test/item",
    "https://localhost/item", "https://127.0.0.1/item", "https://[::1]/item", "https://merchant.invalid/item",
])
def test_live_cache_rejects_fixture_and_local_urls(url):
    assert not _live_product_url(url)


def test_existing_placeholder_cache_is_a_miss(tmp_path):
    import json
    import time
    cache = _Cache(tmp_path / "r.json")
    row = POTTERY_LISTINGS[0].model_copy(update={"source_url": "https://shop.example.com/mug"})
    cache.path.write_text(json.dumps({cache.key("pottery", 8000): {"storedAt": time.time(), "listings": [row.model_dump()]}}))
    assert cache.get("pottery", 8000) is None
    cache.put("new query", 8000, [row])
    assert cache.get("new query", 8000) is None


def test_malformed_cache_does_not_break_research(tmp_path):
    import json
    cache = _Cache(tmp_path / "r.json")
    for data in [[], {cache.key("pottery", 8000): {"storedAt": "invalid", "listings": []}}, {cache.key("pottery", 8000): {"storedAt": 0}}]:
        cache.path.write_text(json.dumps(data))
        assert cache.get("pottery", 8000) is None


@pytest.mark.asyncio
async def test_convex_research_preserves_configuration_errors(monkeypatch):
    import httpx
    from council.scout import _via_convex
    monkeypatch.setenv("CONVEX_SITE_URL", "https://council.test")
    monkeypatch.setenv("COUNCIL_INGEST_SECRET", "test-secret")
    async def response(request):
        return httpx.Response(502, json={"ok": False, "error": "APIFY_TOKEN is not configured"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(RuntimeError, match="APIFY_TOKEN is not configured"):
            await _via_convex(client, "pottery", analyze(JUDGE), [])


def test_listing_keeps_real_shopping_urls_with_spaces():
    from council.contracts import Listing
    url = "https://www.google.com/search?ibp=oshop&q=pottery class&prds=productid:1"
    assert Listing(title="Mug", source_url=url, retrieved_at=NOW).source_url == url
    for bad in ("http://shop.test/a", "https:///nohost", "ftp://shop.test/a"):
        with pytest.raises(ValueError):
            Listing(title="Mug", source_url=bad, retrieved_at=NOW)
