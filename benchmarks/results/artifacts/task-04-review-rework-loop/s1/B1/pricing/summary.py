from typing import Iterable
from decimal import Decimal, ROUND_HALF_UP


def summarize(values: Iterable[float]) -> dict[str, float | int]:
    """Return count, total, and average rounded to cents for values."""
    total = Decimal("0")
    count = 0

    for value in values:
        # Converting through str preserves Decimal values and avoids binary
        # floating-point artifacts when cent rounding is applied.
        total += Decimal(str(value))
        count += 1

    if count == 0:
        return {"count": 0, "total": 0.0, "average": 0.0}

    cents = Decimal("0.01")
    rounded_total = total.quantize(cents, rounding=ROUND_HALF_UP)
    rounded_average = (total / count).quantize(cents, rounding=ROUND_HALF_UP)
    return {
        "count": count,
        "total": float(rounded_total),
        "average": float(rounded_average),
    }
