# Architecture

QA Studio is a **single-process** web app: FastAPI serves both the JSON API under `/api/*` and the pre-built React SPA from `backend/static/`. There is no separate web server in production — `start.bat` (or the Docker image) launches Uvicorn on port `8080`, and that's the whole deployment surface.

This document covers what's on `dev` (and merging into `master`) as of April 2026.

> Companion docs:
>
> - [`README.md`](./README.md) — how to install, run, and configure
> - [`FLOW_DIAGRAM.md`](./FLOW_DIAGRAM.md) — end-to-end user & agent flows

---

## 1. High-level system

```mermaid
flowchart LR
  Browser["Browser<br/>React SPA<br/>(Vite build)"]
  subgraph Server["FastAPI process - port 8080"]
    Static["Static files<br/>backend/static/"]
    API["API routers<br/>/api/*"]
    Orch["Orchestrator<br/>RAG + LLM"]
    RAG["RAG retriever<br/>Chroma + Ollama"]
  end
  subgraph External["External services"]
    Gemini["Google Gemini<br/>google-genai"]
    Jira["Jira Cloud<br/>REST + Agile"]
    Xray["Xray Cloud"]
    Zephyr["Zephyr Scale"]
    GDrive["Google Drive<br/>OAuth + Files"]
    Firestore["Firebase Firestore<br/>(optional)"]
  end

  Browser -- "GET /, /assets/*" --> Static
  Browser -- "Bearer JWT<br/>/api/* JSON + SSE" --> API
  API --> Orch
  Orch --> RAG
  Orch -- "generate / stream" --> Gemini
  API -- "issues, sprints, bugs" --> Jira
  API -- "push tests" --> Xray
  API -- "push tests" --> Zephyr
  API -- "OAuth + read files" --> GDrive
  API -. "users, projects, sessions, runs" .-> Firestore
  RAG -. "embeddings (HTTP localhost:11434)" .-> Ollama["Ollama<br/>nomic-embed-text"]
```

Everything outside the `Server` box is optional except Gemini.

---

## 2. Backend layout

```mermaid
flowchart TB
  subgraph routers["routers/ — FastAPI APIRouters"]
    auth["auth.py<br/>/api/auth"]
    agents_r["agents.py<br/>/api/agents"]
    projects_r["projects.py<br/>/api/projects"]
    history_r["history.py<br/>/api/history"]
    jira_r["jira.py<br/>/api/jira"]
    gdrive_r["gdrive.py<br/>/api/gdrive"]
    sf_r["salesforce.py<br/>/api/sf"]
    kb_r["knowledge.py<br/>/api/kb"]
    exports_r["exports.py<br/>/api/exports"]
    llm_r["llm.py<br/>/api/llm"]
    stlc_r["stlc_pack.py<br/>/api/stlc"]
    tm_r["test_management.py<br/>/api/test-management"]
    deps["deps.py<br/>(JWT + singleton)"]
  end

  subgraph core["core/ — domain logic"]
    Orchestrator["orchestrator.py<br/>RAG + LLM coordinator"]
    Prompts["prompts/prompts.py<br/>17 agent prompts"]
    UserAuth["user_auth.py<br/>bcrypt + JWT"]
    PM["project_manager.py<br/>per-project docs + index"]
    JiraClient["jira_client.py<br/>REST + Agile"]
    JiraLinks["jira_links.py"]
    TM["test_management/<br/>xray, zephyr, native_jira"]
    GD["gdrive_client.py"]
    SF["sf_org_fetcher.py"]
    Exporter["exporter.py<br/>md/csv/xlsx/pdf"]
    Tables["table_parse.py"]
    FS["firestore_db.py"]
  end

  subgraph rag["rag/ — vector store"]
    Embedder["embedder.py<br/>Chroma + Ollama"]
    Ingestor["ingestor.py<br/>PDF/DOCX/MD chunking"]
    Retriever["retriever.py<br/>global + per-project"]
  end

  agents_r --> Orchestrator
  stlc_r --> Orchestrator
  Orchestrator --> Retriever
  Orchestrator --> Prompts
  Retriever --> Embedder
  projects_r --> PM
  PM --> Embedder
  PM --> Ingestor
  kb_r --> Embedder
  kb_r --> Ingestor
  jira_r --> JiraClient
  jira_r --> JiraLinks
  tm_r --> TM
  tm_r --> JiraClient
  gdrive_r --> GD
  sf_r --> SF
  auth --> UserAuth
  exports_r --> Exporter
  exports_r --> Tables
  history_r --> FS
  Orchestrator --> FS
  UserAuth --> FS
  PM --> FS
  deps --> UserAuth
  deps --> Orchestrator
  agents_r --> deps
  projects_r --> deps
  jira_r --> deps
```

