# Adding a New Workflow Block

Welcome! This guide walks through adding a new block (a "node type," in the code) to Circuit — one of the drag-and-drop pieces users connect together on the canvas, like "Send Gmail" or "Read Drive file."

It's long, but only because it's a checklist-style reference, not because the work itself is hard. Once you've added one or two blocks, most of this becomes muscle memory: the same handful of files, in the same order, every time. Read the big picture below first — it'll make the rest click faster.

Two files carry most of the weight: `backend/app/services/node_runners.py` (what the block actually *does*) and `frontend/src/App.tsx` (what the block *looks like* in the editor). Nearly everything else in this guide is wiring those two things together safely.

## The Big Picture

Before diving into files, here's the journey one block config takes, end to end:

```
1. User drags "Send Slack message" onto the canvas
        │
        ▼
2. Frontend: catalog entry gives it a title/icon; a default config is attached
   (editorCatalog.ts)
        │  user fills in fields in the Inspector panel on the right
        ▼
3. The whole workflow — every block's config — gets saved as JSON
   (a workflow document in MongoDB)
        │  user clicks "Run workflow"
        ▼
4. Backend: node.typed_config() parses that raw JSON into a real,
   validated Pydantic object for this specific block (workflow.py)
        │
        ▼
5. Backend: run_node() looks at the block's type and dispatches to
   your runner function (node_runners.py)
        │  the runner resolves any {{template}} values, calls the
        │  real service (Slack, an LLM, Google Drive...), and returns
        │  a dict of results
        ▼
6. That result is stored under the block's output_key, so any block
   drawn *after* it on the canvas can reference it as
   {{your_node_id.output_key}}
```

A few terms that come up constantly, defined once so they don't feel like jargon later:

- **`output_key`** — the name a block's result is stored under, so other blocks can find it. If a block's output key is `message`, downstream blocks reference it with `{{that_block.message}}`.
- **`typed_config()`** — the method that turns a node's raw saved JSON config into a real Python object of the right type, with validation. This is how the backend knows a "Send Slack message" node actually *has* a `channel` field.
- **Template / `{{...}}`** — the `{{block_id.output_key}}` or `{{input.key}}` syntax users type into fields to pull in a value from somewhere else in the workflow. Resolved at run time, checked for validity before that (see "Preflight" below).
- **Preflight** — a check that runs right before a workflow executes, catching problems (missing connection, empty required field, bad template reference) and showing them to the user *before* anything actually runs.

With that mental model in place, the rest of this guide is really just: "do steps 2, 4, and 5 above, in each of the files where they live."

## Before You Start

A little planning up front saves you from re-touching the same files twice. Decide these things before writing any code:

- Stable block type value, for example `slack_message`.
- Display title and category.
- Configuration fields and defaults.
- Whether the block has an `output_key`.
- Exact output shape.
- Required credentials, connections, or environment variables.
- Which upstream template values it accepts.
- Whether it needs special graph behavior such as branches or loops.
- What should happen on bad input and provider errors.

Prefer a small, explicit output shape. For example:

```json
{
  "message_id": "abc123",
  "status": "sent"
}
```

If the block has `output_key: "message"`, downstream nodes reference it as:

```text
{{send_message.message}}
```

The short template form maps to `outputs.<node_id>.<output_key>` at runtime.

## Required Files

Here's the map. For a normal, non-branching block (the vast majority of them), you'll touch these five — they're what makes the block exist at all:

| File | What you do there |
|---|---|
| `backend/app/models/workflow.py` | Register the block's type name and its config shape |
| `backend/app/services/node_runners.py` | Write the function that does the actual work |
| `frontend/src/editorTypes.ts` | Register the block's type name on the frontend too |
| `frontend/src/editorCatalog.ts` | Give it a title, category, and default config |
| `frontend/src/App.tsx` | Give it an inspector form so users can configure it |

You'll *usually* also touch these:

