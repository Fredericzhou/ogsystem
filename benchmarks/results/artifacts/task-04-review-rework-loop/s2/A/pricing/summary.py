from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable


def summarize(values: Iterable[float]) -> dict[str, float | int]:
    """Return count, total, and average rounded to cents for values."""
    total = Decimal("0")
    count = 0
    for value in values:
        total += Decimal(str(value))
        count += 1

    rounded_total = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    average = total / count if count else Decimal("0")
    rounded_average = average.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "count": count,
        "total": float(rounded_total),
        "average": float(rounded_average),
    }
