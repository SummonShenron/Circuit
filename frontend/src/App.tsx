import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Braces,
  CirclePlay,
  CircleHelp,
  Check,
  Cloud,
  Download,
  Database,
  GitBranch,
  Globe2,
  HardDrive,
  Mail,
  Clock3,
  CloudSun,
  Newspaper,
  Table2,
  FileSpreadsheet,
  Rss,
  SendHorizontal,
  MessageSquareText,
  CalendarDays,
  GitPullRequest,
  History,
  Plus,
  Save,
  Sparkles,
  MessageCircle,
  PanelRight,
  Tag,
  Trash2,
  Undo2,
  Workflow,
  X,
  Search,
} from "lucide-react";
import "./App.css";
import "./EditorOverrides.css";
import Dashboard from "./Dashboard";
import { UserButton } from "@clerk/clerk-react";
import { PatchyEmptyState } from "./components/PatchyEmptyState";
import { BlockLibrary } from "./components/BlockLibrary";
import { RunInputsDialog } from "./components/RunInputsDialog";
import { ConnectionPicker } from "./components/ConnectionPicker";
import { CopilotBlade } from "./components/CopilotBlade";
import { blocks, configs } from "./editorCatalog";
import type { Data, FlowNode, HelpTopic, Kind, Proposal, RunResult, Status, Stored, Variable, WorkflowInput, WorkflowPatchProposal } from "./editorTypes";
import { getApiUrl } from "./apiConfig";
import { isTutorialId, tutorials, type Tutorial, type TutorialId } from "./tutorials";

const API = getApiUrl();
const MODELS = ["gemini-3.6-flash", "gemini-1.5-flash"];
type RunHistoryEntry = RunResult & { id: string; startedAt: string; durationMs: number; status: "completed" | "failed" };
const formatRunJson = (value: unknown) => {
  try {
    const formatted = JSON.stringify(value ?? {}, null, 2);
    return formatted === undefined ? String(value) : formatted;
  } catch {
    return String(value);
  }
};
const starter: FlowNode[] = [
  {
    id: "brief",
    type: "workflow",
    position: { x: 120, y: 120 },
    data: {
      label: "Prepare brief",
      kind: "transform",
      config: {
        mappings: { brief: "Describe the workflow builder in one sentence." },
      },
      status: "idle",
    },
  },
  {
    id: "writer",
    type: "workflow",
    position: { x: 420, y: 120 },
    data: {
      label: "Draft response",
      kind: "llm",
      config: {
        ...configs.llm,
        prompt:
          "Write a concise response using this brief: {{outputs.brief.brief}}",
      },
      status: "idle",
    },
  },
];
const starterEdges: Edge[] = [
  { id: "brief-writer", source: "brief", target: "writer", animated: true },
];
const blockHelp: Record<Kind, HelpTopic> = {
  llm: { title: "LLM block", what: "Sends a prompt to a configured Gemini model and stores its generated response.", when: "Use it to summarize, classify, rewrite, extract, or generate text.", example: "Prompt: Summarize {{brief.brief}} in three bullets. Tip: Enable JSON mode to extract structured data like job listings." },
  transform: { title: "Transform block", what: "Builds predictable values from text, workflow inputs, and upstream outputs without calling a model. Can also merge arrays from multiple sources into one list.", when: "Use it to prepare a prompt, shape API data, or merge multiple job/record listings into a single unified list for downstream processing.", example: "Regular: message: Hello {{input.customer_name}}. Array merge: jobs: merge {{company1.jobs}} and {{company2.jobs}}" },
  api: { title: "API request block", what: "Makes an HTTP request to an approved host and stores the response for later blocks.", when: "Use it to create calendar events, send data to a webhook, or call a connected service.", example: "POST a JSON body using {{writer.response}}." },
  condition: { title: "Condition block", what: "Checks a value and chooses either its True or False outgoing route.", when: "Use it when later steps depend on whether a value exists, matches, or contains text.", example: "If {{classifier.status}} equals approved, follow True." },
  repeat_until: { title: "Repeat Until block", what: "Runs a bounded loop until a configured condition succeeds or the iteration limit is reached.", when: "Use it for revision, polling, or quality-check loops that must stop safely.", example: "Continue while quality.passed is not true, up to 3 iterations." },
  for_each: { title: "For Each block", what: "Runs selected body nodes once for every item in a list and collects their results.", when: "Use it to process documents, records, URLs, or messages one at a time.", example: "Run a summary body for every {{input.documents}} item." },
  github_repository: { title: "GitHub Repository Context block", what: "Reads safe, bounded repository metadata and selected text files using your encrypted GitHub connection.", when: "Use it before an LLM block that needs to explain a repository's purpose, files, and capabilities.", example: "Read README.md and package.json, then pass {{repo.repository_context}} to an LLM." },
  resend_email: { title: "Send Email block", what: "Sends a text or HTML email through Resend using the server-side RESEND_API_KEY.", when: "Use it after an LLM or Transform block has prepared a notification, report, or customer message.", example: "To: {{input.customer_email}}, Subject: Your update, Body: {{writer.response}}" },
  google_drive: { title: "Google Drive File block", what: "Creates a new text file or writes content to an existing Google Drive file using your connected Google Workspace account.", when: "Use it to save reports, generated documents, or workflow results for later access.", example: "Name: weekly-report.md, Content: {{writer.response}}" },
  google_drive_update: { title: "Update Google Drive File block", what: "Replaces the content of an existing Google Drive file using its file ID and your Google Workspace connection.", when: "Use it when a recurring workflow should keep one report or document up to date.", example: "File ID: 1abc..., Content: {{generate_briefing.briefing}}" },
  weather_forecast: { title: "Weather Forecast block", what: "Fetches a NOAA forecast without an API key.", when: "Use it in a daily briefing or weather-aware automation.", example: "Outputs a seven-day forecast for the configured NOAA grid point." },
  news_headlines: { title: "News Headlines block", what: "Fetches current Hacker News front-page headlines without an API key.", when: "Use it in a briefing or research workflow.", example: "Returns the top five current Hacker News stories." },
  google_sheets_append: { title: "Append Google Sheet Row block", what: "Appends one row to a Google Sheet through your Google Workspace connection.", when: "Use it to log workflow results or collect records over time.", example: "Spreadsheet ID: 1abc..., Range: Sheet1!A:Z" },
  csv_create: { title: "Create CSV block", what: "Builds a CSV file payload from headers and rows.", when: "Use it before saving an export to Drive or sending it to another service.", example: "Headers: [\"name\", \"status\"], Rows: [[\"Patchy\", \"ready\"]]" },
  rss_feed: { title: "RSS Feed block", what: "Reads a bounded list of RSS or Atom feed items without an API key.", when: "Use it for blogs, release notes, news feeds, and monitoring.", example: "Feed URL: https://example.com/feed.xml" },
  webhook_post: { title: "Webhook POST block", what: "Sends a JSON POST request to an allowlisted host.", when: "Use it to notify another service or hand off structured workflow data.", example: "POST {\"message\": \"{{writer.response}}\"}" },
  http_response: { title: "HTTP Response block", what: "Defines the public HTTP response returned by an event-triggered workflow.", when: "Use it as the final node in a workflow called by a CLI, frontend, or another service. Select it as the Schedule node's Public response node.", example: "Status: 200\nHeaders: {\"Content-Type\":\"application/json\"}\nBody: {\"message\":\"{{answer.response}}\",\"conversation_id\":\"{{input.conversation_id}}\"}\nOutput key: http_response" },
  mongodb: { title: "MongoDB block", what: "Reads records or updates one record in a server-side MongoDB database.", when: "Use it for user-approved data lookups or bounded updates. Credentials stay on the server or in an encrypted user secret.", example: "Operation: Find\nDatabase: app\nCollection: users\nFilter: {\"email\":\"{{input.email}}\"}" },
  mongodb_vector_search: { title: "MongoDB Search block", what: "Embeds a query and runs a MongoDB Atlas $vectorSearch against a configured search index, returning the top matching chunks.", when: "Use it as the retriever step in a RAG workflow, right before an LLM block that answers using the returned chunks.", example: "Index: vector_index, k: 4, Strategy: Hybrid, Query: {{input.message}}" },
  gmail_send: { title: "Send Gmail block", what: "Sends plain-text email through a connected Google Workspace account.", when: "Use it when email should come from the user’s Google account instead of Resend.", example: "To: someone@example.com, Subject: Workflow result" },
  reddit_headlines: { title: "Reddit Headlines block", what: "Reads subreddit posts through Reddit’s public JSON endpoint using a descriptive User-Agent.", when: "Use it for community monitoring, topic summaries, or social listening workflows.", example: "Subreddit: news, Sort: top, Limit: 5" },
  google_calendar: { title: "Google Calendar block", what: "Lists, creates, or updates calendar events through a connected Google Workspace account.", when: "Use it for briefings, reminders, scheduling, and event-driven workflows.", example: "Operation: Create, Event: {\"summary\":\"Team sync\",\"start\":{...},\"end\":{...}}" },
  github_action: { title: "GitHub Action block", what: "Creates issues, comments on issues, or opens pull requests using the selected GitHub PAT.", when: "Use it to turn workflow results into tracked engineering work.", example: "Create issue in owner/repository with title and body from an LLM." },
  job_search: { title: "Job Search block", what: "Searches supported job APIs and normalizes listings into a common jobs output.", when: "Use it to build job alerts, interview prep digests, or role-ranking workflows.", example: "Provider: Adzuna, Keywords: software engineer, Location: Des Moines, IA" },
  erragent: { title: "ErrAgent block", what: "Asks ErrAgent to plan, debug, or propose changes using the current workflow context.", when: "Use it when an incident, failed run, connector idea, or new automation needs an architect.", example: "Operation: Debug failed run, Goal: Explain why the last email step failed." },
  schedule: { title: "Schedule / event trigger", what: "Starts a workflow on a recurring timer or receives a signed JSON event from a CLI, frontend, or another backend.", when: "Use schedule mode for recurring work. Use event mode to expose a workflow as a headless API that accepts JSON inputs and can return a configured HTTP Response.", example: "POST /api/workflows/{workflow_id}/events/chat-message with X-Workflow-Trigger and {\"message\":\"Hello\"}." },
  variable: { title: "Variable block", what: "Stores one named value for later blocks. Its value may be literal text or built from another variable, input, or upstream output.", when: "Use it to name a reusable URL, instruction, shared label, or prepared value without repeating it across several nodes.", example: "Name: api_base_url, Value: https://api.example.com" },
};
const panelHelp = {
  library: { title: "Block library", what: "This panel contains every workflow building block and the workflow inputs available at run time.", when: "Use it to add a new capability to the canvas or declare values a workflow receives from a user.", example: "Add a Transform block to prepare data before an LLM block." },
  inspector: { title: "Node inspector", what: "This panel edits the selected block's label, configuration, connections, and retry behavior.", when: "Use it after selecting a canvas block to define exactly what it should do.", example: "Set an LLM prompt, then insert {{brief.brief}} from an earlier Transform output." },
  copilot: { title: "Workflow Copilot", what: "The Copilot explains, debugs, and proposes workflow changes using the current canvas as context.", when: "Use it when you need help choosing blocks, mapping outputs, or diagnosing a failed workflow.", example: "Ask: Create a flow that summarizes each document and sends the results." },
};
// Per-field help shown when Help Mode is on and a specific inspector field is clicked.
// Keys are "<kind>.<field>"; a few fields (retry, headers, body, output key) are reused
// across kinds so they're keyed by usage (e.g. "llm.retry" vs "api.retry").
const fieldHelp: Record<string, HelpTopic> = {
  "inspector.close": { title: "Close inspector", what: "Deselects the current block, closing the inspector panel.", when: "Use it once you're done editing a block and want to return to browsing the canvas.", example: "Click the X after finishing an LLM block's prompt." },
  "inspector.delete": { title: "Delete block", what: "Removes the selected block from the canvas along with any edges connected to it.", when: "Use it to remove a block that's no longer part of the workflow.", example: "Delete an unused Transform block before saving." },
  "inspector.label": { title: "Block label", what: "The display name shown on the canvas node and used in error messages and traces.", when: "Rename a block so its purpose is clear at a glance, especially once a workflow has several blocks of the same kind.", example: "Rename an LLM block from \"LLM\" to \"Draft response\"." },
  "llm.model": { title: "Model", what: "Chooses which Gemini model generates the response for this block.", when: "Pick a faster model for simple tasks, or a more capable one for nuanced writing or reasoning.", example: "gemini-3.6-flash for quick summaries; gemini-1.5-flash if 3.6 is unavailable." },
  "llm.prompt": { title: "Prompt", what: "The instruction sent to the model, which can include variables from earlier blocks or workflow inputs.", when: "Write it like an instruction to a person: what to produce, from what input, in what format.", example: "Summarize {{brief.brief}} in three bullet points for a busy exec." },
  "llm.temperature": { title: "Temperature", what: "Controls how deterministic vs. varied the model's output is, from 0 (focused) to 1 (creative).", when: "Lower it for factual or structured output; raise it for brainstorming or creative writing.", example: "0.1 for extracting a value; 0.7 for drafting marketing copy." },
  "llm.max_tokens": { title: "Max tokens", what: "Caps how long the model's response can be. Leave blank to let the model decide.", when: "Set a cap to control cost and latency, or to keep downstream fields short.", example: "Set 60 to keep a generated subject line to roughly one sentence." },
  "llm.system_instructions": { title: "System instructions", what: "Standing guidance applied to every call this block makes, separate from the per-run prompt.", when: "Use it for tone, role, or constraints that shouldn't change run to run.", example: "You are a support agent. Always respond in two short paragraphs." },
  "llm.json_mode": { title: "JSON mode", what: "Instructs the model to return structured JSON and extracts it from markdown code blocks or plain JSON.", when: "Enable it when you need to extract structured data like job listings, classified records, or tabular fields for downstream processing.", example: "Extract job listings as [{\"title\": \"...\", \"company\": \"...\", \"location\": \"\"}]" },
  "llm.output_key": { title: "Output key", what: "The name later blocks use to reference this block's response, as {{this_block_id.<key>}}.", when: "Change it when you have multiple LLM blocks and want their outputs to be easy to tell apart.", example: "Set to draft so later steps use {{writer.draft}}." },
  "llm.retry": { title: "Retry policy", what: "Controls how many times this block retries on failure and how long it waits between attempts.", when: "Increase attempts for flaky model calls; raise the backoff multiplier to space retries out further.", example: "3 attempts, 500ms initial delay, 2x backoff: waits 500ms, then 1000ms, then 2000ms." },
  "erragent.goal": { title: "ErrAgent goal", what: "The instruction sent to ErrAgent along with this workflow run's inputs and outputs.", when: "Describe the planning, debugging, connector, or job-search task you want ErrAgent to handle.", example: "Explain the latest failed run and propose a safe workflow patch." },
  "http_response.status_code": { title: "HTTP status code", what: "The status code returned to the event caller when this node is selected as the public response.", when: "Use 200 for a successful assistant response, 400-series codes for caller errors, or 500-series codes for workflow failures.", example: "200" },
  "http_response.headers": { title: "Response headers", what: "String-to-string headers returned with the public response.", when: "Set Content-Type to application/json when returning a JSON body.", example: "{\"Content-Type\":\"application/json\"}" },
  "http_response.body": { title: "JSON response body", what: "The public JSON payload returned to a CLI, frontend, or backend caller. It can contain templates from inputs and upstream nodes.", when: "Shape the stable contract your calling application reads instead of exposing Circuit's internal trace and context.", example: "{\"message\":\"{{answer.response}}\",\"conversation_id\":\"{{input.conversation_id}}\",\"suggestions\":[]}" },
  "http_response.output_key": { title: "Output key", what: "The internal name for this response node's result before Circuit sends its body to the event caller.", when: "Leave it as http_response unless another node needs a distinct reference.", example: "http_response" },
  "schedule.event": { title: "Headless event trigger", what: "Exposes this workflow through a signed JSON POST endpoint. The request body becomes workflow input values.", when: "Use event mode when another app, CLI, or backend should invoke Circuit on demand.", example: "POST /api/workflows/<workflow_id>/events/chat-message with X-Workflow-Trigger and {\"message\":\"Hello Circuit\"}." },
  "schedule.event_secret": { title: "Event trigger secret", what: "Names the encrypted dashboard secret used to authenticate event callers through the X-Workflow-Trigger header.", when: "Create the secret on the dashboard, then give its value only to the trusted calling app or CLI.", example: "CHAT_TRIGGER_TOKEN" },
  "schedule.response": { title: "Public response node", what: "Selects the HTTP Response node whose status, headers, and JSON body are returned to an event caller.", when: "Select it when a CLI, frontend, or backend needs a clean response instead of Circuit's internal run trace.", example: "HTTP Response body: {\"message\":\"{{answer.response}}\"}" },
  "transform.mappings": { title: "Mappings", what: "Each row defines one output field, built from literal text and inserted variables, without calling a model.", when: "Use it to assemble a prompt, reshape data for an API call, or set a fixed value.", example: "Key \"greeting\", value \"Hello {{input.customer_name}}\"." },
  "transform.merge_arrays": { title: "Array merge", what: "Combines multiple arrays from different sources into one unified output list.", when: "Use it after a For Each loop that produces multiple job/record listings to merge them into one output for Google Sheets.", example: "Output key: jobs, paths: {{company1.jobs}} and {{company2.jobs}} merged into jobs: [all items]." },
  "template.array_indexing": { title: "Array indexing in templates", what: "Access individual items from a list using bracket notation with zero-based indices, and drill into nested fields.", when: "Use it to extract a specific job, record, or item from a For Each loop output or any list returned by a node.", example: "{{foreach.items[0].title}} extracts the title of the first item; {{foreach.items[0]}} gets the whole first item; {{lists.results[2].jobs}} drills into index 2 to get the jobs field." },
  "condition.input_path": { title: "Input path", what: "The value this block checks, referenced as a variable from an earlier block or workflow input.", when: "Point it at whatever value determines which branch the workflow should take.", example: "{{classifier.status}} to branch on a value produced by an earlier LLM block." },
  "condition.operator": { title: "Operator", what: "How the input path's value is compared: whether it exists, equals, doesn't equal, or contains something.", when: "Use \"Exists\" for optional values, \"Equals\" for exact matches, \"Contains\" for substrings.", example: "Equals \"approved\" to follow True only on an exact match." },
  "condition.value": { title: "Comparison value", what: "The value the input path is compared against, unused when the operator is \"Exists\".", when: "Set it to whatever the input path should equal, not equal, or contain.", example: "approved, when checking {{classifier.status}} equals approved." },
  "repeat_until.input_path": { title: "Check path", what: "The value checked on each iteration to decide whether the loop should continue or stop.", when: "Point it at a value produced inside the loop body, such as a pass/fail flag.", example: "quality.passed to loop until a quality-check block reports true." },
  "repeat_until.operator": { title: "Operator", what: "How the check path's value is evaluated: exists, equals, doesn't equal, or contains.", when: "Use \"Equals\" or \"Not equals\" for pass/fail style checks, \"Contains\" for partial matches.", example: "Not equals \"true\" to keep looping until the check flips to true." },
  "repeat_until.value": { title: "Expected value", what: "The value the check path is compared against on each iteration.", when: "Set it to the value that should end the loop once reached.", example: "true, so the loop ends once quality.passed equals true." },
  "repeat_until.max_iterations": { title: "Maximum iterations", what: "A hard cap on loop iterations so the workflow can't run forever if the check never succeeds.", when: "Set it based on how many revision or polling attempts are reasonable before giving up.", example: "3, to allow up to three revision passes before taking the Limit reached branch." },
  "for_each.items_path": { title: "Items path", what: "The list this block iterates over, one run of the body per item.", when: "Point it at a workflow input or upstream output that resolves to a list.", example: "input.documents to run the body once per uploaded document." },
  "for_each.body_node_ids": { title: "Body nodes", what: "The canvas blocks that run once per item; check every block that belongs inside the loop.", when: "Select the blocks that should repeat, not blocks that should run once overall.", example: "Check a Transform and an LLM block that together summarize one document." },
  "for_each.item_key": { title: "Item key", what: "The name used to reference the current item inside the loop body, as {{input.<key>}}.", when: "Change it if \"item\" is ambiguous next to other variables in the loop body.", example: "Set to document so the loop body reads {{input.document}}." },
  "for_each.result_key": { title: "Result key", what: "The name later blocks use to reference the collected list of per-item results.", when: "Change it when a workflow has more than one For Each block to keep results distinct.", example: "Set to summaries so later steps use {{this_block_id.summaries}}." },
  "for_each.max_items": { title: "Maximum items", what: "A hard cap on how many items the loop will process, even if the list is longer.", when: "Set it to bound cost and runtime when the input list size isn't guaranteed.", example: "25, so a 200-document list only processes the first 25." },
  "api.method": { title: "Method", what: "The HTTP method used for the request.", when: "Use GET to fetch data, POST to create something, PUT/PATCH to update, DELETE to remove.", example: "POST when creating a calendar event or sending a webhook payload." },
  "api.url": { title: "URL", what: "The endpoint this block calls, which can include inserted variables.", when: "Point it at an approved host, building the path or query from upstream data when needed.", example: "https://www.googleapis.com/calendar/v3/... with {{writer.response}} in the body instead." },
  "api.connection": { title: "Connection", what: "The authenticated account this request runs as, for services like Google Workspace.", when: "Connect an account when the target API needs authorization rather than a public endpoint.", example: "Connect a Google Workspace account before calling the Calendar or Gmail APIs." },
  "api.headers": { title: "Headers", what: "A JSON object of HTTP headers sent with the request.", when: "Use it for content types, API keys, or auth headers the target service requires.", example: "{ \"Content-Type\": \"application/json\" }" },
  "api.body": { title: "JSON body", what: "The JSON payload sent with the request, which can include inserted variables.", when: "Use it for POST/PUT/PATCH requests that need structured data.", example: "{ \"summary\": \"{{writer.response}}\" }" },
  "api.gmail": { title: "Gmail message", what: "Convenience fields for To, Subject, and Body that are only shown for Gmail API URLs.", when: "Use them instead of hand-building the Gmail send payload in JSON body.", example: "To: {{input.customer_email}}, Subject: Your update, Body: Hi {{input.customer_name}}, ..." },
  "api.output_key": { title: "Output key", what: "The name later blocks use to reference this block's response, as {{this_block_id.<key>}}.", when: "Change it when a workflow has multiple API blocks and needs to tell their responses apart.", example: "Set to calendar_event so later steps use {{scheduler.calendar_event}}." },
  "api.retry": { title: "Retry policy", what: "Controls how many times this request retries on failure and how long it waits between attempts.", when: "Raise attempts or backoff for calls to services that are occasionally slow or rate-limited.", example: "3 attempts with a 2x backoff to ride out a brief rate limit." },
  "resend_email.retry": { title: "Retry policy", what: "Controls how many times the email send retries on failure and how long it waits between attempts.", when: "Use retries for transient provider failures, while keeping the workflow bounded.", example: "2 attempts with a 1 second initial delay." },
  "google_drive.connection": { title: "Google Workspace connection", what: "Selects the encrypted Google OAuth account used to write the Drive file.", when: "Connect Google Workspace before running this block.", example: "Choose the account that has access to the destination Drive folder." },
  "google_drive.retry": { title: "Retry policy", what: "Controls how many times the Drive write retries on failure and how long it waits between attempts.", when: "Use retries for transient Google API failures.", example: "2 attempts with a 1 second initial delay." },
};

