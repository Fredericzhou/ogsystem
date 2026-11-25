import pytest
from ledger.engine import LedgerEngine
from ledger.models import Transaction
from ledger.report import summarize_account


def test_basic_ledger_flow():
    engine = LedgerEngine()
    assert engine.deposit("v1", "alice", 100.0, "salary") is True
    assert engine.withdraw("v2", "alice", 25.0, "food") is True
    assert engine.balance("alice") == pytest.approx(75.0)


def test_report_summary():
    summary = summarize_account([
        Transaction("v1", "alice", "deposit", 10.0, "salary"),
        Transaction("v2", "alice", "withdraw", 3.0, "food"),
    ])
    assert summary == {"total_in": 10.0, "total_out": 3.0, "net": 7.0, "count": 2}
