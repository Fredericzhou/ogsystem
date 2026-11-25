from dataclasses import dataclass


@dataclass(frozen=True)
class Transaction:
    tx_id: str
    account: str
    kind: str  # "deposit" or "withdraw"
    amount: float
    category: str = "general"
