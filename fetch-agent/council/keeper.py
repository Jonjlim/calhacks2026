"""Keeper — constraints and budget.

Plain, auditable rules over real listings:
  hard  — over budget (observed price), already owned, disliked, duplicate
  soft  — style preferences such as "handmade" (noted, never excluding)
Every exclusion carries the reason, so the Courier can explain it.
"""

from __future__ import annotations

import re

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
