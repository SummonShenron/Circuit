import { useEffect, useState } from "react";
import type { StoredConnection } from "../editorTypes";

const API = "http://127.0.0.1:8010/api";

function GitHubTokenForm({ onConnected, onCancel }: { onConnected: (connection: StoredConnection) => void; onCancel: () => void }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("GitHub");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const connect = async () => {
    if (!token.trim()) { setError("Enter a GitHub personal access token."); return; }
    setSaving(true);
    try {
      const response = await fetch(`${API}/connections/github`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.trim(), display_name: name }) });
      const body = await response.json() as StoredConnection | { detail?: string };
      if (!response.ok || !("id" in body)) throw new Error("detail" in body ? body.detail ?? "Could not connect GitHub" : "Could not connect GitHub");
      setToken(""); onConnected(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect GitHub"); }
    finally { setSaving(false); }
  };
  return <div className="github-token-form"><label>Connection name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Personal access token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_..." /></label>{error && <span className="field-error">{error}</span>}<div><button className="connect-button" type="button" onClick={() => void connect()} disabled={saving}>{saving ? "Checking..." : "Connect GitHub"}</button><button className="cancel-button" type="button" onClick={onCancel}>Cancel</button></div></div>;
}

export function ConnectionPicker({ value, onChange, returnTo }: { value: string; onChange: (value: string) => void; returnTo?: string }) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [error, setError] = useState("");
  const [showGitHub, setShowGitHub] = useState(false);
  const load = async () => { try { const response = await fetch(`${API}/connections`); if (!response.ok) throw new Error("Could not load connections"); setConnections(await response.json() as StoredConnection[]); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load connections"); } };
  useEffect(() => { void load(); }, []);
  const connectGoogle = async () => { try { const query = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ""; const response = await fetch(`${API}/connections/google/start${query}`, { method: "POST" }); const body = await response.json() as { authorization_url?: string; detail?: string }; if (!response.ok || !body.authorization_url) throw new Error(body.detail ?? "Could not start Google connection"); window.location.assign(body.authorization_url); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start Google connection"); } };
  const disconnect = async () => { if (!value || !window.confirm("Disconnect this Google Workspace account?")) return; const response = await fetch(`${API}/connections/${value}`, { method: "DELETE" }); if (!response.ok) { setError("Could not disconnect the account"); return; } setConnections((items) => items.filter((connection) => connection.id !== value)); onChange(""); };
  return <label>Connection<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">No connection</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.display_name}{connection.account_email ? ` - ${connection.account_email}` : ""}</option>)}</select><button className="connect-button" type="button" onClick={() => void connectGoogle()}>Connect Google Workspace</button><button className="connect-button" type="button" onClick={() => setShowGitHub(true)}>Connect GitHub</button>{showGitHub && <GitHubTokenForm onCancel={() => setShowGitHub(false)} onConnected={(connection) => { setConnections((items) => [...items, connection]); onChange(connection.id); setShowGitHub(false); }} />}{value && <button className="disconnect-button" type="button" onClick={() => void disconnect()}>Disconnect account</button>}{error && <span className="field-error">{error}</span>}</label>;
}
