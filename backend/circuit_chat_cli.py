"""Headless chat client for an event-triggered Circuit workflow."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import httpx


DEFAULT_API_URL = os.getenv("CIRCUIT_API_URL", "http://127.0.0.1:8010")
# Cloud backend option
CLOUD_API_URL = "https://circut-1tw3.onrender.com"
DEFAULT_EVENT_NAME = "chat-message"
MAX_HISTORY_MESSAGES = 20


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Chat with a Circuit workflow through its event trigger."
    )
    parser.add_argument(
        "--workflow-id",
        default=os.getenv("CIRCUIT_WORKFLOW_ID"),
        help="Circuit workflow ID, or CIRCUIT_WORKFLOW_ID.",
    )
    parser.add_argument(
        "--trigger-secret",
        default=os.getenv("CIRCUIT_TRIGGER_SECRET"),
        help="Schedule trigger secret, or CIRCUIT_TRIGGER_SECRET.",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("CIRCUIT_API_URL", DEFAULT_API_URL),
        help=f"Circuit API base URL, or CIRCUIT_API_URL. Default: {DEFAULT_API_URL}",
    )
    parser.add_argument(
        "--event-name",
        default=os.getenv("CIRCUIT_EVENT_NAME", DEFAULT_EVENT_NAME),
        help=f"Event trigger name, or CIRCUIT_EVENT_NAME. Default: {DEFAULT_EVENT_NAME}",
    )
    parser.add_argument(
        "--conversation-id",
        default=os.getenv("CIRCUIT_CONVERSATION_ID", "cli-session"),
        help="Conversation ID, or CIRCUIT_CONVERSATION_ID.",
    )
    parser.add_argument(
        "--once",
        metavar="MESSAGE",
        help="Send one message and exit instead of opening an interactive prompt.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        help="HTTP timeout in seconds. Default: 90.",
    )
    return parser


def require_configuration(args: argparse.Namespace) -> None:
    missing = [
        name
        for name, value in (
            ("--workflow-id / CIRCUIT_WORKFLOW_ID", args.workflow_id),
            ("--trigger-secret / CIRCUIT_TRIGGER_SECRET", args.trigger_secret),
        )
        if not value
    ]
    if missing:
        raise SystemExit("Missing required configuration: " + ", ".join(missing))


def event_url(api_url: str, workflow_id: str, event_name: str) -> str:
    return f"{api_url.rstrip('/')}/api/workflows/{workflow_id}/events/{event_name}"


def extract_message(response_body: Any) -> str:
    if isinstance(response_body, dict):
        for key in ("message", "response", "text", "content"):
            value = response_body.get(key)
            if isinstance(value, str):
                return value
    return json.dumps(response_body, indent=2, ensure_ascii=False)


def send_message(
    client: httpx.Client,
    args: argparse.Namespace,
    history: list[dict[str, str]],
    message: str,
) -> tuple[str, list[dict[str, str]]]:
    request_body = {
        "conversation_id": args.conversation_id,
        "message": message,
        "history": json.dumps(history[-MAX_HISTORY_MESSAGES:], ensure_ascii=False),
    }
    response = client.post(
        event_url(args.api_url, args.workflow_id, args.event_name),
        headers={
            "X-Workflow-Trigger": args.trigger_secret,
            "Content-Type": "application/json",
        },
        json=request_body,
    )
    try:
        response_body = response.json()
    except ValueError:
        response_body = response.text
    if response.is_error:
        detail = response_body.get("detail", response_body) if isinstance(response_body, dict) else response_body
        raise RuntimeError(f"Circuit returned HTTP {response.status_code}: {detail}")

    answer = extract_message(response_body)
    next_history = [*history, {"role": "user", "content": message}, {"role": "assistant", "content": answer}]
    return answer, next_history[-MAX_HISTORY_MESSAGES:]


def run_once(args: argparse.Namespace, message: str) -> int:
    history: list[dict[str, str]] = []
    with httpx.Client(timeout=args.timeout) as client:
        answer, _ = send_message(client, args, history, message)
    print(answer)
    return 0


def run_interactive(args: argparse.Namespace) -> int:
    history: list[dict[str, str]] = []
    print("Circuit chat CLI. Type /exit to quit or /clear to reset history.")
    with httpx.Client(timeout=args.timeout) as client:
        while True:
            try:
                message = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return 0
            if not message:
                continue
            if message.lower() in {"/exit", "/quit"}:
                return 0
            if message.lower() == "/clear":
                history.clear()
                print("Conversation history cleared.")
                continue
            try:
                answer, history = send_message(client, args, history, message)
            except (httpx.HTTPError, RuntimeError) as error:
                print(f"error> {error}", file=sys.stderr)
                continue
            print(f"assistant> {answer}")


def main() -> int:
    args = build_parser().parse_args()
    require_configuration(args)
    if args.once is not None:
        try:
            return run_once(args, args.once)
        except (httpx.HTTPError, RuntimeError) as error:
            print(f"error> {error}", file=sys.stderr)
            return 1
    return run_interactive(args)


if __name__ == "__main__":
    raise SystemExit(main())
