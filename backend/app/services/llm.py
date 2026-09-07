import logging
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI

from ..config import Settings

logger = logging.getLogger(__name__)


def response_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block["text"]
            for block in content
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
        )
    return str(content)


class GoogleFlashModel:
    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.google_api_key
        self._models: dict[tuple[str, float, int | None], ChatGoogleGenerativeAI] = {}

    def get(
        self, model_name: str, temperature: float, max_tokens: int | None
    ) -> ChatGoogleGenerativeAI:
        if not self._api_key:
            raise ValueError("LLM nodes require GOOGLE_API_KEY to be configured")
        cache_key = (model_name, temperature, max_tokens)
        if cache_key not in self._models:
            logger.info("initializing Google LLM model=%s", model_name)
            self._models[cache_key] = ChatGoogleGenerativeAI(
                model=model_name,
                google_api_key=self._api_key,
                temperature=temperature,
                max_output_tokens=max_tokens,
            )
        return self._models[cache_key]