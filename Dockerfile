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
    pkg-config && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /build/dist ./static

RUN mkdir -p data logs projects knowledge_base rag/vector_store rag/project_stores

# Render injects $PORT (default 10000); fall back to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Shell-form CMD wrapped in `sh -c` so signals propagate AND $PORT is expanded.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
