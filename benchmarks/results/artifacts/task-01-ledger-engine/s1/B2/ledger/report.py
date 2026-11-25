import csv
from io import StringIO

from .models import Transaction


def summarize_account(transactions: list[Transaction]) -> dict[str, float | int]:
    """Return {'total_in': float, 'total_out': float, 'net': float, 'count': int}."""
    total_in = 0.0
    total_out = 0.0
    for transaction in transactions:
        if transaction.kind == "deposit":
            total_in += transaction.amount
        elif transaction.kind == "withdraw":
            total_out += transaction.amount
    return {
        "total_in": total_in,
        "total_out": total_out,
        "net": total_in - total_out,
        "count": len(transactions),
    }


def totals_by_category(transactions: list[Transaction]) -> dict[str, float]:
    """Return net signed total per category (deposit positive, withdraw negative)."""
    totals: dict[str, float] = {}
    for transaction in transactions:
        sign = 1.0 if transaction.kind == "deposit" else -1.0
        totals[transaction.category] = totals.get(transaction.category, 0.0) + sign * transaction.amount
    return totals


def export_csv(transactions: list[Transaction]) -> str:
    """Return CSV string with header 'tx_id,account,kind,amount,category' and one row per transaction."""
    output = StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(("tx_id", "account", "kind", "amount", "category"))
    for transaction in transactions:
        writer.writerow(
            (
                transaction.tx_id,
                transaction.account,
                transaction.kind,
                transaction.amount,
                transaction.category,
            )
        )
    return output.getvalue()