function Field({ helpMode, topic, onHelp, children }: { helpMode: boolean; topic?: HelpTopic; onHelp: (topic: HelpTopic, position: { x: number; y: number }) => void; children: ReactNode }) {
  return (
    <div
      className="help-field"
      onClickCapture={(event) => {
        if (helpMode && topic) {
          event.preventDefault();
          event.stopPropagation();
          onHelp(topic, { x: event.clientX, y: event.clientY });
        }
      }}
    >
      {children}
    </div>
  );
}

function HelpPanel({ topic, position, onClose }: { topic: HelpTopic; position: { x: number; y: number }; onClose: () => void }) {
  const left = Math.min(position.x + 14, window.innerWidth - 378); const top = Math.min(position.y + 14, window.innerHeight - 300);
  return <aside className="help-panel" style={{ left: Math.max(12, left), top: Math.max(72, top) }}><div className="help-heading"><span><CircleHelp size={17} /> Help Mode</span><button className="icon-button" onClick={onClose}><X size={16} /></button></div><h2>{topic.title}</h2><strong>What it does</strong><p>{topic.what}</p><strong>Use it when</strong><p>{topic.when}</p><strong>Example</strong><pre>{topic.example}</pre></aside>;
}

function Icon({ kind }: { kind: Kind }) {
  const Component = {
    llm: Bot,
    api: Globe2,
    condition: GitBranch,
    repeat_until: GitBranch,
    for_each: GitBranch,
    github_repository: GitBranch,
      resend_email: Mail,
      google_drive: HardDrive,
        google_drive_update: HardDrive,
        weather_forecast: CloudSun,
        news_headlines: Newspaper,
        google_sheets_append: Table2,
        csv_create: FileSpreadsheet,
        rss_feed: Rss,
        webhook_post: SendHorizontal,
        http_response: SendHorizontal,
        mongodb: Database,
        mongodb_vector_search: Search,
        gmail_send: Mail,
        reddit_headlines: MessageSquareText,
        google_calendar: CalendarDays,
        github_action: GitPullRequest,
        job_search: Globe2,
        erragent: Sparkles,
      schedule: Clock3,
    variable: Tag,
    transform: Braces,
  }[kind];
  return <Component size={16} />;
}
function WorkflowBlock({ data }: NodeProps<FlowNode>) {
  if (data.kind === "for_each") return <div className={`workflow-block for-each ${data.status}`}><Handle type="target" position={Position.Left} /><span className="block-icon"><Icon kind="for_each" /></span>{data.label}<span className="repeat-branches"><span>Each item<Handle id="each_item" type="source" position={Position.Right} style={{ top: "18%" }} /></span><span>Complete<Handle id="complete" type="source" position={Position.Right} style={{ top: "50%" }} /></span><span>Limit reached<Handle id="limit_reached" type="source" position={Position.Right} style={{ top: "82%" }} /></span></span><span className="block-status" /></div>;
  if (data.kind === "repeat_until") return <div className={`workflow-block repeat-until ${data.status}`}><Handle type="target" position={Position.Left} /><span className="block-icon"><Icon kind="repeat_until" /></span>{data.label}<span className="repeat-branches"><span>Continue<Handle id="continue" type="source" position={Position.Right} style={{ top: "18%" }} /></span><span>Done<Handle id="done" type="source" position={Position.Right} style={{ top: "50%" }} /></span><span>Limit reached<Handle id="limit_reached" type="source" position={Position.Right} style={{ top: "82%" }} /></span></span><span className="block-status" /></div>;
  if (data.kind === "condition")
    return (
      <div className={`workflow-block condition ${data.status}`}>
        <Handle type="target" position={Position.Left} />
        <span className="block-icon">
          <Icon kind="condition" />
        </span>
        {data.label}
        <span className="condition-branches">
          <span>
            True
            <Handle
              id="true"
              type="source"
              position={Position.Right}
              style={{ top: "32%" }}
            />
          </span>
          <span>
            False
            <Handle
              id="false"
              type="source"
              position={Position.Right}
              style={{ top: "72%" }}
            />
          </span>
        </span>
        <span className="block-status" />
      </div>
    );
  return (
    <div className={`workflow-block ${data.kind} ${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <span className="block-icon">
        <Icon kind={data.kind} />
      </span>
      {data.label}
      <span className="block-status" />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { workflow: WorkflowBlock };

type TextField = HTMLInputElement | HTMLTextAreaElement;

// React tracks the previous value on the DOM node, so the native setter is required
// for a programmatic edit to reach onChange.
function setFieldValue(element: TextField, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function VariablePicker({
  variables,
  onInsert,
  transformToken,
}: {
  variables: Variable[];
  onInsert: (token: string) => void;
  transformToken?: (token: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<{ element: TextField; start: number; end: number } | null>(null);
  const captureCaret = () => {
    const element = document.activeElement as TextField | null;
    if (!element || (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA")) return;
    const scope = containerRef.current?.closest("label, .mapping-row") ?? null;
    if (scope && !scope.contains(element)) return;
    caretRef.current = {
      element,
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length,
    };
  };
  const handleInsert = (token: string) => {
    const text = transformToken ? transformToken(token) : token;
    const caret = caretRef.current;
    if (caret && caret.element.isConnected) {
      const { element, start, end } = caret;
      setFieldValue(element, `${element.value.slice(0, start)}${text}${element.value.slice(end)}`);
      const position = start + text.length;
      element.focus();
      element.setSelectionRange(position, position);
      caretRef.current = { element, start: position, end: position };
    } else {
      onInsert(token);
    }
    setOpen(false);
  };
  return (
    <div className="variable-picker" ref={containerRef} onMouseDown={captureCaret}>
      <button
        className="variable-trigger"
        type="button"
        onClick={() => setOpen(!open)}
      >
        <Tag size={13} /> Insert variable
      </button>
      {open && (
        <div className="variable-menu">
          {variables.length ? (
            <>
              <span className="variable-hint">Tip: Append [0] or [1] to access list items</span>
              {variables.map((variable) => (
                <button
                  className="variable-chip"
                  type="button"
                  key={variable.token}
                  onClick={() => {
                    handleInsert(variable.token);
                  }}
                >
                  <strong>{variable.label}</strong>
                  <span>{variable.detail}</span>
                </button>
              ))}
            </>
          ) : (
            <span className="variable-empty">
              Connect an earlier block to use its output.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function outputKeys(node: FlowNode) {
  if (node.data.kind === "transform")
    return [
      ...Object.keys((node.data.config.mappings as Record<string, string>) ?? {}),
      ...Object.keys((node.data.config.merge_arrays as Record<string, string[]>) ?? {}),
    ];
  if (node.data.kind === "variable") return [String(node.data.config.name ?? "value")];
  if (node.data.kind === "llm")
    return [String(node.data.config.output_key ?? "response")];
  if (node.data.kind === "api")
    return [String(node.data.config.output_key ?? "api_response")];
  if (node.data.kind === "github_repository")
    return [String(node.data.config.output_key ?? "repository_context")];
  if (node.data.kind === "resend_email")
    return [String(node.data.config.output_key ?? "email_response")];
  if (node.data.kind === "google_drive")
    return [String(node.data.config.output_key ?? "drive_file")];
  if (node.data.kind === "google_drive_update")
    return [String(node.data.config.output_key ?? "drive_file")];
  if (node.data.kind === "weather_forecast")
    return [String(node.data.config.output_key ?? "weather")];
  if (node.data.kind === "news_headlines")
    return [String(node.data.config.output_key ?? "news")];
  if (node.data.kind === "google_sheets_append")
    return [String(node.data.config.output_key ?? "sheet_append")];
  if (node.data.kind === "csv_create")
    return [String(node.data.config.output_key ?? "csv_file")];
  if (node.data.kind === "rss_feed")
    return [String(node.data.config.output_key ?? "feed")];
  if (node.data.kind === "webhook_post")
    return [String(node.data.config.output_key ?? "webhook_response")];
  if (node.data.kind === "http_response")
    return [String(node.data.config.output_key ?? "http_response")];
  if (node.data.kind === "mongodb")
    return [String(node.data.config.output_key ?? "mongodb_result")];
  if (node.data.kind === "mongodb_vector_search")
    return [String(node.data.config.output_key ?? "retrieved_context")];
  if (node.data.kind === "gmail_send")
    return [String(node.data.config.output_key ?? "gmail_response")];
  if (node.data.kind === "reddit_headlines")
    return [String(node.data.config.output_key ?? "reddit")];
  if (node.data.kind === "google_calendar")
    return [String(node.data.config.output_key ?? "calendar")];
  if (node.data.kind === "github_action")
    return [String(node.data.config.output_key ?? "github_action")];
  if (node.data.kind === "job_search")
    return [String(node.data.config.output_key ?? "jobs")];
  if (node.data.kind === "erragent")
    return [String(node.data.config.output_key ?? "erragent_result")];
  return [];
}
function variablesFor(
  nodes: FlowNode[],
  edges: Edge[],
  targetId: string,
  inputs: WorkflowInput[],
): Variable[] {
  const upstream = new Set<string>();
  const visit = (id: string) =>
    edges
      .filter((edge) => edge.target === id)
      .forEach((edge) => {
        if (!upstream.has(edge.source)) {
          upstream.add(edge.source);
          visit(edge.source);
        }
      });
  visit(targetId);
  const inputVariables = inputs.map((input) => ({
    token: `{{input.${input.key}}}`,
    label: "Workflow input",
    detail: input.label,
  }));
  const outputVariables = nodes
    .filter((node) => upstream.has(node.id))
    .flatMap((node) =>
      outputKeys(node).map((key) => ({
        token: `{{${node.id}.${key}}}`,
        label: node.data.label,
        detail: key,
      })),
    );
  return [...inputVariables, ...outputVariables];
}

function TemplateWarnings({ value, variables }: { value: string; variables: Variable[] }) {
  const tokens = [...value.matchAll(/{{\s*([a-zA-Z_][\w-]*(?:(?:\.[a-zA-Z_][\w-]*)|(?:\[\d+\]))*)\s*}}/g)].map((match) => match[1]);
  const paths = variables.map((variable) => variable.token.slice(2, -2).trim());
  // A token may drill into an available output, so prefixes count as available too.
  const available = (token: string) => paths.some((path) => token === path || token.startsWith(`${path}.`) || token.startsWith(`${path}[`));
  const invalid = [...new Set(tokens.filter((token) => !available(token)))].map((token) => `{{${token}}}`);
  return invalid.length ? <span className="template-warning">Unavailable here: {invalid.join(", ")}</span> : null;
}

function JsonField({ label, value, variables, workflowId, nodeId, onChange }: { label: string; value: Record<string, unknown> | null; variables: Variable[]; workflowId: string | null; nodeId: string; onChange: (value: Record<string, unknown> | null) => void }) {
  const [raw, setRaw] = useState(value ? JSON.stringify(value, null, 2) : "");
  const [error, setError] = useState("");
  const validate = (next: string) => { setRaw(next); if (!next.trim()) { setError(""); onChange(null); return; } try { const parsed = JSON.parse(next); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(); setError(""); onChange(parsed as Record<string, unknown>); } catch { setError("Enter a JSON object") } };
  // Commit valid JSON while typing so inserted variables persist without needing a blur.
  const track = (next: string) => { setRaw(next); if (!next.trim()) return; try { const parsed = JSON.parse(next); if (parsed && !Array.isArray(parsed) && typeof parsed === "object") { setError(""); onChange(parsed as Record<string, unknown>); } } catch { /* wait for valid JSON */ } };
  return <label>{label}<textarea className="json-input" rows={4} value={raw} onChange={(event) => track(event.target.value)} onBlur={(event) => validate(event.target.value)} />{error && <span className="field-error">{error}</span>}<TemplateWarnings value={raw} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => validate(`${raw}${token}`)} /><SuggestPrompt workflowId={workflowId} nodeId={nodeId} value={raw} onApply={validate} /></label>;
}

function SuggestPrompt({ workflowId, nodeId, value, onApply }: { workflowId: string | null; nodeId: string; value: string; onApply: (value: string) => void }) {
  const [loading, setLoading] = useState(false);
  const suggest = async () => { const goal = window.prompt("What should this prompt accomplish?"); if (!goal || !workflowId) return; setLoading(true); try { const response = await fetch(`${API}/workflows/${workflowId}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ node_id: nodeId, goal, current_value: value }) }); const body = await response.json() as { suggestion?: string; detail?: string }; if (!response.ok || !body.suggestion) throw new Error(body.detail ?? "Suggestion failed"); if (window.confirm(`Apply this suggestion?\n\n${body.suggestion}`)) onApply(body.suggestion); } catch (error) { window.alert(error instanceof Error ? error.message : "Suggestion failed"); } finally { setLoading(false); } };
  return <button className="suggest-button" type="button" onClick={() => void suggest()} disabled={loading}>{loading ? "Thinking..." : "Suggest with AI"}</button>;
}

