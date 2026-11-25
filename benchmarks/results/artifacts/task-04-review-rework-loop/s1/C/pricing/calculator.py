from decimal import Decimal, ROUND_HALF_UP


def apply_discount(amount: float, rate: float) -> float:
    """Return amount after a percentage discount, rounded to cents.

    amount must be non-negative and rate must be between 0 and 1 inclusive.
    Raise ValueError for invalid inputs. Rounding is decimal half-up.
    """
    def as_decimal(value: object, name: str) -> Decimal:
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise ValueError(f"{name} must be a finite number")
        try:
            decimal_value = Decimal(str(value))
        except (TypeError, ValueError, ArithmeticError) as exc:
            raise ValueError(f"{name} must be a finite number") from exc
        if not decimal_value.is_finite():
            raise ValueError(f"{name} must be a finite number")
        return decimal_value

    amount_decimal = as_decimal(amount, "amount")
    rate_decimal = as_decimal(rate, "rate")
    if amount_decimal < 0:
        raise ValueError("amount must be non-negative")
    if not Decimal("0") <= rate_decimal <= Decimal("1"):
        raise ValueError("rate must be between 0 and 1 inclusive")

    try:
        discounted = amount_decimal * (Decimal("1") - rate_decimal)
        return float(discounted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except ArithmeticError as exc:
        raise ValueError("amount and rate must be valid numbers") from exc