### Module responsibilities

| Module                                         | Responsibility |
|------------------------------------------------|----------------|
| `routers/agents.py`                            | `GET /{name}/prompt`, `POST /{name}/run`, `POST /{name}/stream`. Threadpools the sync orchestrator and bridges to SSE via `asyncio.Queue`. |
| `routers/jira.py`                              | Jira Cloud session management (memory + optional Firestore), JQL search, sprint listing via Agile API, bug creation with optional issue link. |
| `routers/test_management.py`                   | Pushes parsed test cases to Xray Cloud, Zephyr Scale, or native Jira `Test` issues. Optionally appends `Linked story: <KEY>` to every test case's preconditions. |
| `routers/gdrive.py`                            | Per-user OAuth flow + reads file content for Jira's full-issue view. |
| `routers/stlc_pack.py`                         | Runs five agents back-to-back over a single SSE stream, feeding each one the previous step's output as `linked_output`. |
| `core/orchestrator.py`                         | Builds `(system_prompt, user_block)` per request, retries through a fallback model chain, supports SSE streaming, persists run logs to Firestore or `logs/agent_log.jsonl`. |
| `core/prompts/prompts.py`                      | All 17 agent prompts. Two scope markers (`_SCOPE_ONLY`, `_PROJECT_SCOPE`) toggle automatically when a project is active. |
| `rag/embedder.py`                              | Wraps LangChain Chroma with Ollama `nomic-embed-text` embeddings, persisted under `backend/rag/vector_store/` (global) or `backend/projects/<slug>/vector_store/` (per project). |
| `rag/retriever.py`                             | Lazy-loads global + per-project Chroma stores and returns combined source-annotated context. |
| `core/firestore_db.py`                         | Optional Firestore client. When `STORAGE_BACKEND=firestore` it backs users, projects, Jira/Xray/Zephyr sessions, and agent run history. |

---

## 3. Frontend layout

```mermaid
flowchart TB
  Main["main.jsx → App.jsx<br/>BrowserRouter"]
  subgraph providers["Provider tree (top → bottom)"]
    Auth["AuthProvider"]
    Jira["JiraProvider"]
    TM["TestManagementProvider"]
    AR["AgentResultsProvider"]
  end
  subgraph routes["Routes"]
    Layout["Layout (Sidebar + Outlet)"]
    Hub["/ → Hub"]
    Agents["/requirements, /test-plan, /testcases, /smoke,<br/>/regression, /bugs, /closure-report,<br/>/estimation, /automation-plan, /test-data,<br/>/rtm, /copado-scripts, /uat-plan,<br/>/execution-report, /rca"]
    Stlc["/stlc-pack"]
    Projects["/projects"]
    History["/history"]
    Login["/login"]
  end
  subgraph shared["Shared components"]
    AgentForm["AgentForm.jsx<br/>(QA mode + RAG + Jira + linked output<br/>+ fields + streaming + report)"]
    Picker["JiraIssuePicker.jsx<br/>(sprint, search, multi-select)"]
    JConn["JiraConnector.jsx"]
    JBug["JiraBugPush.jsx<br/>(bug_report only)"]
    TmPush["TestManagementPush.jsx<br/>(testcase only)"]
    CPE["CustomPromptEditor.jsx<br/>(testcase only)"]
    Report["ReportPanel.jsx + exports"]
  end

  Main --> Auth --> Jira --> TM --> AR --> Layout
  Layout --> Hub
  Layout --> Agents
  Layout --> Stlc
  Layout --> Projects
  Layout --> History
  Login -. "redirects to /" .-> Layout
  Agents --> AgentForm
  AgentForm --> Picker
  AgentForm --> JConn
  AgentForm --> CPE
  AgentForm --> Report
  Report --> JBug
  Report --> TmPush
```

