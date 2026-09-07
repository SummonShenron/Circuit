# Adding a New Workflow Block

This guide explains how to add a new workflow block to Circuit. A block is complete only when it can be created in the editor, saved, validated, executed, inspected, and documented.

The current implementation keeps most frontend editor behavior in `frontend/src/App.tsx` and most backend node behavior in `backend/app/services/node_runners.py`.

## Before You Start

Decide these contracts first:

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

For a normal, non-branching block, update these files:

1. `backend/app/models/workflow.py`
2. `backend/app/services/node_runners.py`
3. `frontend/src/editorTypes.ts`
4. `frontend/src/editorCatalog.ts`
5. `frontend/src/App.tsx`

Usually also update:

6. `backend/app/services/workflow_validation.py`
7. `backend/app/services/api_catalog.py` if the block exposes an API connector
8. `.env.example` and `README.md` if new environment variables are needed
9. Tests or a focused regression script

Update these only when the block needs them:

- `backend/app/repositories/*.py` for new persistence access
- `backend/app/services/*.py` for OAuth or provider-specific services
- `backend/app/api/*.py` for new HTTP endpoints
- `frontend/src/components/*.tsx` for a reusable or large editor component
- `frontend/src/App.css` or a focused CSS file for custom UI
- `backend/app/services/workflow_engine.py` for branch, loop, or scheduling behavior
- `backend/app/services/workflow_copilot.py` for Copilot capability descriptions or deterministic proposals

## Implementation Order

Use this order so the type contract exists before wiring the UI:

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

## 1. Backend Node Type and Config

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

Choose one of these patterns:

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

Find `outputKeys()` in `frontend/src/App.tsx`.

For an `output_key` block, add:

```typescript
if (node.data.kind === "slack_message")
  return [String(node.data.config.output_key ?? "message")];
```

This controls which outputs appear in downstream variable pickers. If this step is missed, the runner may work but users cannot conveniently insert its output.

## 9. Block Icon, Help, and Copilot

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
- Special scheduling or event behavior.

For a branch node, also update connection validation in `App.tsx` so allowed handles are enforced on the canvas.

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

- Keep the serialized node type stable.
- Make configuration explicit and validated.
- Keep output keys predictable.
- Prefer upstream references selected through the variable picker.
- Never hide credential requirements until execution.
- Never expose secret values to the frontend, logs, or Copilot.
- Keep external provider logic out of the React editor.
- Add tests for the contract, not only the happy-path HTTP call.
- Treat preflight and runtime errors as user-facing product behavior, not just developer diagnostics.
