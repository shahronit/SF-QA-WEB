# QA Studio — AI Test Artifact Generator

> **QA Studio · by Astound Digital** — Created &amp; Managed by the **QDEC Team**.

A single-deployable web app that helps the Astound Digital delivery QA team generate the full Software Testing Life Cycle (STLC) of artifacts — requirements analysis, test plans, test cases, bug reports, automation scripts, RTM, UAT, execution & closure reports — from short prompts grounded in your project documents and Jira tickets.

Built with **FastAPI + React** and shipped as one process: the React SPA is built into `backend/static/` and served by FastAPI on port `8080`. The frontend wears an Astound co-brand (deep-violet / magenta / cyan aurora theme, Sora display font, vendored 3D iconography) without renaming the application.

> Companion docs:
>
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system layout, modules, request flow
> - [`FLOW_DIAGRAM.md`](./FLOW_DIAGRAM.md) — end-to-end user & agent flow diagrams

---

## Highlights

- **17 specialised AI agents** organised in two phases (Manual QA + Advanced QA), driven by a shared `AgentForm` UI.
- **RAG over project docs** — per-project ChromaDB vector store + a global Salesforce knowledge base; uses Ollama `nomic-embed-text` for embeddings.
- **Salesforce or General mode** — every agent has a single QA-mode toggle that switches its prompt between Salesforce-aware (Apex, SOQL, Experience/Commerce Cloud) and product-agnostic language.
- **Jira Cloud integration** — connect once, then browse projects, sprints, multi-select tickets (Test Plan), auto-detect Jira keys typed in any field, push bug reports back as issues, and link them via "Relates" / etc.
- **Test management push** — send generated test cases to **Xray Cloud**, **Zephyr Scale**, or native Jira `Test` issues, with optional user-story linkage tagged on every test case.
- **Google Drive integration** — per-user OAuth so the Jira full-issue view auto-fetches attached design docs.
- **1-click STLC pack** — run Requirements → Plan → Test Cases → Execution → Closure as a single chained SSE stream.
- **Customise the system prompt** (Test Case Development) — view the default prompt, edit it, persist the override to `localStorage`, with a 32 KB cap. Default prompts on disk are never modified.
- **Streaming everywhere** — Server-Sent Events for token-by-token LLM output, with auto-fallback through a configurable model chain and exponential backoff on 429/503.
- **Exports** — Markdown, CSV, Excel, and PDF (via `xhtml2pdf`).
- **Storage** — local JSON files by default, or **Firebase Firestore** for multi-user/multi-device persistence (users, projects, sessions, run history).

---

## Architecture at a glance

| Layer        | Tech                                                                                        |
|--------------|---------------------------------------------------------------------------------------------|
| Frontend     | React 18, Vite 6, React Router 6, Tailwind CSS, Framer Motion, react-hot-toast, react-markdown + remark-gfm |
| Backend API  | FastAPI, Pydantic v2, `sse-starlette`, async + threadpool                                   |
| LLM          | **Google Gemini** (`google-genai` ≥ 1.0) — primary. OpenAI ChatGPT plumbing is included but the user-facing option is currently disabled |
| RAG          | ChromaDB ≥ 0.5, LangChain ≥ 0.3, Ollama `nomic-embed-text` embeddings                       |
| Auth         | bcrypt + JWT (`python-jose`)                                                                |
| Persistence  | Local JSON (`backend/data/`) **or** Firestore (`firebase-admin`)                            |
| Integrations | Jira Cloud REST + Agile, Xray Cloud, Zephyr Scale, Google Drive OAuth                       |
| Exports      | `openpyxl`, `markdown`, `xhtml2pdf` + `pdfplumber`                                          |
| Packaging    | `start.bat` (Windows one-shot), Docker / Docker Compose, Render-ready                       |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the detailed component diagram.

---

## Agent catalogue

Every agent renders the same `AgentForm` shell — Project Context (RAG) + Link Previous Agent Output (chain) sit side-by-side above the Jira picker, then the agent-specific input fields, then a streamed Markdown report with Excel/CSV/PDF/Markdown export buttons.

### Manual QA

