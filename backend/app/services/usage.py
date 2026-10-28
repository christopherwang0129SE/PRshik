"""Per-request LLM usage meter (tokens, calls, cache hits, estimated $)."""
from __future__ import annotations

from dataclasses import dataclass

from app.config import settings
from app.services.nemotron import estimate_cost_usd


@dataclass
class UsageMeter:
    llm_calls: int = 0
    cache_hits: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    cached_llm_calls: int = 0
    cached_tokens: int = 0
    cached_cost_usd: float = 0.0

    def record_call(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.llm_calls += 1
        self.prompt_tokens += int(prompt_tokens)
        self.completion_tokens += int(completion_tokens)

    def record_cache_hit(self, *, calls: int = 0, tokens: int = 0, cost_usd: float = 0.0) -> None:
        self.cache_hits += 1
        self.cached_llm_calls += calls
        self.cached_tokens += tokens
        self.cached_cost_usd += cost_usd

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    @property
    def estimated_cost_usd(self) -> float:
        return estimate_cost_usd(self.prompt_tokens, self.completion_tokens)

    def summary_fields(self) -> dict:
        return {
            "cached_llm_calls": self.cached_llm_calls,
            "cached_tokens": self.cached_tokens,
            "cached_cost_usd": self.cached_cost_usd,
            "model": settings.nebius_model,
            "llm_calls": self.llm_calls,
            "cache_hits": self.cache_hits,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost_usd": self.estimated_cost_usd,
            "input_usd_per_1m": settings.nemotron_input_usd_per_1m,
            "output_usd_per_1m": settings.nemotron_output_usd_per_1m,
        }
