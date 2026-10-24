"""Archivist — memory understanding.

Reads the recipient memories / request text and extracts structured clues:
interests, wishes, style preferences, things already owned, dislikes, the
budget and the occasion, plus what is still unknown. The rule-based reader is
deterministic and works offline; when an ASI:One key is configured, the model
may add clues it missed, but its output is validated and can never remove or
override what the rules found.
"""

from __future__ import annotations

import asyncio
import json
import os
import re

from pydantic import BaseModel, ValidationError

from .contracts import Analysis, Clue, Memory

OCCASIONS = ("birthday", "anniversary", "graduation", "wedding", "housewarming", "christmas", "holiday", "retirement", "farewell", "valentine")

# (kind, pattern). Order matters: ownership/dislike before generic "has"/"likes".
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("ownership", re.compile(r"\b(?:already\s+(?:owns?|has|have|got)|owns?\s+(?:an?\s+|the\s+)?|has\s+(?:an?\s+|the\s+)?)(?P<x>[^.,;]+?)(?:\s+already)?(?=$|[.,;]|\s+and\s)", re.I)),
    ("dislike", re.compile(r"\b(?:hates?|dislikes?|doesn'?t\s+(?:like|want)|does\s+not\s+(?:like|want)|can'?t\s+stand|allergic\s+to|no)\s+(?P<x>[^.,;]+?)(?=$|[.,;]|\s+and\s)", re.I)),
    ("wish", re.compile(r"\b(?:wants?\s+to|would\s+love\s+to|has\s+always\s+wanted\s+to|dreams?\s+of|hopes?\s+to|wishes?\s+(?:to|for)|wants?)\s+(?P<x>[^.,;]+?)(?=$|[.,;]|\s+and\s)", re.I)),
    ("preference", re.compile(r"\b(?:prefers?|is\s+into\s+|favou?rs?)\s+(?P<x>[^.,;]+?)(?=$|[.,;]|\s+and\s)", re.I)),
    ("interest", re.compile(r"\b(?:loves?|likes?|enjoys?|adores?|is\s+obsessed\s+with|collects?|is\s+passionate\s+about)\s+(?P<x>[^.,;]+?)(?=$|[.,;]|\s+and\s+(?:she|he|they|wants|has|already|prefers|our|the|budget)\b)", re.I)),
]

FILLER = re.compile(r"^(?:a|an|the|some|her|his|their|to|try|trying|learn|learning|doing)\s+", re.I)
BUDGET = re.compile(r"(?:budget\s+(?:is|of)?\s*|under\s+|up\s+to\s+|around\s+|about\s+|max(?:imum)?\s+)?\$\s?(\d{1,5}(?:\.\d{1,2})?)|(\d{1,5})\s*(?:dollars|usd)\b", re.I)
RECIPIENT = re.compile(r"\bfor\s+([A-Z][a-z]{1,20})\b|^([A-Z][a-z]{1,20})\s+(?:loves?|likes?|wants?|enjoys?|is|has|already)\b", re.M)


def _phrase(raw: str) -> str:
    p = raw.strip().strip("\"'")
    # Keep "try a pottery class" as "pottery class" but leave meaningful nouns alone.
    for _ in range(3):
        p = FILLER.sub("", p)
    p = re.sub(r"\s+(?:things|stuff)$", "", p, flags=re.I)
    return re.sub(r"\s+", " ", p).strip(" .")[:80]


def _split_list(phrase: str) -> list[str]:
    """'pottery and handmade crafts' -> ['pottery', 'handmade crafts']."""
    parts = re.split(r"\s*(?:,|\band\b|&)\s*", phrase)
    return [p for p in (x.strip() for x in parts) if p]


def read_memory(memory: Memory) -> list[Clue]:
    text = memory.text
    clues: list[Clue] = []
    taken: list[tuple[int, int]] = []
    for kind, pattern in PATTERNS:
        for m in pattern.finditer(text):
            span = m.span("x")
            if any(a <= span[0] < b for a, b in taken):
                continue
            taken.append(span)
            phrases = _split_list(m.group("x")) if kind in ("interest", "preference") else [m.group("x")]
            for raw in phrases:
                p = _phrase(raw)
                if p and not BUDGET.search(p) and len(p) >= 3:
                    clues.append(Clue(kind=kind, phrase=p.lower(), memory_id=memory.memory_id))
    return clues