| Route               | Agent key       | What it does |
|---------------------|-----------------|--------------|
| `/requirements`     | `requirement`   | Acceptance criteria, edge cases, gaps |
| `/test-plan`        | `test_plan`     | Combined Test Plan & Strategy doc; supports multi-select tickets and "use entire sprint as scope" |
| `/testcases`        | `testcase`      | Markdown table of production-ready test cases; optional **custom system prompt** (per-device) |
| `/smoke`            | `smoke`         | Comprehensive smoke test plan |
| `/regression`       | `regression`    | Regression test plan covering impacted areas |
| `/bugs`             | `bug_report`    | Astound-standard bug report; one click to push as a Jira issue with optional "Relates to" link |
| `/closure-report`   | `closure_report`| Test Closure Report |

### Advanced QA Agents

| Route               | Agent key        | What it does |
|---------------------|------------------|--------------|
| `/estimation`       | `estimation`     | Multi-technique effort estimation (Astound playbook + UCP/FPA/3-point) |
| `/automation-plan`  | `automation_plan`| Automation strategy + tooling matrix |
| `/test-data`        | `test_data`      | Realistic test data fixtures for named entities |
| `/rtm`              | `rtm`            | Requirements Traceability Matrix |
| `/copado-scripts`   | `copado_script`  | Production-ready scripts in your chosen framework (Provar, Selenium, Playwright, Cypress, Postman, etc.) |
| `/uat-plan`         | `uat_plan`       | UAT Plan + sign-off checklist |
| `/execution-report` | `exec_report`    | Daily / cycle-end execution report |
| `/rca`              | `rca`            | Structured root-cause analysis |
| `/stlc-pack`        | (multi-agent)    | One-click chained pack: Requirements → Plan → Test Cases → Execution → Closure, streamed phase-by-phase |

---

## Quick start (Windows one-liner)

```powershell
cd C:\path\to\sf-qa-web
.\start.bat
```

