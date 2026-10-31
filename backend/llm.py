"""Thin, resilient client for the Groq chat-completions API (OpenAI-compatible, JSON mode)."""
import json
import os
import re
import time
from typing import Any

import httpx

BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")


class LLMError(Exception):
    pass


def llm_available() -> bool:
    return bool(os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY"))


def _extract_json(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def chat_json(system: str, user: str, temperature: float = 0.1, retries: int = 3) -> dict[str, Any]:
    """Call the model in JSON mode with retry/backoff on rate limits and bad JSON."""
    key = os.getenv("GROQ_API_KEY") or os.getenv("LLM_API_KEY")
    if not key:
        raise LLMError("No API key configured (set GROQ_API_KEY)")

    payload = {
        "model": MODEL,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    last_err: Exception | None = None

    for attempt in range(retries):
        try:
            r = httpx.post(f"{BASE_URL}/chat/completions", json=payload, headers=headers, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(1.5 * (attempt + 1))
                last_err = LLMError(f"HTTP {r.status_code}: {r.text[:200]}")
                continue
            if r.status_code >= 400:
                raise LLMError(f"HTTP {r.status_code}: {r.text[:300]}")
            content = r.json()["choices"][0]["message"]["content"]
            return _extract_json(content)
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as e:
            last_err = e
            time.sleep(1.0 * (attempt + 1))
    raise LLMError(f"LLM call failed after {retries} attempts: {last_err}")
