import pytest
from catalog.models import Product
from catalog.service import add_product, total_value


def test_catalog_basic_flow():
    product = Product("p1", "Widget", 2.5)
    catalog = add_product({}, product)
    assert total_value(catalog, {"p1": 2}) == pytest.approx(5.0)
