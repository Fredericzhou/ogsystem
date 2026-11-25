from .models import Transaction


def summarize_account(transactions: list[Transaction]) -> dict[str, float | int]:
    """Return {'total_in': float, 'total_out': float, 'net': float, 'count': int}."""
    raise NotImplementedError


def totals_by_category(transactions: list[Transaction]) -> dict[str, float]:
    """Return net signed total per category (deposit positive, withdraw negative)."""
    raise NotImplementedError


def export_csv(transactions: list[Transaction]) -> str:
    """Return CSV string with header 'tx_id,account,kind,amount,category' and one row per transaction."""
    raise NotImplementedError
