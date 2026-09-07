import { useState } from "react";
import { CirclePlay, X } from "lucide-react";
import type { WorkflowInput } from "../editorTypes";

export function RunInputsDialog({ inputs, onSubmit, onClose }: { inputs: WorkflowInput[]; onSubmit: (values: Record<string, unknown>) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const submit = () => {
    if (inputs.some((input) => input.required && (values[input.key] === undefined || values[input.key] === ""))) {
      setError("Complete every required input.");
      return;
    }
    onSubmit(values);
  };
  return <div className="run-modal-backdrop"><section className="run-modal"><div className="panel-heading"><span>Run inputs</span><button className="icon-button" onClick={onClose}><X size={16} /></button></div>{inputs.map((input) => <label key={input.key}>{input.label}{input.required && " *"}{input.type === "boolean" ? <input type="checkbox" checked={Boolean(values[input.key])} onChange={(event) => setValues({ ...values, [input.key]: event.target.checked })} /> : <input type={input.type === "number" ? "number" : "text"} value={String(values[input.key] ?? "")} onChange={(event) => setValues({ ...values, [input.key]: input.type === "number" && event.target.value ? Number(event.target.value) : event.target.value })} />}</label>)}{error && <span className="field-error">{error}</span>}<button className="run-button" onClick={submit}><CirclePlay size={17} /> Run workflow</button></section></div>;
}
