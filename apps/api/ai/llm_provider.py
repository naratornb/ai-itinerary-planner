"""
llm_provider.py — Centralised LLM Provider Interface
======================================================
Single point of entry for all LLM calls across the 4 AI modules.
No other module should import anthropic or google.genai directly.

Provider selection (in priority order):
  1. GEMINI_API_KEY set   → uses Gemini 3.1 Flash-Lite (default)
  2. ANTHROPIC_API_KEY set → uses Claude Sonnet

Usage:
    from llm_provider import call_llm

    response = call_llm(
        system_prompt="You are a travel assistant...",
        user_prompt="Plan a 5 day trip to Japan",
        max_tokens=1000,
    )
    print(response.text)       # raw string
    print(response.tokens_in)  # input tokens used
    print(response.tokens_out) # output tokens used
"""

import os
import json
from dataclasses import dataclass
from urllib import request as urlrequest, error as urlerror

# ── Configuration ──────────────────────────────────────────────────────────────
GEMINI_MODEL    = os.environ.get("GEMINI_MODEL",    "gemini-2.5-flash")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.1"))


# ── Response object ────────────────────────────────────────────────────────────
@dataclass
class LLMResponse:
    text:       str
    provider:   str
    model:      str
    tokens_in:  int
    tokens_out: int

    @property
    def total_tokens(self) -> int:
        return self.tokens_in + self.tokens_out


# ── Gemini (REST, no SDK needed) ───────────────────────────────────────────────
def _call_gemini(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int
) -> LLMResponse:

    api_key = os.environ.get("GEMINI_API_KEY", "")
    model = GEMINI_MODEL

    if not api_key:
        raise EnvironmentError("GEMINI_API_KEY is not set")

    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )

    payload = {
        "system_instruction": {
            "parts": [
                {"text": system_prompt}
            ]
        },
        "contents": [
            {
                "parts": [
                    {"text": user_prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": LLM_TEMPERATURE,
            "maxOutputTokens": max_tokens,
        },
    }

    req = urlrequest.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlrequest.urlopen(req, timeout=120) as resp:
            data = json.loads(
                resp.read().decode("utf-8")
            )

    except urlerror.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Gemini HTTP {e.code}: {body}"
        ) from e

    except urlerror.URLError as e:
        raise RuntimeError(
            f"Gemini network error: {e.reason}"
        ) from e

    except TimeoutError as e:
        raise RuntimeError(
            "Gemini request timed out after 120 seconds"
        ) from e

    candidates = data.get("candidates", [])

    if not candidates:
        raise RuntimeError(
            f"Gemini returned no candidates: {data}"
        )

    try:
        text = (
            candidates[0]
            ["content"]
            ["parts"][0]
            ["text"]
            .strip()
        )
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(
            f"Unexpected Gemini response: {data}"
        ) from e

    usage = data.get("usageMetadata", {})

    tokens_in = usage.get(
        "promptTokenCount", 0
    )

    tokens_out = usage.get(
        "candidatesTokenCount", 0
    )

    return LLMResponse(
        text=text,
        provider="gemini",
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
# ── Anthropic Claude ───────────────────────────────────────────────────────────
def _call_anthropic(system_prompt: str, user_prompt: str, max_tokens: int) -> LLMResponse:
    import anthropic  # only imported when actually needed

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    model   = ANTHROPIC_MODEL
    client  = anthropic.Anthropic(api_key=api_key)

    message = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    text       = message.content[0].text.strip()
    tokens_in  = message.usage.input_tokens
    tokens_out = message.usage.output_tokens

    return LLMResponse(
        text=text, provider="anthropic", model=model,
        tokens_in=tokens_in, tokens_out=tokens_out,
    )


# ── Public interface ───────────────────────────────────────────────────────────
def call_llm(
    system_prompt: str,
    user_prompt:   str,
    max_tokens:    int = 1000,
) -> LLMResponse:
    """
    Call the configured LLM and return an LLMResponse.

    Provider priority:
      GEMINI_API_KEY set    → Gemini (default, cheaper)
      ANTHROPIC_API_KEY set → Claude (fallback)

    Raises:
      EnvironmentError  — no API key configured
      RuntimeError      — LLM call failed after all retries
    """
    gemini_key    = os.environ.get("GEMINI_API_KEY",    "")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if gemini_key:
        try:
            return _call_gemini(system_prompt, user_prompt, max_tokens)
        except Exception as e:
            if anthropic_key:
                print(f"[llm_provider] Gemini failed ({e}), falling back to Claude")
            else:
                raise RuntimeError(f"Gemini call failed: {e}") from e

    if anthropic_key:
        try:
            return _call_anthropic(system_prompt, user_prompt, max_tokens)
        except Exception as e:
            raise RuntimeError(f"Anthropic call failed: {e}") from e

    raise EnvironmentError(
        "No LLM API key configured. "
        "Set GEMINI_API_KEY for Gemini or ANTHROPIC_API_KEY for Claude."
    )


# ── JSON helper: strip fences and trailing commas ─────────────────────────────
def parse_json_response(raw_text: str) -> dict:
    """
    Parse an LLM JSON response defensively.
    Handles markdown fences and trailing commas (a known Gemini quirk).
    Raises json.JSONDecodeError if the text is genuinely not JSON.
    """
    import re
    clean = re.sub(r"```(?:json)?", "", raw_text).strip().strip("`").strip()
    clean = re.sub(r",(\s*[}\]])", r"\1", clean)   # remove trailing commas
    return json.loads(clean)


# ── Convenience: provider name for logging ────────────────────────────────────
def active_provider() -> str:
    """Return which provider will be used given current environment."""
    if os.environ.get("GEMINI_API_KEY"):
        return f"gemini / {GEMINI_MODEL}"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return f"anthropic / {ANTHROPIC_MODEL}"
    return "none — no API key set"


# ── Smoke test (run this file directly to verify) ─────────────────────────────
if __name__ == "__main__":
    print(f"Active provider: {active_provider()}")
    resp = call_llm(
        system_prompt="You are a helpful assistant. Reply in one sentence.",
        user_prompt="Say hello.",
        max_tokens=50,
    )
    print(f"Response: {resp.text}")
    print(f"Tokens: {resp.tokens_in} in / {resp.tokens_out} out")
