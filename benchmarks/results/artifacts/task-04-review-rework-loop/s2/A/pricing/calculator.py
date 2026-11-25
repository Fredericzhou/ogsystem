from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def apply_discount(amount: float, rate: float) -> float:
    """Return amount after a percentage discount, rounded to cents.

    amount must be non-negative and rate must be between 0 and 1 inclusive.
    Raise ValueError for invalid inputs. Rounding is decimal half-up.
    """
    try:
        amount_decimal = Decimal(str(amount))
        rate_decimal = Decimal(str(rate))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("amount and rate must be numeric") from None

    if (
        not amount_decimal.is_finite()
        or not rate_decimal.is_finite()
        or amount_decimal < 0
        or not 0 <= rate_decimal <= 1
    ):
        raise ValueError("amount must be non-negative and rate must be between 0 and 1")

    discounted = amount_decimal * (Decimal("1") - rate_decimal)
    return float(discounted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
