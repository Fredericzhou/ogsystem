from decimal import Decimal, ROUND_HALF_UP


def apply_discount(amount: float, rate: float) -> float:
    """Return amount after a percentage discount, rounded to cents.

    amount must be non-negative and rate must be between 0 and 1 inclusive.
    Raise ValueError for invalid inputs. Rounding is decimal half-up.
    """
    # Convert through text so a float such as 2.675 retains its user-facing
    # decimal value instead of its binary representation during rounding.
    values = []
    for value in (amount, rate):
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise ValueError("amount and rate must be numeric")
        try:
            decimal_value = Decimal(str(value))
        except (ValueError, TypeError):
            raise ValueError("amount and rate must be numeric") from None
        if not decimal_value.is_finite():
            raise ValueError("amount and rate must be finite")
        values.append(decimal_value)

    amount_decimal, rate_decimal = values
    if amount_decimal < 0:
        raise ValueError("amount must be non-negative")
    if not 0 <= rate_decimal <= 1:
        raise ValueError("rate must be between 0 and 1 inclusive")

    discounted = amount_decimal * (Decimal("1") - rate_decimal)
    return float(discounted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
