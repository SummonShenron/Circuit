# Circuit

Circuit is a visual, agentic workflow builder. Create workflows by placing LLM, transform, condition, and API nodes on a React Flow canvas, connect them, save them to MongoDB Atlas, and execute the resulting graph with LangGraph.

## What Works Today

- Drag, drop, connect, rename, and delete workflow nodes.
- Persist workflows in MongoDB Atlas.
- Execute saved workflows with a LangGraph `StateGraph`.
- Use Google Gemini Flash LLM nodes through `GOOGLE_API_KEY`.
- Configure LLM model, prompt, temperature, max tokens, system instructions, and output key.
- Configure transform mappings, conditions, and API requests in the editor.
- Inspect node status and execution trace after a run.
- Log API, database, node, and execution lifecycle events.

## Architecture

```text
React + Vite + React Flow (127.0.0.1:8090)
              |
              | HTTP JSON
              v
FastAPI + LangGraph (127.0.0.1:8010)
              |
              +-- MongoDB Atlas: saved workflow documents
              +-- Google Gemini: LLM node execution
              +-- Approved external hosts: API node execution
```

The frontend writes its canvas graph to `PUT /api/workflows/{workflow_id}`. The backend validates that referenced nodes exist and the graph has no cycles, stores the document in Atlas, then compiles its nodes and edges into a LangGraph workflow at run time.

## Requirements

- Python 3.11 or newer.
- Node.js 20 or newer.
- A MongoDB Atlas cluster and connection string.
- A Google AI API key for LLM nodes.

Docker is not required.

## Setup

1. Copy `.env.example` to `.env` at the repository root.
2. Fill in the values below. Keep `.env` private; it is ignored by Git.
3. Install backend dependencies.
4. Install frontend dependencies.
5. Start both development servers.

### Development Launcher

Use the root scripts during development instead of rebuilding after each edit:

```powershell
.\start-dev.ps1
```

This opens two PowerShell windows:

- FastAPI/Uvicorn at `http://127.0.0.1:8010` with Python reload enabled.
- Vite at `http://127.0.0.1:8090` with browser hot reload enabled.

Stop both servers with:

```powershell
.\stop-dev.ps1
```

If the stop script reports an orphaned listener, restart Windows once before running the launcher again.

### Environment Variables

```dotenv
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
MONGO_DATABASE=workflow_builder
GOOGLE_API_KEY=<your-google-ai-api-key>
LOG_LEVEL=INFO
CORS_ORIGINS=["http://127.0.0.1:8090"]
API_ALLOWED_HOSTS=["api.example.com"]
```

`API_ALLOWED_HOSTS` is a JSON array. API nodes reject any hostname not listed here. This prevents a workflow from turning the backend into an unrestricted outbound request proxy.

### Backend

The repository has been developed with this interpreter:

```powershell
C:/Users/jackh/AppData/Local/Programs/Python/Python312/python.exe -m pip install -e backend
cd backend
C:/Users/jackh/AppData/Local/Programs/Python/Python312/python.exe run.py
```

The API starts at `http://127.0.0.1:8010`.

Useful endpoints:

```text
GET    /health
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/{workflow_id}
PUT    /api/workflows/{workflow_id}
DELETE /api/workflows/{workflow_id}
POST   /api/workflows/{workflow_id}/run
```

Open `http://127.0.0.1:8010/docs` for FastAPI's interactive API documentation.

### Frontend

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

Open `http://127.0.0.1:8090`.

### Headless Chat CLI

The repository includes a small CLI that simulates a frontend chat app by calling an event-triggered workflow and printing the HTTP Response node's JSON body.

Configure these PowerShell variables:

```powershell
$env:CIRCUIT_WORKFLOW_ID="<workflow-id>"
$env:CIRCUIT_TRIGGER_SECRET="<schedule-trigger-secret>"
$env:CIRCUIT_API_URL="http://127.0.0.1:8010"
$env:CIRCUIT_EVENT_NAME="chat-message"
```

Run an interactive session:

```powershell
.venv\Scripts\python.exe backend\circuit_chat_cli.py
```

Or send one message:

```powershell
.venv\Scripts\python.exe backend\circuit_chat_cli.py --once "Hello Circuit"
```

