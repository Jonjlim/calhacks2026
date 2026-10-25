#!/usr/bin/env python3
"""Deploy (or update) Moss, Unwrap's voice guide, on the Moss Platform (MAP-026, D29).

One-time setup, rerun after changing agent.json. It sends only the prompt and
greeting in agent.json: no tools, no room data and no secrets beyond the
project credentials used to authenticate.

  cd scripts/moss-voice
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  MOSS_PROJECT_ID=... MOSS_PROJECT_KEY=... MOSS_VOICE_AGENT_ID=... .venv/bin/python deploy.py

Create the voice agent (and get MOSS_VOICE_AGENT_ID) in the Moss Platform first,
and pick its voice there: a young female voice (agent.json → voice).
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from moss_voice_agent_manager import MossVoiceClient

load_dotenv(Path(__file__).with_name(".env"))
AGENT = json.loads(Path(__file__).with_name("agent.json").read_text())


def main() -> int:
    project_id = os.getenv("MOSS_PROJECT_ID")
    project_key = os.getenv("MOSS_PROJECT_KEY")
    voice_agent_id = os.getenv("MOSS_VOICE_AGENT_ID")
    missing = [n for n, v in (("MOSS_PROJECT_ID", project_id), ("MOSS_PROJECT_KEY", project_key), ("MOSS_VOICE_AGENT_ID", voice_agent_id)) if not v]
    if missing:
        print(f"Missing {', '.join(missing)}. Set them in scripts/moss-voice/.env (git-ignored) or the environment.")
        return 1
    client = MossVoiceClient(project_id=project_id, project_key=project_key)
    try:
        response = client.deploy(
            voice_agent_id=voice_agent_id,
            prompt=AGENT["prompt"],
            initial_greeting=AGENT["greeting"],
            project_name="unwrap-moss-guide",
        )
    except Exception as error:  # the error text can echo request details; keep it short
        print(f"Deploy failed: {type(error).__name__}: {str(error)[:300]}")
        return 1
    print(f"Deployed Moss ({AGENT['name']}).")
    if getattr(response, "deployment_url", None):
        print(f"Dashboard: {response.deployment_url}")
    print("Voice: set a young female voice on this agent in the Moss Platform (see agent.json).")
    print("Then set MOSS_PROJECT_ID, MOSS_PROJECT_KEY and MOSS_VOICE_AGENT_ID in the Next.js server env.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
