from collections.abc import Callable
from typing import Any


def run_with_retries(fn: Callable[[], Any], max_retries: int = 2) -> dict[str, Any]:
    """Invoke fn() with up to max_retries retries on Exception.

    Returns {'status': 'ok', 'result': ..., 'attempts': int}
    or {'status': 'failed', 'error': str, 'attempts': int}.
    """
    attempts = 0
    # Negative retry counts cannot provide fewer than the initial attempt.
    retries = max(0, max_retries)
    while attempts <= retries:
        attempts += 1
        try:
            return {"status": "ok", "result": fn(), "attempts": attempts}
        except Exception as exc:
            if attempts > retries:
                return {"status": "failed", "error": str(exc), "attempts": attempts}

    # The loop always returns from either the success or failure path.
    raise RuntimeError("retry loop terminated unexpectedly")