| File | What you do there |
|---|---|
| `backend/app/services/workflow_validation.py` | Catch bad configs before a run starts (preflight) |
| `backend/app/services/api_catalog.py` | Only if the block wraps a known external API — lets Workflow Copilot describe it accurately |
| `.env.example` and `README.md` | Only if the block needs a new environment variable |
| Tests / a focused regression script | Confirm the contract, not just the happy path |

And these only if the block genuinely needs them — don't reach for them by default:

- `backend/app/repositories/*.py` — new persistence access
- `backend/app/services/*.py` — a new OAuth flow or provider-specific service
- `backend/app/api/*.py` — a new HTTP endpoint
- `frontend/src/components/*.tsx` — a reusable or large editor component
- `frontend/src/App.css` (or a focused CSS file) — custom UI
- `backend/app/services/workflow_engine.py` — only for branch/loop control-flow nodes like `CONDITION`, `FOR_EACH`, `REPEAT_UNTIL`
- `backend/app/services/scheduler.py` — only for *trigger* behavior. This is a common mix-up: scheduling and event/Drive-watch polling live here, not in `workflow_engine.py`. It decides when a `SCHEDULE` node fires, then calls `run_workflow()` directly (bypassing `validate_run_inputs`, so ad hoc trigger-supplied inputs like `drive_file_id` don't need to be declared workflow inputs)
- `backend/app/services/workflow_copilot.py` — Copilot's capability description or its deterministic workflow proposals

## Implementation Order

There's a reason to do these in order rather than jumping straight to the pretty UI part: the backend defines what the block *is*, and the frontend just needs to agree with that definition. Build the backend first and the frontend part goes faster because you're not guessing at a shape that doesn't exist yet.

1. Add the backend node type and config model.
2. Add the backend runner and dispatch entry.
3. Register output keys and template validation behavior.
4. Add preflight checks for configuration and credentials.
5. Add the frontend kind and default config.
6. Add the block catalog entry.
7. Add the inspector form.
8. Add output discovery and variable picker behavior.
9. Add help text.
10. Add tests and build validation.

The sections below walk through each of these one at a time, using a fictional "Send Slack message" block as a running example.

## 1. Backend Node Type and Config

This is where the block starts existing, technically speaking — nothing about it works yet, but the system now knows the name and shape of it.

Open `backend/app/models/workflow.py`.

### Add the enum value

Add the stable serialized value to `NodeType`:

```python
class NodeType(StrEnum):
    # Existing values...
    SLACK_MESSAGE = "slack_message"
```

The serialized value is stored in MongoDB and sent to the frontend. Do not casually rename it after release.

### Add a Pydantic config model

Place the config model near related models:

```python
class SlackMessageNodeConfig(BaseModel):
    channel: str = ""
    text: str = ""
    connection_id: str = Field(min_length=1)
    output_key: str = "message"
```

Use Pydantic constraints for values that must exist or be bounded. Keep template-bearing fields as strings so they can be resolved at runtime.

### Add it to the union

Add the config to `NodeConfig`:

```python
NodeConfig = ExistingConfig | SlackMessageNodeConfig
```

### Add it to `WorkflowNode.typed_config()`

This is required. Without it, saved nodes cannot be parsed into the correct config:

```python
config_models = {
    # Existing entries...
    NodeType.SLACK_MESSAGE: SlackMessageNodeConfig,
}
```

### Register its output keys

`node_output_keys()` is used by template validation. Nodes with an `output_key` are discovered automatically by the current implementation. If the block has a custom output shape without `output_key`, add an explicit case.

For a normal output-key block, this is enough:

```python
output_key = getattr(config, "output_key", None)
```

If the block returns multiple named outputs, add those names explicitly and make sure the runner returns the same keys.

## 2. Backend Runner and Dispatch

The block has a shape now — this is where it actually does something.

Open `backend/app/services/node_runners.py`.

### Add a runner

Use the existing patterns for template resolution, credentials, HTTP clients, retries, and errors:

```python
async def run_slack_message(
    node: WorkflowNode,
    context: dict[str, Any],
    connections: ConnectionRepository | None,
    owner_id: str | None,
) -> dict[str, Any]:
    config = node.typed_config()
    assert isinstance(config, SlackMessageNodeConfig)

    values = resolve_template(
        {"channel": config.channel, "text": config.text},
        context,
    )

    if not values["channel"] or not values["text"]:
        raise ValueError("Slack message requires a channel and text")

    # Use the provider client here.
    result = {"message_id": "...", "status": "sent"}
    return {config.output_key: result}
```

Runner rules:

- Resolve templates before making external calls.
- Validate required resolved values.
- Never return secret values in output, logs, or errors.
- Raise concise `ValueError` messages for user-correctable failures.
- Return a dictionary keyed by the configured output key.
- Keep provider-specific details inside the runner or a dedicated service.

### Add dispatch

At the bottom of `run_node()`:

```python
if node.type == NodeType.SLACK_MESSAGE:
    return await run_slack_message(node, context, connections, owner_id)
```

If the block is added to the enum and config model but not this dispatch table, runtime execution ends with `Unsupported node type`.

## 3. Credentials and Connections

Skip this section entirely if your block doesn't call anything that needs auth. If it does, pick one of these three patterns rather than inventing a fourth:

### Per-user secret

Use `SecretRepository` and a node config field such as `api_key_secret`. The node should resolve the encrypted secret at runtime for the current owner.

### Shared environment credential

Add fields to `backend/app/config.py`:

```python
slack_api_key: str | None = None
```

The environment name is derived from the field name by Pydantic Settings, so `slack_api_key` maps to `SLACK_API_KEY`.

Document it in `.env.example` and `README.md`. Never commit real values.

### User OAuth connection

Use `ConnectionRepository` and a provider service. The connection must be scoped to the authenticated owner. Do not expose access tokens to the frontend or Copilot.

If a block supports both per-user and shared credentials, define precedence clearly. The current Job Search behavior is:

1. Node-specific user secret.
2. Shared environment credential.
3. A clear error if neither exists.

## 4. Preflight Validation

The backend can now run the block — but "can run" and "gives a good error message when misconfigured" are different things. This is where you add the latter.

Open `backend/app/services/workflow_validation.py`.

Add checks for configuration that can be detected before execution:

- Required URL, prompt, or field is present.
- Required connection exists and belongs to the user.
- Required user secret exists.
- Shared environment fallback is configured.
- Host is allowlisted for outbound API access.

Example:

```python
if node.type == NodeType.SLACK_MESSAGE:
    config = node.typed_config()
    if not config.channel:
        issues.append(PrefightIssue("error", node.id, node.label, "Slack channel is required"))
```

Use severity `error` when execution should be blocked and `warning` when execution can safely continue.

The preflight endpoint is:

```text
POST /api/workflows/{workflow_id}/preflight
```

The frontend runs preflight before execution and displays blocking errors in the editor alert.

## 5. Frontend Type Registration

The backend is fully done at this point. Everything from here on is teaching the editor UI that this block exists.

Open `frontend/src/editorTypes.ts`.

Add the serialized kind to `Kind`:

```typescript
export type Kind =
  | "llm"
  // Existing values...
  | "slack_message";
```

This keeps node data, catalog entries, proposals, and stored graph types consistent.

## 6. Frontend Catalog and Defaults

This is what makes the block show up in the library panel on the left, draggable onto the canvas.

Open `frontend/src/editorCatalog.ts`.

Add a block entry:

```typescript
{
  kind: "slack_message",
  title: "Send Slack message",
  description: "Post a message to Slack",
  category: "Output connectors",
}
```

Add a default config under `configs`:

```typescript
slack_message: {
  channel: "",
  text: "",
  connection_id: "",
  output_key: "message",
},
```

The default must contain every field the inspector reads. Missing defaults create uncontrolled inputs or undefined runtime configuration.

## 7. Frontend Inspector Form

The block can be dragged onto the canvas now, but there's nowhere to configure it yet — that's the panel that appears on the right when a node is selected.

Open `frontend/src/App.tsx` and find `NodeForm()`.

Add a branch for the new kind:

```tsx
if (kind === "slack_message") {
  return (
    <div className="node-form">
      <p className="form-hint">Send a message through the selected Slack connection.</p>
      <label>
        Channel
        <input
          value={String(config.channel ?? "")}
          onChange={(event) => update("channel", event.target.value)}
        />
      </label>
      <label>
        Message
        <textarea
          rows={5}
          value={String(config.text ?? "")}
          onChange={(event) => update("text", event.target.value)}
        />
        <VariablePicker
          variables={variables}
          onInsert={(token) => update("text", `${String(config.text ?? "")}${token}`)}
        />
      </label>
      <label>
        Output key
        <input
          value={String(config.output_key ?? "message")}
          onChange={(event) => update("output_key", event.target.value)}
        />
      </label>
    </div>
  );
}
```

Use the existing `Field` wrapper when the field needs Help Mode support. Use `TemplateWarnings` and `VariablePicker` for any field that accepts templates.

## 8. Frontend Output Discovery

This step is easy to forget because everything *works* without it — the block runs fine either way. But without it, no one downstream can easily find this block's output to reference it, so it'll look broken even though it isn't.

Find `outputKeys()` in `frontend/src/App.tsx`.

For an `output_key` block, add:

```typescript
if (node.data.kind === "slack_message")
  return [String(node.data.config.output_key ?? "message")];
```

This controls which outputs appear in downstream variable pickers. If this step is missed, the runner may work but users cannot conveniently insert its output.

## 9. Block Icon, Help, and Copilot

The block is fully functional at this point — this section is the polish that makes it feel like it belongs next to every other block in Circuit.

### Icon

Find the icon map in `App.tsx` and add the new kind. Prefer an existing `lucide-react` icon.

### Block help

Add a `blockHelp` entry:

```typescript
slack_message: {
  title: "Send Slack message block",
  what: "Posts a message through a connected Slack account.",
  when: "Use it after an LLM or Transform block prepares a notification.",
  example: "Message: {{writer.response}}",
},
```

### Field help

Add entries for important fields such as:

- `slack_message.channel`
- `slack_message.text`
- `slack_message.connection`
- `slack_message.output_key`

### Copilot capability text

If the new block changes what Copilot can offer, update `backend/app/services/workflow_copilot.py`:

- `CAPABILITIES`
- Deterministic proposals, if this block belongs in a known workflow pattern
- Prompt instructions that restrict proposals to real node types and available connections

## 10. Graph and Engine Changes

Most ordinary blocks do not require `workflow_engine.py` changes. The engine calls `run_node()` for them.

Update `backend/app/services/workflow_engine.py` only when the block changes control flow, for example:

- A new branch node.
- A new loop type.
- A node that executes a nested graph.

For a branch node, also update connection validation in `App.tsx` so allowed handles are enforced on the canvas.

### Adding a new trigger mode instead of a new block

Not every feature is a new `NodeType`. Adding a way for a workflow to *start* (a new `SCHEDULE` trigger mode, for example) is a different, smaller pattern:

1. Add the new `trigger_mode` value and any supporting config fields to `ScheduleNodeConfig` in `backend/app/models/workflow.py`.
2. Add a branch in the polling loop in `backend/app/services/scheduler.py` that decides when it fires and calls `run_workflow(workflow, inputs, connections, owner_id)` directly. Any inputs you invent here (e.g. `drive_file_id`) are plain dict keys, not declared `WorkflowInput`s — but if a downstream block should be able to reference them via `{{input.x}}`, add them to the allow-list in `validate_template_references()` in `workflow.py` (see how `drive_file_id`/`drive_file_name`/`drive_file_mime_type` are handled for `drive_watch`), otherwise saving the workflow will fail with "references undeclared input".
3. Add preflight checks for the new trigger mode's required fields in `workflow_validation.py` (see the `SCHEDULE` node's `continue`-guarded block near the top of the node loop).
4. Add the UI in `ScheduleForm` in `App.tsx`, and if it should be selectable in the variable picker, extend `variablesFor()` the same way `drive_watch` variables are added.