### Provider responsibilities

| Provider                       | What it owns |
|--------------------------------|--------------|
| `AuthContext`                  | JWT, current user, login/logout, axios interceptor side-effects |
| `JiraContext`                  | Connection state, project list, `listIssues({ projectKey, sprintId, activeSprintsOnly, … })`, `listSprints`, `getIssue`, etc. |
| `TestManagementContext`        | Per-target connection + push helpers for Xray, Zephyr, native Jira |
| `AgentResultsContext`          | In-session map of `{agentName → {content, label, timestamp}}` so any agent can chain another agent's most-recent output |

### `AgentForm` rendering order (every agent)

1. **QA Mode card** — Salesforce / General toggle
2. **2-column grid** (`grid-cols-1 lg:grid-cols-2`):
   - Project Context (RAG) card
   - Link Previous Agent Output card *(hidden on `requirement`; that card spans full width)*
3. **Import from Jira** picker (when connected). On `test_plan` only it switches to multi-select + "Use entire sprint as scope".
4. **Customize System Prompt** card — `testcase` agent only.
5. Primary input fields (per-agent).
6. Generate button → SSE stream → `ReportPanel` with exports + (on `bug_report`) `JiraBugPush` + (on `testcase`) `TestManagementPush`.

---

## 4. Storage model

There are two interchangeable backends, selected by `STORAGE_BACKEND`:

| Concept           | `local` (default)                                         | `firestore`                                       |
|-------------------|-----------------------------------------------------------|---------------------------------------------------|
| Users             | `backend/data/users.json`                                 | `users` collection                                |
| Projects         | `backend/projects/<slug>/{meta.json,docs/,vector_store/}` | `projects` + on-disk vectors (always local)       |
| Agent run history | `backend/logs/agent_log.jsonl`                            | `agent_runs` collection                           |
| Jira session      | In-memory only                                            | `jira_sessions/<username>` (survives restarts)    |
| Xray session      | In-memory only                                            | `xray_sessions/<username>`                        |
| Zephyr session    | In-memory only                                            | `zephyr_sessions/<username>`                      |
| Global Salesforce KB | `backend/knowledge_base/` source + `backend/rag/vector_store/` | (always local)                            |

Vector indexes are always **on the local filesystem** because Chroma needs disk-backed collections.

---

## 5. Agent request lifecycle

The hot path on `POST /api/agents/{name}/stream`:

```mermaid
sequenceDiagram
    autonumber
    participant UI as React (AgentForm)
    participant API as FastAPI router
    participant TP as Threadpool
    participant Orch as Orchestrator
    participant RAG as RAGRetriever
    participant Chroma
    participant LLM as Gemini

    UI->>API: POST .../stream<br/>{user_input, project_slug, system_prompt_override?}
    API->>API: Validate JWT, set active project on Orchestrator
    API->>TP: spawn _producer thread

    TP->>Orch: stream_agent(name, user_input, override)
    Orch->>Orch: _build_messages(...)
    alt project active
      Orch->>RAG: get_combined_context(query, slug)
      RAG->>Chroma: similarity_search (project + global)
      Chroma-->>RAG: top-K snippets
    else no project
      Orch->>RAG: get_context(query)
      RAG->>Chroma: similarity_search (global)
      Chroma-->>RAG: top-K snippets
    end
    Orch->>Orch: choose system prompt (override or PROMPTS[name])<br/>swap _SCOPE_ONLY → _PROJECT_SCOPE if project
    Orch->>LLM: stream(model, system_prompt, user_block)
    loop for each token batch
      LLM-->>Orch: chunk
      Orch-->>TP: yield chunk
      TP-->>API: queue.put_nowait({event: token, ...})
      API-->>UI: SSE event "token"
    end
    LLM-->>Orch: stream complete
    Orch->>Orch: _append_log({...full_text})
    Orch-->>TP: end
    TP-->>API: queue.put_nowait(None)
    API-->>UI: SSE close
    UI->>UI: saveResult(name, accumulated)
```

Key behaviours:

