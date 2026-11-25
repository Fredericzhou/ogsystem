from typing import Iterable
from decimal import Decimal, ROUND_HALF_UP


def summarize(values: Iterable[float]) -> dict[str, float | int]:
    """Return count, total, and average rounded to cents for values."""
    numbers = [Decimal(str(value)) for value in values]
    count = len(numbers)

    if not count:
        return {"count": 0, "total": 0.0, "average": 0.0}

    cents = Decimal("0.01")
    total = sum(numbers, Decimal("0"))
    average = total / count

    return {
        "count": count,
        "total": float(total.quantize(cents, rounding=ROUND_HALF_UP)),
        "average": float(average.quantize(cents, rounding=ROUND_HALF_UP)),
    }
