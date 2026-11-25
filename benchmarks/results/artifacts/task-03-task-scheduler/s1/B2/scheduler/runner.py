from collections.abc import Callable
from typing import Any


def run_with_retries(fn: Callable[[], Any], max_retries: int = 2) -> dict[str, Any]:
    """Invoke fn() with up to max_retries retries on Exception.

    Returns {'status': 'ok', 'result': ..., 'attempts': int}
    or {'status': 'failed', 'error': str, 'attempts': int}.
    """
    retries = max(0, max_retries)
    attempts = 0
    last_error: Exception | None = None

    for _ in range(retries + 1):
        attempts += 1
        try:
            return {"status": "ok", "result": fn(), "attempts": attempts}
        except Exception as exc:
            last_error = exc

    return {"status": "failed", "error": str(last_error), "attempts": attempts}
