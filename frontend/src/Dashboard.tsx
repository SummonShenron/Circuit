import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, CloudSun, FilePlus2, GitBranch, KeyRound, Link2, MoreHorizontal, Play, Trash2, Workflow, X, XCircle } from "lucide-react";
import { UserButton } from "@clerk/clerk-react";
import "./Dashboard.css";
import "./DashboardOverrides.css";
import "./DashboardLayoutOverrides.css";
import "./RunHistory.css";
import { getApiUrl } from "./apiConfig";

const API = getApiUrl();

type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  updated_at: string;
  graph: { nodes: unknown[]; edges: unknown[] };
};
type SecretSummary = { name: string; description: string; updated_at: string };
type ConnectionSummary = { id: string; provider: "google_calendar" | "github"; display_name: string; account_email: string | null };
type WorkflowRun = { id: string; workflow_id: string; started_at: string; completed_at: string; duration_ms: number; status: "completed" | "failed"; trigger: "manual" | "schedule" | "event"; context: { inputs: Record<string, unknown>; outputs: Record<string, unknown>; logs: string[]; errors: string[] }; trace: Array<{ node_id: string; node_label: string; status: "started" | "completed" | "failed"; message: string; timestamp: string }> };

type DashboardProps = {
  onOpen: (workflowId: string) => void;
  onCreate: (workflowId: string) => void;
};

