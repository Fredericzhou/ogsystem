from decimal import Decimal, ROUND_HALF_UP, localcontext


def apply_discount(amount: float, rate: float) -> float:
    """Return amount after a percentage discount, rounded to cents.

    amount must be non-negative and rate must be between 0 and 1 inclusive.
    Raise ValueError for invalid inputs. Rounding is decimal half-up.
    """
    def as_decimal(value: object) -> Decimal:
        if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
            raise ValueError("amount and rate must be numeric")
        try:
            result = Decimal(str(value))
        except (ArithmeticError, ValueError, TypeError):
            raise ValueError("amount and rate must be numeric") from None
        if not result.is_finite():
            raise ValueError("amount and rate must be finite")
        return result

    amount_decimal = as_decimal(amount)
    rate_decimal = as_decimal(rate)
    if amount_decimal < 0:
        raise ValueError("amount must be non-negative")
    if not 0 <= rate_decimal <= 1:
        raise ValueError("rate must be between 0 and 1")

    # Decimal's default context can round large valid amounts before the final
    # cent rounding, so size the operation context from the input magnitude.
    precision = max(
        28,
        len(amount_decimal.as_tuple().digits),
        len(rate_decimal.as_tuple().digits),
        amount_decimal.adjusted() + len(amount_decimal.as_tuple().digits) + 4,
    )
    with localcontext() as context:
        context.prec = precision
        discounted = amount_decimal * (Decimal("1") - rate_decimal)
        rounded = discounted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(rounded)
