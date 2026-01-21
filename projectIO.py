import os
import json
from init import init_file

FILE_DIR = "file"
DATA_FILE = os.path.join(FILE_DIR, "data.json")

# --------------------------
# 初始化 file/data.json
# --------------------------
# init_file imported from init.py

def load_data():
    init_file()
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# --------------------------
# 專案操作
# --------------------------
def list_projects():
    data = load_data()
    projects = data.get("projects", {})
    current = data.get("current_project")
    if not projects:
        print("No projects found.")
        return []
    print("\nCurrent Projects:")
    for idx, (name, info) in enumerate(projects.items(), start=1):
        marker = " [CURRENT]" if name == current else ""
        print(f"{idx}. {name} -> {info.get('path')}{marker}")
    return list(projects.keys())

def add_project():
    data = load_data()
    name = input("Enter new project name: ").strip()
    path = input("Enter project folder path: ").strip()
    if name in data["projects"]:
        print(f"Project '{name}' already exists.")
        return
    os.makedirs(path, exist_ok=True)
    # New structure with origin/shadow/coped sections
    data["projects"][name] = {
        "path": os.path.abspath(path),
        "origin": {"selected_files": []},
        "shadow": {"selected_files": []},
        "coped": {},
        "source_context": "origin",
        "coped_context": None,
        "toggles": {"source": True, "shadow": False, "diff": False}
    }
    data["current_project"] = name
    save_data(data)
    print(f"Project '{name}' added and set as current project.")

def delete_project():
    data = load_data()
    name = input("Enter project name to delete: ").strip()
    if name not in data["projects"]:
        print(f"Project '{name}' does not exist.")
        return
    path = data["projects"][name]["path"]
    confirm = input(f"Are you sure you want to delete '{name}' ({path})? (y/n): ").strip().lower()
    if confirm != "y":
        print("Delete cancelled.")
        return
    del data["projects"][name]
    if data.get("current_project") == name:
        data["current_project"] = None
    save_data(data)
    print(f"Project '{name}' removed from data.json.")

def select_project():
    data = load_data()
    projects = list_projects()
    if not projects:
        return None
    name = input("Enter project name to select as current: ").strip()
    if name not in projects:
        print(f"Project '{name}' not found.")
        return None
    data["current_project"] = name
    save_data(data)
    print(f"Project '{name}' is now the current project.")
    return name

# --------------------------
# 互動選單
# --------------------------
def main():
    init_file()
    while True:
        print("\n=== Project Manager ===")
        list_projects()
        print("\nOptions: 1. Add  2. Delete  3. Select  0. Cancel/Exit")
        choice = input("Choose an option: ").strip()
        if choice == "1":
            add_project()
        elif choice == "2":
            delete_project()
        elif choice == "3":
            select_project()
        elif choice == "0":
            print("Exiting Project Manager.")
            break
        else:
            print("Invalid option. Please choose 1, 2, 3 or 0.")

if __name__ == "__main__":
    main()
