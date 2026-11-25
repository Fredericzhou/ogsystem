from .models import Product


def add_product(catalog: dict[str, Product], product: Product) -> dict[str, Product]:
    """Return a copied catalog with product added; raise KeyError on duplicate id."""
    if product.product_id in catalog:
        raise KeyError(product.product_id)

    updated_catalog = catalog.copy()
    updated_catalog[product.product_id] = product
    return updated_catalog


def find_product(catalog: dict[str, Product], product_id: str) -> Product | None:
    """Return a product by id or None when absent."""
    return catalog.get(product_id)


def total_value(catalog: dict[str, Product], quantities: dict[str, int]) -> float:
    """Return the sum of unit_price * quantity; reject unknown IDs or negative quantities."""
    total = 0.0
    for product_id, quantity in quantities.items():
        if product_id not in catalog:
            raise KeyError(product_id)
        if quantity < 0:
            raise ValueError("quantity must be non-negative")
        total += catalog[product_id].unit_price * quantity
    return total