The workflow should use event mode, declare `conversation_id`, `message`, and `history` inputs, and select an HTTP Response node as its public response. The CLI keeps the last 20 conversation messages locally for the session.

To make a production bundle:

```powershell
npm --prefix frontend run build
```

## Create Your First Workflow

This walkthrough creates a simple workflow that turns a fixed brief into a Gemini response.

1. Start the backend, then open `http://127.0.0.1:8090` in a browser.
2. The canvas opens a saved workflow or creates a starter one containing **Prepare brief** and **Draft response**.
3. Select **Prepare brief**. In the Transform inspector, set a mapping key such as `brief` and give it a value such as `Explain what an agentic workflow builder does.`
4. Select **Draft response**. In the LLM inspector, set the prompt to `Write a concise explanation using this brief: {{brief.brief}}`.
5. Optionally set its system instructions, temperature, max token limit, and output key. `0.2` is a useful initial temperature for consistent results.
6. Ensure an edge runs from **Prepare brief** to **Draft response**. Drag from the handle on the right of the first block to the handle on the left of the second block if needed.
7. Click the save icon in the upper-right corner. The workflow graph and every node configuration are stored in MongoDB Atlas.
8. Click **Run workflow**. The canvas marks node status, and the execution trace beneath the workspace lists every start, completion, or failure event.

The LLM output is returned under `outputs.writer.response` when the LLM node ID is `writer` and its output key is `response`. In editor templates, use the shorter `{{writer.response}}` form.

## Workflow Document

A workflow is a versioned MongoDB document with a canvas graph:

```json
{
  "version": 1,
  "name": "Brief to response",
  "description": "Build a short response from a fixed brief.",
  "graph": {
    "nodes": [
      {
        "id": "brief",
        "type": "transform",
        "label": "Prepare brief",
        "position": { "x": 120, "y": 120 },
        "config": {
          "mappings": {
            "brief": "Describe the workflow builder in one sentence."
          }
        }
      },
      {
        "id": "writer",
        "type": "llm",
        "label": "Draft response",
        "position": { "x": 420, "y": 120 },
        "config": {
          "model": "gemini-3.6-flash",
          "prompt": "Write a concise response using this brief: {{brief.brief}}",
          "temperature": 0.2,
          "max_tokens": 200,
          "system_instructions": "Be direct and use plain language.",
          "output_key": "response"
        }
      }
    ],
    "edges": [
      { "id": "brief-writer", "source": "brief", "target": "writer" }
    ]
  }
}
```

Each node stores its own `config` object. The editor modifies this object and Save sends the full graph to the backend, so configuration persists across browser and API restarts.

## Workflow Inputs and Template Validation

Workflows may declare typed inputs. A declared input has a stable key, display label, type (`string`, `number`, or `boolean`), and required flag. Templates reference them as `{{input.customer_name}}`.

The run endpoint validates supplied inputs before it starts LangGraph: required values must be present, values must match their declared type, and undeclared input keys are rejected. This prevents API callers from bypassing the editor's forthcoming Run Inputs form.

Before a workflow is created or updated, the backend checks every template in node configuration. A reference must point to either a declared input or an output from an upstream connected node. Invalid references are rejected instead of silently becoming empty values at run time.

Examples:

```text
{{input.customer_name}}  valid when customer_name is declared
{{brief.summary}}        valid when brief is upstream and exposes summary
{{writer.response}}      invalid if writer is downstream of the current node
{{missing.value}}        invalid because missing does not identify a node
```

The visual picker already limits output choices to upstream nodes. A dedicated workflow-input editor and inline template-warning display are the next UI pass.

## Node Types

### Transform

Transform nodes build values for their own output. Each mapping has an output field name and a literal or template value.

```json
{
  "mappings": {
    "greeting": "Hello {{input.name}}"
  }
}
```

The result is stored at `outputs.<node_id>`. The example above produces:

```json
{
  "outputs": {
    "transform-node-id": {
      "greeting": "Hello Jack"
    }
  }
}
```

### LLM

LLM nodes call Google Gemini through `langchain-google-genai`.

```json
{
  "model": "gemini-3.6-flash",
  "prompt": "Summarize: {{input.text}}",
  "temperature": 0.2,
  "max_tokens": 200,
  "system_instructions": "Use concise bullet points.",
  "output_key": "summary"
}
```

