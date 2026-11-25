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
    import heapq

    # Include prerequisite-only tasks as graph nodes and collapse duplicate edges.
    nodes = set(deps)
    for prerequisites in deps.values():
        nodes.update(prerequisites)

    dependents: dict[str, set[str]] = {node: set() for node in nodes}
    indegree = {node: 0 for node in nodes}
    for task, prerequisites in deps.items():
        for prerequisite in set(prerequisites):
            dependents[prerequisite].add(task)
            indegree[task] += 1

    ready = [(-priorities.get(node, 0), node) for node in nodes if indegree[node] == 0]
    heapq.heapify(ready)
    order: list[str] = []

    while ready:
        _, task = heapq.heappop(ready)
        order.append(task)
        for dependent in dependents[task]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                heapq.heappush(ready, (-priorities.get(dependent, 0), dependent))

    if len(order) != len(nodes):
        raise ValueError("dependency graph contains a cycle")
    return order
