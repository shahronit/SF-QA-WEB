# Flow Diagrams

End-to-end user, agent, and integration flows for QA Studio (`dev` + `master` as of April 2026).

> Companion docs:
>
> - [`README.md`](./README.md) — install & configure
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module-level architecture

---

## 1. Top-level user journey

```mermaid
flowchart TD
  Start(["User opens http://localhost:8080"])
  Login{"Has JWT?"}
  Auth["/login -> register or sign-in<br/>bcrypt + JWT"]
  Hub["/ Dashboard (Hub)"]
  Setup{"First-time setup?"}
  Project["/projects<br/>create + upload docs<br/>build per-project index"]
  Jira["JiraConnector<br/>email + API token"]
  GD["Connect Google Drive<br/>(per-user OAuth)"]
  TM["Connect Test Management<br/>Xray / Zephyr / native Jira"]
  Agent["Pick an agent<br/>(Manual QA or Advanced)"]
  Run["Generate -> SSE stream"]
  Report["Markdown report rendered<br/>+ exports + push actions"]
  History["/history<br/>browse past runs"]
  StlcEntry["/stlc-pack<br/>1-click chained pack"]

  Start --> Login
  Login -- "no" --> Auth --> Hub
  Login -- "yes" --> Hub
  Hub --> Setup
  Setup -- "optional" --> Project
  Setup -- "optional" --> Jira
  Setup -- "optional" --> GD
  Setup -- "optional" --> TM
  Setup --> Agent
  Project --> Agent
  Jira --> Agent
  Agent --> Run --> Report
  Report --> History
  Hub --> StlcEntry
  StlcEntry --> Report
```

---

## 2. Standard agent run (the hot path)

This is what happens on every `Generate` click on any single-agent page (`/requirements`, `/test-plan`, `/testcases`, `/bugs`, …).

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as AgentForm (React)
    participant Picker as JiraIssuePicker
    participant CPE as CustomPromptEditor<br/>(testcase only)
    participant LS as localStorage
    participant API as FastAPI<br/>/api/agents/.../stream
    participant TP as Threadpool
    participant Orch as Orchestrator
    participant RAG as RAGRetriever
    participant Gemini

    User->>UI: Pick QA Mode (Salesforce / General)
    User->>UI: (optional) Select project ⇒ enables RAG
    User->>UI: (optional) Select Linked Previous Output
    opt Jira import
      User->>Picker: Pick sprint, search "PROJ-123"
      Picker->>API: GET /api/jira/issues?... (or /sprints, /issue/{key})
      API-->>Picker: issue rows / detail
      Picker->>UI: writeScopeBlock or onImport
    end
    opt Custom prompt (testcase only)
      User->>CPE: Toggle ON, edit prompt
      CPE->>LS: persist override + toggle state
      CPE->>UI: onChange(override)
    end
    User->>UI: Fill agent fields → click Generate

    UI->>API: POST .../stream<br/>{user_input, project_slug, system_prompt_override?}
    API->>API: Validate JWT
    API->>Orch: set_project(slug)
    API->>TP: spawn _producer
    TP->>Orch: stream_agent(name, input, override)
    Orch->>RAG: get_combined_context | get_context
    RAG-->>Orch: context block (top-K snippets)
    Orch->>Orch: pick prompt (override or default)<br/>swap _SCOPE_ONLY → _PROJECT_SCOPE if project
    Orch->>Gemini: stream(model, system_prompt, user_block)
    loop tokens
      Gemini-->>Orch: chunk
      Orch-->>TP: yield
      TP-->>API: queue.put_nowait(token)
      API-->>UI: SSE event "token"
      UI->>UI: append + render Markdown live
    end
    Gemini-->>Orch: done
    Orch->>Orch: append run log<br/>(Firestore or logs/agent_log.jsonl)
    API-->>UI: SSE close
    UI->>UI: AgentResultsContext.saveResult(name, full)
    UI->>User: ReportPanel + exports + Confetti 🎉
```

Notes:

- The override path catches `ValueError` (e.g. > 32 KB) and surfaces it as `**Error:** …` inside the stream rather than tearing the connection.
- On retryable Gemini errors (`429`, `503`, `UNAVAILABLE`, `RESOURCE_EXHAUSTED`, `overloaded`) the orchestrator walks the `GEMINI_FALLBACK_MODELS` chain with exponential backoff before raising.

---

## 3. AgentForm UI layout (every agent)

```mermaid
flowchart TD
  QA["1. QA Mode card<br/>Salesforce / General"]
  Row{"2. Side-by-side row"}
  RAG["Project Context (RAG)<br/>RAG over project docs"]
  Link["Link Previous Agent Output<br/>(hidden on requirement)"]
  Jira["3. Import from Jira<br/>+ sprint filter, key search<br/>+ multi-select on test_plan"]
  CPE["4. Customize System Prompt<br/>(testcase only)"]
  Fields["5. Primary fields<br/>(per agent)"]
  Generate["6. Generate"]
  Stream["7. Streamed Markdown report"]
  Actions["8. Export + push actions"]

  QA --> Row
  Row --> RAG
  Row --> Link
  RAG --> Jira
  Link --> Jira
  Jira --> CPE
  CPE --> Fields
  Fields --> Generate --> Stream --> Actions
