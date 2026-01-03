import json

with open('file/data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("=== Current Project ===")
print(f"current_project: {data.get('current_project')}")

print("\n=== All Projects ===")
for name, info in data.get('projects', {}).items():
    print(f"  {name}:")
    print(f"    path: {info.get('path')}")
    print(f"    source_context: {info.get('source_context')}")
    print(f"    coped_context: {info.get('coped_context')}")
