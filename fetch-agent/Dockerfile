# Persistent host for the Unwrap Gift Council: five uAgents in one Bureau process.
# Build from the repository root so the shared decoration library is included:
#   docker build -f fetch-agent/Dockerfile -t unwrap-council .
FROM python:3.12.7-slim

WORKDIR /app
COPY fetch-agent/requirements.txt fetch-agent/requirements.txt
RUN pip install --no-cache-dir -r fetch-agent/requirements.txt
COPY lib/council/library.json lib/council/library.json
COPY fetch-agent/agent.py fetch-agent/print_addresses.py fetch-agent/README.md fetch-agent/
COPY fetch-agent/council fetch-agent/council
COPY fetch-agent/readmes fetch-agent/readmes

WORKDIR /app/fetch-agent
ENV PYTHONUNBUFFERED=1
# Hosts such as Render inject PORT; the Bureau's one HTTP server (Courier REST + inspector) listens on it (AGENT_PORT or 8001 otherwise).
CMD ["python", "agent.py"]