```

The grid degrades gracefully on the `requirement` agent (which has no upstream agent to chain from): the Project Context card spans the whole row.

---

## 4. Custom system prompt (Test Case Development)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant CPE as CustomPromptEditor
    participant LS as localStorage<br/>(qa-studio:custom-prompt:testcase)
    participant API as GET /api/agents/testcase/prompt
    participant Form as AgentForm
    participant Stream as POST /api/agents/testcase/stream
    participant Orch as Orchestrator

    Note over CPE: First mount
    CPE->>API: fetch default prompt
    API-->>CPE: { prompt: "..." }
    CPE->>LS: read toggle + draft
    alt toggle ON
      CPE->>Form: onChange(draft)
    else toggle OFF
      CPE->>Form: onChange(null)
    end

    User->>CPE: toggle ON
    CPE->>LS: write toggle=1
    User->>CPE: edits textarea
    CPE->>LS: write draft (debounced)
    CPE->>Form: onChange(value)

    User->>Form: click Generate
    Form->>Stream: body includes system_prompt_override
    Stream->>Orch: stream_agent(..., override)
    alt override > 32 000 chars
      Orch-->>Stream: ValueError
      Stream-->>Form: SSE token "**Error:** …"
    else valid
      Orch->>Orch: system_prompt = override
      Orch-->>Stream: stream tokens
    end

    User->>CPE: click "Reset to default"
    CPE->>LS: remove draft entry
    CPE->>CPE: setDraft(default)
    alt toggle ON
      CPE->>Form: onChange(default)
    end

    User->>CPE: toggle OFF
    CPE->>LS: write toggle=0
    CPE->>Form: onChange(null)
```

---

## 5. Jira import + sprint flow (every agent)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Picker as JiraIssuePicker
    participant Form as AgentForm
    participant Jira as /api/jira

    User->>Picker: select Project
    Picker->>Jira: GET /sprints?project_key=...
    Jira-->>Picker: sprints (auto-detected board)

    alt Single-select agents
      User->>Picker: pick Sprint → list issues
      Picker->>Jira: GET /issues?...&sprint_id=...
      Jira-->>Picker: issue rows
      User->>Picker: click an issue
      Picker->>Jira: GET /issue/{KEY}/full
      Jira-->>Picker: full issue (description, AC, links, files)
      User->>Picker: "Import to form"
      Picker->>Form: onImport(issue)
      Form->>Form: jiraIssueToText(...) → primary textarea
    else Test Plan & Strategy (multi-select)
      User->>Picker: tick multiple issues<br/>or "Use entire sprint as scope"
      Picker->>Jira: GET /issue/{KEY} for each (cap 5 in parallel)
      Jira-->>Picker: issue details
      Picker->>Form: onImportMany([...]) or onUseSprintScope(...)
      Form->>Form: write consolidated scope block<br/>(coverage matrix included)
    end

    Note over Form: User can still edit fields before Generate
```

The picker also auto-detects when the user types a Jira key (e.g. `PROJ-123`) into any field and offers a one-click import via the same path.

---

## 6. Bug report → Jira (with optional link)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Form as AgentForm (/bugs)
    participant Report as ReportPanel + JiraBugPush
    participant API as /api/jira/create-bug
    participant Jira as Jira Cloud REST

    User->>Form: Fill bug fields → Generate
    Form-->>Report: streamed Markdown bug report
    User->>Report: pick Project, optional "Linked ticket", link type
    Report->>API: POST { project_key, summary, description,<br/>linked_issue_key?, link_type }
    API->>Jira: POST /issue (create Bug)
    Jira-->>API: { key: "PROJ-456", id, self }
    opt linked_issue_key set
      API->>Jira: POST /issueLink { type, inwardIssue, outwardIssue }
      Jira-->>API: 201 (or non-fatal error)
    end
    API-->>Report: { key, url, link_error? }
    Report-->>User: toast + clickable Jira link
```

`link_error` is non-fatal: the bug is still created, the UI just shows a warning.

---

