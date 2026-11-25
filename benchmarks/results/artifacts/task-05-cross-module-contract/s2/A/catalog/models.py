from dataclasses import dataclass


@dataclass(frozen=True)
class Product:
    """A product with a non-empty id, name, and non-negative unit price."""

    product_id: str
    name: str
    unit_price: float

    def __post_init__(self) -> None:
        """Reject empty identifiers/names and negative prices."""
        if not isinstance(self.product_id, str):
            raise TypeError("product_id must be a string")
        if not self.product_id:
            raise ValueError("product_id must not be empty")
        if not isinstance(self.name, str):
            raise TypeError("name must be a string")
        if not self.name:
            raise ValueError("name must not be empty")
        if self.unit_price < 0:
            raise ValueError("unit_price must be non-negative")
