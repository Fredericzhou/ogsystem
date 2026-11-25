from dataclasses import dataclass


@dataclass(frozen=True)
class Product:
    """A product with a non-empty id, name, and non-negative unit price."""

    product_id: str
    name: str
    unit_price: float

    def __post_init__(self) -> None:
        """Reject empty identifiers/names and negative prices."""
        raise NotImplementedError
