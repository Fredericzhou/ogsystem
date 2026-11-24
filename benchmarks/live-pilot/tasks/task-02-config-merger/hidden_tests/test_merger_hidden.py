import copy
import pytest
from config_pkg.merger import merge_dicts, resolve_env_vars


def test_deep_merge_replace_and_immutability():
    base = {"db": {"host": "localhost", "port": 5432}, "tags": ["a"]}
    override = {"db": {"port": 5433}, "tags": ["b"]}
    base_orig = copy.deepcopy(base)
    res = merge_dicts(base, override, list_strategy="replace")
    assert res == {"db": {"host": "localhost", "port": 5433}, "tags": ["b"]}
    assert base == base_orig


def test_deep_merge_append_lists():
    res = merge_dicts({"tags": [1, 2]}, {"tags": [3]}, list_strategy="append")
    assert res["tags"] == [1, 2, 3]


def test_resolve_env_vars_nested_and_defaults():
    cfg = {
        "url": "https://${HOST:localhost}:${PORT}/api",
        "items": ["${ENV}", "${MISSING:fallback}"],
        "num": 42,
    }
    resolved = resolve_env_vars(cfg, {"PORT": "8080", "ENV": "prod"})
    assert resolved == {
        "url": "https://localhost:8080/api",
        "items": ["prod", "fallback"],
        "num": 42,
    }


def test_resolve_env_vars_missing_raises():
    with pytest.raises(KeyError):
        resolve_env_vars({"secret": "${NO_SUCH_VAR}"}, {})


def test_combined_merge_then_resolve():
    merged = merge_dicts(
        {"service": {"host": "${HOST:127.0.0.1}", "port": "8000"}},
        {"service": {"port": "${PORT}"}},
    )
    resolved = resolve_env_vars(merged, {"PORT": "9000"})
    assert resolved == {"service": {"host": "127.0.0.1", "port": "9000"}}