## 11. API Catalog and Documentation

For a connector backed by a documented external API, update `backend/app/services/api_catalog.py` so Copilot can discover it during API questions.

Add:

- Connector name.
- Search keywords.
- Source documentation URL.
- HTTP method and URL.
- Authentication requirements.
- Example headers and body.

Update `.env.example` and `README.md` for new environment variables, allowlisted hosts, setup steps, or credentials.

Never add real credentials to documentation, tests, or source files.

## 12. Tests and Validation

At minimum, test these layers:

### Backend model test

- Config parses valid data.
- Required fields reject invalid data.
- `typed_config()` returns the new config type.

### Template validation test

- A valid upstream reference passes.
- A missing output fails with a useful message.
- A self-reference fails.
- A downstream reference fails.

### Runner test

- Templates resolve correctly.
- The provider request is shaped correctly.
- The output matches the documented contract.
- Provider errors become useful workflow errors.

### Frontend build

Run:

```powershell
npm --prefix frontend run build
```

### Backend compilation

Run:

```powershell
$files = Get-ChildItem backend\app -Recurse -Filter *.py | ForEach-Object { $_.FullName }
.venv\Scripts\python.exe -m py_compile $files
```

For a small focused Python test:

```powershell
$env:PYTHONPATH = "backend"
.venv\Scripts\python.exe path\to\test_file.py
```

