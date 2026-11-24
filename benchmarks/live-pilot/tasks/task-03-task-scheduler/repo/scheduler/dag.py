def has_cycle(deps: dict[str, list[str]]) -> bool:
    """Return True if dependency graph contains a cycle."""
    state: dict[str, int] = {}

    def dfs(node: str) -> bool:
        state[node] = 1
        for prereq in deps.get(node, []):
            if state.get(prereq, 0) == 1:
                return True
            if state.get(prereq, 0) == 0 and dfs(prereq):
                return True
        state[node] = 2
        return False

    return any(state.get(n, 0) == 0 and dfs(n) for n in deps)


def topo_sort_prioritized(
    deps: dict[str, list[str]],
    priorities: dict[str, int],
) -> list[str]:
    """Return execution order where prerequisites run before dependents.

    Among ready tasks, pick highest priority first, then lexicographically smallest task_id.
    Raise ValueError if a cycle exists.
    """
    raise NotImplementedError