## 7. Test cases → Test Management push

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Form as AgentForm (/testcases)
    participant TmPush as TestManagementPush
    participant Parse as POST /api/test-management/parse
    participant Push as POST /api/test-management/push
    participant Target as Xray / Zephyr / Jira

    User->>Form: Generate test cases
    Form-->>TmPush: render Markdown
    TmPush->>Parse: { markdown }
    Parse-->>TmPush: list of TestCaseDTO

    User->>TmPush: pick target tab (xray / zephyr / native_jira)
    User->>TmPush: pick Project + (optional) user story key
    User->>TmPush: edit titles, untick rows to skip
    User->>TmPush: click Push N tests

    TmPush->>Push: { target, project_key, testcases, issuetype?, user_story_key? }
    Note over Push: appends "Linked story: KEY" to every preconditions
    alt target == xray
      Push->>Target: POST /api/v2/import/test (per case, OAuth client-credentials)
    else target == zephyr
      Push->>Target: POST /testcases (per case, Bearer token)
    else target == native_jira
      Push->>Target: POST /issue { issuetype: "Test", description }
    end
    Target-->>Push: per-row create result
    Push-->>TmPush: results[] (one per testcase)
    TmPush-->>User: per-row success / failure
```

---

## 8. STLC pack (multi-agent chain over a single SSE stream)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Page as /stlc-pack
    participant API as /api/stlc/run (SSE)
    participant Orch as Orchestrator (×5 calls)

    User->>Page: pick project + optional Jira ticket → Run pack
    Page->>API: POST { project_slug, qa_mode, jira_key? }
    API-->>Page: SSE pack_start { agents, jira_key, seed_preview }

    loop For each phase
      API-->>Page: SSE agent_start { agent, label, phase }
      API->>Orch: stream_agent(phase_agent, input)
      Note over API,Orch: input includes prior phase output as linked_output
      loop tokens
        Orch-->>API: chunk
        API-->>Page: SSE token { agent, text }
        Page->>Page: append to phase report
      end
      API-->>Page: SSE agent_end { agent }
    end
    API-->>Page: SSE pack_end { pack_id }
    Page->>Page: persist run log (Firestore or jsonl)
    Page-->>User: combined report (5 sections)
```

The five phases are fixed:

| Index | Phase                          | Agent key       |
|-------|--------------------------------|-----------------|
| 1     | Requirement Analysis           | `requirement`   |
| 2     | Test Planning                  | `test_plan`     |
| 3     | Test Case Development          | `testcase`      |
| 4     | Test Execution                 | `exec_report`   |
| 5     | Test Cycle Closure             | `closure_report`|

---

## 9. Project + RAG ingestion

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as /projects
    participant Proj as /api/projects
    participant Ing as ingestor.py
    participant Vec as embedder.py (Chroma + Ollama)
    participant Disk as backend/projects/<slug>/

    User->>UI: Create project (name, slug, description)
    UI->>Proj: POST /api/projects
    Proj->>Disk: create folder + meta.json

    User->>UI: Upload PDF / DOCX / MD
    UI->>Proj: POST /api/projects/{slug}/upload (multipart)
    Proj->>Disk: write to docs/

    User->>UI: Build index
    UI->>Proj: POST /api/projects/{slug}/build-index
    Proj->>Ing: chunk all docs in docs/
    Ing-->>Proj: list of LangChain Documents
    Proj->>Vec: build(documents) → Chroma persist
    Vec->>Disk: write vector_store/ shard
    Vec-->>Proj: ready
    Proj-->>UI: { docs, chunks }

    Note over Vec: Subsequent queries use<br/>RAGRetriever.get_combined_context(query, slug)
```

The same flow but for the **global Salesforce KB** runs through `POST /api/kb/build`, reading docs from `backend/knowledge_base/` into `backend/rag/vector_store/`.

---

## 10. Auth + session lifecycle

```mermaid
flowchart LR
  A["User submits<br/>email + password"]
  B["/api/auth/login or /register"]
  C["bcrypt verify (or hash + insert)"]
  D["JWT signed with JWT_SECRET<br/>(8 h expiry)"]
  E["axios saves token to localStorage"]
  F["axios interceptor adds<br/>Authorization: Bearer ..."]
  G["FastAPI deps.get_current_user<br/>verifies + loads user"]
  H{"401?"}
  I["AuthContext clears token<br/>→ redirect /login"]
  J["Continue with request"]

  A --> B --> C --> D --> E --> F --> G --> H
  H -- "yes" --> I
  H -- "no"  --> J
```

Per-integration sessions (Jira, Xray, Zephyr, Google Drive) are stored separately, keyed by `username`, and live either in process memory or Firestore depending on `STORAGE_BACKEND`.

---

## 11. Branch model

```mermaid
gitGraph
   commit id: "stable"
   branch dev
   checkout dev
   commit id: "Jira full issue + GDrive"
   commit id: "Reorg agents + TM push"
   commit id: "Tables scroll + TM story link + linked Jira defect"
   commit id: "Sprint filter + Test Plan multi-select"
   commit id: "Side-by-side RAG/linked layout + custom prompt"
   commit id: "Gemini-only LLM selector"
   checkout main
   merge dev tag: "release"
```

- `dev` carries every feature commit; PRs target `dev`.
- `master` is fast-forwarded from `dev` at release boundaries.
