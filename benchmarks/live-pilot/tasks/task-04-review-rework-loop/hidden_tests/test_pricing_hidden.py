import pytest
from pricing.calculator import apply_discount
from pricing.summary import summarize


def test_half_up_cent_rounding():
    assert apply_discount(10.01, 0.5) == pytest.approx(5.01)
    assert apply_discount(10.00, 0.15) == pytest.approx(8.50)


def test_discount_validation():
    for amount, rate in [(-1.0, 0.1), (1.0, -0.1), (1.0, 1.1)]:
        with pytest.raises(ValueError):
            apply_discount(amount, rate)


def test_zero_and_full_discount():
    assert apply_discount(0.0, 0.5) == 0.0
    assert apply_discount(12.34, 1.0) == 0.0


def test_summary_empty_and_rounding():
    assert summarize([]) == {"count": 0, "total": 0.0, "average": 0.0}
    assert summarize([1.005, 2.005]) == {"count": 2, "total": 3.01, "average": 1.51}


def test_summary_accepts_generators():
    assert summarize(value for value in [2.0, 4.0]) == {"count": 2, "total": 6.0, "average": 3.0}