`start.bat` runs `npm install` → `npm run build`, copies `frontend/dist` → `backend/static/`, activates `backend/venv`, and launches Uvicorn on `http://localhost:8080`. Open that URL and log in — that's it.

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** (only needed if you want to rebuild the frontend; otherwise existing `backend/static/` is reused)
- **Ollama** with the embedding model: `ollama pull nomic-embed-text` (only required if you build / use RAG indexes)
- **Google Gemini API key** — get one free at [aistudio.google.com](https://aistudio.google.com/app/apikey)

### `backend/.env` (minimum)

```env
JWT_SECRET=change-me-to-a-random-string

GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-pro
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.0-flash

# Optional — enables Firestore-backed multi-user persistence
STORAGE_BACKEND=local
# FIREBASE_CREDENTIALS_PATH=C:\path\to\firebase-adminsdk.json
# FIREBASE_PROJECT_ID=your-project-id

# Optional — Google Drive auto-fetch in Jira full-issue view
# GOOGLE_OAUTH_CLIENT_ID=...
# GOOGLE_OAUTH_CLIENT_SECRET=...
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8080/api/gdrive/callback
```

See [`backend/.env.example`](./backend/.env.example) for the full annotated template.

---

## Manual development setup

If you don't want to use `start.bat`, you can run the two halves separately.

### Backend (FastAPI on `:8080` or `:8000`)

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

### Frontend (Vite dev server on `:3000`)

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend, so the SPA is served at `http://localhost:3000` while the API stays on `http://localhost:8080`.

### Production build into the FastAPI app

```bash
cd frontend
npm run build
# Then refresh backend/static/ from frontend/dist (start.bat does this for you)
```

---

## Docker

```bash
docker compose up --build
```

The single image runs FastAPI on port `8080` and serves the pre-built React SPA from `backend/static/`. Mount your `backend/.env` and (optionally) a Firebase service-account JSON via `FIREBASE_CREDENTIALS_PATH`.

`render.yaml` is included for one-click deploys to Render.

---

## Project layout

```
sf-qa-web/
├── backend/
│   ├── main.py                 # FastAPI app + SPA fallback
│   ├── config.py                # pydantic-settings (.env loader)
│   ├── core/
│   │   ├── orchestrator.py      # RAG + LLM coordinator (Gemini / OpenAI adapters)
│   │   ├── prompts/prompts.py   # All 17 agent prompts
│   │   ├── user_auth.py         # bcrypt + JWT, JSON or Firestore backed
│   │   ├── project_manager.py   # Per-project doc store + vector index
│   │   ├── jira_client.py       # Jira Cloud REST + Agile (boards, sprints)
│   │   ├── jira_links.py        # Issue-key extraction helpers
│   │   ├── test_management/     # Xray, Zephyr Scale, native Jira Test
│   │   ├── gdrive_client.py     # Google Drive OAuth + file fetch
│   │   ├── sf_org_fetcher.py    # Salesforce org metadata
│   │   ├── exporter.py          # MD / CSV / Excel / PDF
│   │   ├── table_parse.py       # GFM table parsing for exports
│   │   └── firestore_db.py      # Optional Firestore client
│   ├── rag/
│   │   ├── embedder.py          # Chroma + Ollama `nomic-embed-text`
│   │   ├── ingestor.py          # PDF / DOCX / MD chunking
│   │   └── retriever.py         # Combined global + per-project retrieval
│   ├── routers/
│   │   ├── auth.py              # /api/auth
│   │   ├── agents.py            # /api/agents/{name}/(prompt|run|stream)
│   │   ├── projects.py          # /api/projects
│   │   ├── history.py           # /api/history
│   │   ├── jira.py              # /api/jira/*  (connect, projects, sprints, search, create-bug)
│   │   ├── gdrive.py            # /api/gdrive/* (OAuth flow + file read)
│   │   ├── salesforce.py        # /api/sf/*    (org login, metadata)
│   │   ├── knowledge.py         # /api/kb/*    (build / status)
│   │   ├── exports.py           # /api/exports/{excel|csv|markdown|pdf}
│   │   ├── llm.py               # /api/llm/(providers|switch)
│   │   ├── stlc_pack.py         # /api/stlc/run (chained SSE pack)
│   │   ├── test_management.py   # /api/test-management/* (Xray, Zephyr, native Jira)
│   │   └── deps.py              # Auth + orchestrator singletons
│   ├── data/                    # Local JSON store (users, projects)
│   ├── projects/                # Per-project docs + Chroma indexes
│   ├── knowledge_base/          # Global Salesforce KB source docs
│   ├── logs/                    # JSONL agent run log (when not using Firestore)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Routes + provider tree
│   │   ├── api/client.js        # Axios + JWT interceptor
│   │   ├── context/             # AuthContext, JiraContext, TestManagementContext, AgentResultsContext
│   │   ├── components/
│   │   │   ├── AgentForm.jsx        # Shared agent UI shell (RAG + Jira + linked output + streaming)
│   │   │   ├── JiraIssuePicker.jsx  # Sprint filter, key search, multi-select
│   │   │   ├── JiraConnector.jsx
│   │   │   ├── JiraBugPush.jsx      # On bug-report agent only
│   │   │   ├── TestManagementPush.jsx
│   │   │   ├── CustomPromptEditor.jsx  # Test Case agent only
│   │   │   ├── ReportPanel.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── motion/            # Confetti, GeneratingScene, FadeIn, Counter, …
│   │   │   ├── insights/          # CoverageDonut, ExecutionBars, TechniqueCompare …
│   │   │   └── mascots/           # Phase mascots (Requirement, Design, Execution, Closure …)
│   │   ├── pages/                 # 1 page per agent + Hub, Projects, History, Login, StlcPack
│   │   └── styles/toon-theme.css
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
├── render.yaml
├── start.bat
├── ARCHITECTURE.md
├── FLOW_DIAGRAM.md
└── README.md
```

---

## Key API endpoints

All routes live under `/api/*` and (except for `/auth/*` and `/health`) require a `Bearer <jwt>` header.

| Method & path                                  | Purpose                                              |
|------------------------------------------------|------------------------------------------------------|
| `POST /api/auth/register` · `POST /api/auth/login` | bcrypt + JWT (8 h expiry)                          |
| `GET  /api/agents/{name}/prompt`               | Default system prompt (used by Custom Prompt Editor) |
| `POST /api/agents/{name}/run`                  | Synchronous agent run                                |
| `POST /api/agents/{name}/stream`               | SSE token stream (used by the UI)                    |
| `GET  /api/projects` / `POST /api/projects`    | Per-user project CRUD                                |
| `POST /api/projects/{slug}/upload`             | Upload PDF / DOCX / MD docs                          |
| `POST /api/projects/{slug}/build-index`        | Build the per-project Chroma index                   |
| `GET  /api/history`                            | List past agent runs                                 |
| `POST /api/jira/connect` · `GET /api/jira/projects` · `GET /api/jira/sprints` · `GET /api/jira/issues` · `GET /api/jira/issue/{key}/full` · `POST /api/jira/create-bug` | Jira Cloud + Agile flow |
| `GET  /api/gdrive/connect` · `GET /api/gdrive/callback` · `POST /api/gdrive/read` | Google Drive OAuth + file fetch |
| `POST /api/test-management/connect/(xray|zephyr)` · `POST /api/test-management/push` | Push test cases to Xray, Zephyr Scale, or native Jira Tests |
| `POST /api/exports/(excel|csv|markdown|pdf)`   | Convert a Markdown report into the chosen format     |
| `POST /api/stlc/run`                           | Streamed multi-agent STLC pack                       |
| `GET  /api/llm/providers` · `POST /api/llm/switch` | List / switch the active LLM provider             |

---

## Configuration knobs (env vars)

| Var                                  | Default                  | Notes |
|--------------------------------------|--------------------------|-------|
| `JWT_SECRET`                         | `sf-qa-studio-secret-change-me` | **Change in production** |
| `JWT_EXPIRE_MINUTES`                 | `480`                    | 8 h |
| `GEMINI_API_KEY`                     | _empty_                  | Required for the LLM |
| `GEMINI_MODEL`                       | `gemini-2.5-pro`         | Primary model |
| `GEMINI_FALLBACK_MODELS`             | `gemini-2.5-flash,gemini-2.0-flash` | Tried in order on transient failures |
| `GEMINI_MAX_RETRIES`                 | `3`                      | Per model, exponential backoff |
| `OPENAI_*`                           | _disabled_               | Plumbing exists but the user-facing option is hidden — re-enable by un-commenting the registration block in `backend/core/orchestrator.py` |
| `RAG_TOP_K`                          | `3`                      | Snippets per retrieval call |
| `MAX_OUTPUT_TOKENS`                  | `8192`                   | Per LLM call |
| `TEMPERATURE`                        | `0.25`                   |  |
| `STORAGE_BACKEND`                    | `local`                  | Set to `firestore` for multi-user persistence |
| `FIREBASE_CREDENTIALS_JSON` *or* `FIREBASE_CREDENTIALS_PATH` | _empty_ | Required for Firestore |
| `FIREBASE_PROJECT_ID`                | _empty_                  | Required for Firestore |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | _empty_ | Required for Google Drive integration |

---

## Custom system prompt (Test Case Development)

The **Test Case Development** agent (`/testcases`) exposes a **Customize System Prompt** card.

- Toggle **OFF** → expandable read-only "View default prompt" panel.
- Toggle **ON** → 10-row editor pre-filled from `localStorage["qa-studio:custom-prompt:testcase"]` (or the default if empty), with a 32 000-character cap and a Reset link.
- Both the toggle state (`qa-studio:custom-prompt-on:testcase`) and the body persist in `localStorage`, so they survive reloads, tab closes, and days of use on the same device.
- The override is shipped on the request as `system_prompt_override`; the file `backend/core/prompts/prompts.py` is **never modified**.

The pattern is namespaced by agent key, so adding the editor to other agents later is a one-line change in `AgentForm`.

---

## Branch model

- **`master`** — last stable release.
- **`dev`** — active feature branch (Sprint filter, multi-select Test Plan scope, custom system prompt, side-by-side RAG/linked-output layout, Gemini-only LLM selector).

Open PRs against `dev`; merge `dev` → `master` to release.

---

## License

Internal Astound tooling — see your team for redistribution terms.
