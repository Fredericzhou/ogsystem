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
    # Build the full node set because a prerequisite may only appear in a
    # dependency list, and calculate the number of prerequisites remaining for
    # each task.
    nodes = set(deps)
    for prerequisites in deps.values():
        nodes.update(prerequisites)

    remaining = {node: 0 for node in nodes}
    dependents: dict[str, list[str]] = {node: [] for node in nodes}
    for task, prerequisites in deps.items():
        remaining[task] = len(prerequisites)
        for prerequisite in prerequisites:
            dependents[prerequisite].append(task)

    import heapq

    ready = [(-priorities.get(node, 0), node) for node in nodes if remaining[node] == 0]
    heapq.heapify(ready)
    order: list[str] = []
    while ready:
        _, task = heapq.heappop(ready)
        order.append(task)
        for dependent in dependents[task]:
            remaining[dependent] -= 1
            if remaining[dependent] == 0:
                heapq.heappush(ready, (-priorities.get(dependent, 0), dependent))

    if len(order) != len(nodes):
        raise ValueError("dependency graph contains a cycle")
    return order