- **Threadpool bridge** — Uvicorn keeps its event loop free for other requests by running the sync orchestrator in a worker thread and pushing tokens through an `asyncio.Queue`.
- **Model fallback chain** — `_call_with_retry` / `_stream_with_fallback` walk `GEMINI_MODEL → GEMINI_FALLBACK_MODELS` with exponential backoff (max 30 s) on 429/503/`UNAVAILABLE`/`RESOURCE_EXHAUSTED`/`overloaded`.
- **System prompt override** — capped at 32 000 chars; `ValueError` is surfaced as HTTP 400 (run) or as an inline error chunk (stream).
- **Run log** — every successful run is appended to either Firestore (`agent_runs`) or `logs/agent_log.jsonl`.

See [`FLOW_DIAGRAM.md`](./FLOW_DIAGRAM.md) for the higher-level user-side flow and the STLC pack flow.

---

## 6. RAG architecture

```mermaid
flowchart LR
  subgraph Build["Index build (one-off per project / KB)"]
    Docs["PDF / DOCX / MD"]
    Ingest["ingestor.py<br/>chunk + metadata"]
    Embed["embedder.py<br/>OllamaEmbeddings<br/>nomic-embed-text"]
    Persist["Chroma<br/>persist_directory"]
    Docs --> Ingest --> Embed --> Persist
  end

  subgraph Query["Query path (per agent run)"]
    Retr["retriever.py"]
    Combine["get_combined_context()"]
    Inject["context block prepended<br/>to user_block"]
    Persist --> Retr --> Combine --> Inject
  end
```

Two separately persisted Chroma stores:

- **Global Salesforce KB** — `backend/rag/vector_store/`, populated from `backend/knowledge_base/` via `POST /api/kb/build`.
- **Per-project store** — `backend/projects/<slug>/vector_store/`, populated by `POST /api/projects/{slug}/build-index` after uploading docs.

When a project is active the orchestrator uses `get_combined_context` (project docs are authoritative scope, global Salesforce KB is background reference). When no project is active it uses `get_context` against the global store only.

---

## 7. External integrations

| Integration   | Auth model                        | Where credentials live                                |
|---------------|-----------------------------------|-------------------------------------------------------|
| **Jira Cloud**    | Email + API token, per user     | `JIRA_SESSIONS` (Firestore) **or** in-memory only     |
| **Xray Cloud**    | Client ID + secret, per user    | `XRAY_SESSIONS` (Firestore) **or** in-memory only     |
| **Zephyr Scale**  | API token, per user             | `ZEPHYR_SESSIONS` (Firestore) **or** in-memory only   |
| **Google Drive**  | OAuth 2.0 (3-legged), per user  | `gdrive_sessions` Firestore collection                |
| **Salesforce Org**| Username/password (sandbox/prod) | Per-request — never stored                           |
| **Gemini**        | API key (`GEMINI_API_KEY`)       | Server `.env`                                         |
| **Firebase Firestore** | Service-account JSON         | `FIREBASE_CREDENTIALS_JSON` env or `_PATH` file       |

All of these are optional except Gemini.

---

## 8. Build & deploy

```mermaid
flowchart LR
  Dev["frontend/src/**"]
  Build["vite build"]
  Dist["frontend/dist/"]
  Static["backend/static/"]
  Uvicorn["uvicorn main:app<br/>:8080"]
  Browser["Browser"]
  Dev --> Build --> Dist
  Dist -- "xcopy / cp" --> Static
  Static --> Uvicorn
  Uvicorn --> Browser
```

- **Local development** — run `start.bat` (Windows) or `npm run dev` + `uvicorn main:app --reload --port 8080`.
- **Single-process production** — `start.bat` rebuilds the SPA on every launch and refreshes `backend/static/`. `Dockerfile` does the same in `multi-stage` form.
- **Render** — `render.yaml` defines a web service that runs the same Dockerfile.

The SPA fallback in `main.py` returns `index.html` for any non-`/api/*` path, so React Router handles deep-links cleanly even after a hard refresh.

---

## 9. What's intentionally out of scope

- **Multi-tenant isolation** beyond per-user JWT — every authenticated user shares the same backing store.
- **OpenAI / ChatGPT in the user-facing selector** — the adapter exists but the registration block in `orchestrator.py` is commented out so only Gemini shows up. Re-enable by un-commenting one block; no other code changes are needed.
- **Background task queue** — long-running agent runs use threadpool + SSE, not a Celery/RQ queue. This is fine because every run streams progress and the LLM is the bottleneck, not CPU.
