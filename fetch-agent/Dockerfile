# Persistent host for the Unwrap Gift Council uAgent (one long-running process).
# Build from the repository root so the shared decoration library is included:
#   docker build -f fetch-agent/Dockerfile -t unwrap-council .
FROM python:3.12.7-slim

WORKDIR /app
COPY fetch-agent/requirements.txt fetch-agent/requirements.txt
RUN pip install --no-cache-dir -r fetch-agent/requirements.txt
COPY lib/council/library.json lib/council/library.json
COPY fetch-agent/agent.py fetch-agent/README.md fetch-agent/
COPY fetch-agent/council fetch-agent/council

WORKDIR /app/fetch-agent
ENV PYTHONUNBUFFERED=1
# Hosts such as Render inject PORT; agent.py listens on it (AGENT_PORT or 8001 otherwise).
CMD ["python", "agent.py"]
