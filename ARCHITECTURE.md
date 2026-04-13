# Salesforce QA Studio — Architecture & Technical Reference

**Version:** 1.0.0
**Last Updated:** April 13, 2026
**Platform:** Web Application (Single-Server Deployment)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Backend Architecture](#6-backend-architecture)
7. [AI Agents](#7-ai-agents)
8. [RAG Pipeline](#8-rag-pipeline)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [External Integrations](#10-external-integrations)
11. [Data Flow](#11-data-flow)
12. [Configuration Reference](#12-configuration-reference)
13. [Deployment Options](#13-deployment-options)
14. [API Reference](#14-api-reference)
15. [Security Considerations](#15-security-considerations)

---

## 1. Executive Summary

**Salesforce QA Studio** is an AI-powered web application designed to reduce manual QA effort for Salesforce teams by 70–95% while maintaining 80–95% response accuracy.

It provides six specialized AI agents that generate production-ready QA artifacts — requirements analysis, test cases, bug reports, smoke test plans, regression test plans, and effort estimations — all grounded in Salesforce best practices via Retrieval-Augmented Generation (RAG).

### Key Capabilities

| Capability | Description |
|---|---|
| AI-Powered Test Artifacts | 6 agents generate structured, Salesforce-specific QA documents |
| RAG-Grounded Responses | All outputs are contextually enriched with Salesforce knowledge |
| Salesforce Org Integration | Live login to sandbox/production orgs to fetch real metadata |
| Project-Based Context | Upload project-specific documents for scoped, authoritative answers |
| Jira Integration | Push generated bug reports directly to Jira Cloud |
| Export Capabilities | Download results as Excel (.xlsx) or CSV files |
| Multi-User Support | User registration, login, and project sharing |
| Single-Server Deployment | Frontend + backend served from one process on one port |

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SINGLE SERVER (Uvicorn, port 8080)               │
│                                                                     │
│  ┌─────────────────────────┐    ┌─────────────────────────────────┐ │
│  │   React SPA (static/)   │    │        FastAPI REST API         │ │
│  │                         │    │         (/api/*)                │ │
│  │  GET /       → index    │    │                                 │ │
│  │  GET /assets → JS/CSS   │    │  /api/auth    → Authentication  │ │
│  │  GET /*      → SPA      │    │  /api/agents  → AI Generation   │ │
│  │              fallback   │    │  /api/projects→ Document Mgmt   │ │
│  │                         │    │  /api/history → Run Logs        │ │
│  │                         │    │  /api/sf      → Salesforce Org  │ │
│  │                         │    │  /api/jira    → Jira Cloud      │ │
│  │                         │    │  /api/kb      → Knowledge Base  │ │
│  │                         │    │  /api/exports → Excel/CSV       │ │
│  └─────────────────────────┘    └─────────────────────────────────┘ │
│                                           │                         │
│                                           ▼                         │
│                                  ┌─────────────────┐                │
│                                  │  Orchestrator    │                │
│                                  │  (core engine)   │                │
│                                  └────┬───────┬─────┘                │
│                                       │       │                      │
│                           ┌───────────┘       └──────────┐           │
│                           ▼                              ▼           │
│                  ┌─────────────────┐          ┌─────────────────┐    │
│                  │  RAG Retriever  │          │   Gemini API    │    │
│                  │  (ChromaDB +    │          │   (google-genai)│    │
│                  │   Ollama embed) │          │                 │    │
│                  └─────────────────┘          └─────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                          │                              │
                          ▼                              ▼
                 ┌─────────────────┐          ┌─────────────────┐
                 │  Ollama Server  │          │  Google Cloud   │
                 │  (local, embed  │          │  Gemini 2.5     │
                 │   only)         │          │  Flash (free)   │
                 └─────────────────┘          └─────────────────┘
```

### 2.2 Request Lifecycle

```
Browser (User)
    │
    │  1. GET http://localhost:8080/
    │     → FastAPI returns static/index.html
    │     → Browser loads React SPA (JS + CSS bundles)
    │
    │  2. User fills form, clicks "Generate"
    │
    │  3. POST /api/agents/testcase/run
    │     Headers: { Authorization: Bearer <JWT> }
    │     Body:    { user_input: {...}, project_slug: "..." }
    │
    ▼
FastAPI Router (agents.py)
    │
    ├── Verify JWT token (deps.py → get_current_user)
    ├── Get singleton Orchestrator (deps.py → get_orchestrator)
    │
    ▼
SFQAOrchestrator.run_agent("testcase", user_input)
    │
    ├── 1. Resolve system prompt → PROMPTS["testcase"]
    │
    ├── 2. Retrieve RAG context
    │      ├── Embed user query → Ollama (nomic-embed-text)
    │      ├── Search ChromaDB global store (top-K chunks)
    │      ├── Search project-specific store (if project_slug set)
    │      └── Merge and deduplicate chunks
    │
    ├── 3. Build final prompt
    │      └── system_prompt + "Context:\n{rag_chunks}" + "INPUT:\n{user_input_json}"
    │
    ├── 4. Call Gemini API with retry + fallback
    │      ├── Try gemini-2.5-flash (up to 3 retries, exponential backoff)
    │      ├── On persistent failure → gemini-2.0-flash (3 retries)
    │      └── On persistent failure → gemini-1.5-flash (3 retries)
    │
    ├── 5. Log run to logs/agent_log.jsonl
    │
    └── 6. Return Markdown string
              │
              ▼
         React (ReportPanel)
              ├── Render formatted Markdown (tables via remark-gfm)
              ├── Show raw text view
              └── Offer Excel / CSV download
```

---

## 3. Technology Stack

### 3.1 Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 18.3 | UI framework |
| Vite | 6.0 | Build tool and dev server |
| Tailwind CSS | 3.4 | Utility-first CSS styling |
| Framer Motion | 11.11 | Animations and transitions |
| React Router | 6.28 | Client-side routing (SPA) |
| Axios | 1.7 | HTTP client with interceptors |
| react-markdown | 9.0 | Markdown rendering |
| remark-gfm | 4.0 | GitHub Flavored Markdown (tables) |
| react-hot-toast | 2.4 | Toast notifications |
| react-icons | 5.4 | Icon library |

### 3.2 Backend

| Technology | Version | Purpose |
|---|---|---|
| FastAPI | 0.115+ | Web framework (async, OpenAPI) |
| Uvicorn | 0.32+ | ASGI server |
| Pydantic / Pydantic-Settings | 2.10+ | Data validation, app config |
| google-genai | 1.0+ | Gemini API SDK (LLM generation) |
| ChromaDB | 0.5+ | Vector store for RAG |
| LangChain | 0.3+ | Document loaders, text splitting |
| Ollama (nomic-embed-text) | local | Embedding model for RAG |
| python-jose | 3.3+ | JWT token creation and verification |
| bcrypt | 4.0+ | Password hashing |
| openpyxl | 3.1+ | Excel file generation |
| pypdf | 5.0+ | PDF document loading |
| unstructured | 0.16+ | DOCX/DOC document loading |
| aiofiles | 24.1+ | Async static file serving |

### 3.3 External Services

| Service | Usage | Auth Method |
|---|---|---|
| Google Gemini API | LLM text generation (free tier) | API key |
| Ollama (local) | nomic-embed-text embeddings for RAG | None (localhost) |
| Salesforce Org | Login + metadata fetch (SOAP + REST) | Username + password |
| Jira Cloud | Bug report creation | Email + API token |

---

## 4. Project Structure

```
sf-qa-web/
│
├── Dockerfile                  # Multi-stage build (Node + Python)
├── docker-compose.yml          # Single-service deployment
├── start.bat                   # One-click Windows launcher
├── ARCHITECTURE.md             # This document
│
├── frontend/                   # React SPA source
│   ├── package.json
│   ├── vite.config.js          # Dev server proxy → :8080
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html              # HTML entry point
│   └── src/
│       ├── main.jsx            # React DOM root
│       ├── App.jsx             # Router + auth guard
│       ├── api/
│       │   └── client.js       # Axios instance (baseURL: /api)
│       ├── context/
│       │   └── AuthContext.jsx  # JWT token + user state
│       ├── components/
│       │   ├── Layout.jsx      # App shell (sidebar + content)
│       │   ├── Sidebar.jsx     # Navigation menu
│       │   ├── PageHeader.jsx  # Animated page headers
│       │   ├── AgentForm.jsx   # ★ Shared form with validation + reset
│       │   ├── ReportPanel.jsx # Markdown output + export buttons
│       │   ├── SFOrgLogin.jsx  # Salesforce org authentication
│       │   ├── ProjectBar.jsx  # Project context selector
│       │   └── ToonCard.jsx    # Animated card wrapper
│       ├── pages/
│       │   ├── Login.jsx       # Authentication (login + register)
│       │   ├── Hub.jsx         # Dashboard home
│       │   ├── Requirements.jsx
│       │   ├── TestCases.jsx
│       │   ├── BugReports.jsx
│       │   ├── SmokeTests.jsx
│       │   ├── Regression.jsx
│       │   ├── Estimation.jsx
│       │   ├── Projects.jsx    # Document management
│       │   └── History.jsx     # Past agent runs
│       └── styles/
│           └── toon-theme.css  # Custom theme + table styling
│
├── backend/                    # FastAPI server
│   ├── main.py                 # App init, middleware, SPA serving
│   ├── config.py               # Pydantic settings (env-driven)
│   ├── requirements.txt
│   ├── Dockerfile              # Python-only build (legacy)
│   ├── .env                    # Secrets (GEMINI_API_KEY, JWT_SECRET)
│   ├── .env.example
│   │
│   ├── routers/                # API endpoints
│   │   ├── deps.py             # ★ Singleton orchestrator + JWT dep
│   │   ├── auth.py             # POST /register, /login
│   │   ├── agents.py           # POST /{agent}/run
│   │   ├── projects.py         # CRUD + upload + index
│   │   ├── history.py          # GET agent logs
│   │   ├── salesforce.py       # POST /sf/login
│   │   ├── jira.py             # POST /jira/create
│   │   ├── knowledge.py        # Global KB management
│   │   └── exports.py          # Excel/CSV generation
│   │
│   ├── core/                   # Business logic
│   │   ├── orchestrator.py     # ★ Central engine: RAG + Gemini
│   │   ├── prompts/
│   │   │   └── prompts.py      # PROMPTS dict (6 system prompts)
│   │   ├── user_auth.py        # bcrypt + JWT utilities
│   │   ├── project_manager.py  # Project CRUD + file ops
│   │   ├── sf_org_fetcher.py   # Salesforce SOAP/REST login
│   │   ├── jira_client.py      # Jira Cloud REST client
│   │   ├── exporter.py         # Markdown → Excel/CSV
│   │   └── table_parse.py      # Pipe-table parser
│   │
│   ├── rag/                    # Retrieval-Augmented Generation
│   │   ├── embedder.py         # OllamaEmbeddings wrapper
│   │   ├── ingestor.py         # Doc loading + chunking
│   │   ├── retriever.py        # ★ ChromaDB vector search
│   │   ├── vector_store/       # Global ChromaDB data
│   │   └── project_stores/     # Per-project ChromaDB data
│   │
│   ├── data/
│   │   └── users.json          # User accounts (bcrypt hashed)
│   ├── logs/
│   │   └── agent_log.jsonl     # Agent run history
│   ├── projects/               # Uploaded project documents
│   ├── knowledge_base/         # Global Salesforce docs
│   │   ├── salesforce_docs/
│   │   ├── org_knowledge/
│   │   └── qa_standards/
│   └── static/                 # Built React app (auto-generated)
│       ├── index.html
│       └── assets/
```

---

## 5. Frontend Architecture

### 5.1 Component Hierarchy

```
App.jsx
├── Login.jsx                     (unauthenticated route)
└── Layout.jsx                    (authenticated shell)
    ├── Sidebar.jsx               (navigation)
    ├── ProjectBar.jsx            (project context)
    └── [Active Page]
        ├── PageHeader.jsx
        ├── SFOrgLogin.jsx        (Smoke/Regression only)
        ├── AgentForm.jsx         (shared form component)
        │   └── ReportPanel.jsx   (result display)
        └── [Page-specific UI]
```

### 5.2 AgentForm — Core Shared Component

`AgentForm` is the central component used by all six agent pages. It handles:

| Feature | Behavior |
|---|---|
| Field rendering | Text inputs, textareas, select dropdowns |
| Required field validation | Fields default to required; `required: false` marks optional |
| Visual indicators | Red asterisk (*) on required field labels |
| Generate button state | Disabled (40% opacity) until all required fields are filled |
| Reset button | Clears all fields and previous results |
| API call | POST to `/api/agents/{agentName}/run` with merged user input + extra input |
| Result display | Passes response to `ReportPanel` for rendering |

**Props:**

| Prop | Type | Description |
|---|---|---|
| `agentName` | string | Agent key (e.g., "testcase", "smoke") |
| `fields` | array | Field definitions with key, label, type, required, placeholder |
| `projectSlug` | string | Optional project context for RAG scoping |
| `sheetTitle` | string | Sheet name for Excel export |
| `extraInput` | object | Additional payload (e.g., org_metadata from SFOrgLogin) |

### 5.3 Authentication Flow

```
Login/Register form
    │
    ▼
POST /api/auth/login  →  JWT token (8hr expiry)
    │
    ▼
AuthContext stores token in localStorage
    │
    ▼
Axios interceptor adds "Authorization: Bearer <token>" to all requests
    │
    ▼
On 401 response → auto-clear token → redirect to /login
```

### 5.4 Styling

The application uses a custom "Toon" theme built on Tailwind CSS:

| Element | Style |
|---|---|
| Primary blue | `#0070D2` (Salesforce blue) |
| Navy | `#1E3A5F` |
| Coral | `#FF6B6B` |
| Mint | `#00D2A0` |
| Purple | `#7C5CFC` |
| Cards | Rounded corners (2xl), white background, subtle shadow |
| Tables | Dark gradient header, alternating row colors, hover effects |
| Animations | Framer Motion spring transitions on page load |

---

## 6. Backend Architecture

### 6.1 Application Initialization (main.py)

```python
FastAPI App
    │
    ├── CORS Middleware (allow all origins)
    │
    ├── API Routers (/api/auth, /api/agents, /api/projects, ...)
    │
    ├── Health Check (GET /api/health)
    │
    ├── Static File Mount (/assets → static/assets/)
    │
    ├── Root Route (GET / → static/index.html)
    │
    └── 404 Exception Handler
        └── Non-API routes → index.html (SPA fallback)
        └── API routes → JSON 404
```

### 6.2 Dependency Injection (deps.py)

Two key dependencies injected into route handlers:

1. **`get_orchestrator()`** — Returns a singleton `SFQAOrchestrator` initialized with Gemini API key, model chain, RAG settings, and temperature.

2. **`get_current_user()`** — Extracts and verifies the JWT from the `Authorization` header. Returns the authenticated username. Applied to all protected routes.

### 6.3 Orchestrator — The Central Engine

`SFQAOrchestrator` (core/orchestrator.py) coordinates every agent call:

```
Constructor Parameters:
├── api_key          → Gemini API key
├── model_name       → Primary model (gemini-2.5-flash)
├── fallback_models  → [gemini-2.0-flash, gemini-1.5-flash]
├── max_retries      → 3 per model
├── rag_top_k        → 3 chunks retrieved
├── max_output_tokens→ 8192
└── temperature      → 0.25

Methods:
├── run_agent(agent_name, user_input) → str
│   └── Full RAG → prompt → Gemini → log → return
├── stream_agent(agent_name, user_input) → Iterator[str]
│   └── Same as above but yields chunks (SSE streaming)
├── _call_with_retry(system_prompt, user_block) → str
│   └── Fallback chain with exponential backoff
├── _stream_with_fallback(system_prompt, user_block) → Iterator[str]
│   └── Streaming variant of retry logic
└── _build_messages(agent_name, user_input) → (system, user)
    └── Assembles RAG context + user input into prompt parts
```

**Retry Strategy:**

```
Model Chain: gemini-2.5-flash → gemini-2.0-flash → gemini-1.5-flash

For each model:
    Attempt 1 → on retryable error (503, 429, 500) → wait 2s
    Attempt 2 → on retryable error → wait 4s
    Attempt 3 → on retryable error → move to next model

Non-retryable errors (400, 403, etc.) → raise immediately
```

---

## 7. AI Agents

### 7.1 Agent Summary

| # | Agent | Key | Input Fields | Output |
|---|---|---|---|---|
| 1 | Requirement Analysis | `requirement` | user_story | Structured analysis with objects, requirements, risks |
| 2 | Test Case Generator | `testcase` | requirements, objects, additional_context* | Markdown table: ID, Title, Steps, Expected Results, Priority, Type |
| 3 | Bug Report Generator | `bug_report` | bug_title OR bug_description + steps + expected + actual + environment | Formal bug report with severity, steps, root cause hypothesis |
| 4 | Smoke Test Planner | `smoke` | deployment_scope, org_type, release_date*, org_metadata* | Checklist + test case table |
| 5 | Regression Planner | `regression` | changed_features, impacted_areas, org_metadata* | Regression plan + test case table |
| 6 | Estimation | `estimation` | test_cases, team_size*, sprint_capacity_hrs* | Effort table with 15% buffer |

*Fields marked with \* are optional.*

### 7.2 Prompt Architecture

All prompts are centralized in `core/prompts/prompts.py` as a `PROMPTS` dictionary. No inline prompts exist elsewhere in the codebase.

Each prompt includes:

1. **Role definition** — e.g., "Senior Salesforce QA Lead"
2. **Scope rules** — Mandatory constraint to base answers only on user-provided input
3. **Output format** — Markdown only, no HTML tags
4. **RAG usage rules** — Background reference only, not new scope
5. **Specific output structure** — Tables, checklists, sections
6. **Confidence Level** — Required footer on every response

### 7.3 Test Case Format (Standard)

All test case outputs follow this table structure:

| Column | Rules |
|---|---|
| Test Case ID | TC_001, ST_001, RT_001 (prefixed by agent type) |
| Test Case Title | Must start with "Verify that ..." |
| Pre-conditions | Numbered list within cell |
| Test Steps | Numbered list; Step 1 always "Navigate to..."; atomic, UI-driven |
| Expected Results | Numbered list mapping 1:1 to test steps |
| Priority | Critical / High / Medium / Low |
| Test Type | Functional / Negative / Boundary / Integration / Smoke / Regression |

---

## 8. RAG Pipeline

### 8.1 Architecture

```
Documents (PDF, DOCX, TXT, CSV, MD)
    │
    ▼
Ingestor (rag/ingestor.py)
    │
    ├── Load documents (LangChain loaders: PyPDF, Unstructured, CSV, Text)
    ├── Split into chunks (500 chars, 50 overlap)
    └── Store in ChromaDB with OllamaEmbeddings (nomic-embed-text)
              │
              ├── Global store: rag/vector_store/
              └── Project store: rag/project_stores/{slug}/
```

### 8.2 Retrieval Flow

```
User query (agent input)
    │
    ▼
RAGRetriever.get_context(query, project_slug?)
    │
    ├── Embed query → Ollama nomic-embed-text
    ├── Search global ChromaDB → top-K chunks
    ├── Search project ChromaDB → top-K chunks (if project set)
    ├── Merge and deduplicate
    └── Return concatenated context string
```

### 8.3 Configuration

| Parameter | Value | Description |
|---|---|---|
| Chunk size | 500 characters | Text splitting granularity |
| Chunk overlap | 50 characters | Context continuity between chunks |
| Embedding model | nomic-embed-text | Via Ollama (localhost:11434) |
| Top-K | 3 | Number of chunks retrieved per query |
| Vector store | ChromaDB | SQLite-backed, local persistence |

### 8.4 Knowledge Sources

| Source | Location | Scope |
|---|---|---|
| Salesforce docs | knowledge_base/salesforce_docs/ | Global (all agents) |
| Org knowledge | knowledge_base/org_knowledge/ | Global (all agents) |
| QA standards | knowledge_base/qa_standards/ | Global (all agents) |
| Project documents | projects/{slug}/documents/ | Project-scoped |

---

## 9. Authentication & Authorization

### 9.1 User Management

- Users stored in `data/users.json` (bcrypt-hashed passwords)
- No admin role — all users have equal access
- Projects are scoped to owners or explicitly shared users

### 9.2 JWT Authentication

| Parameter | Value |
|---|---|
| Algorithm | HS256 |
| Expiry | 480 minutes (8 hours) |
| Secret | JWT_SECRET from .env |
| Token location | `Authorization: Bearer <token>` header |

### 9.3 Protected Routes

All `/api/*` routes except `/api/auth/login`, `/api/auth/register`, and `/api/health` require a valid JWT.

---

## 10. External Integrations

### 10.1 Google Gemini (LLM Generation)

| Detail | Value |
|---|---|
| SDK | `google-genai` (Python) |
| Primary model | gemini-2.5-flash |
| Fallback models | gemini-2.0-flash → gemini-1.5-flash |
| Tier | Free (with rate limits) |
| Max output tokens | 8,192 |
| Temperature | 0.25 |
| Auth | API key via `GEMINI_API_KEY` in .env |

### 10.2 Ollama (RAG Embeddings)

| Detail | Value |
|---|---|
| Model | nomic-embed-text |
| Purpose | Document and query embedding for vector search |
| Host | localhost:11434 |
| Required | Yes (for RAG functionality) |

### 10.3 Salesforce Org (Metadata Fetch)

| Detail | Value |
|---|---|
| Login | SOAP Partner API (login.salesforce.com or test.salesforce.com) |
| Metadata | REST API + Tooling API |
| Data fetched | Custom objects, flows, validation rules, profiles, permission sets |
| Auth | Username + password + optional security token |
| Custom domain | Supported (e.g., mycompany.my.salesforce.com) |

### 10.4 Jira Cloud

| Detail | Value |
|---|---|
| API | Jira Cloud REST API v3 |
| Auth | Email + API token (entered in UI) |
| Action | Create issue from generated bug report |

---

## 11. Data Flow

### 11.1 Agent Execution

```
┌──────────┐     POST /api/agents/{name}/run     ┌──────────────┐
│  Browser  │ ──────────────────────────────────► │  agents.py   │
│           │     { user_input, project_slug }    │  (router)    │
└──────────┘                                      └──────┬───────┘
                                                         │
                                                         ▼
                                                  ┌──────────────┐
                                                  │   deps.py    │
                                                  │ JWT verify + │
                                                  │ orchestrator │
                                                  └──────┬───────┘
                                                         │
                                                         ▼
                                                  ┌──────────────┐
                                                  │ Orchestrator │
                                                  │              │
                                                  │ 1. Get prompt│
                                                  │ 2. RAG query │──► ChromaDB + Ollama
                                                  │ 3. Call LLM  │──► Gemini API
                                                  │ 4. Log run   │──► agent_log.jsonl
                                                  └──────┬───────┘
                                                         │
                                                         ▼
                                                  ┌──────────────┐
┌──────────┐     { result: "markdown..." }        │  Response    │
│  Browser  │ ◄────────────────────────────────── │  (JSON)      │
│           │                                      └──────────────┘
└──────────┘
         │
         ▼
  ReportPanel.jsx
  ├── Formatted Markdown (tables, lists)
  ├── Raw text view
  └── Export → Excel / CSV
```

### 11.2 Document Ingestion

```
User uploads files (PDF, DOCX, TXT, etc.)
    │
    │  POST /api/projects/{slug}/upload
    │  (multipart/form-data)
    │
    ▼
projects.py → Save to projects/{slug}/documents/
    │
    │  POST /api/projects/{slug}/build-index
    │
    ▼
Ingestor
    ├── Load each file (LangChain document loaders)
    ├── Split into 500-char chunks (50 overlap)
    ├── Embed chunks → Ollama (nomic-embed-text)
    └── Store in ChromaDB → rag/project_stores/{slug}/
```

### 11.3 Salesforce Org Connection

```
SFOrgLogin.jsx
    │
    │  POST /api/sf/login
    │  { username, password, security_token, login_type, custom_domain }
    │
    ▼
salesforce.py → sf_org_fetcher.py
    │
    ├── SOAP Login → Salesforce Partner API
    │   └── Returns session_id + instance_url
    │
    ├── REST Metadata Fetch
    │   ├── Custom Objects (describe global)
    │   ├── Active Flows (Tooling API)
    │   ├── Validation Rules (Tooling API)
    │   ├── Profiles
    │   └── Permission Sets
    │
    └── Return summary string + org label + instance URL
              │
              ▼
         SFOrgLogin sets orgMetadata state
              │
              ▼
         AgentForm includes org_metadata in extraInput
              │
              ▼
         Orchestrator receives org_metadata as part of user_input
```

---

## 12. Configuration Reference

All settings are managed via environment variables in `backend/.env`:

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `sf-qa-studio-secret-change-me` | Secret key for JWT signing |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `JWT_EXPIRE_MINUTES` | `480` | Token expiry (8 hours) |
| `GEMINI_API_KEY` | *(required)* | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Primary LLM model |
| `GEMINI_FALLBACK_MODELS` | `gemini-2.0-flash,gemini-1.5-flash` | Comma-separated fallback chain |
| `GEMINI_MAX_RETRIES` | `3` | Retries per model on transient errors |
| `RAG_TOP_K` | `3` | Number of chunks retrieved per query |
| `MAX_OUTPUT_TOKENS` | `8192` | Maximum LLM response length |
| `TEMPERATURE` | `0.25` | LLM creativity (0 = deterministic, 1 = creative) |

---

## 13. Deployment Options

### 13.1 One-Click (Windows)

```batch
start.bat
```

This script:
1. Builds the React frontend (`npm run build`)
2. Copies build output to `backend/static/`
3. Creates a Python venv and installs dependencies (if needed)
4. Starts Uvicorn on port 8080

**Access:** http://localhost:8080

### 13.2 Manual Start

```bash
# Terminal 1: Start Ollama (for RAG embeddings)
ollama serve

# Terminal 2: Start the application
cd backend
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8080
```

**Access:** http://localhost:8080

### 13.3 Docker

```bash
docker compose up --build
```

Single container runs both frontend and backend.

**Access:** http://localhost:8080

### 13.4 Development Mode

```bash
# Terminal 1: Backend with auto-reload
cd backend
.\venv\Scripts\activate
uvicorn main:app --reload --port 8080

# Terminal 2: Frontend dev server with HMR
cd frontend
npm run dev
```

**Access:** http://localhost:3000 (Vite proxies `/api` → :8080)

### 13.5 Prerequisites

| Requirement | Details |
|---|---|
| Python | 3.10+ |
| Node.js | 18+ (for frontend build) |
| Ollama | Running locally with `nomic-embed-text` pulled |
| Gemini API Key | Free from https://aistudio.google.com/app/apikey |

---

## 14. API Reference

### 14.1 Authentication

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{ username, display_name, password }` | `{ access_token, user }` |
| POST | `/api/auth/login` | `{ username, password }` | `{ access_token, user }` |

### 14.2 Agents

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/api/agents/{agent_name}/run` | `{ user_input: {...}, project_slug? }` | `{ result: "markdown" }` |

Valid `agent_name` values: `requirement`, `testcase`, `bug_report`, `smoke`, `regression`, `estimation`

### 14.3 Projects

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects/` | List user's projects |
| POST | `/api/projects/` | Create project `{ name, description }` |
| POST | `/api/projects/{slug}/upload` | Upload documents (multipart) |
| POST | `/api/projects/{slug}/build-index` | Build RAG vector index |
| DELETE | `/api/projects/{slug}` | Delete project |

### 14.4 Other Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/history/` | List past agent runs |
| POST | `/api/sf/login` | Salesforce org authentication |
| POST | `/api/jira/create` | Create Jira issue |
| POST | `/api/kb/build` | Build global knowledge base index |
| POST | `/api/exports/excel` | Generate Excel from markdown |
| POST | `/api/exports/csv` | Generate CSV from markdown |
| GET | `/api/health` | Health check (no auth required) |

---

## 15. Security Considerations

| Area | Implementation |
|---|---|
| Passwords | bcrypt hashed (never stored in plain text) |
| Authentication | JWT with configurable expiry |
| API protection | All routes require valid JWT (except auth + health) |
| Secrets management | `.env` file (not committed to Git) |
| CORS | Currently allows all origins (tighten for production) |
| Salesforce credentials | Entered per-session in UI, not persisted |
| Jira credentials | Entered per-session in UI, not persisted |
| Gemini API key | Stored in server-side `.env` only |
| File uploads | Restricted to document types (.pdf, .docx, .csv, .txt, .xlsx, .md) |
| Git exclusions | `.gitignore` covers `.env`, `vector_store/`, `users.json`, `logs/` |

---

*Document generated for Salesforce QA Studio v1.0.0*
