import pytest
from ledger.engine import LedgerEngine
from ledger.models import Transaction
from ledger.report import export_csv, summarize_account, totals_by_category


def test_deposit_and_withdraw_basic():
    eng = LedgerEngine()
    assert eng.deposit("t1", "alice", 100.0, "salary") is True
    assert eng.withdraw("t2", "alice", 35.0, "food") is True
    assert eng.balance("alice") == pytest.approx(65.0)


def test_idempotent_tx_id():
    eng = LedgerEngine()
    assert eng.deposit("dup1", "alice", 50.0) is True
    assert eng.deposit("dup1", "alice", 50.0) is False
    assert eng.balance("alice") == pytest.approx(50.0)


def test_overdraft_and_non_positive_rejected():
    eng = LedgerEngine()
    eng.deposit("t1", "alice", 20.0)
    with pytest.raises(ValueError):
        eng.withdraw("t2", "alice", 25.0)
    with pytest.raises(ValueError):
        eng.deposit("t3", "alice", 0.0)
    with pytest.raises(ValueError):
        eng.withdraw("t4", "alice", -5.0)
    assert eng.balance("alice") == pytest.approx(20.0)


def test_transfer_atomic_and_idempotent():
    eng = LedgerEngine()
    eng.deposit("t1", "alice", 100.0)
    assert eng.transfer("tr1", "alice", "bob", 40.0) is True
    assert eng.transfer("tr1", "alice", "bob", 40.0) is False
    assert eng.balance("alice") == pytest.approx(60.0)
    assert eng.balance("bob") == pytest.approx(40.0)
    with pytest.raises(ValueError):
        eng.transfer("tr2", "alice", "bob", 999.0)
    assert eng.balance("alice") == pytest.approx(60.0)
    assert eng.balance("bob") == pytest.approx(40.0)


def test_summarize_account():
    txs = [
        Transaction("1", "a", "deposit", 100.0, "salary"),
        Transaction("2", "a", "withdraw", 30.0, "food"),
        Transaction("3", "a", "withdraw", 20.0, "food"),
    ]
    s = summarize_account(txs)
    assert s["total_in"] == pytest.approx(100.0)
    assert s["total_out"] == pytest.approx(50.0)
    assert s["net"] == pytest.approx(50.0)
    assert s["count"] == 3


def test_totals_by_category():
    txs = [
        Transaction("1", "a", "deposit", 100.0, "salary"),
        Transaction("2", "a", "withdraw", 30.0, "food"),
        Transaction("3", "a", "deposit", 10.0, "food"),
    ]
    totals = totals_by_category(txs)
    assert totals["salary"] == pytest.approx(100.0)
    assert totals["food"] == pytest.approx(-20.0)


def test_export_csv():
    txs = [Transaction("tx1", "alice", "deposit", 50.0, "salary")]
    csv_text = export_csv(txs).strip().splitlines()
    assert csv_text[0] == "tx_id,account,kind,amount,category"
    assert "tx1" in csv_text[1] and "alice" in csv_text[1] and "salary" in csv_text[1]
