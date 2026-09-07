from typing import Any


CONNECTORS: list[dict[str, Any]] = [
    {
        "name": "Google Calendar",
        "keywords": ["google calendar", "calendar", "event", "meeting"],
        "source_url": "https://developers.google.com/calendar/api/v3/reference/events/insert",
        "method": "POST",
        "url": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        "authentication": "OAuth 2.0 Bearer token with calendar.events scope",
        "headers": {"Content-Type": "application/json"},
        "body": {"summary": "{{input.title}}", "description": "{{input.description}}", "start": {"dateTime": "{{input.start_time}}"}, "end": {"dateTime": "{{input.end_time}}"}},
    },
    {
        "name": "Google Drive",
        "keywords": ["google drive", "drive", "upload file", "create file"],
        "source_url": "https://developers.google.com/drive/api/v3/reference/files/create",
        "method": "POST",
        "url": "https://www.googleapis.com/drive/v3/files",
        "authentication": "OAuth 2.0 Bearer token with drive.file scope",
        "headers": {"Content-Type": "application/json"},
        "body": {"name": "{{input.file_name}}", "mimeType": "text/plain"},
    },
    {
        "name": "Gmail",
        "keywords": ["gmail", "email", "send email", "mail"],
        "source_url": "https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send",
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        "authentication": "OAuth 2.0 Bearer token with gmail.send scope",
        "headers": {"Content-Type": "application/json"},
        "body": {"raw": "Base64url-encoded RFC 2822 email message"},
    },
    {
        "name": "Slack",
        "keywords": ["slack", "chat message", "channel"],
        "source_url": "https://api.slack.com/methods/chat.postMessage",
        "method": "POST",
        "url": "https://slack.com/api/chat.postMessage",
        "authentication": "Bearer token with chat:write scope",
        "headers": {"Content-Type": "application/json"},
        "body": {"channel": "{{input.channel}}", "text": "{{writer.response}}"},
    },
    {
        "name": "GitHub Issues",
        "keywords": ["github", "issue", "repository"],
        "source_url": "https://docs.github.com/rest/issues/issues#create-an-issue",
        "method": "POST",
        "url": "https://api.github.com/repos/{{input.owner}}/{{input.repo}}/issues",
        "authentication": "Bearer token with issues write permission",
        "headers": {"Accept": "application/vnd.github+json"},
        "body": {"title": "{{input.title}}", "body": "{{writer.response}}"},
    },
    {
        "name": "Discord Webhook",
        "keywords": ["discord", "webhook"],
        "source_url": "https://discord.com/developers/docs/resources/webhook",
        "method": "POST",
        "url": "{{input.webhook_url}}",
        "authentication": "Webhook URL secret",
        "headers": {"Content-Type": "application/json"},
        "body": {"content": "{{writer.response}}"},
    },
    {
        "name": "Generic Webhook",
        "keywords": ["webhook", "http", "api"],
        "source_url": "https://www.rfc-editor.org/rfc/rfc9110",
        "method": "POST",
        "url": "{{input.webhook_url}}",
        "authentication": "Provider-specific",
        "headers": {"Content-Type": "application/json"},
        "body": {"message": "{{writer.response}}"},
    },
]


def search_connectors(query: str) -> list[dict[str, Any]]:
    normalized_query = query.lower()
    return [connector for connector in CONNECTORS if any(keyword in normalized_query for keyword in connector["keywords"])]