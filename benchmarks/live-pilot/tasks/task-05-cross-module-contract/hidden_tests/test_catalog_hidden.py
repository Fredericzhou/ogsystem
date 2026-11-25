import pytest
from catalog.models import Product
from catalog.service import add_product, find_product, total_value


def test_product_validation():
    for args in [("", "Widget", 1.0), ("p", "", 1.0), ("p", "Widget", -1.0)]:
        with pytest.raises(ValueError):
            Product(*args)


def test_copy_on_add_and_duplicate_rejection():
    product = Product("p1", "Widget", 2.5)
    original = {}
    catalog = add_product(original, product)
    assert original == {}
    assert find_product(catalog, "p1") == product
    with pytest.raises(KeyError):
        add_product(catalog, product)


def test_total_value_contract():
    catalog = add_product({}, Product("p1", "Widget", 2.5))
    assert total_value(catalog, {}) == 0.0
    assert total_value(catalog, {"p1": 3}) == pytest.approx(7.5)
    with pytest.raises(KeyError):
        total_value(catalog, {"missing": 1})
    with pytest.raises(ValueError):
        total_value(catalog, {"p1": -1})


def test_unknown_lookup():
    assert find_product({}, "missing") is None
