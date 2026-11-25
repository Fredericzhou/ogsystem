import pytest
from pricing.calculator import apply_discount
from pricing.summary import summarize


def test_basic_discount_and_summary():
    assert apply_discount(100.0, 0.2) == pytest.approx(80.0)
    assert summarize([10.0, 20.0]) == {"count": 2, "total": 30.0, "average": 15.0}
