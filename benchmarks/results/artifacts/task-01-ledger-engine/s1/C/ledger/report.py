import csv
from io import StringIO

from .models import Transaction


def summarize_account(transactions: list[Transaction]) -> dict[str, float | int]:
    """Return {'total_in': float, 'total_out': float, 'net': float, 'count': int}."""
    total_in = sum((tx.amount for tx in transactions if tx.kind == "deposit"), 0.0)
    total_out = sum((tx.amount for tx in transactions if tx.kind == "withdraw"), 0.0)
    return {
        "total_in": total_in,
        "total_out": total_out,
        "net": total_in - total_out,
        "count": len(transactions),
    }


def totals_by_category(transactions: list[Transaction]) -> dict[str, float]:
    """Return net signed total per category (deposit positive, withdraw negative)."""
    totals: dict[str, float] = {}
    for tx in transactions:
        signed_amount = tx.amount if tx.kind == "deposit" else -tx.amount
        totals[tx.category] = totals.get(tx.category, 0.0) + signed_amount
    return totals


def export_csv(transactions: list[Transaction]) -> str:
    """Return CSV string with header 'tx_id,account,kind,amount,category' and one row per transaction."""
    output = StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(("tx_id", "account", "kind", "amount", "category"))
    for tx in transactions:
        writer.writerow((tx.tx_id, tx.account, tx.kind, tx.amount, tx.category))
    return output.getvalue()