function RetryFields({ value, onChange }: { value: Record<string, unknown> | undefined; onChange: (value: Record<string, unknown>) => void }) {
  const retry = { max_attempts: 1, initial_delay_ms: 500, backoff_multiplier: 2, ...value };
  const update = (key: string, input: number) => onChange({ ...retry, [key]: input });
  return <fieldset className="retry-fields"><legend>Retry policy</legend><label>Attempts<input type="number" min="1" max="5" value={Number(retry.max_attempts)} onChange={(event) => update("max_attempts", Number(event.target.value))} /></label><label>Initial delay (ms)<input type="number" min="0" max="30000" step="100" value={Number(retry.initial_delay_ms)} onChange={(event) => update("initial_delay_ms", Number(event.target.value))} /></label><label>Backoff multiplier<input type="number" min="1" max="10" step="0.5" value={Number(retry.backoff_multiplier)} onChange={(event) => update("backoff_multiplier", Number(event.target.value))} /></label></fieldset>;
}

function ScheduleForm({ config, bodyOptions, onChange }: { config: Record<string, unknown>; bodyOptions: FlowNode[]; onChange: (config: Record<string, unknown>) => void }) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const days = (config.days_of_week as number[] | undefined) ?? [];
  const errorHandlers = bodyOptions.filter((node) => node.data.kind === "erragent");
  void errorHandlers;
    return <div className="node-form"><p className="form-hint">The scheduler checks enabled schedules every 15 seconds. Event mode is configuration-only until an event source is connected.</p><label className="required-input"><input type="checkbox" checked={Boolean(config.enabled ?? true)} onChange={(event) => update("enabled", event.target.checked)} /> Enabled</label><label>Trigger mode<select value={String(config.trigger_mode ?? "schedule")} onChange={(event) => update("trigger_mode", event.target.value)}><option value="schedule">Scheduled timer</option><option value="event">External event</option></select></label>{config.trigger_mode === "event" ? <label>Event name<input value={String(config.event_name ?? "")} onChange={(event) => update("event_name", event.target.value)} placeholder="github.issue.created" /></label> : <><label>Frequency<select value={String(config.interval ?? "hourly")} onChange={(event) => update("interval", event.target.value)}><option value="5_minutes">Every 5 minutes</option><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekly">Weekly</option></select></label><label>Specific time (optional)<input type="time" value={String(config.time_of_day ?? "")} onChange={(event) => update("time_of_day", event.target.value || undefined)} /></label><label>Timezone<select value={String(config.timezone ?? "UTC")} onChange={(event) => update("timezone", event.target.value)}><option value="UTC">UTC</option><option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option><option value="America/Los_Angeles">Pacific</option><option value="Europe/London">London</option><option value="Europe/Paris">Paris</option><option value="Asia/Tokyo">Tokyo</option></select></label>{config.interval === "weekly" && <label>Every N weeks<input type="number" min="1" max="52" value={Number(config.weeks_interval ?? 1)} onChange={(event) => update("weeks_interval", Number(event.target.value))} /></label>}<label>Days of week<select multiple value={days.map(String)} onChange={(event) => update("days_of_week", Array.from(event.target.selectedOptions).map((option) => Number(option.value)))}><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option></select></label></>}</div>;
}

function ScheduleErrorHandlerField({ config, bodyOptions, onChange }: { config: Record<string, unknown>; bodyOptions: FlowNode[]; onChange: (config: Record<string, unknown>) => void }) {
  const handlers = bodyOptions.filter((node) => node.data.kind === "erragent");
  return <label>Error handler (optional)<select value={String(config.error_handler_node_id ?? "")} onChange={(event) => onChange({ ...config, error_handler_node_id: event.target.value || undefined })}><option value="">None</option>{handlers.map((node) => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select><span className="form-hint">Runs after a failed workflow and receives the failed run context.</span></label>;
}

function ScheduleResponseField({ config, bodyOptions, onChange }: { config: Record<string, unknown>; bodyOptions: FlowNode[]; onChange: (config: Record<string, unknown>) => void }) {
  const responses = bodyOptions.filter((node) => node.data.kind === "http_response");
  return <label>Public response node (optional)<select value={String(config.response_node_id ?? "")} onChange={(event) => onChange({ ...config, response_node_id: event.target.value || undefined })}><option value="">Return internal run result</option>{responses.map((node) => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select><span className="form-hint">Event callers receive this node's status, headers, and JSON body.</span></label>;
}

function ConditionForm({ config, variables, onChange }: { config: Record<string, unknown>; variables: Variable[]; onChange: (config: Record<string, unknown>) => void }) {
  const legacy = { input_path: String(config.input_path ?? ""), operator: String(config.operator ?? "exists"), value: config.value ?? null };
  const conditions = ((config.conditions as Array<{ input_path: string; operator: string; value: unknown }> | undefined) ?? []).length
    ? (config.conditions as Array<{ input_path: string; operator: string; value: unknown }>)
    : [legacy];
  const updateConditions = (next: Array<{ input_path: string; operator: string; value: unknown }>) => onChange({ ...config, conditions: next, input_path: next[0]?.input_path ?? "", operator: next[0]?.operator ?? "exists", value: next[0]?.value ?? null });
  return <div className="node-form"><p className="form-hint">Connect both True and False handles. Add conditions and choose whether all or any must match.</p><label>Match conditions<select value={String(config.logic ?? "and")} onChange={(event) => onChange({ ...config, logic: event.target.value })}><option value="and">ALL conditions (AND)</option><option value="or">ANY condition (OR)</option></select></label>{conditions.map((condition, index) => <div className="condition-row" key={`condition-${index}`}><label>Input path<input value={condition.input_path} onChange={(event) => updateConditions(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, input_path: event.target.value } : item))} placeholder="{{router.classification.route}}" /><TemplateWarnings value={condition.input_path} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => updateConditions(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, input_path: token } : item))} /></label><label>Operator<select value={condition.operator} onChange={(event) => updateConditions(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value } : item))}><option value="exists">Exists</option><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option></select></label>{condition.operator !== "exists" && <label>Comparison value<input value={String(condition.value ?? "")} onChange={(event) => updateConditions(conditions.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /></label>}<button className="row-icon" type="button" title="Remove condition" disabled={conditions.length === 1} onClick={() => updateConditions(conditions.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div>)}<button className="add-row" type="button" onClick={() => updateConditions([...conditions, { input_path: "", operator: "exists", value: null }])}><Plus size={14} /> Add condition</button></div>;
}

function GitHubRepositoryForm({ config, variables, returnTo, onChange }: { config: Record<string, unknown>; variables: Variable[]; returnTo: string; onChange: (config: Record<string, unknown>) => void }) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const owner = String(config.owner ?? "");
  const repository = String(config.repository ?? "");
  return <div className="node-form"><p className="form-hint">Read repository context or search pull requests, commits, and issues through the connected GitHub account.</p><label>Owner<input value={owner} onChange={(event) => update("owner", event.target.value)} placeholder="octocat" /><TemplateWarnings value={owner} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("owner", `${owner}${token}`)} /></label><label>Repository<input value={repository} onChange={(event) => update("repository", event.target.value)} placeholder="hello-world" /><TemplateWarnings value={repository} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("repository", `${repository}${token}`)} /></label><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Operation<select value={String(config.operation ?? "repository_context")} onChange={(event) => update("operation", event.target.value)}><option value="repository_context">Repository context</option><option value="search_pull_requests">Search pull requests</option><option value="search_commits">Search commits</option><option value="search_issues">Search issues</option></select></label>{config.operation !== "repository_context" ? <><label>Search query<input value={String(config.search_query ?? "")} onChange={(event) => update("search_query", event.target.value)} placeholder="bug fix, author:octocat, is:open" /><span className="form-hint">Additional repository and type filters are added automatically.</span><TemplateWarnings value={String(config.search_query ?? "")} variables={variables} /></label><label>Result limit<input type="number" min="1" max="50" value={Number(config.search_limit ?? 10)} onChange={(event) => update("search_limit", Number(event.target.value))} /></label></> : <><label className="required-input"><input type="checkbox" checked={Boolean(config.include_readme ?? true)} onChange={(event) => update("include_readme", event.target.checked)} /> Include README.md</label><label className="required-input"><input type="checkbox" checked={Boolean(config.auto_select_files ?? true)} onChange={(event) => update("auto_select_files", event.target.checked)} /> Auto-select useful files</label><label>Paths to include<input value={Array.isArray(config.include_paths) ? config.include_paths.join(", ") : ""} onChange={(event) => update("include_paths", event.target.value.split(",").map((path) => path.trim()).filter(Boolean))} placeholder="package.json, pyproject.toml" /></label><label>Maximum files<input type="number" min="1" max="30" value={Number(config.max_files ?? 12)} onChange={(event) => update("max_files", Number(event.target.value))} /></label><label>Maximum characters<input type="number" min="1000" max="100000" value={Number(config.max_chars ?? 40000)} onChange={(event) => update("max_chars", Number(event.target.value))} /></label></>}<label>Output key<input value={String(config.output_key ?? "repository_context")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
}

function GitHubActionForm({ config, variables, onChange }: { config: Record<string, unknown>; variables: Variable[]; onChange: (config: Record<string, unknown>) => void }) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const field = (key: string) => String(config[key] ?? "");
  const variableTextField = (label: string, key: string, placeholder: string) => <label>{label}<input value={field(key)} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} /><TemplateWarnings value={field(key)} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update(key, `${field(key)}${token}`)} /></label>;
  return <div className="node-form"><p className="form-hint">Use a GitHub PAT connection with permission to write issues and pull requests.</p><ConnectionPicker value={String(config.connection_id ?? "")} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Action<select value={String(config.action ?? "create_issue")} onChange={(event) => update("action", event.target.value)}><option value="create_issue">Create issue</option><option value="comment_issue">Comment on issue</option><option value="create_pull_request">Create pull request</option></select></label>{variableTextField("Owner", "owner", "owner")}{variableTextField("Repository", "repository", "repository")}{config.action === "comment_issue" && <label>Issue number<input type="number" value={String(config.issue_number ?? "")} onChange={(event) => update("issue_number", event.target.value ? Number(event.target.value) : undefined)} /></label>}{variableTextField("Title", "title", "Issue or pull request title")}<label>Body<textarea rows={6} value={field("body")} onChange={(event) => update("body", event.target.value)} placeholder="Describe the change or issue" /><TemplateWarnings value={field("body")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("body", `${field("body")}${token}`)} /></label>{config.action === "create_pull_request" && <><>{variableTextField("Head branch", "head", "feature/my-change")}</><>{variableTextField("Base branch", "base", "main")}</></>}<label>Output key<input value={field("output_key") || "github_action"} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
}