## Complete Checklist

A copy-pasteable version of everything above, for a final pass before you call the block done.

### Backend

- [ ] Added `NodeType` enum value.
- [ ] Added Pydantic config model.
- [ ] Added config to `NodeConfig`.
- [ ] Added config to `WorkflowNode.typed_config()`.
- [ ] Added runner function.
- [ ] Added `run_node()` dispatch.
- [ ] Confirmed output keys are discoverable.
- [ ] Added credential, connection, or environment handling.
- [ ] Added preflight validation.
- [ ] Added provider-specific errors and logging without secrets.
- [ ] Added API catalog entry when relevant.

### Frontend

- [ ] Added kind to `editorTypes.ts`.
- [ ] Added block catalog entry.
- [ ] Added default config.
- [ ] Added inspector form branch.
- [ ] Added template warnings and variable picker where relevant.
- [ ] Added `outputKeys()` mapping.
- [ ] Added block icon.
- [ ] Added block help.
- [ ] Added field help.
- [ ] Added Copilot capability/proposal support when relevant.

### Verification

- [ ] Saved a workflow containing the new block.
- [ ] Ran preflight.
- [ ] Ran the workflow successfully.
- [ ] Tested a provider failure.
- [ ] Confirmed the execution trace identifies the node.
- [ ] Confirmed downstream template insertion works.
- [ ] Ran backend compilation.
- [ ] Ran the frontend production build.

