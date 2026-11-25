from typing import Any
from copy import deepcopy


def merge_dicts(
    base: dict[str, Any],
    override: dict[str, Any],
    list_strategy: str = "replace",
) -> dict[str, Any]:
    """Deep merge override into base without mutating inputs.

    list_strategy: 'replace' overwrites lists; 'append' concatenates base + override lists.
    """
    merged: dict[str, Any] = deepcopy(base)

    for key, override_value in override.items():
        if key not in merged:
            merged[key] = deepcopy(override_value)
            continue

        base_value = merged[key]
        if isinstance(base_value, dict) and isinstance(override_value, dict):
            merged[key] = merge_dicts(base_value, override_value, list_strategy)
        elif isinstance(base_value, list) and isinstance(override_value, list):
            merged[key] = (
                base_value + deepcopy(override_value)
                if list_strategy == "append"
                else deepcopy(override_value)
            )
        else:
            merged[key] = deepcopy(override_value)

    return merged


def resolve_env_vars(config: Any, env: dict[str, str]) -> Any:
    """Recursively resolve ${VAR} and ${VAR:default} in strings inside dicts/lists.

    Raise KeyError if VAR is not in env and no default is provided.
    """
    raise NotImplementedError
