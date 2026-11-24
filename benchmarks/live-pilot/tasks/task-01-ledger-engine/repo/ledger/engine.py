from .models import Transaction


class LedgerEngine:
    """In-memory multi-account ledger with overdraft guard and idempotent tx_id."""

    def __init__(self) -> None:
        self._balances: dict[str, float] = {}
        self._seen_tx_ids: set[str] = set()
        self._history: list[Transaction] = []

    def balance(self, account: str) -> float:
        return self._balances.get(account, 0.0)

    def history(self, account: str | None = None) -> list[Transaction]:
        if account is None:
            return list(self._history)
        return [tx for tx in self._history if tx.account == account]

    def deposit(self, tx_id: str, account: str, amount: float, category: str = "general") -> bool:
        """Deposit positive amount. Return False if tx_id already applied; raise ValueError if amount <= 0."""
        raise NotImplementedError

    def withdraw(self, tx_id: str, account: str, amount: float, category: str = "general") -> bool:
        """Withdraw positive amount. Return False if tx_id already applied; raise ValueError if amount <= 0 or insufficient funds."""
        raise NotImplementedError

    def transfer(self, tx_id: str, src: str, dst: str, amount: float, category: str = "transfer") -> bool:
        """Atomically transfer positive amount from src to dst. Return False if tx_id already applied; raise ValueError on invalid amount or overdraft."""
        raise NotImplementedError
