from scheduler.dag import has_cycle


def test_existing_cycle_detection():
    assert has_cycle({"a": ["b"], "b": []}) is False
    assert has_cycle({"a": ["b"], "b": ["a"]}) is True
