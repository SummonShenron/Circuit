import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import type { Proposal } from "../editorTypes";
import "./CopilotBlade.css";

const API = "http://127.0.0.1:8010/api";

export function CopilotBlade({ workflowId, selectedNodeId, latestRun, onClose, onApply, onLoadingChange }: { workflowId: string | null; selectedNodeId: string | null; latestRun: unknown; onClose: () => void; onApply: (proposal: Proposal) => void; onLoadingChange: (loading: boolean) => void }) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, proposal]);
  const send = async () => {
    if (!draft.trim() || !workflowId || loading) return;
    const message = draft.trim();
    setDraft(""); setMessages((items) => [...items, { role: "user", content: message }]); setLoading(true); onLoadingChange(true);
    try {
      const response = await fetch(`${API}/workflows/${workflowId}/copilot/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, selected_node_id: selectedNodeId, latest_run: latestRun, conversation: messages.slice(-20) }) });
      const body = await response.json() as { message?: string; detail?: string | Array<{ msg?: string }>; proposal?: Proposal };
      const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg ?? "Invalid Copilot request").join("; ") : body.detail;
      setMessages((items) => [...items, { role: "assistant", content: response.ok ? body.message ?? "I could not respond." : detail ?? "Copilot request failed." }]);
      if (response.ok) setProposal(body.proposal ?? null);
    } finally { setLoading(false); onLoadingChange(false); }
  };
  return <aside className="copilot-blade"><div className="copilot-heading"><span><Sparkles size={16} /> Workflow Copilot</span><button className="icon-button" onClick={onClose}><X size={16} /></button></div><p className="copilot-context">{selectedNodeId ? `Focused on ${selectedNodeId}` : "Ask about this workflow"}</p><div className="copilot-messages">{messages.map((message, index) => <p className={`copilot-message ${message.role}`} key={index}>{message.content}</p>)}{proposal && <section className={`proposal-card ${proposal.valid ? "valid" : "invalid"}`}><strong>{proposal.summary}</strong>{proposal.valid ? <button className="apply-proposal" onClick={() => { onApply(proposal); setProposal(null); }}>Apply proposal</button> : proposal.errors.map((error) => <span key={error}>{error}</span>)}</section>}{loading && <p className="copilot-message assistant">Thinking...</p>}<div ref={messagesEndRef} /></div><div className="copilot-compose"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask how to build this flow..." rows={3} /><button className="icon-button" onClick={() => void send()} disabled={loading} title="Send message"><Send size={17} /></button></div></aside>;
}
