from .models import Product


def add_product(catalog: dict[str, Product], product: Product) -> dict[str, Product]:
    """Return a copied catalog with product added; raise KeyError on duplicate id."""
    raise NotImplementedError


def find_product(catalog: dict[str, Product], product_id: str) -> Product | None:
    """Return a product by id or None when absent."""
    raise NotImplementedError


def total_value(catalog: dict[str, Product], quantities: dict[str, int]) -> float:
    """Return the sum of unit_price * quantity; reject unknown IDs or negative quantities."""
    raise NotImplementedError
