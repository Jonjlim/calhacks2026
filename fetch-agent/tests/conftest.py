import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Tests never call the model or real services.
os.environ["COUNCIL_USE_LLM"] = "0"
for key in ("CONVEX_SITE_URL", "COUNCIL_INGEST_SECRET", "APIFY_TOKEN", "COUNCIL_BROADCAST_KEY"):
    os.environ.pop(key, None)
