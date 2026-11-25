from typing import Any
from copy import deepcopy
import re


def merge_dicts(
    base: dict[str, Any],
    override: dict[str, Any],
    list_strategy: str = "replace",
) -> dict[str, Any]:
    """Deep merge override into base without mutating inputs.

    list_strategy: 'replace' overwrites lists; 'append' concatenates base + override lists.
    """
    result = deepcopy(base)

    for key, override_value in override.items():
        if key not in result:
            result[key] = deepcopy(override_value)
            continue

        base_value = result[key]
        if isinstance(base_value, dict) and isinstance(override_value, dict):
            result[key] = merge_dicts(base_value, override_value, list_strategy)
        elif isinstance(base_value, list) and isinstance(override_value, list):
            if list_strategy == "replace":
                result[key] = deepcopy(override_value)
            else:
                result[key] = deepcopy(base_value) + deepcopy(override_value)
        else:
            result[key] = deepcopy(override_value)

    return result


def resolve_env_vars(config: Any, env: dict[str, str]) -> Any:
    """Recursively resolve ${VAR} and ${VAR:default} in strings inside dicts/lists.

    Raise KeyError if VAR is not in env and no default is provided.
    """
    if isinstance(config, dict):
        return {key: resolve_env_vars(value, env) for key, value in config.items()}

    if isinstance(config, list):
        return [resolve_env_vars(value, env) for value in config]

    if isinstance(config, str):
        pattern = re.compile(r"\$\{([^}:]+)(?::([^}]*))?\}")

        def replace(match: re.Match[str]) -> str:
            name, default = match.group(1), match.group(2)
            if name in env:
                return env[name]
            if default is not None:
                return default
            raise KeyError(name)

        return pattern.sub(replace, config)

    return config