## Common Failure Modes

If something's not working, it's almost certainly one of these — check here before assuming something more exotic is wrong.

### `Unsupported node type`

The enum/config may exist, but `run_node()` does not dispatch to the runner.

### `Invalid workflow templates`

Usually one of these:

- The source node ID is stale.
- The source node is not upstream.
- The output key does not match the source config.
- A Transform references its own output.
- `outputKeys()` or `node_output_keys()` does not know the output.

### Inspector shows undefined fields

The frontend default config is missing a field read by `NodeForm()`.

### The output works but does not appear in the variable picker

Add the node to frontend `outputKeys()` and confirm the backend output key is consistent.

### Preflight blocks a valid-looking node

Check whether credentials are user-scoped, shared through environment variables, or absent. Preflight should describe which source it expects.

### Save appears to work but Run does not start

Check the preflight response. The editor intentionally saves first, then blocks execution when preflight returns errors. The visible editor alert should contain the specific blocker.

## Design Principles

The rules of thumb behind all of the above — worth internalizing, since they'll settle most judgment calls this guide doesn't explicitly cover:

- Keep the serialized node type stable.
- Make configuration explicit and validated.
- Keep output keys predictable.
- Prefer upstream references selected through the variable picker.
- Never hide credential requirements until execution.
- Never expose secret values to the frontend, logs, or Copilot.
- Keep external provider logic out of the React editor.
- Add tests for the contract, not only the happy-path HTTP call.
- Treat preflight and runtime errors as user-facing product behavior, not just developer diagnostics.