function MongoVectorSearchForm({ config, variables, onChange }: { config: Record<string, unknown>; variables: Variable[]; onChange: (config: Record<string, unknown>) => void }) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const query = String(config.query ?? "");
  const [sharedIndexLoading, setSharedIndexLoading] = useState(false);
  const [sharedIndexStatus, setSharedIndexStatus] = useState("");
  const useSharedIndex = async () => {
    setSharedIndexLoading(true);
    setSharedIndexStatus("");
    try {
      const response = await fetch(`${API}/mongodb-search/shared-index`, { method: "POST" });
      const body = await response.json() as { detail?: string; database_name?: string; collection_name?: string; index_name?: string; embedding_path?: string; embedding_model?: string; embedding_dimensions?: number; index_status?: string; seeded_documents?: number };
      if (!response.ok) throw new Error(body.detail ?? "Could not prepare the shared search index");
      onChange({
        ...config,
        database_name: body.database_name,
        collection_name: body.collection_name,
        index_name: body.index_name,
        embedding_path: body.embedding_path,
        embedding_model: body.embedding_model,
        embedding_dimensions: body.embedding_dimensions,
        connection_uri_secret: undefined,
      });
      setSharedIndexStatus(body.index_status === "building" ? "Shared index is building on MongoDB Atlas; wait a few minutes before running this node." : "Shared index is ready. Fields have been filled in for you.");
    } catch (error) {
      setSharedIndexStatus(error instanceof Error ? error.message : "Could not prepare the shared search index");
    } finally {
      setSharedIndexLoading(false);
    }
  };
  return <div className="node-form">
    <p className="form-hint">Embeds the query with Gemini and runs a MongoDB Atlas $vectorSearch against the configured search index. Reuse the local-rag db_utils/search.py setup as a template for your own index and collection.</p>
    <button className="suggest-button" type="button" onClick={() => void useSharedIndex()} disabled={sharedIndexLoading}>{sharedIndexLoading ? "Preparing..." : "Use Circuit's shared search index"}</button>
    {sharedIndexStatus && <span className="form-hint">{sharedIndexStatus}</span>}
    <label>Database name<input value={String(config.database_name ?? "")} onChange={(event) => update("database_name", event.target.value)} placeholder="saapp_database" /></label>
    <label>Collection name<input value={String(config.collection_name ?? "")} onChange={(event) => update("collection_name", event.target.value)} placeholder="documents" /></label>
    <label>Search index name<input value={String(config.index_name ?? "vector_index")} onChange={(event) => update("index_name", event.target.value)} placeholder="vector_index" /></label>
    <label>Embedding field path<input value={String(config.embedding_path ?? "embedding")} onChange={(event) => update("embedding_path", event.target.value)} placeholder="embedding" /></label>
    <label>Query<textarea rows={3} value={query} onChange={(event) => update("query", event.target.value)} placeholder="{{input.message}}" /><TemplateWarnings value={query} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("query", `${query}${token}`)} /></label>
    <label>K nearest neighbors<input type="number" min="1" max="50" value={Number(config.k ?? 4)} onChange={(event) => update("k", Number(event.target.value))} /></label>
    <label>Max chunks returned<input type="number" min="1" max="50" value={Number(config.max_chunks ?? 4)} onChange={(event) => update("max_chunks", Number(event.target.value))} /></label>
    <label>Strategy<select value={String(config.strategy ?? "vector")} onChange={(event) => update("strategy", event.target.value)}><option value="vector">Vector</option><option value="lexical">Lexical</option><option value="hybrid">Hybrid (vector + lexical)</option></select></label>
    <label>Connection URI secret (optional)<input value={String(config.connection_uri_secret ?? "")} onChange={(event) => update("connection_uri_secret", event.target.value || undefined)} placeholder="MONGO_WORKFLOW_URI_SECRET" /></label>
    <label>Embedding model<input value={String(config.embedding_model ?? "models/gemini-embedding-001")} onChange={(event) => update("embedding_model", event.target.value)} /></label>
    <label>Embedding dimensions<input type="number" min="1" max="4096" value={Number(config.embedding_dimensions ?? 768)} onChange={(event) => update("embedding_dimensions", Number(event.target.value))} /><span className="form-hint">Must match the dimensions the search index was created with.</span></label>
    <label>Output key<input value={String(config.output_key ?? "retrieved_context")} onChange={(event) => update("output_key", event.target.value)} /></label>
  </div>;
}

