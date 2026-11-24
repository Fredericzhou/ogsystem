import pytest
from scheduler.dag import has_cycle, topo_sort_prioritized
from scheduler.runner import run_with_retries


def test_existing_regression_guard():
    assert has_cycle({"a": ["b"], "b": []}) is False
    assert has_cycle({"a": ["b"], "b": ["a"]}) is True


def test_topo_sort_prioritized_order():
    deps = {"deploy": ["build", "lint"], "build": ["init"], "lint": ["init"], "init": []}
    priorities = {"init": 1, "build": 5, "lint": 10, "deploy": 1}
    assert topo_sort_prioritized(deps, priorities) == ["init", "lint", "build", "deploy"]


def test_topo_sort_tie_break_lexicographic():
    deps = {"b": [], "a": [], "c": ["a", "b"]}
    priorities = {"a": 5, "b": 5, "c": 1}
    assert topo_sort_prioritized(deps, priorities) == ["a", "b", "c"]


def test_topo_sort_cycle_raises():
    with pytest.raises(ValueError):
        topo_sort_prioritized({"a": ["b"], "b": ["a"]}, {"a": 1, "b": 1})


def test_run_with_retries_eventual_success():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("transient")
        return "done"

    res = run_with_retries(flaky, max_retries=2)
    assert res == {"status": "ok", "result": "done", "attempts": 3}


def test_run_with_retries_exhausted():
    def always_fail():
        raise ValueError("boom")

    res = run_with_retries(always_fail, max_retries=2)
    assert res["status"] == "failed"
    assert res["attempts"] == 3
    assert "boom" in res["error"]
