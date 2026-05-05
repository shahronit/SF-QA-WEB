# ---- Stage 1: Build React frontend ----
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Python backend + static frontend ----
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libcairo2-dev \
    pkg-config \
    curl \
    ca-certificates \
    tar && \
    rm -rf /var/lib/apt/lists/*

# Cursor CLI: official installer drops the binary at
# /root/.local/bin/cursor-agent (and an `agent` alias). The orchestrator's
# _discover_cursor_bin() in backend/routers/deps.py already probes that
# path, but we also prepend it to PATH so plain
# `subprocess.run(["cursor-agent", ...])` resolves without the full path.
# Authentication is hydrated at container start by /app/start.sh from a
# Render Secret File mounted at /etc/secrets/cursor-auth.tgz; without that
# file the binary is present but unauthenticated and the orchestrator
# routes everything to Gemini.
RUN curl -fsS https://cursor.com/install | bash
ENV PATH="/root/.local/bin:${PATH}"

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /build/dist ./static

# Container entrypoint: hydrates Cursor credentials (if the Secret File
# is present) then exec's uvicorn so signals still propagate cleanly.
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

RUN mkdir -p data logs projects knowledge_base rag/vector_store rag/project_stores

# Render injects $PORT (default 10000); fall back to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

CMD ["/app/start.sh"]
