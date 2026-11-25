from typing import Any
import copy
import re


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
            result = copy.deepcopy(base_value)
            for key, value in override_value.items():
                if key in result:
                    result[key] = merge(result[key], value)
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
    placeholder = re.compile(r"\$\{([^}:]+)(?::([^}]*))?\}")

    def resolve(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if not isinstance(value, str):
            return value

        def replace(match: re.Match[str]) -> str:
            name, default = match.group(1), match.group(2)
            if name in env:
                return env[name]
            if default is not None:
                return default
            raise KeyError(name)

        return placeholder.sub(replace, value)

    return resolve(config)
