from collections.abc import Callable
from typing import Any


def run_with_retries(fn: Callable[[], Any], max_retries: int = 2) -> dict[str, Any]:
    """Invoke fn() with up to max_retries retries on Exception.

    Returns {'status': 'ok', 'result': ..., 'attempts': int}
    or {'status': 'failed', 'error': str, 'attempts': int}.
    """
    retries_left = max(0, max_retries)
    attempts = 0
    while True:
        attempts += 1
        try:
            return {"status": "ok", "result": fn(), "attempts": attempts}
        except Exception as exc:
            if retries_left == 0:
                return {"status": "failed", "error": str(exc), "attempts": attempts}
            retries_left -= 1
