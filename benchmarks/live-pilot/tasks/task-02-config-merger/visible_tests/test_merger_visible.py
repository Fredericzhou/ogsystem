from config_pkg.merger import merge_dicts, resolve_env_vars


def test_basic_merge():
    assert merge_dicts({"a": 1, "nested": {"x": 1}}, {"nested": {"y": 2}}) == {
        "a": 1,
        "nested": {"x": 1, "y": 2},
    }


def test_basic_environment_resolution():
    assert resolve_env_vars({"url": "http://${HOST}:${PORT}"}, {"HOST": "localhost", "PORT": "8080"}) == {
        "url": "http://localhost:8080"
    }
