"""Courier — prepares the final answer from real results only.

Every product line comes from a Listing (title, https source link, observed
price, retrieval time). When research found nothing, the reply says so and
offers search ideas clearly marked as unverified, never as products.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .contracts import Analysis, DecorationSpec, KeeperReport, ScoutReport


def _money(minor: int | None) -> str:
    return f"${minor / 100:.2f}" if minor is not None else "price not observed"


def _when(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%b %d, %H:%M UTC")


def compose(analysis: Analysis, scout: ScoutReport, keeper: KeeperReport, decorations: list[DecorationSpec]) -> str:
    who = analysis.recipient or "them"
    head = f"## Gift ideas for {who}"
    meta = [x for x in (analysis.occasion, f"budget ${analysis.budget_minor / 100:.0f}" if analysis.budget_minor is not None else None) if x]
    lines = [head + (f" ({', '.join(meta)})" if meta else ""), ""]

    heard = [f"**{k}:** {', '.join(c.phrase for c in analysis.of(kind))}" for kind, k in (("interest", "Loves"), ("wish", "Wants"), ("preference", "Prefers"), ("ownership", "Already has"), ("dislike", "Avoid")) if analysis.of(kind)]
    if heard:
        lines += ["**What the Archivist heard** — " + " · ".join(heard), ""]

    if keeper.kept:
        label = " (from cache — prices as observed at the time shown)" if scout.cached else ""
        lines.append(f"**Recommendations** — researched by the Scout{label}, checked by the Keeper:")
        for i, v in enumerate(keeper.kept, 1):
            x = v.listing
            seller = f" at {x.seller}" if x.seller else ""
            why = "; ".join(v.notes) or "Matches the clues"
            # Markdown links break on raw spaces; escape them for display only.
            lines.append(f"{i}. [{x.title}]({x.source_url.replace(' ', '%20')}) — {_money(x.price_minor)}{seller} · observed {_when(x.retrieved_at)}")
            lines.append(f"   _Why:_ {why}.")
        lines.append("")
    else:
        lines.append("**No verified listings yet.** " + (scout.error or "Research returned nothing that passed the checks."))
        if scout.queries:
            lines.append("Search ideas (not verified products): " + ", ".join(f"“{q}”" for q in scout.queries))
        lines.append("")

    if keeper.excluded:
        lines.append("**Left out by the Keeper:** " + "; ".join(f"{e.title[:60]} — {e.reason}" for e in keeper.excluded[:4]))
    if keeper.soft_notes:
        lines.append("**Soft notes:** " + "; ".join(keeper.soft_notes))
    wishes = analysis.of("wish")
    if wishes:
        lines.append(f"**Experience idea:** {who} wants to try {wishes[0].phrase} — a local class or voucher may beat any product (search your area; not a verified listing).")
    if decorations:
        lines.append("**Muse's charm for the gift box:** " + ", ".join(f"{d.label} ({d.assetId.replace('_', ' ')})" for d in decorations))
    if analysis.uncertainties:
        lines.append("**Still unknown:** " + " ".join(analysis.uncertainties))
    return "\n".join(lines).strip()


def summary(keeper: KeeperReport) -> str:
    return f"Delivered {len(keeper.kept)} recommendation{'s' if len(keeper.kept) != 1 else ''}"