def analyze_rules(memories: list[Memory]) -> Analysis:
    joined = "\n".join(m.text for m in memories)
    budget = None
    for m in BUDGET.finditer(joined):
        amount = m.group(1) or m.group(2)
        if amount:
            budget = round(float(amount) * 100)
    occasion = next((o for o in OCCASIONS if re.search(rf"\b{o}\b", joined, re.I)), None)
    rm = RECIPIENT.search(joined)
    recipient = (rm.group(1) or rm.group(2)) if rm else None
    if recipient and recipient.lower() in {"she", "he", "they", "our", "the", "find", "gift"}:
        recipient = None
    seen: set[tuple[str, str]] = set()
    clues: list[Clue] = []
    for mem in memories:
        for c in read_memory(mem):
            if (c.kind, c.phrase) not in seen:
                seen.add((c.kind, c.phrase))
                clues.append(c)
    unknown = []
    if budget is None:
        unknown.append("No budget given — options are not price-filtered.")
    if not any(c.kind in ("interest", "wish") for c in clues):
        unknown.append("No interests or wishes found to search for.")
    if occasion is None:
        unknown.append("Occasion not mentioned.")
    return Analysis(recipient=recipient, occasion=occasion, budget_minor=budget, clues=tuple(clues), uncertainties=tuple(unknown))


class _LlmClue(BaseModel):
    kind: str
    phrase: str


class _LlmAnalysis(BaseModel):
    clues: list[_LlmClue] = []


async def enrich_with_model(analysis: Analysis, memories: list[Memory], timeout_s: float = 12.0) -> Analysis:
    """Optionally add clues the rules missed. Never removes rule findings; failures are ignored."""
    key = os.getenv("ASI1_API_KEY")
    if not key or os.getenv("COUNCIL_USE_LLM", "1") == "0":
        return analysis
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(base_url="https://api.asi1.ai/v1", api_key=key, timeout=timeout_s)
        prompt = (
            "Extract gift clues as JSON {\"clues\":[{\"kind\":\"interest|wish|preference|ownership|dislike\",\"phrase\":\"2-4 words\"}]}. "
            "Only include facts stated in the text. Text:\n" + "\n".join(m.text for m in memories)[:3000]
        )
        resp = await asyncio.wait_for(
            client.chat.completions.create(model="asi1", messages=[{"role": "user", "content": prompt}], max_tokens=400),
            timeout=timeout_s,
        )
        content = resp.choices[0].message.content or ""
        match = re.search(r"\{.*\}", content, re.S)
        parsed = _LlmAnalysis.model_validate(json.loads(match.group(0))) if match else _LlmAnalysis()
    except (Exception, ValidationError):  # model is optional; never fail the run because of it
        return analysis
    have = {(c.kind, c.phrase) for c in analysis.clues}
    extra: list[Clue] = []
    anchor = memories[0].memory_id
    for c in parsed.clues[:8]:
        kind = c.kind.strip().lower()
        phrase = _phrase(c.phrase).lower()
        if kind in ("interest", "wish", "preference", "ownership", "dislike") and 3 <= len(phrase) <= 80 and (kind, phrase) not in have:
            # Only keep model clues whose words actually appear in the text.
            if all(w in " ".join(m.text.lower() for m in memories) for w in phrase.split()[:2]):
                extra.append(Clue(kind=kind, phrase=phrase, memory_id=anchor))  # type: ignore[arg-type]
                have.add((kind, phrase))
    if not extra:
        return analysis
    return analysis.model_copy(update={"clues": analysis.clues + tuple(extra)})


async def analyze(memories: list[Memory]) -> Analysis:
    return await enrich_with_model(analyze_rules(memories), memories)


def summary(a: Analysis) -> str:
    parts = []
    for kind, label in (("interest", "loves"), ("wish", "wants"), ("preference", "prefers"), ("ownership", "owns"), ("dislike", "avoid")):
        items = [c.phrase for c in a.of(kind)]
        if items:
            parts.append(f"{label}: {', '.join(items[:3])}")
    if a.budget_minor is not None:
        parts.append(f"budget ${a.budget_minor / 100:.0f}")
    return "; ".join(parts)[:200] or "No clues found yet."
