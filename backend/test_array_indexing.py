#!/usr/bin/env python3
"""Test array indexing support in template paths."""

from app.models.workflow import normalize_template_path
from app.services.node_runners import read_path

def test_normalize_template_path():
    """Test parsing of array indices in template paths."""
    print("Testing normalize_template_path...")
    
    # Test basic dot notation (no arrays)
    result = normalize_template_path("foo.bar.baz")
    print(f"  foo.bar.baz -> {result}")
    assert result == ["outputs", "foo", "bar", "baz"]
    
    # Test single index
    result = normalize_template_path("items[0]")
    print(f"  items[0] -> {result}")
    assert result == ["outputs", ("items", 0)]
    
    # Test multiple indices
    result = normalize_template_path("foreach.items[0].json")
    print(f"  foreach.items[0].json -> {result}")
    assert result == ["outputs", "foreach", ("items", 0), "json"]
    
    # Test input prefix with array
    result = normalize_template_path("input.document[2]")
    print(f"  input.document[2] -> {result}")
    # input.document[2] parses as: input, document[2]
    # So we get: ["inputs", ("document", 2)]
    assert result == ["inputs", ("document", 2)]
    
    print("✓ normalize_template_path tests passed!")


def test_read_path():
    """Test array index resolution in read_path."""
    print("\nTesting read_path with array indices...")
    
    context = {
        "outputs": {
            "foreach": {
                "items": [
                    {"title": "Job 1", "company": "Acme"},
                    {"title": "Job 2", "company": "Tech Corp"},
                    {"title": "Job 3", "company": "StartupXYZ"}
                ]
            }
        }
    }
    
    # Test accessing first item
    result = read_path(context, "foreach.items[0]")
    print(f"  foreach.items[0] -> {result}")
    assert result == {"title": "Job 1", "company": "Acme"}
    
    # Test accessing nested field
    result = read_path(context, "foreach.items[0].title")
    print(f"  foreach.items[0].title -> {result}")
    assert result == "Job 1"
    
    # Test accessing second item
    result = read_path(context, "foreach.items[1].company")
    print(f"  foreach.items[1].company -> {result}")
    assert result == "Tech Corp"
    
    # Test out-of-bounds returns None
    result = read_path(context, "foreach.items[99]")
    print(f"  foreach.items[99] -> {result}")
    assert result is None
    
    # Test invalid path returns None
    result = read_path(context, "foreach.items[0].nonexistent")
    print(f"  foreach.items[0].nonexistent -> {result}")
    assert result is None
    
    print("✓ read_path tests passed!")


if __name__ == "__main__":
    test_normalize_template_path()
    test_read_path()
    print("\n✅ All array indexing tests passed!")