- `temperature` must be between `0` and `1`.
- `max_tokens` is optional and must be a positive integer when present.
- System instructions are sent separately from the user prompt.
- Model instances are lazy-created and cached by model name, temperature, and token limit.

### GitHub Repository Context

GitHub Repository Context reads bounded repository metadata, `README.md`, and selected text files with a stored GitHub connection. It rejects secret-like paths and does not execute repository code.

Create a repository-question workflow:

1. Add `owner`, `repository`, and `question` workflow inputs.
2. Add a GitHub Repository Context node, select a GitHub connection, and configure `{{input.owner}}` and `{{input.repository}}`.
3. Keep README enabled and optionally add paths such as `package.json` or `pyproject.toml`.
4. Connect it to an LLM node with a prompt such as:

```text
Repository context:
{{repo_context.repository_context}}

Question: {{input.question}}

Explain what this application does, its main capabilities, and any notable limitations.
```

The node returns the collected text under its configured output key, defaulting to `repository_context`.

### Condition

Condition nodes choose either the `true` or `false` branch from a value in the current context.

```json
{
  "input_path": "outputs.classifier.sentiment",
  "operator": "equals",
  "value": "positive"
}
```

Supported operators: `exists`, `equals`, `not_equals`, and `contains`.

For a condition node to compile, it must have exactly two outgoing edges labeled `true` and `false`. The backend enforces this at execution time. On the canvas, connect from the condition node's dedicated True and False handles; their edges receive these labels automatically, and each branch may have one destination.

### API Request

API nodes make an HTTP request to an approved host.

```json
{
  "method": "POST",
  "url": "https://api.example.com/messages",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "message": "{{writer.response}}"
  },
  "output_key": "delivery"
}
```

Headers, bodies, URLs, and values may use templates. The result contains `status_code` and `body` under the configured output key.

## Templates and Execution Context

Templates use double braces and dot paths. The editor's variable picker inserts the shorter form:

```text
{{input.name}}
{{writer.response}}
```

`{{input.name}}` resolves to `{{inputs.name}}`; `{{writer.response}}` resolves to `{{outputs.writer.response}}`. Canonical forms remain supported for saved or imported workflows.

Every run begins with:

```json
{
  "inputs": {},
  "outputs": {},
  "logs": [],
  "errors": []
}
```

The runner adds node outputs under `outputs.<node_id>`, appends readable log entries, and returns ordered trace events. A trace event has a node ID, label, `started` / `completed` / `failed` status, message, and timestamp.

## Validation and Failures

- Node IDs must be unique.
- Every edge source and target must exist.
- Graphs cannot contain cycles.
- Empty graphs cannot run.
- Condition nodes need `true` and `false` labeled edges.
- API requests must have an absolute `http` or `https` URL and use an approved host.
- Node errors are returned in the execution context and trace instead of crashing the complete workflow run.

## Logging

The backend uses standard Python module loggers via `logger = logging.getLogger(__name__)`. Set `LOG_LEVEL` to `DEBUG`, `INFO`, `WARNING`, or `ERROR`.

Logs record safe operational details such as application lifecycle, database connection state, workflow/node IDs, node types, model names, and status codes. They intentionally do not log credentials, MongoDB URIs, prompts, request bodies, headers, workflow inputs, or LLM responses.

## Current MVP Limits

- The editor opens the first stored workflow; a workflow dashboard is not built yet.
- Run history is returned to the UI but not persisted.
- API request controls are implemented, but production allowlist policy and timeout/retry configuration need refinement.
- API JSON text is validated after focus leaves the field.
- Import/export JSON, authentication, collaboration, streaming execution, and the finished mascot are pending.

## Project Layout

```text
backend/
  app/
    api/workflows.py          FastAPI workflow endpoints
    models/workflow.py        Pydantic workflow and node contracts
    repositories/workflows.py MongoDB persistence
    services/workflow_engine.py LangGraph compilation and trace creation
    services/node_runners.py  Transform, condition, LLM, and API behavior
    services/llm.py           Lazy Google Flash client
  run.py                      Uvicorn launcher on 127.0.0.1:8010
frontend/
  src/App.tsx                 React Flow canvas and node inspectors
  src/App.css                 Editor styling
  vite.config.ts              Vite host/port configuration
.env.example                  Required local configuration template
```