function NodeForm({
  kind,
  config,
  variables,
  workflowId,
  nodeId,
  bodyOptions,
  helpMode,
  onFieldHelp,
  onChange,
}: {
  kind: string;
  config: Record<string, unknown>;
  variables: Variable[];
  workflowId: string | null;
  nodeId: string;
  bodyOptions: FlowNode[];
  helpMode: boolean;
  onFieldHelp: (topic: HelpTopic, position: { x: number; y: number }) => void;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const update = (key: string, value: unknown) =>
    onChange({ ...config, [key]: value });
  const field = (key: string) => ({ helpMode, onHelp: onFieldHelp, topic: fieldHelp[key] });
  if (kind === "schedule") return <><ScheduleForm config={config} bodyOptions={bodyOptions} onChange={onChange} /><div className="node-form"><ScheduleResponseField config={config} bodyOptions={bodyOptions} onChange={onChange} /><ScheduleErrorHandlerField config={config} bodyOptions={bodyOptions} onChange={onChange} /></div></>;
  if (kind === "mongodb") return <div className="node-form"><p className="form-hint">Uses MONGO_WORKFLOW_URI or an encrypted URI secret on the server. Project and cluster are labels; the URI controls authentication and the actual cluster.</p><label>Project<input value={String(config.project ?? "")} onChange={(event) => update("project", event.target.value)} placeholder="my-project" /></label><label>Cluster name<input value={String(config.cluster_name ?? "")} onChange={(event) => update("cluster_name", event.target.value)} placeholder="Production" /></label><label>Database name<input value={String(config.database_name ?? "")} onChange={(event) => update("database_name", event.target.value)} placeholder="app" /></label><label>Collection name<input value={String(config.collection_name ?? "")} onChange={(event) => update("collection_name", event.target.value)} placeholder="users" /></label><label>Operation<select value={String(config.operation ?? "find")} onChange={(event) => update("operation", event.target.value)}><option value="find">Find records</option><option value="update_one">Update one record</option></select></label><label>Connection URI secret (optional)<input value={String(config.connection_uri_secret ?? "")} onChange={(event) => update("connection_uri_secret", event.target.value || undefined)} placeholder="MONGO_WORKFLOW_URI_SECRET" /></label><JsonField label="Filter" value={(config.filter as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("filter", value ?? {})} />{config.operation === "update_one" && <JsonField label="Update document" value={(config.update as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("update", value ?? {})} />}<label>Read limit<input type="number" min="1" max="100" value={Number(config.limit ?? 20)} onChange={(event) => update("limit", Number(event.target.value))} /></label><label>Output key<input value={String(config.output_key ?? "mongodb_result")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "llm")
    return (
      <div className="node-form">
        <Field {...field("llm.model")}>
        <label>
          Model
          <select
            value={String(config.model)}
            onChange={(event) => update("model", event.target.value)}
          >
            {MODELS.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </label>
        </Field>
        <Field {...field("llm.prompt")}>
        <label>
          Prompt
          <textarea
            rows={5}
            value={String(config.prompt ?? "")}
            onChange={(event) => update("prompt", event.target.value)}
          />
          <TemplateWarnings value={String(config.prompt ?? "")} variables={variables} />
          <VariablePicker
            variables={variables}
            onInsert={(token) =>
              update("prompt", `${String(config.prompt ?? "")}${token}`)
            }
          />
          <SuggestPrompt workflowId={workflowId} nodeId={nodeId} value={String(config.prompt ?? "")} onApply={(suggestion) => update("prompt", suggestion)} />
        </label>
        </Field>
        <Field {...field("llm.json_mode")}>
        <label className="required-input">
          <input
            type="checkbox"
            checked={Boolean(config.json_mode ?? false)}
            onChange={(event) => update("json_mode", event.target.checked)}
          />
          {" "}JSON mode (returns structured data)
        </label>
        </Field>
        <Field {...field("llm.temperature")}>
        <label>
          Temperature{" "}
          <span className="field-value">
            {Number(config.temperature ?? 0.2).toFixed(1)}
          </span>
          <input
            className="temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={Number(config.temperature ?? 0.2)}
            onChange={(event) =>
              update("temperature", Number(event.target.value))
            }
          />
        </label>
        </Field>
        <Field {...field("llm.max_tokens")}>
        <label>
          Max tokens
          <input
            type="number"
            min="1"
            value={String(config.max_tokens ?? "")}
            onChange={(event) =>
              update(
                "max_tokens",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
        </Field>
        <Field {...field("llm.system_instructions")}>
        <label>
          System instructions
          <textarea
            rows={3}
            value={String(config.system_instructions ?? "")}
            onChange={(event) =>
              update("system_instructions", event.target.value)
            }
          />
        </label>
        </Field>
        <Field {...field("llm.output_key")}>
        <label>
          Output key
          <input
            value={String(config.output_key ?? "response")}
            onChange={(event) => update("output_key", event.target.value)}
          />
        </label>
        </Field>
        <Field {...field("llm.retry")}>
        <RetryFields value={config.retry as Record<string, unknown> | undefined} onChange={(retry) => update("retry", retry)} />
        </Field>
      </div>
    );
  if (kind === "variable") return <div className="node-form"><p className="form-hint">Use this named value in later blocks as <code>{`{{${nodeId}.${String(config.name ?? "value")}}}`}</code>.</p><label>Name<input value={String(config.name ?? "value")} onChange={(event) => update("name", event.target.value.replace(/\W/g, "_"))} placeholder="api_base_url" /></label><label>Value<textarea rows={4} value={String(config.value ?? "")} onChange={(event) => update("value", event.target.value)} placeholder="https://api.example.com" /><TemplateWarnings value={String(config.value ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("value", `${String(config.value ?? "")}${token}`)} /><SuggestPrompt workflowId={workflowId} nodeId={nodeId} value={String(config.value ?? "")} onApply={(suggestion) => update("value", suggestion)} /></label></div>;
  if (kind === "transform") {
    const mappings = (config.mappings as Record<string, string>) ?? {};
    const merge_arrays = (config.merge_arrays as Record<string, string[]>) ?? {};
    const entries = Object.entries(mappings);
    const mergeEntries = Object.entries(merge_arrays);
    
    const change = (index: number, key: string, value: string) => {
      const next = entries.filter((_, i) => i !== index);
      if (key) next.splice(index, 0, [key, value]);
      onChange({ ...config, mappings: Object.fromEntries(next) });
    };
    
    const changeMerge = (index: number, key: string, value: string[]) => {
      const next = mergeEntries.filter((_, i) => i !== index);
      if (key) next.splice(index, 0, [key, value]);
      onChange({ ...config, merge_arrays: Object.fromEntries(next) });
    };
    
    return (
      <div className="node-form">
        <Field {...field("transform.mappings")}>
        <p className="form-hint">
          Regular field mappings. Use the picker to insert variables.
        </p>
        {entries.map(([key, value], index) => (
          <div className="mapping-row" key={`mapping-${index}`}>
            <input
              value={key}
              onChange={(event) => change(index, event.target.value, value)}
            />
            <span>
              <input
                value={value}
                onChange={(event) => change(index, key, event.target.value)}
                placeholder="Value or variable"
              />
              <TemplateWarnings value={value} variables={variables} />
              <VariablePicker
                variables={variables}
                onInsert={(token) => change(index, key, `${value}${token}`)}
              />
              <SuggestPrompt workflowId={workflowId} nodeId={nodeId} value={value} onApply={(suggestion) => change(index, key, suggestion)} />
            </span>
            <button className="row-icon" onClick={() => change(index, "", "")}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          className="add-row"
          onClick={() =>
            onChange({
              ...config,
              mappings: { ...mappings, [`field_${entries.length + 1}`]: "" },
            })
          }
        >
          <Plus size={14} /> Add mapping
        </button>
        </Field>
        
        <Field {...field("transform.merge_arrays")}>
        <p className="form-hint">
          Merge arrays: name the combined output, then list source arrays (one per line). Downstream nodes reference it as <code>{`{{${nodeId}.output_key}}`}</code>.
        </p>
        {mergeEntries.map(([key, paths], index) => (
          <div key={`merge-${index}`} style={{ marginBottom: "12px" }}>
            <div className="mapping-row">
              <input
                value={key}
                onChange={(event) => changeMerge(index, event.target.value, paths)}
                aria-label="Merged output key"
                placeholder="Output key (e.g., jobs)"
              />
              <button className="row-icon" onClick={() => changeMerge(index, "", [])}>
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              value={paths.join("\n")}
              onChange={(event) =>
                changeMerge(
                  index,
                  key,
                  event.target.value
                    .split("\n")
                    .map((p) => p.trim())
                    .filter(Boolean)
                )
              }
              placeholder="{{source1.jobs}}&#10;{{source2.jobs}}"
              rows={3}
              style={{ width: "100%", marginBottom: "8px" }}
            />
            <TemplateWarnings value={paths.join("\n")} variables={variables} />
            <VariablePicker
              variables={variables}
              onInsert={(token) => changeMerge(index, key, [...paths, token])}
            />
          </div>
        ))}
        <button
          className="add-row"
          onClick={() =>
            onChange({
              ...config,
              merge_arrays: { ...merge_arrays, [`merged_${mergeEntries.length + 1}`]: [] },
            })
          }
        >
          <Plus size={14} /> Add array merge
        </button>
        </Field>
      </div>
    );
  }
  if (kind === "condition") return <ConditionForm config={config} variables={variables} onChange={onChange} />;
  if (kind === "repeat_until") return <div className="node-form"><p className="form-hint">Continue loops back through work; Done exits; Limit handles exhausted attempts.</p><Field {...field("repeat_until.input_path")}><label>Check path<input value={String(config.input_path ?? "")} onChange={(event) => update("input_path", event.target.value)} placeholder="quality.passed" /><TemplateWarnings value={String(config.input_path ?? "")} variables={variables} /><VariablePicker variables={variables} transformToken={(token) => token.slice(2, -2)} onInsert={(token) => update("input_path", token.slice(2, -2))} /></label></Field><Field {...field("repeat_until.operator")}><label>Operator<select value={String(config.operator ?? "exists")} onChange={(event) => update("operator", event.target.value)}><option value="exists">Exists</option><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option></select></label></Field>{config.operator !== "exists" && <Field {...field("repeat_until.value")}><label>Expected value<input value={String(config.value ?? "")} onChange={(event) => update("value", event.target.value)} /></label></Field>}<Field {...field("repeat_until.max_iterations")}><label>Maximum iterations<input type="number" min="1" max="20" value={Number(config.max_iterations ?? 3)} onChange={(event) => update("max_iterations", Number(event.target.value))} /></label></Field></div>;
  if (kind === "for_each") { const selected = (config.body_node_ids as string[] | undefined) ?? []; return <div className="node-form"><p className="form-hint">Select the nodes run once for each item.</p><Field {...field("for_each.items_path")}><label>Items path<input value={String(config.items_path ?? "")} onChange={(event) => update("items_path", event.target.value)} placeholder="input.documents" /><TemplateWarnings value={String(config.items_path ?? "")} variables={variables} /></label></Field><Field {...field("for_each.body_node_ids")}><div className="body-selector">{bodyOptions.map((node) => <label key={node.id}><input type="checkbox" checked={selected.includes(node.id)} onChange={(event) => update("body_node_ids", event.target.checked ? [...selected, node.id] : selected.filter((id) => id !== node.id))} /> {node.data.label}</label>)}</div></Field><Field {...field("for_each.item_key")}><label>Item key<input value={String(config.item_key ?? "item")} onChange={(event) => update("item_key", event.target.value)} /></label></Field><Field {...field("for_each.result_key")}><label>Result key<input value={String(config.result_key ?? "items")} onChange={(event) => update("result_key", event.target.value)} /></label></Field><Field {...field("for_each.max_items")}><label>Maximum items<input type="number" min="1" max="100" value={Number(config.max_items ?? 25)} onChange={(event) => update("max_items", Number(event.target.value))} /></label></Field></div>; }
  if (kind === "schedule") { const days = (config.days_of_week as number[] | undefined) ?? []; return <div className="node-form"><p className="form-hint">The scheduler checks enabled schedules every 15 seconds. Event mode is configuration-only until an event source is connected.</p><label className="required-input"><input type="checkbox" checked={Boolean(config.enabled ?? true)} onChange={(event) => update("enabled", event.target.checked)} /> Enabled</label><label>Trigger mode<select value={String(config.trigger_mode ?? "schedule")} onChange={(event) => update("trigger_mode", event.target.value)}><option value="schedule">Scheduled timer</option><option value="event">External event</option></select></label>{config.trigger_mode === "event" ? <label>Event name<input value={String(config.event_name ?? "")} onChange={(event) => update("event_name", event.target.value)} placeholder="github.issue.created" /></label> : <><label>Frequency<select value={String(config.interval ?? "hourly")} onChange={(event) => update("interval", event.target.value)}><option value="5_minutes">Every 5 minutes</option><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekly">Weekly</option></select></label>{config.interval === "weekly" && <label>Every N weeks<input type="number" min="1" max="52" value={Number(config.weeks_interval ?? 1)} onChange={(event) => update("weeks_interval", Number(event.target.value))} /></label>}<label>Days of week<select multiple value={days.map(String)} onChange={(event) => update("days_of_week", Array.from(event.target.selectedOptions).map((option) => Number(option.value)))}><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option></select></label></>}<JsonField label="Trigger inputs" value={(config.input_values as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("input_values", value ?? {})} /></div>; }
  const returnTo = workflowId ? `${window.location.origin}/?workflow=${encodeURIComponent(workflowId)}` : window.location.origin;
  if (kind === "github_repository") return <GitHubRepositoryForm config={config} variables={variables} returnTo={returnTo} onChange={onChange} />;
  if (kind === "github_action") return <GitHubActionForm config={config} variables={variables} onChange={onChange} />;
  if (kind === "mongodb_vector_search") return <MongoVectorSearchForm config={config} variables={variables} onChange={onChange} />;
  if (kind === "github_repository") return <div className="node-form"><p className="form-hint">Read repository context or search pull requests, commits, and issues through the connected GitHub account.</p><label>Owner<input value={String(config.owner ?? "")} onChange={(event) => update("owner", event.target.value)} placeholder="octocat" /></label><label>Repository<input value={String(config.repository ?? "")} onChange={(event) => update("repository", event.target.value)} placeholder="hello-world" /></label><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Operation<select value={String(config.operation ?? "repository_context")} onChange={(event) => update("operation", event.target.value)}><option value="repository_context">Repository context</option><option value="search_pull_requests">Search pull requests</option><option value="search_commits">Search commits</option><option value="search_issues">Search issues</option></select></label>{config.operation !== "repository_context" ? <><label>Search query<input value={String(config.search_query ?? "")} onChange={(event) => update("search_query", event.target.value)} placeholder="bug fix, author:octocat, is:open" /><span className="form-hint">Additional repository and type filters are added automatically.</span><TemplateWarnings value={String(config.search_query ?? "")} variables={variables} /></label><label>Result limit<input type="number" min="1" max="50" value={Number(config.search_limit ?? 10)} onChange={(event) => update("search_limit", Number(event.target.value))} /></label></> : <><label className="required-input"><input type="checkbox" checked={Boolean(config.include_readme ?? true)} onChange={(event) => update("include_readme", event.target.checked)} /> Include README.md</label><label className="required-input"><input type="checkbox" checked={Boolean(config.auto_select_files ?? true)} onChange={(event) => update("auto_select_files", event.target.checked)} /> Auto-select important source files</label><label>Extra file paths<textarea rows={3} value={((config.include_paths as string[] | undefined) ?? []).join("\n")} onChange={(event) => update("include_paths", event.target.value.split("\n").map((path) => path.trim()).filter(Boolean))} placeholder={"package.json\npyproject.toml"} /></label><label>Maximum files<input type="number" min="1" max="25" value={Number(config.max_files ?? 12)} onChange={(event) => update("max_files", Number(event.target.value))} /></label><label>Maximum context characters<input type="number" min="1000" max="100000" step="1000" value={Number(config.max_chars ?? 40000)} onChange={(event) => update("max_chars", Number(event.target.value))} /></label></>}<label>Output key<input value={String(config.output_key ?? "repository_context")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "resend_email") return <div className="node-form"><p className="form-hint">Sends through Resend. Set RESEND_API_KEY in the backend environment before running.</p><label>From<input value={String(config.from_email ?? "")} onChange={(event) => update("from_email", event.target.value)} placeholder="Workflow Builder &lt;updates@example.com&gt;" /></label><label>To<input value={String(config.to ?? "")} onChange={(event) => update("to", event.target.value)} placeholder="person@example.com, team@example.com" /><TemplateWarnings value={String(config.to ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("to", `${String(config.to ?? "")}${token}`)} /></label><label>Subject<input value={String(config.subject ?? "")} onChange={(event) => update("subject", event.target.value)} /></label><label>Body<textarea rows={7} value={String(config.body ?? "")} onChange={(event) => update("body", event.target.value)} /><TemplateWarnings value={String(config.body ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("body", `${String(config.body ?? "")}${token}`)} /></label><label>Body format<select value={String(config.body_type ?? "text")} onChange={(event) => update("body_type", event.target.value)}><option value="text">Plain text</option><option value="html">HTML</option></select></label><label>Output key<input value={String(config.output_key ?? "email_response")} onChange={(event) => update("output_key", event.target.value)} /></label><Field {...field("resend_email.retry")}><RetryFields value={config.retry as Record<string, unknown> | undefined} onChange={(retry) => update("retry", retry)} /></Field></div>;
  if (kind === "google_drive") return <div className="node-form"><p className="form-hint">Creates a new file or updates an existing file with text content using Google Drive.</p><Field {...field("google_drive.connection")}><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /></Field><label>File name<input value={String(config.name ?? "")} onChange={(event) => update("name", event.target.value)} placeholder="weekly-report.md" /></label><label>Content<textarea rows={8} value={String(config.content ?? "")} onChange={(event) => update("content", event.target.value)} /><TemplateWarnings value={String(config.content ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("content", `${String(config.content ?? "")}${token}`)} /></label><label>MIME type<input value={String(config.mime_type ?? "text/plain")} onChange={(event) => update("mime_type", event.target.value)} placeholder="text/markdown" /></label><label>Folder ID (optional)<input value={String(config.folder_id ?? "")} onChange={(event) => update("folder_id", event.target.value || undefined)} /></label><label>Existing file ID (optional)<input value={String(config.file_id ?? "")} onChange={(event) => update("file_id", event.target.value || undefined)} /></label><label>Output key<input value={String(config.output_key ?? "drive_file")} onChange={(event) => update("output_key", event.target.value)} /></label><Field {...field("google_drive.retry")}><RetryFields value={config.retry as Record<string, unknown> | undefined} onChange={(retry) => update("retry", retry)} /></Field></div>;
  if (kind === "google_drive_update") return <div className="node-form"><p className="form-hint">Updates an existing Google Drive file. Find the file ID in its Drive URL.</p><Field {...field("google_drive.connection")}><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /></Field><label>File ID<input value={String(config.file_id ?? "")} onChange={(event) => update("file_id", event.target.value)} placeholder="1abc..." /></label><label>Content<textarea rows={8} value={String(config.content ?? "")} onChange={(event) => update("content", event.target.value)} /><TemplateWarnings value={String(config.content ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("content", `${String(config.content ?? "")}${token}`)} /></label><label>MIME type<input value={String(config.mime_type ?? "text/plain")} onChange={(event) => update("mime_type", event.target.value)} placeholder="text/markdown" /></label><label>Output key<input value={String(config.output_key ?? "drive_file")} onChange={(event) => update("output_key", event.target.value)} /></label><Field {...field("google_drive.retry")}><RetryFields value={config.retry as Record<string, unknown> | undefined} onChange={(retry) => update("retry", retry)} /></Field></div>;
  if (kind === "weather_forecast") return <div className="node-form"><p className="form-hint">Keyless NOAA forecast for the configured Des Moines grid point.</p><label>Output key<input value={String(config.output_key ?? "weather")} onChange={(event) => update("output_key", event.target.value)} /></label><label>User-Agent<input value={String(config.user_agent ?? "Circuit workflow builder")} onChange={(event) => update("user_agent", event.target.value)} /></label></div>;
  if (kind === "news_headlines") return <div className="node-form"><p className="form-hint">Keyless Hacker News front-page stories.</p><label>Headline count<input type="number" min="1" max="20" value={Number(config.limit ?? 5)} onChange={(event) => update("limit", Number(event.target.value))} /></label><label>Output key<input value={String(config.output_key ?? "news")} onChange={(event) => update("output_key", event.target.value)} /></label><label>User-Agent<input value={String(config.user_agent ?? "Circuit workflow builder/1.0")} onChange={(event) => update("user_agent", event.target.value)} /></label></div>;
  if (kind === "google_sheets_append") return <div className="node-form"><p className="form-hint">Append one row to a Google Sheet. Reconnect Google Workspace after adding Sheets permission.</p><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Spreadsheet ID<input value={String(config.spreadsheet_id ?? "")} onChange={(event) => update("spreadsheet_id", event.target.value)} /></label><label>Range<input value={String(config.range_name ?? "Sheet1!A:Z")} onChange={(event) => update("range_name", event.target.value)} /></label><JsonField label="Row values" value={{ values: (config.values as unknown[]) ?? [] }} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("values", Array.isArray(value?.values) ? value.values : [])} /><label>Output key<input value={String(config.output_key ?? "sheet_append")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "csv_create") return <div className="node-form"><p className="form-hint">Creates CSV text that downstream nodes can save to Drive or send elsewhere.</p><label>Filename<input value={String(config.filename ?? "export.csv")} onChange={(event) => update("filename", event.target.value)} /></label><label>Headers<textarea rows={2} value={JSON.stringify(config.headers ?? [])} onChange={(event) => { try { update("headers", JSON.parse(event.target.value)); } catch { /* wait for valid JSON */ } }} /></label><label>Rows<textarea rows={5} value={JSON.stringify(config.rows ?? [])} onChange={(event) => { try { update("rows", JSON.parse(event.target.value)); } catch { /* wait for valid JSON */ } }} /></label><label>Output key<input value={String(config.output_key ?? "csv_file")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "rss_feed") return <div className="node-form"><p className="form-hint">Reads RSS or Atom items without requiring an API key.</p><label>Feed URL<input value={String(config.url ?? "")} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com/feed.xml" /></label><label>Maximum items<input type="number" min="1" max="50" value={Number(config.limit ?? 10)} onChange={(event) => update("limit", Number(event.target.value))} /></label><label>Output key<input value={String(config.output_key ?? "feed")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "webhook_post") return <div className="node-form"><p className="form-hint">POST JSON to an allowlisted host. Add the host to API_ALLOWED_HOSTS before running.</p><label>URL<input value={String(config.url ?? "")} onChange={(event) => update("url", event.target.value)} /></label><JsonField label="Headers" value={(config.headers as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("headers", value ?? {})} /><JsonField label="JSON body" value={(config.body as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("body", value ?? {})} /><label>Output key<input value={String(config.output_key ?? "webhook_response")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "http_response") return <div className="node-form"><p className="form-hint">Returns this JSON body to an event caller. Select this node as the Schedule response node.</p><label>Status code<input type="number" min="100" max="599" value={Number(config.status_code ?? 200)} onChange={(event) => update("status_code", Number(event.target.value))} /></label><JsonField label="Headers" value={(config.headers as Record<string, unknown>) ?? { "Content-Type": "application/json" }} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("headers", value ?? {})} /><JsonField label="JSON response body" value={(config.body as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("body", value ?? {})} /><label>Output key<input value={String(config.output_key ?? "http_response")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "mongodb") return <div className="node-form"><p className="form-hint">Uses MONGO_WORKFLOW_URI or an encrypted URI secret on the server. Project and cluster are labels; the URI controls authentication and the actual cluster.</p><label>Project<input value={String(config.project ?? "")} onChange={(event) => update("project", event.target.value)} placeholder="my-project" /></label><label>Cluster name<input value={String(config.cluster_name ?? "")} onChange={(event) => update("cluster_name", event.target.value)} placeholder="Production" /></label><label>Database name<input value={String(config.database_name ?? "")} onChange={(event) => update("database_name", event.target.value)} placeholder="app" /></label><label>Collection name<input value={String(config.collection_name ?? "")} onChange={(event) => update("collection_name", event.target.value)} placeholder="users" /></label><label>Operation<select value={String(config.operation ?? "find")} onChange={(event) => update("operation", event.target.value)}><option value="find">Find records</option><option value="update_one">Update one record</option></select></label><label>Connection URI secret (optional)<input value={String(config.connection_uri_secret ?? "")} onChange={(event) => update("connection_uri_secret", event.target.value || undefined)} placeholder="MONGO_WORKFLOW_URI_SECRET" /></label><JsonField label="Filter" value={(config.filter as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("filter", value ?? {})} />{config.operation === "update_one" && <JsonField label="Update document" value={(config.update as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("update", value ?? {})} />}<label>Read limit<input type="number" min="1" max="100" value={Number(config.limit ?? 20)} onChange={(event) => update("limit", Number(event.target.value))} /></label><label>Output key<input value={String(config.output_key ?? "mongodb_result")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "gmail_send") return <div className="node-form"><p className="form-hint">Send plain-text email through the selected Google Workspace account.</p><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>To<input value={String(config.to ?? "")} onChange={(event) => update("to", event.target.value)} /></label><label>Subject<input value={String(config.subject ?? "")} onChange={(event) => update("subject", event.target.value)} /></label><label>Body<textarea rows={7} value={String(config.body ?? "")} onChange={(event) => update("body", event.target.value)} /><VariablePicker variables={variables} onInsert={(token) => update("body", `${String(config.body ?? "")}${token}`)} /></label><label>Output key<input value={String(config.output_key ?? "gmail_response")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "reddit_headlines") return <div className="node-form"><p className="form-hint">Reads public Reddit JSON with the recommended User-Agent. Reddit may block some hosting networks.</p><label>Subreddit<input value={String(config.subreddit ?? "news")} onChange={(event) => update("subreddit", event.target.value.replace(/^r\//, ""))} placeholder="news" /></label><label>Sort<select value={String(config.sort ?? "top")} onChange={(event) => update("sort", event.target.value)}><option value="hot">Hot</option><option value="new">New</option><option value="top">Top</option></select></label><label>Post count<input type="number" min="1" max="25" value={Number(config.limit ?? 5)} onChange={(event) => update("limit", Number(event.target.value))} /></label><label>User-Agent<input value={String(config.user_agent ?? "CircuitWorkflowBot/1.0 (by u/patchy)")} onChange={(event) => update("user_agent", event.target.value)} /></label><label>Output key<input value={String(config.output_key ?? "reddit")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "google_calendar") return <div className="node-form"><p className="form-hint">Use a Google Workspace connection with Calendar permission. Reconnect after OAuth scope changes.</p><ConnectionPicker value={String(config.connection_id ?? "")} returnTo={returnTo} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Operation<select value={String(config.operation ?? "list")} onChange={(event) => update("operation", event.target.value)}><option value="list">List events</option><option value="create">Create event</option><option value="update">Update event</option></select></label><label>Calendar ID<input value={String(config.calendar_id ?? "primary")} onChange={(event) => update("calendar_id", event.target.value)} /></label>{config.operation === "list" ? <><label>Start time (RFC3339, optional)<input value={String(config.time_min ?? "")} onChange={(event) => update("time_min", event.target.value || undefined)} placeholder="2026-09-06T00:00:00Z" /></label><label>End time (RFC3339, optional)<input value={String(config.time_max ?? "")} onChange={(event) => update("time_max", event.target.value || undefined)} /></label><label>Maximum events<input type="number" min="1" max="100" value={Number(config.max_results ?? 10)} onChange={(event) => update("max_results", Number(event.target.value))} /></label></> : <><label>Event ID{config.operation === "update" && " (required)"}<input value={String(config.event_id ?? "")} onChange={(event) => update("event_id", event.target.value || undefined)} /></label><JsonField label="Event JSON" value={(config.event as Record<string, unknown>) ?? {}} variables={variables} workflowId={workflowId} nodeId={nodeId} onChange={(value) => update("event", value ?? {})} /></>}<label>Output key<input value={String(config.output_key ?? "calendar")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "github_action") return <div className="node-form"><p className="form-hint">Use a GitHub PAT connection with permission to write issues and pull requests.</p><ConnectionPicker value={String(config.connection_id ?? "")} onChange={(connectionId) => update("connection_id", connectionId || undefined)} /><label>Action<select value={String(config.action ?? "create_issue")} onChange={(event) => update("action", event.target.value)}><option value="create_issue">Create issue</option><option value="comment_issue">Comment on issue</option><option value="create_pull_request">Create pull request</option></select></label><label>Owner<input value={String(config.owner ?? "")} onChange={(event) => update("owner", event.target.value)} placeholder="owner" /></label><label>Repository<input value={String(config.repository ?? "")} onChange={(event) => update("repository", event.target.value)} placeholder="repository" /></label>{config.action === "comment_issue" && <label>Issue number<input type="number" value={String(config.issue_number ?? "")} onChange={(event) => update("issue_number", event.target.value ? Number(event.target.value) : undefined)} /></label>}<label>Title<input value={String(config.title ?? "")} onChange={(event) => update("title", event.target.value)} /><VariablePicker variables={variables} onInsert={(token) => update("title", `${String(config.title ?? "")}${token}`)} /></label><label>Body<textarea rows={6} value={String(config.body ?? "")} onChange={(event) => update("body", event.target.value)} /><VariablePicker variables={variables} onInsert={(token) => update("body", `${String(config.body ?? "")}${token}`)} /></label>{config.action === "create_pull_request" && <><label>Head branch<input value={String(config.head ?? "")} onChange={(event) => update("head", event.target.value)} /></label><label>Base branch<input value={String(config.base ?? "main")} onChange={(event) => update("base", event.target.value)} /></label></>}<label>Output key<input value={String(config.output_key ?? "github_action")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "job_search") return <div className="node-form"><p className="form-hint">Credentials are optional here. The server uses shared ADZUNA_APP_ID / ADZUNA_APP_KEY / JOOBLE_API_KEY environment variables when these personal secret fields are blank.</p><label>Provider<select value={String(config.provider ?? "adzuna")} onChange={(event) => update("provider", event.target.value)}><option value="adzuna">Adzuna</option><option value="jooble">Jooble</option></select></label><label>Keywords<input value={String(config.keywords ?? "software engineer")} onChange={(event) => update("keywords", event.target.value)} placeholder="software engineer" /></label><label>Location<input value={String(config.location ?? "Des Moines, IA")} onChange={(event) => update("location", event.target.value)} /></label><label>Radius (miles)<input type="number" min="0" max="250" value={Number(config.radius_miles ?? 30)} onChange={(event) => update("radius_miles", Number(event.target.value))} /></label><label className="required-input"><input type="checkbox" checked={Boolean(config.remote ?? false)} onChange={(event) => update("remote", event.target.checked)} /> Include remote roles</label><label>Result limit<input type="number" min="1" max="100" value={Number(config.limit ?? 25)} onChange={(event) => update("limit", Number(event.target.value))} /></label>{config.provider === "adzuna" ? <><label>App ID secret (optional)<input value={String(config.app_id_secret ?? "")} onChange={(event) => update("app_id_secret", event.target.value || undefined)} placeholder="ADZUNA_APP_ID" /></label><label>App key secret (optional)<input value={String(config.app_key_secret ?? "")} onChange={(event) => update("app_key_secret", event.target.value || undefined)} placeholder="ADZUNA_APP_KEY" /></label></> : <label>API key secret (optional)<input value={String(config.api_key_secret ?? "")} onChange={(event) => update("api_key_secret", event.target.value || undefined)} placeholder="JOOBLE_API_KEY" /></label>}<label>Output key<input value={String(config.output_key ?? "jobs")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  if (kind === "erragent") return <div className="node-form"><p className="form-hint">ErrAgent receives this workflow's inputs and outputs and returns a reviewable plan or diagnosis. It does not mutate Circuit directly.</p><label>Operation<select value={String(config.operation ?? "debug_run")} onChange={(event) => update("operation", event.target.value)}><option value="debug_run">Debug failed run</option><option value="plan_workflow">Plan workflow</option><option value="patch_workflow">Propose workflow patch</option><option value="generate_connector">Generate connector proposal</option><option value="job_search_flow">Create job-search flow</option></select></label><label>Bridge endpoint<input value={String(config.endpoint ?? "")} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://erragent.example.com/api/v1/circuit/architect" /></label><Field {...field("erragent.goal")}><label>Goal<textarea rows={5} value={String(config.goal ?? "")} onChange={(event) => update("goal", event.target.value)} placeholder="Explain the latest failed run and propose a safe fix." /><TemplateWarnings value={String(config.goal ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("goal", `${String(config.goal ?? "")}${token}`)} /></label></Field><label>Incident ID (optional)<input value={String(config.incident_id ?? "")} onChange={(event) => update("incident_id", event.target.value || undefined)} /></label><label>API key secret (optional)<input value={String(config.api_key_secret ?? "")} onChange={(event) => update("api_key_secret", event.target.value || undefined)} placeholder="ERRAGENT_API_KEY" /></label><label>Timeout (seconds)<input type="number" min="5" max="120" value={Number(config.timeout_seconds ?? 30)} onChange={(event) => update("timeout_seconds", Number(event.target.value))} /></label><label>Output key<input value={String(config.output_key ?? "erragent_result")} onChange={(event) => update("output_key", event.target.value)} /></label></div>;
  return (
    <div className="node-form">
      <Field {...field("api.method")}>
      <label>
        Method
        <select
          value={String(config.method ?? "GET")}
          onChange={(event) => update("method", event.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
      </label>
      </Field>
      <Field {...field("api.url")}>
      <label>
        URL
        <input
          value={String(config.url ?? "")}
          onChange={(event) => {
            const url = event.target.value;
            if (url.includes("googleapis.com/calendar")) {
              const next = { ...config };
              delete next.api_key_secret;
              delete next.api_key_query_param;
              delete next.api_key_header;
              onChange({ ...next, url });
            } else {
              update("url", url);
            }
          }}
        />
        <TemplateWarnings value={String(config.url ?? "")} variables={variables} />
        <VariablePicker
          variables={variables}
          onInsert={(token) =>
            update("url", `${String(config.url ?? "")}${token}`)
          }
        />
        <SuggestPrompt workflowId={workflowId} nodeId={nodeId} value={String(config.url ?? "")} onApply={(suggestion) => update("url", suggestion)} />
      </label>
      </Field>
      <Field {...field("api.connection")}>
      <ConnectionPicker value={String(config.connection_id ?? "")} onChange={(connectionId) => update("connection_id", connectionId || undefined)} />
      </Field>
      <div className="api-key-connector"><p className="form-hint">Optional personal API-key connector. Create the secret on the dashboard first.</p><label>Secret name<input value={String(config.api_key_secret ?? "")} onChange={(event) => update("api_key_secret", event.target.value || undefined)} placeholder="WEATHER_API_KEY" /></label><label>Query parameter<input value={String(config.api_key_query_param ?? "")} onChange={(event) => update("api_key_query_param", event.target.value || undefined)} placeholder="key" /></label><label>Or header name<input value={String(config.api_key_header ?? "")} onChange={(event) => update("api_key_header", event.target.value || undefined)} placeholder="X-API-Key" /></label></div>
      <Field {...field("api.headers")}>
      <JsonField
        label="Headers"
        value={(config.headers as Record<string, unknown>) ?? {}}
        variables={variables}
        workflowId={workflowId}
        nodeId={nodeId}
        onChange={(value) => update("headers", value ?? {})}
      />
      </Field>
      <Field {...field("api.body")}>
      <JsonField
        label="JSON body"
        value={(config.body as Record<string, unknown> | null) ?? null}
        variables={variables}
        workflowId={workflowId}
        nodeId={nodeId}
        onChange={(value) => update("body", value)}
      />
      </Field>
      {String(config.url ?? "").includes("gmail.googleapis.com") && <Field {...field("api.gmail")}><><label>To<input value={String((config.gmail_message as Record<string, string> | undefined)?.to ?? "")} onChange={(event) => update("gmail_message", { ...(config.gmail_message as Record<string, string> ?? {}), to: event.target.value })} /></label><label>Subject<input value={String((config.gmail_message as Record<string, string> | undefined)?.subject ?? "")} onChange={(event) => update("gmail_message", { ...(config.gmail_message as Record<string, string> ?? {}), subject: event.target.value })} /></label><label>Email body<textarea rows={4} value={String((config.gmail_message as Record<string, string> | undefined)?.body ?? "")} onChange={(event) => update("gmail_message", { ...(config.gmail_message as Record<string, string> ?? {}), body: event.target.value })} /><TemplateWarnings value={String((config.gmail_message as Record<string, string> | undefined)?.body ?? "")} variables={variables} /><VariablePicker variables={variables} onInsert={(token) => update("gmail_message", { ...(config.gmail_message as Record<string, string> ?? {}), body: `${String((config.gmail_message as Record<string, string> | undefined)?.body ?? "")}${token}` })} /></label></></Field>}
      <Field {...field("api.output_key")}>
      <label>
        Output key
        <input
          value={String(config.output_key ?? "api_response")}
          onChange={(event) => update("output_key", event.target.value)}
        />
      </label>
      </Field>
      <Field {...field("api.retry")}>
      <RetryFields value={config.retry as Record<string, unknown> | undefined} onChange={(retry) => update("retry", retry)} />
      </Field>
    </div>
  );
}

function InputsPanel({ inputs, onChange }: { inputs: WorkflowInput[]; onChange: (inputs: WorkflowInput[]) => void }) {
  const [showAddInput, setShowAddInput] = useState(false);
  const [draft, setDraft] = useState<WorkflowInput>({ key: `input_${inputs.length + 1}`, label: "New input", type: "string", required: false });
  const openAddInput = () => {
    setDraft({ key: `input_${inputs.length + 1}`, label: "New input", type: "string", required: false });
    setShowAddInput(true);
  };
  const add = () => {
    const key = draft.key.trim().replace(/\W/g, "_");
    if (!key) return;
    onChange([...inputs, { ...draft, key, label: draft.label.trim() || key }]);
    setShowAddInput(false);
  };
  const update = (index: number, change: Partial<WorkflowInput>) => onChange(inputs.map((input, inputIndex) => inputIndex === index ? { ...input, ...change } : input));
  return <>
    <section className="workflow-inputs"><div className="panel-heading"><span>Inputs</span><button className="row-icon" type="button" title="Add input" aria-label="Add workflow input" onClick={openAddInput}><Plus size={14} /></button></div>{inputs.map((input, index) => <div className="input-row" key={`workflow-input-${index}`}><input value={input.key} aria-label="Input key" placeholder="key" onChange={(event) => update(index, { key: event.target.value.replace(/\W/g, "_") })} /><input value={input.label} aria-label="Input label" placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} /><select value={input.type} aria-label="Input type" onChange={(event) => update(index, { type: event.target.value as WorkflowInput["type"] })}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes/No</option></select><label className="required-input"><input type="checkbox" checked={input.required} onChange={(event) => update(index, { required: event.target.checked })} /> Required</label><button className="row-icon" type="button" title="Remove input" onClick={() => onChange(inputs.filter((_, inputIndex) => inputIndex !== index))}><Trash2 size={14} /></button></div>)}</section>
    {showAddInput && <div className="input-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAddInput(false); }}><section className="input-modal" role="dialog" aria-modal="true" aria-labelledby="add-input-title"><div className="input-modal-heading"><h2 id="add-input-title">Add workflow input</h2><button className="icon-button" type="button" title="Close" onClick={() => setShowAddInput(false)}><X size={17} /></button></div><p>Inputs become available as <code>{"{{input.key}}"}</code> in connected blocks.</p><label>Key<input autoFocus value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value.replace(/\W/g, "_") })} placeholder="customer_name" /></label><label>Label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Customer name" /></label><label>Type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as WorkflowInput["type"] })}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes/No</option></select></label><label className="input-modal-checkbox"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} /> Required</label><div className="input-modal-actions"><button className="text-button" type="button" onClick={() => setShowAddInput(false)}>Cancel</button><button className="apply-proposal" type="button" onClick={add} disabled={!draft.key.trim()}>Add input</button></div></section></div>}
  </>;
}

function TutorialPanel({ tutorial, step, complete, onNext, onBack, onSkip, onOpenConsole }: { tutorial: Tutorial; step: number; complete: boolean; onNext: () => void; onBack: () => void; onSkip: () => void; onOpenConsole: () => void }) {
  const steps = tutorial.steps;
  const current = steps[step] ?? steps[steps.length - 1];
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLElement | null>(null);
  const clampPosition = (left: number, top: number) => {
    const panel = panelRef.current;
    const width = panel?.offsetWidth ?? 360;
    const height = panel?.offsetHeight ?? 280;
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    };
  };
  const startDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setPosition({ left: rect.left, top: rect.top });
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPosition(clampPosition(event.clientX - dragOffset.current.x, event.clientY - dragOffset.current.y));
  };
  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <aside ref={panelRef} className={`tutorial-panel${dragging ? " is-dragging" : ""}`} role="dialog" aria-label={tutorial.title} style={position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}><div className="tutorial-panel-heading" onPointerDown={startDragging} onPointerMove={movePanel} onPointerUp={stopDragging} onPointerCancel={stopDragging}><span><Sparkles size={16} /> {tutorial.title}</span><button className="icon-button" type="button" title="Skip tutorial" onClick={onSkip}><X size={16} /></button></div><div className="tutorial-progress">Step {step + 1} of {steps.length}</div><h2>{current.title}</h2><p>{current.body}</p><div className="tutorial-panel-actions"><button className="text-button" type="button" onClick={onBack} disabled={step === 0}>Back</button>{step === steps.length - 1 ? <button className="apply-proposal" type="button" onClick={onOpenConsole}>Open Console</button> : <button className="apply-proposal" type="button" onClick={onNext} disabled={!complete}>Next</button>}</div></aside>;
}

function TraceStep({ event, received, expanded, onToggle }: { event: RunResult["trace"][number]; received?: RunResult["trace"][number]["received"]; expanded: boolean; onToggle: () => void }) {
  return <article className={`trace-step ${event.status} ${expanded ? "expanded" : ""}`}>
    <button className="trace-step-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
      <span className="trace-step-summary"><span className="trace-step-chevron">{expanded ? "▾" : "▸"}</span><span>{event.node_label}: {event.message}</span></span>
      <span className="trace-step-status">{event.status}</span>
    </button>
    {expanded && <div className="trace-step-details"><div><strong>Received</strong><pre>{formatRunJson(received ?? event.received ?? {})}</pre></div><div><strong>Output</strong><pre>{formatRunJson(event.output ?? {})}</pre></div></div>}
  </article>;
}

function Editor({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(starter);
  const [edges, setEdges, onEdgesChange] = useEdgesState(starterEdges);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [workflowLoaded, setWorkflowLoaded] = useState(false);
  const [inputs, setInputs] = useState<WorkflowInput[]>([]);
  const [selected, setSelected] = useState<string | null>("brief");
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.search).get("connection_error") ?? "");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [running, setRunning] = useState(false);
  const [executionNodeId, setExecutionNodeId] = useState<string | null>(null);
  const [hasExecutionError, setHasExecutionError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showRunInputs, setShowRunInputs] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleDraft, setConsoleDraft] = useState("");
  const [consoleMessages, setConsoleMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [consoleSending, setConsoleSending] = useState(false);
  const [consoleError, setConsoleError] = useState("");
  const [copilotThinking, setCopilotThinking] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [applyingProposal, setApplyingProposal] = useState(false);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [expandedTraceSteps, setExpandedTraceSteps] = useState<Set<string>>(new Set());
  const [helpMode, setHelpMode] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const [helpPosition, setHelpPosition] = useState({ x: 24, y: 78 });
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [isConnectingBlock, setIsConnectingBlock] = useState(false);
  const [showMobileLibrary, setShowMobileLibrary] = useState(false);
  const [showMobileInspector, setShowMobileInspector] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [tutorialId, setTutorialId] = useState<TutorialId | null>(() => {
    const stored = window.sessionStorage.getItem("circuit-tutorial");
    return isTutorialId(stored) ? stored : null;
  });
  const [tutorialStep, setTutorialStep] = useState(0);
  const [hasSaved, setHasSaved] = useState(false);
  const canvasPanelRef = useRef<HTMLElement | null>(null);
  const undoStack = useRef<Array<{ nodes: FlowNode[]; edges: Edge[] }>>([]);
  const dragHistoryCaptured = useRef(false);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const current = nodes.find((node) => node.id === selected);
  const tutorial: Tutorial | null = tutorialId ? tutorials[tutorialId] : null;
  const tutorialComplete = tutorial?.steps[tutorialStep]?.complete({ inputs, nodes, edges, hasSaved }) ?? true;
  const variables = current
    ? variablesFor(nodes, edges, current.id, inputs)
    : [];
  const payload = () => ({
    name,
    inputs,
    graph: {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data.kind,
        label: node.data.label,
        position: node.position,
        config: node.data.config,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        source_handle: edge.sourceHandle ?? null,
        label: edge.label ?? edge.sourceHandle ?? null,
      })),
    },
  });
  const pushUndo = () => {
    undoStack.current = [...undoStack.current.slice(-49), { nodes, edges }];
    setCanUndo(true);
  };
  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setCanUndo(undoStack.current.length > 0);
    setNotice("Undid the last canvas change");
  };
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${API}/workflows/${workflowId}`);
        const workflow = (await response.json()) as Stored & { inputs?: WorkflowInput[] };
        if (response.ok) {
          setId(workflow.id);
          setName(workflow.name);
          setInputs(workflow.inputs ?? []);
          setSelected(workflow.graph.nodes[0]?.id ?? null);
          setNodes(
            workflow.graph.nodes.map((node) => {
              const config = { ...node.config };
              if (node.type === "api" && String(config.url ?? "").includes("googleapis.com/calendar")) {
                delete config.api_key_secret;
                delete config.api_key_query_param;
                delete config.api_key_header;
              }
              return {
                id: node.id,
                type: "workflow",
                position: node.position,
                data: {
                  label: node.label,
                  kind: node.type,
                  config,
                  status: "idle",
                },
              };
            }),
          );
          setEdges(
            workflow.graph.edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.source_handle ?? undefined,
              label: edge.label ?? undefined,
              animated: true,
            })),
          );
          undoStack.current = [];
          setCanUndo(false);
          setWorkflowLoaded(true);
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 0 }));
          });
        }
      } catch {
        setNotice("Could not reach the API");
      }
    })();
  }, [fitView, setEdges, setNodes, workflowId]);
  useEffect(() => {
    if (!workflowLoaded || !nodesInitialized || nodes.length === 0) return;
    const refit = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 0 });
    }, 250);
    return () => window.clearTimeout(refit);
  }, [fitView, nodes.length, nodesInitialized, workflowLoaded]);
  useEffect(() => {
    if (!workflowLoaded || nodes.length === 0 || !canvasPanelRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size && size.width > 0 && size.height > 0) {
        void fitView({ padding: 0.2, duration: 0 });
      }
    });
    observer.observe(canvasPanelRef.current);
    return () => observer.disconnect();
  }, [fitView, nodes.length, workflowLoaded]);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`workflow-run-history:${workflowId}`);
      setRunHistory(stored ? JSON.parse(stored) as RunHistoryEntry[] : []);
    } catch {
      setRunHistory([]);
    }
  }, [workflowId]);
  const recordRun = (result: RunResult, startedAt: string, durationMs: number) => {
    const entry: RunHistoryEntry = {
      ...result,
      id: `${startedAt}-${crypto.randomUUID()}`,
      startedAt,
      durationMs,
      status: result.context.errors.length || result.trace.some((event) => event.status === "failed") ? "failed" : "completed",
    };
    setRunHistory((current) => {
      const next = [entry, ...current].slice(0, 25);
      const storageKey = `workflow-run-history:${workflowId}`;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          const compact = next.slice(0, 5).map((run) => ({
            ...run,
            trace: run.trace.map(({ received: _received, output: _output, ...event }) => event),
            context: { ...run.context, outputs: {}, logs: run.context.logs.slice(-20) },
          }));
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(compact));
          } catch {
            window.localStorage.removeItem(storageKey);
          }
        }
      }
      return next;
    });
  };
  const save = async () => {
    if (!id) return;
    setEditorError("");
    setSaving(true);
    try {
      const response = await fetch(`${API}/workflows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) {
        const responseText = await response.text();
        let errorMessage = responseText || "Could not save workflow";
        try {
          const parsed = JSON.parse(responseText) as unknown;
          errorMessage = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
        } catch {
          // Keep non-JSON server responses unchanged.
        }
        console.error(`[Workflow Save Failed] Status: ${response.status}`, errorMessage);
        throw new Error(errorMessage);
      }
      setNotice("Saved to MongoDB Atlas");
      setSaveConfirmed(true);
      setHasSaved(true);
      window.setTimeout(() => setSaveConfirmed(false), 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save workflow";
      console.error("[Save Error]", message, error);
      setEditorError(message);
      setNotice("Save failed");
    } finally {
      setSaving(false);
    }
  };
  const add = (kind: Kind, position = { x: 260, y: 250 }) => {
    pushUndo();
    const node: FlowNode = {
      id: `${kind}_${Date.now()}`,
      type: "workflow",
      position,
      data: {
        label: blocks.find((block) => block.kind === kind)?.title ?? "Node",
        kind,
        config: structuredClone(configs[kind]),
        status: "idle",
      },
    };
    setNodes((all) => [...all, node]);
    setSelected(node.id);
    setIsAddingBlock(true);
    setShowMobileLibrary(false);
    window.setTimeout(() => setIsAddingBlock(false), 900);
  };
  const connect = (connection: Connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const branch = ["condition", "repeat_until", "for_each"].includes(source?.data.kind ?? "") ? connection.sourceHandle : undefined;
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target ||
      (source?.data.kind === "condition" &&
        branch !== "true" &&
        branch !== "false") ||
      (source?.data.kind === "repeat_until" && !["continue", "done", "limit_reached"].includes(branch ?? "")) ||
      (source?.data.kind === "for_each" && !["each_item", "complete", "limit_reached"].includes(branch ?? "")) ||
      (branch &&
        edges.some(
          (edge) =>
            edge.source === connection.source && edge.sourceHandle === branch,
        ))
    ) {
      setNotice("Use each condition branch once and connect different blocks.");
      return;
    }
    pushUndo();
    setEdges((all) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}-${branch ?? "next"}-${connection.target}`,
          label: branch,
          animated: true,
        },
        all,
      ),
    );
    const target = nodes.find((node) => node.id === connection.target);
    if (source?.data.kind === "github_repository" && target?.data.kind === "llm") {
      const repositoryToken = `{{${source.id}.${String(source.data.config.output_key ?? "repository_context")}}}`;
      const prompt = String(target.data.config.prompt ?? "");
      if (!prompt.includes(repositoryToken)) {
        setNodes((all) => all.map((node) => node.id === target.id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, prompt: `${prompt}${prompt.trim() ? "\n\nRepository context:\n" : "Analyze this repository and explain what it does:\n"}${repositoryToken}` } } }
          : node));
      }
    }
    setIsConnectingBlock(true);
    window.setTimeout(() => setIsConnectingBlock(false), 700);
  };
  const handleNodesChange = (changes: Parameters<typeof onNodesChange>[0]) => {
    const startsDrag = changes.some((change) => change.type === "position" && change.dragging === true);
    const endsDrag = changes.some((change) => change.type === "position" && change.dragging === false);
    const structuralChange = changes.some((change) => change.type === "add" || change.type === "remove");
    if ((startsDrag && !dragHistoryCaptured.current) || structuralChange) {
      pushUndo();
      dragHistoryCaptured.current = startsDrag;
    }
    if (endsDrag) dragHistoryCaptured.current = false;
    onNodesChange(changes);
  };
  const run = async (values: Record<string, unknown>) => {
    if (!id) return;
    const startedAt = new Date().toISOString();
    const started = performance.now();
    setRunning(true);
    setExecutionNodeId(null);
    setHasExecutionError(false);
    setRunResult(null);
    setNodes((items) => items.map((node) => ({ ...node, data: { ...node.data, status: "running" } })));
    try {
      await save();
      
      // Preflight validation
      const prefightResponse = await fetch(`${API}/workflows/${id}/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const preflight = (await prefightResponse.json()) as { is_valid?: boolean; issues?: Array<{ severity: string; message: string; node_label: string }>; detail?: string };
      if (!prefightResponse.ok || typeof preflight.is_valid !== "boolean") {
        throw new Error(preflight.detail ?? "Preflight validation failed");
      }
      if (!preflight.is_valid && preflight.issues?.length) {
        const errors = preflight.issues.filter((i) => i.severity === "error").map((i) => `${i.node_label}: ${i.message}`);
        if (errors.length) {
          setNodes((items) => items.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
          const message = errors.join(". ");
          setEditorError(message);
          setNotice("Run blocked by preflight validation");
          setRunning(false);
          return;
        }
      }
      
      const response = await fetch(`${API}/workflows/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: values }),
      });
      const result = (await response.json()) as RunResult | { detail?: string };
      if (!response.ok || !("trace" in result)) throw new Error("detail" in result ? result.detail ?? "Run failed" : "Run failed");
      setRunResult(result);
      recordRun(result, startedAt, Math.round(performance.now() - started));
      const completedTrace = result.trace.filter((event) => event.status !== "started");
      completedTrace.forEach((event, index) => {
        window.setTimeout(() => setExecutionNodeId(event.node_id), index * 420);
      });
      window.setTimeout(() => setExecutionNodeId(null), completedTrace.length * 420 + 300);
      setHasExecutionError(result.context.errors.length > 0 || completedTrace.some((event) => event.status === "failed"));
      const statuses = new Map<string, Status>(result.trace.filter((event) => event.status !== "started").map((event) => [event.node_id, event.status === "failed" ? "failed" : "completed"]));
      setNodes((items) => items.map((node) => ({ ...node, data: { ...node.data, status: statuses.get(node.id) ?? "idle" } })));
      setNotice(result.context.errors.length ? "Workflow finished with errors" : "Workflow completed");
    } catch (error) {
      setNodes((items) => items.map((node) => node.data.status === "running" ? { ...node, data: { ...node.data, status: "failed" } } : node));
      setNotice(error instanceof Error ? error.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };
  const proposalFromRun = (result: RunResult | null): WorkflowPatchProposal | null => {
    if (!result) return null;
    for (const output of Object.values(result.context.outputs)) {
      if (!output || typeof output !== "object") continue;
      for (const value of Object.values(output as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.summary === "string" && candidate.patch && typeof candidate.patch === "object") return candidate as WorkflowPatchProposal;
      }
    }
    return null;
  };
  const applyRunProposal = async (proposal: WorkflowPatchProposal) => {
    if (!id || applyingProposal) return;
    setApplyingProposal(true);
    setEditorError("");
    try {
      pushUndo();
      // Add positions to nodes that don't have them (ErrAgent doesn't provide positions)
      const patch = { ...proposal.patch };
      const currentMaxX = Math.max(...nodes.map(n => n.position.x), 0);
      let nextX = currentMaxX + 250;
      
      patch.add_nodes = (patch.add_nodes ?? []).map((node, index) => ({
        ...node,
        position: node.position || { x: nextX + (index * 200), y: 100 }
      }));
      
      const response = await fetch(`${API}/workflows/${id}/apply-patch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch }) });
      const body = await response.json() as Stored & { inputs?: WorkflowInput[] } | { detail?: string };
      if (!response.ok || !("graph" in body)) throw new Error("detail" in body ? body.detail ?? "Could not apply proposal" : "Could not apply proposal");
      setName(body.name);
      setInputs(body.inputs ?? []);
      setNodes(body.graph.nodes.map((node) => ({ id: node.id, type: "workflow", position: node.position, data: { label: node.label, kind: node.type, config: node.config, status: "idle" } })));
      setEdges(body.graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.source_handle ?? undefined, label: edge.label ?? undefined, animated: true })));
      setRunResult(null);
      setNotice("ErrAgent proposal applied. Review the workflow before running again.");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Could not apply proposal");
    } finally {
      setApplyingProposal(false);
    }
  };
  const exportWorkflow = () => {
    setIsExporting(true);
    const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "workflow"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Workflow export is ready");
    window.setTimeout(() => setIsExporting(false), 1400);
  };
  const update = (data: Partial<Data>) => {
    if (!selected) return;
    setNodes((all) => all.map((node) => node.id === selected ? { ...node, data: { ...node.data, ...data } } : node));
  };
  const applyProposal = (proposal: Proposal) => {
    pushUndo();
    if (proposal.patch.add_inputs?.length) setInputs((items) => [...items, ...proposal.patch.add_inputs!.filter((input) => !items.some((existing) => existing.key === input.key))]);
    setNodes((items) => [
      ...items.map((node) => {
        const updateNode = proposal.patch.update_nodes.find((item) => item.id === node.id);
        return updateNode ? { ...node, data: { ...node.data, label: updateNode.label ?? node.data.label, config: updateNode.config ?? node.data.config } } : node;
      }),
      ...proposal.patch.add_nodes.map((node) => ({ id: node.id, type: "workflow" as const, position: node.position, data: { label: node.label, kind: node.type, config: node.config, status: "idle" as const } })),
    ]);
    setEdges((items) => [...items, ...proposal.patch.add_edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.source_handle ?? undefined, label: edge.label ?? undefined, animated: true }))]);
    setNotice("Proposal applied locally. Save the workflow to persist it.");
  };
  const sendConsoleMessage = async () => {
    if (!id || !consoleDraft.trim() || consoleSending) return;
    const message = consoleDraft.trim();
    const eventNode = nodes.find((node) => node.data.kind === "schedule" && node.data.config.trigger_mode === "event");
    const eventName = String(eventNode?.data.config.event_name ?? "");
    if (!eventName) { setConsoleError("Add an event-triggered Schedule node before using Console."); return; }
    setConsoleDraft("");
    setConsoleError("");
    setConsoleMessages((items) => [...items, { role: "user", content: message }]);
    setConsoleSending(true);
    try {
      const response = await fetch(`${API}/workflows/${id}/console`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_name: eventName, conversation_id: `console-${id}`, message, history: consoleMessages.slice(-20) }) });
      const body = await response.json() as unknown;
      if (!response.ok) throw new Error(typeof body === "object" && body && "detail" in body ? String((body as { detail?: unknown }).detail ?? "Console request failed") : "Console request failed");
      const content = typeof body === "object" && body && "message" in body ? String((body as { message?: unknown }).message) : JSON.stringify(body, null, 2);
      setConsoleMessages((items) => [...items, { role: "assistant", content }]);
    } catch (error) {
      setConsoleError(error instanceof Error ? error.message : "Console request failed");
    } finally {
      setConsoleSending(false);
    }
  };
  const currentProposal = proposalFromRun(runResult);
  const closeTutorial = () => {
    window.sessionStorage.removeItem("circuit-tutorial");
    setTutorialId(null);
  };
  const nextTutorialStep = () => {
    if (tutorialComplete && tutorial) setTutorialStep((step) => Math.min(step + 1, tutorial.steps.length - 1));
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="editor-back" title="Back to workflows" onClick={onBack}><Workflow size={21} /> Circuit</button>
        </div>
        <input
          className="workflow-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="topbar-actions">
          <button className="icon-button undo-control" title="Undo last canvas change" aria-label="Undo last canvas change" onClick={undo} disabled={!canUndo}>
            <Undo2 size={18} />
          </button>
          <button
            className={`icon-button save-control ${saveConfirmed ? "save-confirmed" : ""}`}
            title={saveConfirmed ? "Saved" : "Save workflow"}
            onClick={() => void save().catch(() => undefined)}
            disabled={saving}
          >
            {saveConfirmed ? <Check size={18} /> : <Save size={18} />}
          </button>
          <button className="icon-button" title="Export workflow JSON" onClick={exportWorkflow}><Download size={18} /></button>
          <button className={`icon-button ${helpMode ? "help-active" : ""}`} title="Toggle Help Mode" onClick={() => { setHelpMode((active) => !active); setHelpTopic(null); }}><CircleHelp size={18} /></button>
          <button className="icon-button" title="Open Workflow Copilot" onClick={() => setShowCopilot(true)}><MessageCircle size={18} /></button>
          <button className="icon-button" title="Open workflow Console" onClick={() => setShowConsole(true)}><MessageSquareText size={18} /></button>
          <button className="icon-button library-toggle-mobile" title="Toggle block library" onClick={() => { setShowMobileInspector(false); setShowMobileLibrary(!showMobileLibrary); setLibraryCollapsed(!libraryCollapsed); }}><Tag size={18} /></button>
          <button className="icon-button inspector-toggle-mobile" title="Toggle block inspector" onClick={() => { setShowMobileLibrary(false); setShowMobileInspector(!showMobileInspector); setInspectorCollapsed(!inspectorCollapsed); }}><PanelRight size={18} /></button>
          <button
            className="run-button"
            onClick={() => inputs.length ? setShowRunInputs(true) : void run({})}
            disabled={running}
          >
            <CirclePlay size={17} /> {running ? "Running" : "Run workflow"}
          </button>
          {import.meta.env.VITE_CLERK_PUBLISHABLE_KEY && <UserButton afterSignOutUrl="/" />}
        </div>
      </header>
      {showConsole && <aside className="console-panel"><div className="console-heading"><strong>Workflow Console</strong><button className="icon-button" type="button" title="Close Console" onClick={() => setShowConsole(false)}><X size={16} /></button></div><p className="console-context">Calls the event-triggered workflow as a headless client.</p><div className="console-messages">{consoleMessages.length === 0 && <p className="console-empty">Send a message to test this workflow.</p>}{consoleMessages.map((item, index) => <p className={`console-message ${item.role}`} key={index}>{item.content}</p>)}{consoleSending && <p className="console-message assistant">Waiting for Circuit...</p>}</div>{consoleError && <p className="console-error">{consoleError}</p>}<div className="console-compose"><textarea value={consoleDraft} onChange={(event) => setConsoleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendConsoleMessage(); } }} placeholder="Type a message..." rows={3} /><button className="run-button" type="button" onClick={() => void sendConsoleMessage()} disabled={consoleSending || !consoleDraft.trim()}>Send</button></div></aside>}
      {editorError && <div className="editor-alert" role="alert"><strong>⚠️ Save Error</strong><pre>{editorError}</pre><button type="button" onClick={() => { navigator.clipboard.writeText(editorError); setNotice("Error copied to clipboard"); }} title="Copy error message" aria-label="Copy error"><Braces size={14} /></button><button type="button" onClick={() => setEditorError("")} aria-label="Dismiss save error"><X size={16} /></button></div>}
      {tutorial && <TutorialPanel tutorial={tutorial} step={tutorialStep} complete={tutorialComplete} onNext={nextTutorialStep} onBack={() => setTutorialStep((step) => Math.max(step - 1, 0))} onSkip={closeTutorial} onOpenConsole={() => { setShowConsole(true); closeTutorial(); }} />}
      <section className={`workspace ${showCopilot ? "with-copilot" : ""}`} style={{ "--library-w": libraryCollapsed ? "0px" : undefined, "--inspector-w": inspectorCollapsed ? "0px" : undefined } as React.CSSProperties}>
        {(showMobileLibrary || showMobileInspector) && <div className="mobile-library-backdrop" onClick={() => { setShowMobileLibrary(false); setShowMobileInspector(false); }} />}
        <BlockLibrary className={`${showMobileLibrary ? "visible" : ""} ${libraryCollapsed ? "collapsed" : ""}`} blocks={blocks} helpMode={helpMode} renderIcon={(kind) => <Icon kind={kind} />} onAdd={add} onHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }} getHelpTopic={(kind) => blockHelp[kind]}>
          <InputsPanel inputs={inputs} onChange={setInputs} />
          <div className="library-tip">
            <Sparkles size={15} /> Connect blocks to expose variables.
          </div>
        </BlockLibrary>
        <section
          className="canvas-panel"
          ref={canvasPanelRef}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (helpMode) return;
            const kind = event.dataTransfer.getData("workflow-block") as Kind;
            if (blocks.some((block) => block.kind === kind))
              add(
                kind,
                screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              );
          }}
        >
          <ReactFlow
            key={`${workflowId}-${workflowLoaded ? "loaded" : "loading"}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onInit={(instance) => {
              window.setTimeout(() => void instance.fitView({ padding: 0.2, duration: 0 }), 300);
            }}
            panOnDrag={true}
            panOnScroll={false}
            zoomOnPinch
            selectionOnDrag={false}
            onNodeClick={(event, node) => { if (helpMode) { setHelpTopic(blockHelp[node.data.kind]); setHelpPosition({ x: event.clientX, y: event.clientY }); } else setSelected(node.id); }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background gap={18} size={1} color="#bfd1c8" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="top-right" />
          </ReactFlow>
          <div className="canvas-mascot"><PatchyEmptyState tab="open" compact isAddingBlock={isAddingBlock} isConnectingBlock={isConnectingBlock} isThinking={copilotThinking} isExecuting={running} executionNodeId={executionNodeId} hasExecutionError={hasExecutionError} isAssistantOpen={showCopilot} isExporting={isExporting} onOpenAssistant={() => setShowCopilot(true)} /></div>
        </section>
        <aside className={`inspector-panel ${showMobileInspector ? "visible" : ""} ${inspectorCollapsed ? "collapsed" : ""}`} onClickCapture={(event) => { if (helpMode && event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); setHelpTopic(panelHelp.inspector); setHelpPosition({ x: event.clientX, y: event.clientY }); } }}>
          {current ? (
            <>
              <div className="panel-heading">
                <span>Inspector</span>
                <Field helpMode={helpMode} topic={fieldHelp["inspector.close"]} onHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }}>
                <button
                  className="icon-button"
                  onClick={() => setSelected(null)}
                >
                  <X size={16} />
                </button>
                </Field>
              </div>
              <div className={`inspector-kind ${current.data.kind}`}>
                <Icon kind={current.data.kind} /> {current.data.kind} node
              </div>
              <Field helpMode={helpMode} topic={fieldHelp["inspector.label"]} onHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }}>
              <label>
                Label
                <input
                  value={current.data.label}
                  onChange={(event) => update({ label: event.target.value })}
                />
              </label>
              </Field>
              <NodeForm
                kind={current.data.kind}
                config={current.data.config}
                variables={variables}
                workflowId={id}
                nodeId={current.id}
                bodyOptions={nodes.filter((node) => node.id !== current.id)}
                helpMode={helpMode}
                onFieldHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }}
                onChange={(config) => update({ config })}
              />
              {current.data.kind === "schedule" && current.data.config.trigger_mode === "event" && <Field helpMode={helpMode} topic={fieldHelp["schedule.event"]} onHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }}><div className="event-trigger-settings"><p className="form-hint">Create a personal secret on the dashboard, then send JSON to this URL with an <code>X-Workflow-Trigger</code> header. JSON keys must match the workflow inputs declared on the left.</p><label>Trigger secret name<input value={String(current.data.config.event_secret ?? "")} onChange={(event) => update({ config: { ...current.data.config, event_secret: event.target.value || undefined } })} placeholder="CHAT_TRIGGER_TOKEN" /></label><code className="event-trigger-url">POST http://127.0.0.1:8010/api/workflows/{id}/events/{String(current.data.config.event_name ?? "chat-message")}</code><pre className="event-trigger-example">{`{\n  "conversation_id": "conv_123",\n  "message": "Hello Circuit",\n  "history": []\n}`}</pre></div></Field>}
              <Field helpMode={helpMode} topic={fieldHelp["inspector.delete"]} onHelp={(topic, position) => { setHelpTopic(topic); setHelpPosition(position); }}>
              <button
                className="delete-button"
                onClick={() =>
                  (() => {
                    pushUndo();
                    const deletedNodeId = current.id;
                    setNodes((all) => all.filter((node) => node.id !== deletedNodeId));
                    setEdges((all) => all.filter((edge) => edge.source !== deletedNodeId && edge.target !== deletedNodeId));
                    setSelected(null);
                  })()
                }
              >
                Delete block
              </button>
              </Field>
            </>
          ) : (
            <div className="inspector-empty">
              <Bot size={26} />
              <strong>Select a block</strong>
            </div>
          )}
        </aside>
        {showCopilot && <div onClickCapture={(event) => { if (helpMode) { event.preventDefault(); event.stopPropagation(); setHelpTopic(panelHelp.copilot); setHelpPosition({ x: event.clientX, y: event.clientY }); } }}><CopilotBlade workflowId={id} selectedNodeId={selected} latestRun={runResult} onClose={() => setShowCopilot(false)} onApply={applyProposal} onLoadingChange={setCopilotThinking} /></div>}
      </section>
      <footer className="run-strip">
        <span className="run-indicator">
          <Cloud size={14} /> Atlas connected
        </span>
        <span>{notice || "Save to persist. Run to inspect execution."}</span>
        <button className="history-button" type="button" onClick={() => setShowRunHistory((open) => !open)}>
          <History size={14} /> History{runHistory.length ? ` (${runHistory.length})` : ""}
        </button>
      </footer>
      {showRunHistory && <aside className="run-history-panel">
        <div className="run-history-heading">
          <strong>Run history</strong>
          <div>
            {runHistory.length > 0 && <button className="text-button" type="button" onClick={() => { setRunHistory([]); window.localStorage.removeItem(`workflow-run-history:${workflowId}`); }}>Clear</button>}
            <button className="icon-button" type="button" title="Close run history" onClick={() => setShowRunHistory(false)}><X size={16} /></button>
          </div>
        </div>
        {runHistory.length === 0 ? <p className="run-history-empty">Completed runs will appear here.</p> : <div className="run-history-list">
          {runHistory.map((entry) => <button className="run-history-item" type="button" key={entry.id} onClick={() => { setRunResult(entry); setShowRunHistory(false); }}>
            <span className={`run-history-status ${entry.status}`} />
            <span className="run-history-summary"><strong>{new Date(entry.startedAt).toLocaleString()}</strong><small>{entry.status === "completed" ? "Completed" : "Finished with errors"} · {entry.durationMs} ms</small></span>
            <span className="run-history-count">{entry.trace.filter((event) => event.status === "completed").length} steps</span>
          </button>)}
        </div>}
      </aside>}
      {runResult && <section className="run-results"><div className="run-results-heading"><strong>Execution results</strong><button className="icon-button" title="Close execution results" onClick={() => setRunResult(null)}><X size={16} /></button></div>{currentProposal && <div className="agent-proposal"><strong>ErrAgent proposal</strong><p>{currentProposal.summary}</p>{currentProposal.findings?.length ? <ul>{currentProposal.findings.map((finding, index) => <li key={index}>{finding.message}</li>)}</ul> : null}<div className="agent-proposal-actions"><button className="apply-proposal" type="button" disabled={applyingProposal} onClick={() => void applyRunProposal(currentProposal)}>{applyingProposal ? "Applying..." : "Approve & apply"}</button><button className="text-button" type="button" onClick={() => setRunResult(null)}>Dismiss</button></div></div>}<div className="run-trace-output"><strong>Execution trace</strong>{runResult.trace.filter((event) => event.status !== "started").map((event, index) => <TraceStep key={`${event.node_id}-${event.timestamp}-${index}`} event={event} received={runResult.trace.find((started) => started.node_id === event.node_id && started.status === "started")?.received} expanded={expandedTraceSteps.has(`${event.node_id}-${index}`)} onToggle={() => setExpandedTraceSteps((current) => { const next = new Set(current); const key = `${event.node_id}-${index}`; if (next.has(key)) next.delete(key); else next.add(key); return next; })} />)}</div><div className="run-log-output"><strong>Full run log</strong><pre>{runResult.context.logs.length > 0 ? runResult.context.logs.join("\n") : "No log entries were returned for this run."}</pre></div><div className="run-final-output"><strong>Final outputs</strong><pre>{formatRunJson(runResult.context.outputs)}</pre>{runResult.context.errors.length > 0 && <><strong>Errors</strong><pre className="run-errors">{runResult.context.errors.join("\n")}</pre></>}</div></section>}
      {showRunInputs && <RunInputsDialog inputs={inputs} onClose={() => setShowRunInputs(false)} onSubmit={(values) => { setShowRunInputs(false); void run(values); }} />}
      {helpMode && helpTopic && <HelpPanel topic={helpTopic} position={helpPosition} onClose={() => setHelpTopic(null)} />}
    </main>
  );
}
export default function App() {
  const [workflowId, setWorkflowId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("workflow"));
  if (!workflowId) return <Dashboard onOpen={setWorkflowId} onCreate={setWorkflowId} />;
  return <ReactFlowProvider><Editor workflowId={workflowId} onBack={() => setWorkflowId(null)} /></ReactFlowProvider>;
}
