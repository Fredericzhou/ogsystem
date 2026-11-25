from dataclasses import dataclass


@dataclass(frozen=True)
class Product:
    """A product with a non-empty id, name, and non-negative unit price."""

    product_id: str
    name: str
    unit_price: float

    def __post_init__(self) -> None:
        """Reject empty identifiers/names and negative prices."""
        if not self.product_id:
            raise ValueError("product_id must be non-empty")
        if not self.name:
            raise ValueError("name must be non-empty")
        if self.unit_price < 0:
            raise ValueError("unit_price must be non-negative")
