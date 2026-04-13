# Salesforce QA Studio — Web Application

AI-powered test artifact generation for Salesforce QA teams. Built with FastAPI + React and a playful "toon" UI theme.

## Architecture

| Layer     | Tech                                  |
|-----------|---------------------------------------|
| Frontend  | React 18, Vite, Tailwind CSS, Framer Motion |
| Backend   | FastAPI, Pydantic, SSE streaming      |
| LLM       | Google Gemini 2.5 Flash (free tier)   |
| RAG       | ChromaDB + LangChain + nomic-embed-text |
| Auth      | JWT (python-jose) + bcrypt            |

## Features

- **6 AI Agents** — Requirements, Test Cases, Bug Reports, Smoke Tests, Regression, Estimation
- **RAG-grounded** — responses based on uploaded project documents + Salesforce knowledge base
- **Project management** — create projects, upload docs, build per-project vector indexes
- **Jira integration** — generate bug reports and push them to Jira Cloud
- **Salesforce org connect** — authenticate to sandbox/production and fetch org metadata
- **Export** — download results as Excel, CSV, or Markdown
- **History** — browse and filter past agent runs
- **User auth** — local JSON-backed registration/login with JWT tokens

## Quick Start (Local Development)

### Prerequisites

- Python 3.10+
- Node.js 18+
- A free Gemini API key from [aistudio.google.com](https://aistudio.google.com/app/apikey)
- Ollama installed for RAG embeddings only: `ollama pull nomic-embed-text`

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
# Set your Gemini API key in backend/.env:
#   GEMINI_API_KEY=your-key-here
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — the Vite dev server proxies `/api` to the backend.

## Docker Compose

```bash
docker compose up --build
```

Services:
- **frontend** → http://localhost:3000
- **backend** → http://localhost:8000

Set `GEMINI_API_KEY` in `backend/.env` before starting.

## Project Structure

```
sf-qa-web/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py             # Pydantic settings
│   ├── core/                 # Business logic
│   │   ├── orchestrator.py   # RAG + Ollama coordinator
│   │   ├── prompts/prompts.py
│   │   ├── user_auth.py      # JSON user store + JWT
│   │   ├── project_manager.py
│   │   ├── jira_client.py
│   │   ├── sf_org_fetcher.py
│   │   ├── exporter.py
│   │   └── table_parse.py
│   ├── rag/                  # Vector store layer
│   │   ├── embedder.py
│   │   ├── ingestor.py
│   │   └── retriever.py
│   ├── routers/              # API routes
│   │   ├── auth.py
│   │   ├── agents.py
│   │   ├── projects.py
│   │   ├── history.py
│   │   ├── jira.py
│   │   ├── salesforce.py
│   │   ├── knowledge.py
│   │   ├── exports.py
│   │   └── deps.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/client.js     # Axios + JWT interceptor
│   │   ├── context/AuthContext.jsx
│   │   ├── components/       # Reusable UI (Layout, Sidebar, AgentForm…)
│   │   ├── pages/            # Route pages (Hub, TestCases, Projects…)
│   │   └── styles/toon-theme.css
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```
