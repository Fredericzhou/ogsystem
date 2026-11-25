import re
from copy import deepcopy
from typing import Any


def merge_dicts(
    base: dict[str, Any],
    override: dict[str, Any],
    list_strategy: str = "replace",
) -> dict[str, Any]:
    """Deep merge override into base without mutating inputs.

    list_strategy: 'replace' overwrites lists; 'append' concatenates base + override lists.
    """
    merged = deepcopy(base)

    for key, override_value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(override_value, dict):
            merged[key] = merge_dicts(base_value, override_value, list_strategy)
        elif isinstance(base_value, list) and isinstance(override_value, list):
            if list_strategy == "append":
                merged[key] = base_value + deepcopy(override_value)
            else:
                merged[key] = deepcopy(override_value)
        else:
            merged[key] = deepcopy(override_value)

    return merged


def resolve_env_vars(config: Any, env: dict[str, str]) -> Any:
    """Recursively resolve ${VAR} and ${VAR:default} in strings inside dicts/lists.

    Raise KeyError if VAR is not in env and no default is provided.
    """
    pattern = re.compile(r"\$\{([^}:]+)(?::([^}]*))?\}")

    def resolve(value: Any) -> Any:
        if isinstance(value, str):
            def replace(match: re.Match[str]) -> str:
                name, default = match.group(1), match.group(2)
                if name in env:
                    return env[name]
                if default is not None:
                    return default
                raise KeyError(name)

            return pattern.sub(replace, value)
        if isinstance(value, dict):
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    return resolve(config)