export default function Dashboard({ onOpen, onCreate }: DashboardProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretError, setSecretError] = useState("");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubName, setGithubName] = useState("GitHub");
  const [connectingGithub, setConnectingGithub] = useState(false);
  const [openWorkflowMenu, setOpenWorkflowMenu] = useState<string | null>(null);
  const [runHistoryWorkflow, setRunHistoryWorkflow] = useState<WorkflowSummary | null>(null);
  const [runHistory, setRunHistory] = useState<WorkflowRun[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryError, setRunHistoryError] = useState("");
  const [tutorialNotice, setTutorialNotice] = useState("");
  const [showServiceNotice, setShowServiceNotice] = useState(() => window.localStorage.getItem("hideCircuitServiceNotice") !== "1");

  useEffect(() => {
    void (async () => {
      try {
        console.log(`[Dashboard] Fetching workflows from: ${API}`);
        const response = await fetch(`${API}/workflows`);
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Dashboard] Failed to load workflows: ${response.status} ${response.statusText}`, errorText);
          throw new Error(`Failed to load workflows (${response.status}): ${response.statusText}`);
        }
        setWorkflows(await response.json());
        const secretResponse = await fetch(`${API}/secrets`);
        if (secretResponse.ok) setSecrets(await secretResponse.json());
        const connectionResponse = await fetch(`${API}/connections`);
        if (connectionResponse.ok) setConnections(await connectionResponse.json());
      } catch (reason) {
        const errorMsg = reason instanceof Error ? reason.message : "Could not load workflows";
        console.error(`[Dashboard] Error:`, reason);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveSecret = async () => {
    setSecretError("");
    if (!secretName.trim() || !secretValue) { setSecretError("Enter a name and value."); return; }
    const response = await fetch(`${API}/secrets/${encodeURIComponent(secretName.trim())}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: secretName.trim(), value: secretValue }) });
    if (!response.ok) { const body = await response.json() as { detail?: string }; setSecretError(body.detail ?? "Could not save secret"); return; }
    const saved = await response.json() as SecretSummary;
    setSecrets((items) => [...items.filter((item) => item.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)));
    setSecretName(""); setSecretValue("");
  };

  const deleteSecret = async (name: string) => {
    const response = await fetch(`${API}/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (response.ok) setSecrets((items) => items.filter((item) => item.name !== name));
  };

  const connectGoogle = async () => {
    setConnectionError("");
    try {
      const returnTo = `${window.location.origin}/`;
      const response = await fetch(`${API}/connections/google/start?return_to=${encodeURIComponent(returnTo)}`, { method: "POST" });
      const body = await response.json() as { authorization_url?: string; detail?: string };
      if (!response.ok || !body.authorization_url) throw new Error(body.detail ?? "Could not start Google connection");
      window.location.assign(body.authorization_url);
    } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not start Google connection"); }
  };

  const connectGithub = async () => {
    setConnectionError("");
    if (!githubToken.trim()) { setConnectionError("Enter a GitHub personal access token."); return; }
    setConnectingGithub(true);
    try {
      const response = await fetch(`${API}/connections/github`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: githubToken.trim(), display_name: githubName.trim() || "GitHub" }) });
      const body = await response.json() as ConnectionSummary | { detail?: string };
      if (!response.ok || !("id" in body)) throw new Error("detail" in body ? body.detail ?? "Could not connect GitHub" : "Could not connect GitHub");
      setConnections((items) => [...items, body]); setGithubToken("");
    } catch (reason) { setConnectionError(reason instanceof Error ? reason.message : "Could not connect GitHub"); }
    finally { setConnectingGithub(false); }
  };

  const disconnectConnection = async (connection: ConnectionSummary) => {
    if (!window.confirm(`Disconnect ${connection.display_name}?`)) return;
    const response = await fetch(`${API}/connections/${connection.id}`, { method: "DELETE" });
    if (response.ok) setConnections((items) => items.filter((item) => item.id !== connection.id));
    else setConnectionError("Could not disconnect the connection");
  };

  const createWorkflow = async () => {
    try {
      const response = await fetch(`${API}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled workflow", graph: { nodes: [], edges: [] } }),
      });
      if (!response.ok) throw new Error("Could not create workflow");
      const workflow = await response.json() as WorkflowSummary;
      onCreate(workflow.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create workflow");
    }
  };

  const startTutorial = async (tutorial: "chat-assistant" | "routing" | "weather-briefing", workflowName: string) => {
    setTutorialNotice("");
    if (tutorial !== "weather-briefing" && !secrets.some((secret) => secret.name === "CHAT_TRIGGER_TOKEN")) {
      setSecretName("CHAT_TRIGGER_TOKEN");
      setSecretError("Create CHAT_TRIGGER_TOKEN below before starting the tutorial. Use any private value you will remember for testing.");
      document.querySelector(".dashboard-secrets")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    try {
      const response = await fetch(`${API}/workflows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workflowName, graph: { nodes: [], edges: [] } }) });
      if (!response.ok) throw new Error("Could not start tutorial");
      const workflow = await response.json() as WorkflowSummary;
      window.sessionStorage.setItem("circuit-tutorial", tutorial);
      onCreate(workflow.id);
    } catch (reason) {
      setTutorialNotice(reason instanceof Error ? reason.message : "Could not start tutorial");
    }
  };

  const deleteWorkflow = async (workflow: WorkflowSummary) => {
    if (!window.confirm(`Delete ${workflow.name}?`)) return;
    const response = await fetch(`${API}/workflows/${workflow.id}`, { method: "DELETE" });
    if (response.ok) {
      setWorkflows((items) => items.filter((item) => item.id !== workflow.id));
      setOpenWorkflowMenu(null);
    } else {
      setError("Could not delete workflow");
    }
  };

  const openRunHistory = async (workflow: WorkflowSummary) => {
    setOpenWorkflowMenu(null);
    setRunHistoryWorkflow(workflow);
    setRunHistory([]);
    setRunHistoryError("");
    setRunHistoryLoading(true);
    try {
      const response = await fetch(`${API}/workflows/${workflow.id}/runs`);
      const body = await response.json() as WorkflowRun[] | { detail?: string };
      if (!response.ok || !Array.isArray(body)) throw new Error("detail" in body ? body.detail ?? "Could not load run history" : "Could not load run history");
      setRunHistory(body);
    } catch (reason) {
      setRunHistoryError(reason instanceof Error ? reason.message : "Could not load run history");
    } finally {
      setRunHistoryLoading(false);
    }
  };

  return <main className="dashboard-shell">
    <header className="dashboard-topbar"><div className="dashboard-brand"><Workflow size={22} /> Circuit</div><div className="dashboard-actions"><button className="create-workflow" onClick={() => void createWorkflow()}><FilePlus2 size={17} /> New workflow</button>{import.meta.env.VITE_CLERK_PUBLISHABLE_KEY && <UserButton afterSignOutUrl="/" />}</div></header>
    <div className="dashboard-body">
      <section className="dashboard-content"><div className="dashboard-heading"><div className="dashboard-heading-copy"><span>WORKFLOWS</span><h1>Build, run, and improve.</h1><p>Your automations are saved to your workspace and ready to pick up where you left off.</p></div>{showServiceNotice && <aside className="dashboard-service-notice" aria-label="Circuit service notice"><div className="dashboard-service-notice-copy"><strong>Circuit may need a moment</strong><p>The first request after inactivity can be slow while Circuit's backend starts.</p><details><summary>Learn more</summary><p>Circuit runs on cost-sensitive infrastructure and uses third-party LLMs on free tiers. This can cause longer response times or temporary unavailability during peak demand. If the app appears to hang after signing in, wait 30–60 seconds and try again.</p></details></div><button type="button" onClick={() => { setShowServiceNotice(false); window.localStorage.setItem("hideCircuitServiceNotice", "1"); }} aria-label="Dismiss Circuit service notice"><X size={15} /></button></aside>}</div>
      {error && <p className="dashboard-error">{error}</p>}
      <section className="tutorial-card"><div><span>START HERE</span><h2>Guided tutorials</h2><p>Build a chat assistant, connect an API to an LLM, then branch a workflow with a router and condition.</p></div><div className="tutorial-card-actions"><button className="create-workflow" onClick={() => void startTutorial("chat-assistant", "Chat Assistant Tutorial")}><Workflow size={16} /> Chat assistant</button><button className="create-workflow" onClick={() => void startTutorial("routing", "Routing Tutorial")}><GitBranch size={16} /> Routing</button><button className="create-workflow" onClick={() => void startTutorial("weather-briefing", "Weather Briefing Tutorial")}><CloudSun size={16} /> Weather briefing</button></div>{tutorialNotice && <p className="dashboard-error">{tutorialNotice}</p>}</section>
      {loading ? <p className="dashboard-empty">Loading workflows...</p> : workflows.length === 0 ? <section className="dashboard-empty"><Workflow size={28} /><strong>Start with a workflow</strong><span>Create a blank canvas, then connect blocks into an automation.</span><button className="create-workflow" onClick={() => void createWorkflow()}><FilePlus2 size={17} /> New workflow</button></section> : <section className="workflow-grid">{workflows.map((workflow) => <button className="workflow-card" key={workflow.id} onClick={() => onOpen(workflow.id)}><div className="workflow-card-top"><span className="workflow-card-icon"><Workflow size={18} /></span><span className="workflow-card-menu-wrap"><span className="workflow-card-menu-trigger" role="button" tabIndex={0} aria-label={`More options for ${workflow.name}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpenWorkflowMenu((current) => current === workflow.id ? null : workflow.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setOpenWorkflowMenu((current) => current === workflow.id ? null : workflow.id); } }}><MoreHorizontal size={18} /></span>{openWorkflowMenu === workflow.id && <span className="workflow-card-menu" role="menu" onClick={(event) => event.stopPropagation()}><span role="menuitem" tabIndex={0} onClick={() => onOpen(workflow.id)}>Open</span><span role="menuitem" tabIndex={0} onClick={() => void openRunHistory(workflow)}>Run history</span><span role="menuitem" tabIndex={0} onClick={() => void deleteWorkflow(workflow)}>Delete</span></span>}</span></div><strong>{workflow.name}</strong><p>{workflow.description || "No description yet."}</p><div className="workflow-card-meta"><span><Play size={13} /> {workflow.graph.nodes.length} blocks</span><span><Clock3 size={13} /> {new Date(workflow.updated_at).toLocaleDateString()}</span></div></button>)}</section>}</section>
      <section className="dashboard-secrets"><div><span>SECRETS</span><h2>Personal API keys</h2><p>Values are encrypted and never displayed after saving. Use references like <code>{'{"$secret":"WEATHER_API_KEY"}'}</code> in scheduled inputs.</p></div><div className="secret-form"><input value={secretName} onChange={(event) => setSecretName(event.target.value.replace(/[^a-zA-Z0-9_]/g, "_"))} placeholder="WEATHER_API_KEY" /><input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Secret value" autoComplete="new-password" /><button className="create-workflow" onClick={() => void saveSecret()}><KeyRound size={16} /> Save secret</button></div>{secretError && <p className="dashboard-error">{secretError}</p>}<div className="secret-list">{secrets.map((secret) => <div className="secret-row" key={secret.name}><span><KeyRound size={15} /> {secret.name}</span><button className="row-icon" title="Delete secret" onClick={() => void deleteSecret(secret.name)}><Trash2 size={15} /></button></div>)}</div></section>
      <section className="dashboard-connections"><div><span>CONNECTIONS</span><h2>Accounts and services</h2><p>Connect the accounts your workflows are allowed to use. Credentials are stored owner-scoped and encrypted.</p></div><div className="connection-actions"><button className="create-workflow" onClick={() => void connectGoogle()}><Link2 size={16} /> Connect Google Workspace</button><input value={githubName} onChange={(event) => setGithubName(event.target.value)} placeholder="GitHub connection name" /><input type="password" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder="GitHub personal access token" autoComplete="new-password" /><button className="create-workflow" onClick={() => void connectGithub()} disabled={connectingGithub}><GitBranch size={16} /> {connectingGithub ? "Connecting..." : "Connect GitHub"}</button></div>{connectionError && <p className="dashboard-error">{connectionError}</p>}<div className="connection-list">{connections.map((connection) => <div className="connection-row" key={connection.id}><span><Link2 size={15} /> <strong>{connection.display_name}</strong><small>{connection.provider === "google_calendar" ? "Google Workspace" : "GitHub"}{connection.account_email ? ` - ${connection.account_email}` : ""}</small></span><button className="row-icon" title="Disconnect" onClick={() => void disconnectConnection(connection)}><X size={15} /></button></div>)}</div></section>
    </div>
    {runHistoryWorkflow && <div className="run-history-backdrop" role="presentation" onClick={() => setRunHistoryWorkflow(null)}><section className="run-history-modal" role="dialog" aria-modal="true" aria-label={`${runHistoryWorkflow.name} run history`} onClick={(event) => event.stopPropagation()}><div className="run-history-modal-heading"><div><span>RUN HISTORY</span><h2>{runHistoryWorkflow.name}</h2></div><button className="icon-button" type="button" title="Close run history" onClick={() => setRunHistoryWorkflow(null)}><X size={18} /></button></div>{runHistoryLoading ? <p className="dashboard-empty">Loading runs...</p> : runHistoryError ? <p className="dashboard-error">{runHistoryError}</p> : runHistory.length === 0 ? <p className="dashboard-empty">No runs recorded yet.</p> : <div className="run-history-table">{runHistory.map((run) => <article className="run-history-record" key={run.id}><div className="run-history-record-top"><span className={`run-status ${run.status}`}>{run.status === "completed" ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {run.status}</span><strong>{new Date(run.started_at).toLocaleString()}</strong><span>{run.trigger} · {run.duration_ms} ms</span></div><div className="run-history-record-trace">{run.trace.filter((event) => event.status !== "started").map((event, index) => <span className={event.status} key={`${event.node_id}-${index}`}>{event.node_label}: {event.message}</span>)}</div>{run.context.errors.length > 0 && <pre className="run-history-record-errors">{run.context.errors.join("\n")}</pre>}</article>)}</div>}</section></div>}
  </main>;
}