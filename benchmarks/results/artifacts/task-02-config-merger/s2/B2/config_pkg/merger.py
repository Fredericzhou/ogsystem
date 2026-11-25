from typing import Any
import copy


def merge_dicts(
    base: dict[str, Any],
    override: dict[str, Any],
    list_strategy: str = "replace",
) -> dict[str, Any]:
    """Deep merge override into base without mutating inputs.

    list_strategy: 'replace' overwrites lists; 'append' concatenates base + override lists.
    """
    merged: dict[str, Any] = copy.deepcopy(base)

    for key, override_value in override.items():
        if key not in base:
            merged[key] = copy.deepcopy(override_value)
            continue

        base_value = base[key]
        if isinstance(base_value, dict) and isinstance(override_value, dict):
            merged[key] = merge_dicts(base_value, override_value, list_strategy)
        elif isinstance(base_value, list) and isinstance(override_value, list):
            if list_strategy == "append":
                merged[key] = copy.deepcopy(base_value) + copy.deepcopy(override_value)
            else:
                merged[key] = copy.deepcopy(override_value)
        else:
            merged[key] = copy.deepcopy(override_value)

    return merged


def resolve_env_vars(config: Any, env: dict[str, str]) -> Any:
    """Recursively resolve ${VAR} and ${VAR:default} in strings inside dicts/lists.

    Raise KeyError if VAR is not in env and no default is provided.
    """
    raise NotImplementedError
