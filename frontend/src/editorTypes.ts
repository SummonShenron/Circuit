import type { Node } from "@xyflow/react";

export type Kind = "llm" | "api" | "condition" | "transform" | "variable" | "repeat_until" | "for_each" | "github_repository" | "resend_email" | "google_drive" | "schedule" | "google_drive_update" | "google_drive_read" | "weather_forecast" | "news_headlines" | "google_sheets_append" | "csv_create" | "rss_feed" | "webhook_post" | "http_response" | "mongodb" | "mongodb_vector_search" | "gmail_send" | "reddit_headlines" | "google_calendar" | "github_action" | "job_search" | "erragent" | "file_upload" | "current_datetime";
export type Status = "idle" | "running" | "completed" | "failed";
export type Data = { label: string; kind: Kind; config: Record<string, unknown>; status: Status };
export type FlowNode = Node<Data, "workflow">;
export type Stored = { id: string; name: string; graph: { nodes: Array<{ id: string; type: Kind; label: string; position: { x: number; y: number }; config: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; source_handle?: string | null; label?: string | null }> } };
export type Variable = { token: string; label: string; detail: string };
export type RunResult = { context: { inputs: Record<string, unknown>; outputs: Record<string, unknown>; logs: string[]; errors: string[] }; trace: Array<{ node_id: string; node_label: string; status: "started" | "completed" | "failed"; message: string; timestamp: string; received?: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }; output?: unknown }> };
export type WorkflowPatchProposal = { status?: string; summary: string; findings?: Array<{ severity?: string; message?: string }>; patch: Proposal["patch"]; requires_approval?: boolean };
export type WorkflowInput = { key: string; label: string; type: "string" | "number" | "boolean" | "file"; required: boolean };
export type StoredConnection = { id: string; provider: "google_calendar" | "github"; display_name: string; account_email: string | null };
export type Proposal = { summary: string; valid: boolean; errors: string[]; patch: { add_inputs?: WorkflowInput[]; add_nodes: Array<{ id: string; type: Kind; label: string; position: { x: number; y: number }; config: Record<string, unknown> }>; update_nodes: Array<{ id: string; label?: string; config?: Record<string, unknown> }>; add_edges: Array<{ id: string; source: string; target: string; source_handle?: string | null; label?: string | null }> } };
export type HelpTopic = { title: string; what: string; when: string; example: string };
