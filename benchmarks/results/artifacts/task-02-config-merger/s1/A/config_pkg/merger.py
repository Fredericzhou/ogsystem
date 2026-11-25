import copy
import re
from typing import Any


_ENV_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}")


def merge_dicts(
    base: dict[str, Any],
    override: dict[str, Any],
    list_strategy: str = "replace",
) -> dict[str, Any]:
    """Deep merge override into base without mutating inputs.

    list_strategy: 'replace' overwrites lists; 'append' concatenates base + override lists.
    """
    if list_strategy not in {"replace", "append"}:
        raise ValueError("list_strategy must be 'replace' or 'append'")

    def merge(base_value: Any, override_value: Any) -> Any:
        if isinstance(base_value, dict) and isinstance(override_value, dict):
            result = {key: copy.deepcopy(value) for key, value in base_value.items()}
            for key, value in override_value.items():
                if key in base_value:
                    result[key] = merge(base_value[key], value)
                else:
                    result[key] = copy.deepcopy(value)
            return result
        if isinstance(base_value, list) and isinstance(override_value, list):
            if list_strategy == "append":
                return copy.deepcopy(base_value) + copy.deepcopy(override_value)
            return copy.deepcopy(override_value)
        return copy.deepcopy(override_value)

    return merge(base, override)


def resolve_env_vars(config: Any, env: dict[str, str]) -> Any:
    """Recursively resolve ${VAR} and ${VAR:default} in strings inside dicts/lists.

    Raise KeyError if VAR is not in env and no default is provided.
    """
    def resolve(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if not isinstance(value, str):
            return copy.deepcopy(value)

        def substitute(match: re.Match[str]) -> str:
            name, default = match.group(1), match.group(2)
            if name in env:
                return env[name]
            if default is not None:
                return default
            raise KeyError(name)

        return _ENV_VAR_RE.sub(substitute, value)

    return resolve(config)
