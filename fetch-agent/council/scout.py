"""Scout — real gift research.

Primary path reuses the Unwrap app's own research pipeline (Apify Google
Shopping actor → normalizeDataset → rankListings in convex/research) through
the trusted `POST /council/research` Convex endpoint. If Convex is not
configured but an Apify token is, it calls the same verified actor directly
and applies the same strict rules: an https product link and an exact USD
price, or the price is "unknown". Nothing is ever invented.

Results are cached on disk for slow venue Wi-Fi; a cached answer is always
labelled cached and keeps its original retrieval time.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import ipaddress
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .contracts import Analysis, Listing, ScoutReport

VERIFIED_ACTOR = "johnvc~google-shopping-api-google-shopping-products-prices-deals"
VERIFIED_BUILD = "0.0.142"
CACHE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "research.json"
CACHE_TTL_S = 6 * 3600
RESEARCH_TIMEOUT_S = float(os.getenv("COUNCIL_RESEARCH_TIMEOUT_S", "90"))
MAX_QUERIES = 2

_PRICE = re.compile(r"^(?:US\$|USD\s*|\$)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*USD)?$", re.I)


def queries_for(analysis: Analysis) -> list[str]:
    """Wishes lead, then interests; one direction per query (never mash hobbies together)."""
    out: list[str] = []
    for c in analysis.of("wish") + analysis.of("interest"):
        q = c.phrase
        if c.kind == "interest" and any(p.phrase == "handmade" or p.phrase.startswith("handmade") for p in analysis.of("preference")):
            q = f"handmade {q}" if "handmade" not in q else q
        if q not in out:
            out.append(q)
    return out[:MAX_QUERIES]


def _price_minor(price: Any, numeric: Any) -> int | None:
    numeric_minor = round(float(numeric) * 100) if isinstance(numeric, (int, float)) and numeric >= 0 else None
    if price in (None, ""):
        return numeric_minor
    if not isinstance(price, str):
        return None
    m = _PRICE.match(price.strip())
    if not m:
        return None
    minor = round(float(m.group(1).replace(",", "")) * 100)
    if numeric_minor is not None and numeric_minor != minor:
        return None  # conflicting observations: report unknown, never guess
    return minor


def normalize_apify(items: Any, retrieved_at: int) -> list[Listing]:
    """Python port of convex/research/normalize.ts for the direct-Apify fallback."""
    out: list[Listing] = []
    pages = items if isinstance(items, list) else []
    for page in pages:
        if not isinstance(page, dict) or (page.get("search_parameters") or {}).get("gl") != "us":
            continue
        for row in page.get("shopping_results") or []:
            if not isinstance(row, dict):
                continue
            title, link = row.get("title"), row.get("product_link")
            if not isinstance(title, str) or not title.strip() or not isinstance(link, str) or not link.startswith("https://"):
                continue
            currency = row.get("currency")
            if currency is not None and str(currency).upper() != "USD":
                continue
            minor = _price_minor(row.get("price"), row.get("extracted_price"))
            thumb = row.get("thumbnail")
            try:
                out.append(
                    Listing(
                        title=title.strip()[:200],
                        source_url=link,
                        price_minor=minor,
                        price_status="observed" if minor is not None else "unknown",
                        seller=row.get("source") if isinstance(row.get("source"), str) else None,
                        image_url=thumb if isinstance(thumb, str) and thumb.startswith("https://") else None,
                        retrieved_at=retrieved_at,
                    )
                )
            except ValueError:
                continue
    return out


def _live_product_url(value: str) -> bool:
    """Keep recorded test/replay sources out of the live research cache."""
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower().rstrip(".")
        if url.scheme != "https" or not host or url.username or url.password:
            return False
        reserved = ("example.com", "example.org", "example.net", "localhost")
        if any(host == domain or host.endswith("." + domain) for domain in reserved):
            return False
        if host.endswith((".test", ".invalid", ".example", ".localhost")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host
    except ValueError:
        return False


class _Cache:
    def __init__(self, path: Path = CACHE_PATH):
        self.path = path

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    @staticmethod
    def key(query: str, budget: int | None) -> str:
        return hashlib.sha256(f"{query.lower().strip()}|{budget}".encode()).hexdigest()[:24]

    def get(self, query: str, budget: int | None) -> list[Listing] | None:
        try:
            hit = self._load().get(self.key(query, budget))
            if not hit or not 0 <= time.time() - hit["storedAt"] <= CACHE_TTL_S:
                return None
            listings = [Listing.model_validate(x) for x in hit["listings"]]
            # A contaminated entry is a cache miss, never a live "found products" event.
            if any(not _live_product_url(x.source_url) for x in listings):
                return None
            return listings
        except (AttributeError, KeyError, TypeError, ValueError):
            return None

    def put(self, query: str, budget: int | None, listings: list[Listing]) -> None:
        if any(not _live_product_url(x.source_url) for x in listings):
            return
        data = self._load()
        if not isinstance(data, dict):
            data = {}
        data[self.key(query, budget)] = {"storedAt": time.time(), "query": query, "listings": [x.model_dump() for x in listings]}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data))
        except OSError:
            pass


async def _via_convex(client: httpx.AsyncClient, query: str, analysis: Analysis, exclude: list[str]) -> list[Listing]:
    site = os.environ["CONVEX_SITE_URL"].rstrip("/")
    resp = await client.post(
        f"{site}/council/research",
        headers={"Authorization": f"Bearer {os.environ['COUNCIL_INGEST_SECRET']}"},
        json={"queryTerms": [query], "mustExclude": exclude, **({"budgetMinor": analysis.budget_minor} if analysis.budget_minor else {})},
        timeout=RESEARCH_TIMEOUT_S,
    )
    try:
        body = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise RuntimeError("Research backend returned invalid JSON") from None
    if not isinstance(body, dict):
        raise RuntimeError("Research backend returned an invalid response")
    if not resp.is_success or not body.get("ok"):
        # Preserve actionable server errors (e.g. missing APIFY_TOKEN), rather
        # than replacing them with httpx's generic 502/URL help text.
        raise RuntimeError(str(body.get("error") or f"Research HTTP {resp.status_code}")[:160])
    return [Listing.model_validate(x) for x in body["listings"]]


async def _via_apify(client: httpx.AsyncClient, query: str, analysis: Analysis) -> list[Listing]:
    token = os.environ["APIFY_TOKEN"]
    payload: dict[str, Any] = {"q": query[:200], "gl": "us", "hl": "en", "max_pages": 1}
    if analysis.budget_minor:
        payload["max_price"] = analysis.budget_minor / 100
    # Single synchronous run; no POST retry (a timed-out request may already be a paid run).
    resp = await client.post(
        f"https://api.apify.com/v2/acts/{VERIFIED_ACTOR}/run-sync-get-dataset-items",
        params={"build": VERIFIED_BUILD, "timeout": int(RESEARCH_TIMEOUT_S) - 5, "maxTotalChargeUsd": "0.20", "clean": "true"},
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
        timeout=RESEARCH_TIMEOUT_S,
    )
    resp.raise_for_status()
    return normalize_apify(resp.json(), int(time.time() * 1000))


def backend() -> str:
    if os.getenv("CONVEX_SITE_URL") and os.getenv("COUNCIL_INGEST_SECRET"):
        return "convex"
    if os.getenv("APIFY_TOKEN"):
        return "apify"
    return "none"


async def research(analysis: Analysis, cache: _Cache | None = None) -> ScoutReport:
    cache = cache or _Cache()
    queries = queries_for(analysis)
    if not queries:
        return ScoutReport(error="Nothing specific to search for yet.")
    exclude = [c.phrase for c in analysis.of("ownership", "dislike")]
    which = backend()
    found: dict[str, Listing] = {}
    used_cache = False
    errors: list[str] = []

    async with httpx.AsyncClient() as client:

        async def one(q: str) -> None:
            nonlocal used_cache
            cached = cache.get(q, analysis.budget_minor)
            if cached is not None:
                used_cache = True
                for x in cached:
                    found.setdefault(x.source_url, x)
                return
            if which == "none":
                errors.append("No research backend configured (set CONVEX_SITE_URL + COUNCIL_INGEST_SECRET, or APIFY_TOKEN).")
                return
            try:
                rows = await (_via_convex(client, q, analysis, exclude) if which == "convex" else _via_apify(client, q, analysis))
            except httpx.TimeoutException:
                errors.append(f"Research for “{q}” timed out.")
                return
            except Exception as err:  # transport, HTTP or validation failure: report, never invent
                errors.append(f"Research for “{q}” failed: {str(err)[:120]}")
                return
            rows = [x for x in rows if _live_product_url(x.source_url)]
            cache.put(q, analysis.budget_minor, rows)
            for x in rows:
                found.setdefault(x.source_url, x)

        # Independent queries run concurrently.
        await asyncio.gather(*(one(q) for q in queries))

    listings = tuple(found.values())
    return ScoutReport(
        listings=listings,
        queries=tuple(queries),
        source=which if (listings or not used_cache) else "none",
        cached=used_cache,
        error=None if listings else ("; ".join(dict.fromkeys(errors)) or "No listings matched."),
    )


async def research_room(run_id: str) -> ScoutReport:
    """The room's persisted Convex job is the only research source for web rooms.

    No disk-cache cross-room reuse and no direct-Apify fallback. Repeated requests
    attach to the same server-owned job rather than starting another paid search.
    """
    async with httpx.AsyncClient(timeout=RESEARCH_TIMEOUT_S) as client:
        response = await client.post(
            os.environ["CONVEX_SITE_URL"].rstrip("/") + "/council/room-research",
            headers={"Authorization": f"Bearer {os.environ['COUNCIL_INGEST_SECRET']}"},
            json={"runId": run_id},
        )
        body = response.json()
        if not response.is_success or not body.get("ok"):
            return ScoutReport(source="convex", error=str(body.get("error", "Research needs recovery."))[:160])
        listings = tuple(Listing.model_validate(x) for x in body["listings"] if _live_product_url(x.get("source_url", "")))
        return ScoutReport(listings=listings, source="convex")
