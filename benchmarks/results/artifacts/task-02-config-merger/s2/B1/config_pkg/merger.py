import re
from copy import deepcopy
from typing import Any


_ENV_VAR_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}")


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
        if key not in merged:
            merged[key] = deepcopy(override_value)
            continue

        base_value = merged[key]
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
    if isinstance(config, dict):
        return {key: resolve_env_vars(value, env) for key, value in config.items()}
    if isinstance(config, list):
        return [resolve_env_vars(value, env) for value in config]
    if not isinstance(config, str):
        return config

    def replace(match: re.Match[str]) -> str:
        name, default = match.groups()
        if name in env:
            return env[name]
        if default is not None:
            return default
        raise KeyError(name)

    return _ENV_VAR_PATTERN.sub(replace, config)
