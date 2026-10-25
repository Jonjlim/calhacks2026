"""ASI:One access shared by the council's reasoning roles.

The model is optional everywhere: no key, `COUNCIL_USE_LLM=0`, a timeout, or
unparsable output all return None and the caller keeps its deterministic
answer. Callers validate whatever comes back before using it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

log = logging.getLogger("council.llm")

ASI1_BASE_URL = "https://api.asi1.ai/v1"
ASI1_MODEL = "asi1"


def enabled() -> bool:
    return bool(os.getenv("ASI1_API_KEY")) and os.getenv("COUNCIL_USE_LLM", "1") != "0"


async def ask_json(prompt: str, max_tokens: int = 400, timeout_s: float = 12.0) -> dict[str, Any] | None:
    if not enabled():
        return None
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(base_url=ASI1_BASE_URL, api_key=os.environ["ASI1_API_KEY"], timeout=timeout_s)
        resp = await asyncio.wait_for(
            client.chat.completions.create(model=ASI1_MODEL, messages=[{"role": "user", "content": prompt}], max_tokens=max_tokens),
            timeout=timeout_s,
        )
        content = resp.choices[0].message.content or ""
        match = re.search(r"\{.*\}", content, re.S)
        parsed = json.loads(match.group(0)) if match else None
        return parsed if isinstance(parsed, dict) else None
    except Exception as err:  # the model never fails a run
        log.info("ASI:One call skipped: %s", str(err)[:120])
        return None
