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

    # Include prerequisites that are only referenced in another task's list.
    tasks = set(deps)
    for prerequisites in deps.values():
        tasks.update(prerequisites)

    dependents: dict[str, list[str]] = {task: [] for task in tasks}
    remaining: dict[str, int] = {task: 0 for task in tasks}
    for task, prerequisites in deps.items():
        for prerequisite in prerequisites:
            dependents[prerequisite].append(task)
            remaining[task] += 1

    ready = [(-priorities.get(task, 0), task) for task in tasks if remaining[task] == 0]
    heapq.heapify(ready)
    order: list[str] = []

    while ready:
        _, task = heapq.heappop(ready)
        order.append(task)
        for dependent in dependents[task]:
            remaining[dependent] -= 1
            if remaining[dependent] == 0:
                heapq.heappush(ready, (-priorities.get(dependent, 0), dependent))

    if len(order) != len(tasks):
        raise ValueError("dependency graph contains a cycle")
    return order
