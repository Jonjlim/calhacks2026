"""Keeper — constraints and budget.

Plain, auditable rules over real listings:
  hard  — over budget (observed price), already owned, disliked, duplicate
  soft  — style preferences such as "handmade" (noted, never excluding)
Every exclusion carries the reason, so the Courier can explain it.
"""

from __future__ import annotations

import json
import re

from . import llm
from .contracts import Analysis, Exclusion, KeeperReport, Listing, Verdict

# An owned "beginner kit" also rules out starter / beginner sets of the same thing.
_KIT_WORDS = {"kit", "set", "starter", "beginner", "beginners"}


def _tokens(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2}


def _matches(phrase: str, title: str) -> bool:
    want = _tokens(phrase)
    have = _tokens(title)
    if not want:
        return False
    if want <= have:
        return True
    # "beginner kit" owned → also a "starter set" listing.
    return bool(want & _KIT_WORDS) and len(have & _KIT_WORDS) >= 2


def check(analysis: Analysis, listings: list[Listing], limit: int = 5) -> KeeperReport:
    budget = analysis.budget_minor
    owned = [c.phrase for c in analysis.of("ownership")]
    disliked = [c.phrase for c in analysis.of("dislike")]
    prefs = [c.phrase for c in analysis.of("preference")]

    hard: list[str] = []
    if budget is not None:
        hard.append(f"Observed price at or under ${budget / 100:.2f}")
    hard += [f"Not already owned: {p}" for p in owned]
    hard += [f"Avoid: {p}" for p in disliked]
    soft = [f"Prefers {p} — favoured, not required" for p in prefs]

    kept: list[Verdict] = []
    excluded: list[Exclusion] = []
    seen_titles: set[str] = set()
    for x in listings:
        norm = " ".join(sorted(_tokens(x.title)))
        if norm in seen_titles:
            excluded.append(Exclusion(title=x.title, reason="Duplicate of another option"))
            continue
        seen_titles.add(norm)
        hit = next((p for p in owned if _matches(p, x.title)), None)
        if hit:
            excluded.append(Exclusion(title=x.title, reason=f"They already own a {hit}"))
            continue
        bad = next((p for p in disliked if _matches(p, x.title)), None)
        if bad:
            excluded.append(Exclusion(title=x.title, reason=f"They don't like {bad}"))
            continue
        notes: list[str] = []
        if budget is not None:
            if x.price_minor is None:
                notes.append("Price not observed — check before buying")
            elif x.price_minor > budget:
                excluded.append(Exclusion(title=x.title, reason=f"${x.price_minor / 100:.2f} is over the ${budget / 100:.0f} budget"))
                continue
            else:
                notes.append(f"Within budget (${(budget - x.price_minor) / 100:.2f} to spare)")
        for p in prefs:
            if _tokens(p) & _tokens(x.title + " " + (x.seller or "")):
                notes.append(f"Matches their {p} preference")
        kept.append(Verdict(listing=x, notes=tuple(notes)))

    # Preference matches first, then observed prices, then cheaper.
    def rank(v: Verdict) -> tuple:
        pref = any(n.startswith("Matches") for n in v.notes)
        return (not pref, v.listing.price_minor is None, v.listing.price_minor or 0)

    kept.sort(key=rank)
    return KeeperReport(kept=tuple(kept[:limit]), excluded=tuple(excluded), hard_rules=tuple(hard), soft_notes=tuple(soft))


def summary(r: KeeperReport) -> str:
    return f"{len(r.kept)} fit, {len(r.excluded)} excluded" + (f" · {r.hard_rules[0]}" if r.hard_rules else "")


_NOTE_FORBIDDEN = re.compile(r"[\d$€£]")
MAX_NOTES = 10


async def explain_with_model(analysis: Analysis, report: KeeperReport) -> KeeperReport:
    """ASI:One may add one short 'why it fits' note per kept listing.

    It never keeps, excludes or reorders anything, and notes containing digits
    or currency symbols are dropped so prices only ever come from listings.
    """
    if not report.kept or not llm.enabled():
        return report
    clues = {kind: [c.phrase for c in analysis.of(kind)] for kind in ("interest", "wish", "preference", "ownership", "dislike")}
    items = [{"index": i, "title": v.listing.title[:120]} for i, v in enumerate(report.kept)]
    prompt = (
        "For each gift listing, write one short reason (under 100 characters, no prices or numbers) why it suits the recipient, "
        "using only these clues. Reply as JSON {\"notes\":[{\"index\":0,\"why\":\"...\"}]}.\n"
        f"Clues: {json.dumps(clues)}\nListings: {json.dumps(items)}"
    )
    raw = await llm.ask_json(prompt, max_tokens=400)
    notes = raw.get("notes") if raw else None
    if not isinstance(notes, list):
        return report
    why: dict[int, str] = {}
    for n in notes:
        if isinstance(n, dict) and isinstance(n.get("index"), int) and isinstance(n.get("why"), str):
            text = " ".join(n["why"].split()).strip(" .")
            if 0 <= n["index"] < len(report.kept) and 8 <= len(text) <= 120 and not _NOTE_FORBIDDEN.search(text):
                why.setdefault(n["index"], text)
    if not why:
        return report
    kept = tuple(
        Verdict(listing=v.listing, notes=(v.notes + (f"Fit: {why[i]}",))[:MAX_NOTES]) if i in why else v
        for i, v in enumerate(report.kept)
    )
    return report.model_copy(update={"kept": kept})
