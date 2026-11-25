from typing import Iterable
from decimal import Decimal, ROUND_HALF_UP


def summarize(values: Iterable[float]) -> dict[str, float | int]:
    """Return count, total, and average rounded to cents for values."""
    total = Decimal("0")
    count = 0
    for value in values:
        try:
            item = Decimal(str(value))
        except (ValueError, TypeError, ArithmeticError) as exc:
            raise ValueError("values must be numeric") from exc
        if not item.is_finite():
            raise ValueError("values must be finite")
        total += item
        count += 1

    cent = Decimal("0.01")
    rounded_total = total.quantize(cent, rounding=ROUND_HALF_UP)
    average = (total / count if count else Decimal("0")).quantize(
        cent, rounding=ROUND_HALF_UP
    )
    return {"count": count, "total": float(rounded_total), "average": float(average)}
