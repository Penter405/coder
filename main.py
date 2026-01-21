import sys
import os
import shutil
import json
import datetime
import filecmp
import subprocess
from PyQt6.QtWidgets import (
    QApplication, QWidget, QTreeWidget, QTreeWidgetItem, QPushButton,
    QLabel, QVBoxLayout, QHBoxLayout, QMessageBox, QTextEdit, QInputDialog, QCheckBox,
    QFileDialog, QTreeWidgetItemIterator
)
from PyQt6.QtCore import Qt

# Use script directory for consistent data.json path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(SCRIPT_DIR, "file", "data.json")

# ------------------------
# Data IO
# ------------------------
def load_data():
    if not os.path.exists(DATA_JSON):
        return {}
    with open(DATA_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    os.makedirs(os.path.dirname(DATA_JSON), exist_ok=True)
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ------------------------
# Control Selected Files
# ------------------------
# ------------------------
# Console Window (Replaces Control Selected Files)
# ------------------------
class ConsoleWindow(QWidget):
    def __init__(self, project_name, project_path, data):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data
        # Load selected_files from all sections (origin + coped)
        self.selected_files = set()
        
        # Load from origin
        origin_files = self.data["projects"][self.project_name].get("origin", {}).get("selected_files", [])
        for f in origin_files:
            if os.path.isabs(f):
                self.selected_files.add(os.path.normpath(f))
            else:
                self.selected_files.add(os.path.normpath(os.path.join(self.project_path, f)))
        
        # Load from all coped projects
        coped_dict = self.data["projects"][self.project_name].get("coped", {})
        file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
        for coped_name, coped_data in coped_dict.items():
            coped_path = os.path.join(file_dir, coped_name)
            for f in coped_data.get("selected_files", []):
                if os.path.isabs(f):
                    self.selected_files.add(os.path.normpath(f))
                else:
                    self.selected_files.add(os.path.normpath(os.path.join(coped_path, f)))
        
        self.updating = False

        self.setWindowTitle("Console - Manage Project & Files")
        self.resize(700, 500)
        self.init_ui()
        self.build_tree()

    def init_ui(self):
        layout = QVBoxLayout()
        # Head
        layout.addWidget(QLabel(f"Project: {self.project_name}\nPath: {self.project_path}"))

        # Tree
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Project Structure")
        layout.addWidget(self.tree)
        
        # Action Buttons
        btn_layout = QHBoxLayout()
        self.btn_apply = QPushButton("Apply Selected")
        self.btn_cancel = QPushButton("Cancel Selected")
        self.btn_add = QPushButton("Add Coped Project")
        self.btn_delete = QPushButton("Delete Coped Project")
        
        btn_layout.addWidget(self.btn_apply)
        btn_layout.addWidget(self.btn_cancel)
        btn_layout.addStretch()
        btn_layout.addWidget(self.btn_add)
        btn_layout.addWidget(self.btn_delete)
        layout.addLayout(btn_layout)

        self.btn_apply.clicked.connect(self.apply_changes)
        self.btn_cancel.clicked.connect(self.close)
        self.btn_add.clicked.connect(self.add_coped_project)
        self.btn_delete.clicked.connect(self.delete_coped_project)
        self.setLayout(layout)

    def build_tree(self):
        self.tree.clear()
        
        # Root 0: None (Option for Empty Creation)
        self.none_root = QTreeWidgetItem(["None (Create Empty Project)"])
        self.none_root.setData(0, Qt.ItemDataRole.UserRole, "NONE_ROOT")
        self.tree.addTopLevelItem(self.none_root)

        # Root 1: Origin Project
        self.origin_root = QTreeWidgetItem([f"[Origin] {self.project_name}"])
        self.origin_root.setData(0, Qt.ItemDataRole.UserRole, "ORIGIN_ROOT")
        self.origin_root.setFlags(self.origin_root.flags() | Qt.ItemFlag.ItemIsUserCheckable)
        self.origin_root.setCheckState(0, Qt.CheckState.Unchecked)
        self.tree.addTopLevelItem(self.origin_root)
        
        if os.path.exists(self.project_path):
            self.add_items(self.origin_root, self.project_path)
            self.update_parent_state(self.origin_root)  # Update checkbox based on children
            
        # Root 2+: Coped Projects (Scan 'file/{project_name}/' directory)
        file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
        if not os.path.exists(file_dir):
            os.makedirs(file_dir)
            
        # Ensure 'shadow' folder exists
        shadow_path = os.path.join(file_dir, "shadow")
        if not os.path.exists(shadow_path):
            os.makedirs(shadow_path)
            
        subdirs = sorted([d for d in os.listdir(file_dir) if os.path.isdir(os.path.join(file_dir, d))])
        
        for d in subdirs:
            if d == "__pycache__": continue
            if d.lower() == "shadow": continue # Hide Shadow Layer from UI
            
            full_path = os.path.join(file_dir, d)
            # Display name
            display_name = f"[Coped] {d}"
            
            coped_root = QTreeWidgetItem([display_name])
            coped_root.setData(0, Qt.ItemDataRole.UserRole, full_path)
            coped_root.setFlags(coped_root.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            coped_root.setCheckState(0, Qt.CheckState.Unchecked)
            self.tree.addTopLevelItem(coped_root)
            
            self.add_items(coped_root, full_path, is_shadow=True)
            self.update_parent_state(coped_root)  # Update checkbox based on children
            coped_root.setExpanded(False) # Start collapsed
            
        self.origin_root.setExpanded(False) # Start collapsed
        self.tree.itemChanged.connect(self.handle_item_changed)

    def add_items(self, parent_widget, path, is_shadow=False):
        # Flatten directory similar to original but attached to parent_widget
        if os.path.isdir(path):
            for f in sorted(os.listdir(path)):
                if f in [".git", "__pycache__", "file"]: continue
                self.add_node_recursive(parent_widget, os.path.join(path, f), is_shadow)

    def add_node_recursive(self, parent_item, full_path, is_shadow):
        name = os.path.basename(full_path)
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.ItemDataRole.UserRole, full_path)
        # Enable checkable items (our custom update_parent_state handles tri-state)
        item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
        
        # Set initial check state based on selected_files
        norm_path = os.path.normpath(full_path)
        if norm_path in self.selected_files:
            item.setCheckState(0, Qt.CheckState.Checked)
        else:
            item.setCheckState(0, Qt.CheckState.Unchecked)

        parent_item.addChild(item)

        if os.path.isdir(full_path):
            for f in sorted(os.listdir(full_path)):
                if f in [".git", "__pycache__", "file"]: continue
                self.add_node_recursive(item, os.path.join(full_path, f), is_shadow)
            # After adding children, update this item's check state based on children
            self.update_parent_state(item)

    def handle_item_changed(self, item, column):
        if self.updating: return
        self.updating = True
        try:
             # Basic check propagation
            state = item.checkState(0)
            self.update_children(item, state)
            self.update_parent(item)
        finally:
            self.updating = False

    def update_children(self, item, state):
        for i in range(item.childCount()):
            child = item.child(i)
            # Only propagate if checkable
            if child.flags() & Qt.ItemFlag.ItemIsUserCheckable:
                child.setCheckState(0, state)
                self.update_children(child, state)

    def update_parent(self, item):
        parent = item.parent()
        if not parent: return
        self.update_parent_state(parent)
        # Recursively update grandparents
        self.update_parent(parent)

    def update_parent_state(self, parent):
        """Update parent checkbox to reflect children's states (tri-state logic)"""
        if parent.childCount() == 0:
            return
        
        checked_count = 0
        unchecked_count = 0
        partial_count = 0
        
        for i in range(parent.childCount()):
            child = parent.child(i)
            if child.flags() & Qt.ItemFlag.ItemIsUserCheckable:
                state = child.checkState(0)
                if state == Qt.CheckState.Checked:
                    checked_count += 1
                elif state == Qt.CheckState.Unchecked:
                    unchecked_count += 1
                else:  # PartiallyChecked
                    partial_count += 1
        
        total = checked_count + unchecked_count + partial_count
        if total == 0:
            return
        
        # Check if parent is checkable (root items may not be)
        if not (parent.flags() & Qt.ItemFlag.ItemIsUserCheckable):
            return
            
        # Determine parent state
        if checked_count == total:
            parent.setCheckState(0, Qt.CheckState.Checked)
        elif unchecked_count == total:
            parent.setCheckState(0, Qt.CheckState.Unchecked)
        else:
            parent.setCheckState(0, Qt.CheckState.PartiallyChecked)

    def collect_checked_files(self, parent_item):
        path = parent_item.data(0, Qt.ItemDataRole.UserRole)
        # Skip roots
        if path in ["ORIGIN_ROOT", "SHADOW_ROOT", "NONE_ROOT"]: 
            pass
        elif os.path.isfile(path):
             if parent_item.checkState(0) == Qt.CheckState.Checked and (parent_item.flags() & Qt.ItemFlag.ItemIsUserCheckable):
                 # Store path relative to project_path for portability
                 abs_path = os.path.abspath(path)
                 try:
                     rel_path = os.path.relpath(abs_path, self.project_path)
                     # If relative path goes outside project (starts with ..), use absolute
                     if not rel_path.startswith('..'):
                         self.selected_files.add(rel_path)
                         print(f"[ConsoleWindow] Added checked file (relative): {rel_path}")
                     else:
                         self.selected_files.add(abs_path)
                         print(f"[ConsoleWindow] Added checked file (absolute): {abs_path}")
                 except ValueError:
                     # Different drives on Windows, use absolute
                     self.selected_files.add(abs_path)
                     print(f"[ConsoleWindow] Added checked file (absolute-drive): {abs_path}")
             
        for i in range(parent_item.childCount()):
            self.collect_checked_files(parent_item.child(i))

    def apply_changes(self):
        # Collect checked files categorized by section
        self.origin_selected = set()
        self.coped_selected = {}  # coped_name -> set of files
        
        # Initialize coped_selected keys
        file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
        coped_dict = self.data["projects"][self.project_name].get("coped", {})
        for coped_name in coped_dict.keys():
            self.coped_selected[coped_name] = set()
        
        # Scan ALL top-level items
        root_count = self.tree.topLevelItemCount()
        print(f"[ConsoleWindow] Scanning {root_count} roots for selection...")
        for i in range(root_count):
            root = self.tree.topLevelItem(i)
            root_path = root.data(0, Qt.ItemDataRole.UserRole)
            print(f"[ConsoleWindow] Scanning Root: {root.text(0)} - Path: {root_path}")
            self.collect_checked_files_by_section(root, root_path)
        
        # Save to respective sections
        # Origin
        origin_list = []
        for f in self.origin_selected:
            try:
                rel = os.path.relpath(f, self.project_path)
                if not rel.startswith('..'):
                    origin_list.append(rel)
                else:
                    origin_list.append(f)
            except ValueError:
                origin_list.append(f)
        
        if "origin" not in self.data["projects"][self.project_name]:
            self.data["projects"][self.project_name]["origin"] = {}
        self.data["projects"][self.project_name]["origin"]["selected_files"] = origin_list
        
        # Coped projects
        if "coped" not in self.data["projects"][self.project_name]:
            self.data["projects"][self.project_name]["coped"] = {}
        
        for coped_name, files in self.coped_selected.items():
            coped_path = os.path.join(file_dir, coped_name)
            coped_list = []
            for f in files:
                try:
                    rel = os.path.relpath(f, coped_path)
                    if not rel.startswith('..'):
                        coped_list.append(rel)
                    else:
                        coped_list.append(f)
                except ValueError:
                    coped_list.append(f)
            
            if coped_name not in self.data["projects"][self.project_name]["coped"]:
                self.data["projects"][self.project_name]["coped"][coped_name] = {}
            self.data["projects"][self.project_name]["coped"][coped_name]["selected_files"] = coped_list
        
        total = len(self.origin_selected) + sum(len(v) for v in self.coped_selected.values())
        print(f"[ConsoleWindow] Saving {total} selected files across sections.")
        save_data(self.data)
        self.close()
    
    def collect_checked_files_by_section(self, parent_item, root_path):
        """Collect checked files and categorize them by section (origin or coped)"""
        path = parent_item.data(0, Qt.ItemDataRole.UserRole)
        file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
        
        if path in ["ORIGIN_ROOT", "SHADOW_ROOT", "NONE_ROOT"]:
            pass
        elif os.path.isfile(path):
            if parent_item.checkState(0) == Qt.CheckState.Checked and (parent_item.flags() & Qt.ItemFlag.ItemIsUserCheckable):
                abs_path = os.path.abspath(path)
                
                # Determine which section this file belongs to
                if abs_path.startswith(os.path.abspath(file_dir)):
                    # It's in a coped project
                    rel_from_file = os.path.relpath(abs_path, file_dir)
                    parts = rel_from_file.split(os.sep)
                    if len(parts) >= 1:
                        coped_name = parts[0]
                        if coped_name in self.coped_selected:
                            self.coped_selected[coped_name].add(abs_path)
                            print(f"[ConsoleWindow] Added to coped '{coped_name}': {abs_path}")
                        else:
                            # New coped project not in data yet, add it
                            self.coped_selected[coped_name] = {abs_path}
                            print(f"[ConsoleWindow] Added to NEW coped '{coped_name}': {abs_path}")
                else:
                    # It's in origin
                    self.origin_selected.add(abs_path)
                    print(f"[ConsoleWindow] Added to origin: {abs_path}")
        
        for i in range(parent_item.childCount()):
            self.collect_checked_files_by_section(parent_item.child(i), root_path)

    def add_coped_project(self):
        # Determine Source
        source_path = self.project_path # Default to Origin
        source_name = "Origin"
        is_empty_create = False
        
        item = self.tree.currentItem()
        if item:
            path = item.data(0, Qt.ItemDataRole.UserRole)
            if path == "NONE_ROOT":
                is_empty_create = True
                source_name = "None (Empty)"
            elif path and os.path.isdir(path) and path != "ORIGIN_ROOT":
                # Ensure we are not copying "file/" itself or something weird
                source_path = path
                source_name = item.text(0)
            # If ORIGIN_ROOT or others, default to Origin

        promp_title = f"Create New Project from '{source_name}':"
        if is_empty_create:
            promp_title = "Create New EMPTY Project:"

        name, ok = QInputDialog.getText(self, "Add Coped Project", f"{promp_title}\nName (Folder Name):")
        if ok and name:
            safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '_', '-')]).strip()
            if not safe_name:
                QMessageBox.warning(self, "Error", "Invalid project name.")
                return

            # Validation 1: "shadow" is reserved
            if safe_name.lower() == "shadow":
                 QMessageBox.critical(self, "Error", "Name 'shadow' is reserved by System.")
                 return
            
            # Validation 2: Cannot be same as Origin Project
            if safe_name.lower() == self.project_name.lower():
                 QMessageBox.critical(self, "Error", f"Name '{safe_name}' is already used by the Origin Project.")
                 return
            
            # New Logic: Create in file/{project_name}/
            base_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
            if not os.path.exists(base_dir):
                os.makedirs(base_dir)
            
            new_path = os.path.join(base_dir, safe_name)
            if os.path.exists(new_path):
                QMessageBox.warning(self, "Error", f"Project '{safe_name}' already exists in {base_dir}.")
                return
                
            try:
                os.makedirs(new_path)

                if not is_empty_create:
                    # Copy ALL files from source to new_path
                    import shutil
                    
                    # Ignore function to skip .git, file/, __pycache__
                    def ignore_patterns(path, names):
                        ignored = []
                        if ".git" in names: ignored.append(".git")
                        if "__pycache__" in names: ignored.append("__pycache__")
                        # If we are copying Origin, 'file' is in it. We MUST ignore 'file' to avoid recursion/duplication
                        if "file" in names and os.path.abspath(path) == os.path.abspath(self.project_path):
                            ignored.append("file")
                        return ignored

                    shutil.copytree(source_path, new_path, ignore=ignore_patterns, dirs_exist_ok=True) # dirs_exist_ok because we makedirs above

                    # Register new coped project in data.json
                    if "coped" not in self.data["projects"][self.project_name]:
                        self.data["projects"][self.project_name]["coped"] = {}
                    self.data["projects"][self.project_name]["coped"][safe_name] = {"selected_files": []}
                    
                    # Inherit Selection State from source section
                    source_selected = []
                    if os.path.abspath(source_path) == os.path.abspath(self.project_path):
                        # Source is Origin
                        source_selected = self.data["projects"][self.project_name].get("origin", {}).get("selected_files", [])
                    else:
                        # Source is another coped project
                        source_coped_name = os.path.basename(source_path)
                        source_selected = self.data["projects"][self.project_name].get("coped", {}).get(source_coped_name, {}).get("selected_files", [])
                    
                    # Map selected files to new coped project
                    new_selected = []
                    abs_source = os.path.abspath(source_path)
                    
                    for rel_path in source_selected:
                        if os.path.isabs(rel_path):
                            if rel_path.startswith(abs_source):
                                inner_rel = os.path.relpath(rel_path, abs_source)
                                new_file_path = os.path.join(new_path, inner_rel)
                                if os.path.exists(new_file_path):
                                    new_selected.append(inner_rel)
                        else:
                            new_file_path = os.path.join(new_path, rel_path)
                            if os.path.exists(new_file_path):
                                new_selected.append(rel_path)
                    
                    self.data["projects"][self.project_name]["coped"][safe_name]["selected_files"] = new_selected
                    save_data(self.data)
                    
                    # Update local set
                    for rel in new_selected:
                        self.selected_files.add(os.path.normpath(os.path.join(new_path, rel)))

                    QMessageBox.information(self, "Success", f"Created '{safe_name}' from '{source_name}'.\nCopied {len(new_selected)} selections.")
                else:
                    # Empty project - still register in coped
                    if "coped" not in self.data["projects"][self.project_name]:
                        self.data["projects"][self.project_name]["coped"] = {}
                    self.data["projects"][self.project_name]["coped"][safe_name] = {"selected_files": []}
                    save_data(self.data)
                    QMessageBox.information(self, "Success", f"Created empty project '{safe_name}'.")

                self.build_tree()
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to create project: {e}")

    def delete_coped_project(self):
        item = self.tree.currentItem()
        if not item:
            QMessageBox.information(self, "Info", "Please select the project root to delete.")
            return

        # Check if it is a Coped Project Root
        # We set UserRole to the full path of the root
        path = item.data(0, Qt.ItemDataRole.UserRole)
        # Verify it's in 'file/' and is a directory
        
        # Simple check: Is it a child of "Coped Projects" (wait, ConsoleWindow has separate roots)
        # In ConsoleWindow, we have origin_root and now dynamic headers? 
        # Actually my build_tree makes them TopLevelItems generally? 
        # Let's verify standard 'file/XYZ' path pattern
        
        if path == "ORIGIN_ROOT" or path == self.project_path:
             QMessageBox.warning(self, "Warning", "Cannot delete Origin project from here.")
             return

        if path and os.path.isdir(path) and "file" in os.path.abspath(path):
            project_name = os.path.basename(path)
            reply = QMessageBox.question(
                self, 
                "Confirm Delete", 
                f"Are you sure you want to delete coped project '{project_name}'?\nPath: {path}\nThis cannot be undone.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No, 
                QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.Yes:
                try:
                    import shutil
                    shutil.rmtree(path)
                    QMessageBox.information(self, "Deleted", f"Project '{project_name}' deleted.")
                    self.build_tree()
                except Exception as e:
                    QMessageBox.critical(self, "Error", f"Failed to delete: {e}")
        else:
             QMessageBox.information(self, "Info", "Selected item is not a deletable Coped Project root.")

# ------------------------
# Shadow Manager Window (Pre-Launch)
# ------------------------
class ShadowManagerWindow(QWidget):
    def __init__(self, project_path, parent_window):
        super().__init__()
        self.project_path = project_path
        self.parent_window = parent_window
        self.shadow_root = os.path.join(SCRIPT_DIR, "file", "shadow")
        self.setWindowTitle("Shadow Layer Manager")
        self.resize(700, 500)
        self.init_ui()
        self.build_tree()

    def init_ui(self):
        layout = QHBoxLayout()
        
        # Left: Tree
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Shadow Layer Files")
        layout.addWidget(self.tree)
        
        # Right: Buttons
        btn_layout = QVBoxLayout()
        self.btn_enter = QPushButton("Enter (Launch VS Code)")
        self.btn_add = QPushButton("Add (Copy from Origin)")
        self.btn_delete = QPushButton("Delete (Remove form Shadow)")
        
        btn_layout.addWidget(self.btn_enter)
        btn_layout.addWidget(self.btn_add)
        btn_layout.addWidget(self.btn_delete)
        btn_layout.addStretch()
        
        layout.addLayout(btn_layout)
        self.setLayout(layout)
        
        self.btn_enter.clicked.connect(self.launch_vscode)
        self.btn_add.clicked.connect(self.add_files)
        self.btn_delete.clicked.connect(self.delete_files)
        
        # Add Sync Button (Moved from EnterWindow)
        self.btn_sync = QPushButton("Sync Shadow to Origin")
        self.btn_sync.setToolTip("Open Sync Window to copy files back to project")
        self.btn_sync.clicked.connect(self.open_sync_window)
        btn_layout.addWidget(self.btn_sync)

    def open_sync_window(self):
        self.sync_win = SyncWindow(self.project_path, self.parent_window)
        self.sync_win.show()

    def build_tree(self):
        self.tree.clear()
        if os.path.exists(self.shadow_root):
            self.add_items(self.tree, self.shadow_root)

    def add_items(self, parent_widget, path):
        name = os.path.basename(path)
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.ItemDataRole.UserRole, path)
        
        if isinstance(parent_widget, QTreeWidget):
            parent_widget.addTopLevelItem(item)
        else:
            parent_widget.addChild(item)

        if os.path.isdir(path):
            files = sorted(os.listdir(path))
            for f in files:
                self.add_items(item, os.path.join(path, f))

    def launch_vscode(self):
        self.close()
        self.parent_window.real_launch_vscode()

    def add_files(self):
        # Open file dialog at project root
        fname, _ = QFileDialog.getOpenFileName(self, "Select file to add to Shadow", self.project_path)
        if fname:
            try:
                rel = os.path.relpath(fname, self.project_path)
                if rel.startswith(".."):
                    QMessageBox.warning(self, "Error", "File must be inside project.")
                    return
                
                dest = os.path.join(self.shadow_root, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(fname, dest)
                self.build_tree()
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def delete_files(self):
        item = self.tree.currentItem()
        if not item: return
        path = item.data(0, Qt.ItemDataRole.UserRole)
        try:
            if os.path.isfile(path):
                os.remove(path)
            elif os.path.isdir(path):
                shutil.rmtree(path)
            self.build_tree()
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))


# ------------------------
# Sync Window (Save Shadow to Origin)
# ------------------------
class SyncWindow(QWidget):
    def __init__(self, project_path, parent_window):
        super().__init__()
        self.project_path = project_path
        self.parent_window = parent_window
        self.shadow_root = os.path.join(SCRIPT_DIR, "file", "shadow")
        self.setWindowTitle("Sync Shadow to Origin")
        self.resize(700, 500)
        self.init_ui()
        self.build_tree()

    def init_ui(self):
        layout = QHBoxLayout()
        
        # Left: Tree
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Select Files to Sync")
        layout.addWidget(self.tree)
        
        # Right: Buttons
        btn_layout = QVBoxLayout()
        self.btn_choose = QPushButton("Choose (Sync Selected)")
        
        btn_layout.addWidget(self.btn_choose)
        btn_layout.addStretch()
        
        layout.addLayout(btn_layout)
        self.setLayout(layout)
        
        self.btn_choose.clicked.connect(self.sync_files)

    def build_tree(self):
        self.tree.clear()
        if os.path.exists(self.shadow_root):
            self.add_items(self.tree, self.shadow_root)

    def add_items(self, parent_widget, path):
        name = os.path.basename(path)
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.ItemDataRole.UserRole, path)
        item.setCheckState(0, Qt.CheckState.Unchecked) # Default unchecked for safety? Or checked? User didn't specify.
        
        if isinstance(parent_widget, QTreeWidget):
            parent_widget.addTopLevelItem(item)
        else:
            parent_widget.addChild(item)

        if os.path.isdir(path):
            files = sorted(os.listdir(path))
            for f in files:
                self.add_items(item, os.path.join(path, f))
    
    def sync_files(self):
        count = 0
        try:
            # Iterate tree to find checked items
            iterator = QTreeWidgetItemIterator(self.tree)
            while iterator.value():
                item = iterator.value()
                if item.checkState(0) == Qt.CheckState.Checked:
                    shadow_path = item.data(0, Qt.ItemDataRole.UserRole)
                    if os.path.isfile(shadow_path):
                        rel = os.path.relpath(shadow_path, self.shadow_root)
                        dest = os.path.join(self.project_path, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        shutil.copy2(shadow_path, dest)
                        count += 1
                iterator += 1
            
            QMessageBox.information(self, "Success", f"Synced {count} files to origin.")
            self.close()
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

# ------------------------
# Project Choose Window
# ------------------------
from PyQt6.QtCore import pyqtSignal

class ProjectChooseWindow(QWidget):
    selection_made = pyqtSignal()

    def __init__(self, project_name, project_path, data, context_key="source_context"):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data
        self.context_key = context_key  # "source_context" or "coped_context"
        self.setWindowTitle("Choose Project to Process")
        self.resize(700, 500)
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        # Head
        layout.addWidget(QLabel(f"Origin Project: {self.project_name}\nPath: {self.project_path}"))

        # Tree
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Projects / Contexts")
        layout.addWidget(self.tree)

        # Debug Log (Initialize EARLY)
        self.log_widget = QTextEdit()
        self.log_widget.setPlaceholderText("Debug Log...")
        self.log_widget.setMaximumHeight(100)
        
        # Load saved context for THIS context_key
        saved_context = self.data["projects"][self.project_name].get(self.context_key)
        
        # Roots
        self.origin_item = QTreeWidgetItem([f"[Origin] {self.project_name}"])
        self.origin_item.setData(0, Qt.ItemDataRole.UserRole, self.project_path)
        
        # Check Origin if:
        #   1. Saved context matches Origin, OR
        #   2. No saved context AND context_key is 'source_context' (default for source)
        if saved_context == self.project_path:
            self.origin_item.setCheckState(0, Qt.CheckState.Checked)
        elif not saved_context and self.context_key == "source_context":
            self.origin_item.setCheckState(0, Qt.CheckState.Checked)
        else:
            self.origin_item.setCheckState(0, Qt.CheckState.Unchecked)
            
        self.tree.addTopLevelItem(self.origin_item)

        self.coped_root = QTreeWidgetItem(["Coped Projects"])
        self.tree.addTopLevelItem(self.coped_root)

        self.tree.addTopLevelItem(self.coped_root)

        # Populate Coped Projects (Scan 'file/{project_name}/' directory)
        file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
        if not os.path.exists(file_dir):
            os.makedirs(file_dir)
            
        # Ensure 'shadow' folder exists
        shadow_path = os.path.join(file_dir, "shadow")
        if not os.path.exists(shadow_path):
            os.makedirs(shadow_path)
            
        self.coped_roots = [] # Keep track for radio behavior
        
        if os.path.exists(file_dir):
            subdirs = sorted([d for d in os.listdir(file_dir) if os.path.isdir(os.path.join(file_dir, d))])
            first_coped = True
            for d in subdirs:
                if d == "__pycache__": continue
                if d.lower() == "shadow": continue # Hide Shadow Layer from UI
                
                full_path = os.path.join(file_dir, d)
                display_name = d
                
                item = QTreeWidgetItem([display_name])
                item.setData(0, Qt.ItemDataRole.UserRole, full_path)
                
                # Check if:
                #   1. Saved context matches this path, OR
                #   2. No saved context AND context_key is 'coped_context' AND this is first coped
                if saved_context == full_path:
                    item.setCheckState(0, Qt.CheckState.Checked)
                elif not saved_context and self.context_key == "coped_context" and first_coped:
                    item.setCheckState(0, Qt.CheckState.Checked)
                    first_coped = False
                else:
                    item.setCheckState(0, Qt.CheckState.Unchecked)
                
                self.coped_root.addChild(item)
                self.coped_roots.append(item)
                
                # Populate files
                self.populate_tree(item, full_path)

        self.coped_root.setExpanded(True)
        self.origin_item.setExpanded(True)

        self.tree.itemClicked.connect(self.handle_item_clicked)

        # Buttons
        btn_layout = QHBoxLayout()
        self.btn_apply = QPushButton("Apply")
        self.btn_cancel = QPushButton("Cancel")
        btn_layout.addWidget(self.btn_apply)
        btn_layout.addWidget(self.btn_cancel)
        layout.addLayout(btn_layout)

        self.btn_apply.clicked.connect(self.apply_changes)
        self.btn_cancel.clicked.connect(self.close)


        # Add Log Widget to Layout
        layout.addWidget(self.log_widget)
        self.setLayout(layout)  # <--- CRITICAL FIX: Apply the layout to the window
        
        self.log(f"Initialized ProjectChooseWindow for: {self.project_path}")

        self.log(f"Initialized ProjectChooseWindow for: {self.project_path}")

        # Populate NOW (after log widget exists)
        # Origin
        if os.path.exists(self.project_path):
            self.populate_tree(self.origin_item, self.project_path)
            
        # Coped Projects are already populated in the loop above (check lines 488-513 in original context)
        # The loop scanning 'file/' calls self.populate_tree(item, full_path) immediately.
        # So we don't need a separate call here for 'shadow_path'.

    def log(self, msg):
        self.log_widget.append(msg)
        print(f"[ProjectChooseWindow] {msg}")

    def populate_tree(self, parent_item, root_path):
        try:
            self.log(f"Populating path: {root_path}")
            if not os.path.exists(root_path):
                self.log(f"Path does not exist: {root_path}")
                return

            if os.path.isdir(root_path):
                files = sorted(os.listdir(root_path))
                # Get selected files for visual marking from ALL sections
                selected_set = set()
                
                # Load from origin
                origin_files = self.data["projects"][self.project_name].get("origin", {}).get("selected_files", [])
                for f in origin_files:
                    if os.path.isabs(f):
                        selected_set.add(os.path.normpath(f))
                    else:
                        selected_set.add(os.path.normpath(os.path.join(self.project_path, f)))
                
                # Load from all coped projects
                file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
                coped_dict = self.data["projects"][self.project_name].get("coped", {})
                for coped_name, coped_data in coped_dict.items():
                    coped_path = os.path.join(file_dir, coped_name)
                    for f in coped_data.get("selected_files", []):
                        if os.path.isabs(f):
                            selected_set.add(os.path.normpath(f))
                        else:
                            selected_set.add(os.path.normpath(os.path.join(coped_path, f)))
                
                self.log(f"Found {len(files)} files in {root_path}")
                for f in files:
                    full_path = os.path.join(root_path, f)
                    if f in [".git", "__pycache__", "file"]: 
                        continue # Skip generic ignores
                    
                    item = QTreeWidgetItem([f])
                    item.setData(0, Qt.ItemDataRole.UserRole, full_path)
                    
                    # Visual: Color/Bold for selected
                    norm_full_path = os.path.normpath(full_path)
                    if norm_full_path in selected_set:
                        from PyQt6.QtGui import QColor, QFont, QBrush
                        # Use a brighter green
                        item.setForeground(0, QBrush(QColor("#00CD00"))) # Medium Spring Green / Bright Green
                        font = item.font(0)
                        font.setBold(True)
                        item.setFont(0, font)

                    parent_item.addChild(item)
                    if os.path.isdir(full_path):
                        self.populate_tree(item, full_path)
            else:
                self.log(f"Not a directory: {root_path}")
        except Exception as e:
            self.log(f"Error populating tree: {e}")

    def handle_item_clicked(self, item, column):
        # Enforce Radio Behavior for Roots (Origin vs any Coped Root)
        roots = [self.origin_item] + getattr(self, "coped_roots", [])
        
        if item in roots:
            # Uncheck others
            for root in roots:
                if root != item:
                    root.setCheckState(0, Qt.CheckState.Unchecked)
            # Ensure clicked is checked
            if item.checkState(0) == Qt.CheckState.Unchecked:
                 item.setCheckState(0, Qt.CheckState.Checked)

    def apply_changes(self):
        try:
            selected_path = None
            
            # Check Origin
            if self.origin_item.checkState(0) == Qt.CheckState.Checked:
                selected_path = self.origin_item.data(0, Qt.ItemDataRole.UserRole)
            
            # Check Coped Roots
            if not selected_path:
                 coped_roots = getattr(self, "coped_roots", [])
                 for root in coped_roots:
                     if root.checkState(0) == Qt.CheckState.Checked:
                         selected_path = root.data(0, Qt.ItemDataRole.UserRole)
                         break
            
            if not selected_path:
                QMessageBox.warning(self, "Warning", "Please select a project.")
                return

            # Save to the correct context_key
            self.data["projects"][self.project_name][self.context_key] = selected_path
            save_data(self.data)
            # QMessageBox.information(self, "Saved", "Project selection saved.") 
            self.selection_made.emit()
            self.close()
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))



# ------------------------
# Enter Window
# ------------------------
class EnterWindow(QWidget):
    def __init__(self, project_name, project_path, data):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data

        self.setWindowTitle(f"Enter Workspace - {project_name}")
        self.resize(700, 600)
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()

        # 1. Info (Top)
        # main_window.from_top_see=[f"Project: {project_name}",f"Path: {project_path}"...]
        info_label = QLabel(f"Project: {self.project_name}\nPath: {self.project_path}")
        layout.addWidget(info_label)

        # 2. Source / Coped Buttons (Row 1)
        # [source_button, coped_button]
        row1 = QHBoxLayout()
        self.btn_source = QPushButton("Source")
        self.btn_source.setToolTip("Select Source Files (ControlFilesWindow)")
        self.btn_source.clicked.connect(self.open_source_manager)
        
        self.btn_coped = QPushButton("Coped")
        self.btn_coped.setToolTip("Select Shadow Files (ShadowManagerWindow)")
        self.btn_coped.clicked.connect(self.open_shadow_manager_direct)
        
        row1.addWidget(self.btn_source)
        row1.addWidget(self.btn_coped)
        layout.addLayout(row1)

        # 3. Toggles (Row 2)
        # [selected file of source, selected file of shadow, different from source to coped]
        row2 = QHBoxLayout()
        toggles = self.data["projects"][self.project_name].get("toggles", {})

        self.btn_toggle_src = QPushButton("Source Files")
        self.btn_toggle_src.setCheckable(True)
        self.btn_toggle_src.setChecked(toggles.get("source", True))
        self.btn_toggle_src.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        self.btn_toggle_shadow = QPushButton("Shadow Files")
        self.btn_toggle_shadow.setCheckable(True)
        self.btn_toggle_shadow.setChecked(toggles.get("shadow", True))
        self.btn_toggle_shadow.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        self.btn_toggle_diff = QPushButton("Diff (Source vs Coped)")
        self.btn_toggle_diff.setCheckable(True)
        self.btn_toggle_diff.setChecked(toggles.get("diff", True))
        self.btn_toggle_diff.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        row2.addWidget(self.btn_toggle_src)
        row2.addWidget(self.btn_toggle_shadow)
        row2.addWidget(self.btn_toggle_diff)
        layout.addLayout(row2)

        # 4. Input (Row 3)
        # input_box[1]
        layout.addWidget(QLabel("AI Command / Code Input:"))
        self.text_input = QTextEdit()
        self.text_input.setPlaceholderText("Enter AI commands or paste code...")
        layout.addWidget(self.text_input)

        # 5. Actions (Row 4)
        # [generate_chat_txt_button, Open_vs_code_button, toggle_switch[3]]
        row4 = QHBoxLayout()
        self.btn_gen_chat = QPushButton("Generate Prompt")
        self.btn_gen_chat.clicked.connect(self.generate_chat)
        
        self.btn_open_ide = QPushButton("Open IDE")
        self.btn_open_ide.clicked.connect(self.open_vscode_logic)
        
        # Removed toggle_switch[3] "Target: Coped" as per instructions
        
        row4.addWidget(self.btn_gen_chat)
        row4.addWidget(self.btn_open_ide)
        layout.addLayout(row4)

        # 5. Chat Actions (Row 5 - Copy/Paste)
        row5 = QHBoxLayout()
        self.btn_copy_chat = QPushButton("Copy Chat.txt")
        self.btn_copy_chat.clicked.connect(self.copy_chat)
        
        self.btn_paste_ai = QPushButton("Paste AI Response")
        self.btn_paste_ai.clicked.connect(self.paste_ai_response)
        
        row5.addWidget(self.btn_copy_chat)
        row5.addWidget(self.btn_paste_ai)
        layout.addLayout(row5)

        # Log
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMaximumHeight(120)
        layout.addWidget(QLabel("Operation Log:"))
        layout.addWidget(self.log_output)

        self.setLayout(layout)

    def copy_chat(self):
        chat_path = os.path.join(self.project_path, "chat.txt")
        if os.path.exists(chat_path):
            try:
                with open(chat_path, "r", encoding="utf-8") as f:
                    content = f.read()
                clipboard = QApplication.clipboard()
                clipboard.setText(content)
                self.log("Copied chat.txt to clipboard.")
            except Exception as e:
                self.log(f"Error reading chat.txt: {e}")
                QMessageBox.critical(self, "Error", str(e))
        else:
            self.log("chat.txt not found.")
            QMessageBox.warning(self, "Warning", "chat.txt not found.")

    def paste_ai_response(self):
        clipboard = QApplication.clipboard()
        text = clipboard.text()
        if not text:
            self.log("Clipboard is empty.")
            return
            
        chat_path = os.path.join(self.project_path, "chat.txt")
        try:
            # Append to chat.txt
            with open(chat_path, "a", encoding="utf-8") as f:
                f.write("\n\n" + text)
            self.log("Appended AI response to chat.txt.")
        except Exception as e:
            self.log(f"Error writing to chat.txt: {e}")
            QMessageBox.critical(self, "Error", str(e))

    # ------------------------
    # Helpers for New Buttons
    # ------------------------
    def open_source_manager(self):
        # Open ProjectChooseWindow for Source context
        self.proj_choose_source = ProjectChooseWindow(self.project_name, self.project_path, self.data, context_key="source_context")
        self.proj_choose_source.show()

    def open_shadow_manager_direct(self):
        # Open ProjectChooseWindow for Coped context
        self.proj_choose_coped = ProjectChooseWindow(self.project_name, self.project_path, self.data, context_key="coped_context")
        self.proj_choose_coped.show()

    def open_vscode_logic(self):
        # Open ProjectChooseWindow first
        self.proj_choose_vscode = ProjectChooseWindow(self.project_name, self.project_path, self.data)
        self.proj_choose_vscode.selection_made.connect(self.decide_and_launch_vscode)
        self.proj_choose_vscode.show()

    def decide_and_launch_vscode(self):
        # Launch based on SAVED context
        try:
            context = self.data["projects"][self.project_name].get("active_context")
            if not context:
                # Default to project path if nothing set
                context = self.project_path
            
            # Check if context is Shadow to enable extension?
            # User requirement: "make sure the extension of vscode is workful"
            # We will ALWAYS load the extension for now, but point VS Code to the selected folder.
            
            import subprocess
            base_dir = os.path.dirname(os.path.abspath(__file__))
            ext_path = os.path.join(base_dir, "ai-coder-helper")
            
            code_cmd = shutil.which("code")
            if not code_cmd:
                 # Fallback check
                common_paths = [
                    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles%\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"),
                ]
                for p in common_paths:
                    if os.path.exists(p):
                        code_cmd = p
                        break
            
            if not code_cmd:
                QMessageBox.warning(self, "Error", "VS Code not found.")
                return

            cmd = [code_cmd, context, f"--extensionDevelopmentPath={ext_path}"]
            self.log(f"Launching Code on: {context}")
            subprocess.Popen(cmd, shell=True)

        except Exception as e:
            self.log(f"Error launching: {e}")

    def open_vscode_standard(self):
        try:
            import subprocess
            code_cmd = shutil.which("code")
            # ... (Standard lookup logic, reusing what we had or simplifying)
            if not code_cmd:
                QMessageBox.warning(self, "Error", "VS Code not found.")
                return
            subprocess.Popen([code_cmd, self.project_path], shell=True)
            self.log("VS Code (Standard) launched.")
        except Exception as e:
            self.log(f"Error: {e}")

    def log(self, message):
        self.log_output.append(message)

    # ------------------------
    # Generate chat.txt (Updated with Toggles)
    # ------------------------
    def get_canonical_relpath(self, path):
        # Resolve path to a relative path from its "Project Root" (Origin or Coped)
        # 1. Check if in 'file/' (Coped)
        file_dir = os.path.join(self.project_path, "file")
        abs_path = os.path.abspath(path)
        
        if abs_path.startswith(os.path.abspath(file_dir)):
            # It's in a coped project
            rel_from_file = os.path.relpath(abs_path, file_dir)
            # rel_from_file might be "Second\main.py"
            # We want to strip the first component ("Second")
            parts = rel_from_file.split(os.sep)
            if len(parts) > 1:
                return os.path.join(*parts[1:])
            return None # Should not happen for valid files
        
        # 2. Assume Origin
        rel = os.path.relpath(abs_path, self.project_path)
        if rel.startswith(".."):
            return None # Ignore files outside project
        return rel

    def generate_chat(self):
        try:
            # RELOAD DATA to ensure we have the latest 'selected_files' from ConsoleWindow
            self.data = load_data() 
            
            # SAVE TOGGLES for Extension to use
            self.data["projects"][self.project_name]["toggles"] = {
                "source": self.btn_toggle_src.isChecked(),
                "shadow": self.btn_toggle_shadow.isChecked(),
                "diff": self.btn_toggle_diff.isChecked()
            }
            save_data(self.data)

            # Load selected_files from ALL sections (origin + coped)
            selected_files = []
            
            # Load from origin
            origin_files = self.data["projects"][self.project_name].get("origin", {}).get("selected_files", [])
            for f in origin_files:
                if os.path.isabs(f):
                    selected_files.append(f)
                else:
                    selected_files.append(os.path.join(self.project_path, f))
            
            # Load from all coped projects
            file_dir = os.path.join(SCRIPT_DIR, "file", self.project_name)
            coped_dict = self.data["projects"][self.project_name].get("coped", {})
            for coped_name, coped_data in coped_dict.items():
                coped_path = os.path.join(file_dir, coped_name)
                for f in coped_data.get("selected_files", []):
                    if os.path.isabs(f):
                        selected_files.append(f)
                    else:
                        selected_files.append(os.path.join(coped_path, f))
            
            # Permissive: Allow generation even if no files are selected

            # Determine Contexts (Ensure Absolute)
            # Track if contexts are explicitly set vs using defaults
            raw_source_context = self.data["projects"][self.project_name].get("source_context")
            raw_coped_context = self.data["projects"][self.project_name].get("coped_context")
            
            # Normalize for comparison
            p_path_norm = os.path.normcase(os.path.abspath(self.project_path))
            raw_src_norm = os.path.normcase(os.path.abspath(raw_source_context)) if raw_source_context else None
            raw_coped_norm = os.path.normcase(os.path.abspath(raw_coped_context)) if raw_coped_context else None
            
            # source/coped_is_origin: True if explicitly set to project path (or Source default)
            source_is_origin = raw_source_context is None or raw_source_context == "" or raw_src_norm == p_path_norm
            coped_is_origin = raw_coped_norm == p_path_norm
            
            coped_explicitly_set = raw_coped_context is not None and raw_coped_context != ""
            
            # self.log(f"DEBUG: Raw Source: '{raw_source_context}', Is Origin: {source_is_origin}")
            # self.log(f"DEBUG: Raw Coped: '{raw_coped_context}', Is Origin: {coped_is_origin}, Explicit: {coped_explicitly_set}")
            
            source_root = raw_source_context if raw_source_context else self.project_path
            coped_root = raw_coped_context if raw_coped_context else os.path.join(SCRIPT_DIR, "file", "shadow")
            
            script_dir = os.path.dirname(os.path.abspath(__file__))
            
            # If path starts with 'file', it's relative to coder directory (script_dir), not project_path
            if not os.path.isabs(source_root):
                if source_root.startswith("file" + os.sep) or source_root.startswith("file/"):
                    source_root = os.path.join(script_dir, source_root)
                else:
                    source_root = os.path.join(self.project_path, source_root)
            
            if not os.path.isabs(coped_root):
                if coped_root.startswith("file" + os.sep) or coped_root.startswith("file/"):
                    coped_root = os.path.join(script_dir, coped_root)
                else:
                    coped_root = os.path.join(self.project_path, coped_root)

            source_root = os.path.abspath(source_root)
            coped_root = os.path.abspath(coped_root)

            self.log(f"Generating Prompt with:")
            self.log(f"  Source Context: {source_root}")
            self.log(f"  Coped Context: {coped_root}")

            # Filter Selected Files by Context
            # We ONLY consider files that are explicitly selected WITHIN the chosen root.
            src_files = [] 
            coped_files = []
            
            # Normalize selected_files to sets of absolute paths for easy checking
            abs_selected = set()
            for p in selected_files:
                # Fix: Resolve relative paths from project_path, not current working directory
                if os.path.isabs(p):
                    abs_p = os.path.normpath(p)
                else:
                    # Relative path - resolve from project_path
                    abs_p = os.path.normpath(os.path.join(self.project_path, p))
                
                # Safety check: Allow files under project_path OR under coder's file/ directory
                rel_to_project = os.path.relpath(abs_p, self.project_path)
                rel_to_file_dir = os.path.relpath(abs_p, os.path.join(script_dir, "file"))
                
                if not rel_to_project.startswith("..") or not rel_to_file_dir.startswith(".."):
                    abs_selected.add(abs_p)

            # Assign to contexts
            def is_subpath(p, r):
                # Ensure r ends with separator or checking exact match
                # Use normcase to handle Windows case insensitivity and separators
                r = os.path.normcase(os.path.abspath(r))
                p = os.path.normcase(os.path.abspath(p))
                return p == r or p.startswith(os.path.join(r, ""))

            self.log(f"DEBUG: Filtering {len(abs_selected)} files...")
            self.log(f"DEBUG: Source Root (norm): {os.path.normcase(os.path.abspath(source_root))}")
            self.log(f"DEBUG: Coped Root (norm): {os.path.normcase(os.path.abspath(coped_root))}")

            for path in abs_selected:
                is_src = is_subpath(path, source_root)
                is_coped = is_subpath(path, coped_root)
                self.log(f"DEBUG: Checking {path} -> Src: {is_src}, Coped: {is_coped}")

                if is_src:
                    src_files.append(path)
                
                # Check Coped match independently (in case user selected Origin for both contexts)
                # However, if roots differ, we want strict separation.
                # If source_root == coped_root, then src_files == coped_files.
                
                if is_coped:
                    coped_files.append(path)

            # Prepare Relative Paths for Display & Diff
            src_rels = {} # rel -> abs_path
            for p in src_files:
                rel = os.path.relpath(p, source_root)
                src_rels[rel] = p
            
            coped_rels = {} # rel -> abs_path
            for p in coped_files:
                rel = os.path.relpath(p, coped_root)
                coped_rels[rel] = p

            content = ""
            
            # 1. System Prompt (Penter Unified Prompt)
            # 1. System Prompt
            self.log("DEBUG: Starting generate_chat...")
            prompt_file = os.path.join(SCRIPT_DIR, "file", "prompt.txt")
            if os.path.exists(prompt_file):
                try:
                    with open(prompt_file, "r", encoding="utf-8") as f:
                        prompt_text = f.read()
                        content += prompt_text
                        self.log(f"DEBUG: Loaded prompt.txt ({len(prompt_text)} chars)")
                except Exception as e:
                     content += f"// Error reading prompt.txt: {e}\n\n"
                     self.log(f"DEBUG: Error reading prompt.txt: {e}")
            else:
                 # self.log("DEBUG: prompt.txt NOT found. Using fallback.")
                 content += "// Warning: prompt.txt not found.\n"
                 content += "You are Penter AI.\n\n"

             # 2. Input Prompt
            user_input = self.text_input.toPlainText()
            
            # Resolve Source/Coped Project Names
            source_name = "[Not Selected]"
            coped_name = "[Not Selected]"

            def find_project_by_path(target_path):
                target = os.path.normcase(os.path.abspath(target_path))
                curr_proj_path_norm = os.path.normcase(os.path.abspath(self.project_path))
                script_dir = os.path.dirname(os.path.abspath(__file__))
                file_dir_norm = os.path.normcase(os.path.join(script_dir, "file"))
                
                # Priority 1: Check Database for EXACT match (Handles nested projects)
                for name, info in self.data.get("projects", {}).items():
                    p_path = info.get("path")
                    if p_path:
                        norm_p = os.path.normcase(os.path.abspath(p_path))
                        if norm_p == target:
                            return name

                # Priority 2: Check against Current Project (Root)
                if target == curr_proj_path_norm:
                     return self.project_name
                
                # Priority 3: Coped Folder
                if target.startswith(file_dir_norm + os.sep):
                    rel_to_file = os.path.relpath(target, file_dir_norm)
                    parts = rel_to_file.split(os.sep)
                    if len(parts) >= 2:
                        coped_folder_name = parts[1]
                        self.log(f"DEBUG: Coped folder name extracted: {coped_folder_name}")
                        return coped_folder_name
                    elif len(parts) == 1:
                        self.log(f"DEBUG: Direct folder name: {parts[0]}")
                        return parts[0]
                
                # Priority 4: Subpath of Current?
                if target.startswith(curr_proj_path_norm + os.sep):
                    self.log("DEBUG: Subpath match found (Current Project)")
                    return self.project_name

                return None

            # Resolve names based on context selection
            if source_is_origin:
                source_name = self.project_name
            else:
                found_src = find_project_by_path(source_root)
                if found_src: source_name = found_src

            if coped_explicitly_set:
                found_coped = find_project_by_path(coped_root)
                if found_coped: coped_name = found_coped

            # Always output Task Description Header & Project Context
            content += "# Task Description\n"
            content += f"Origin Project: {self.project_name}\n"

            # Conditional Injection based on GUI Toggles
            show_source = self.btn_toggle_src.isChecked()
            show_shadow = self.btn_toggle_shadow.isChecked()
            show_diff = self.btn_toggle_diff.isChecked()
            
            # Determine ACTIVE names based on toggles (UI Logic)
            active_source_name = source_name if (show_source or show_diff) else "[Disabled]"
            active_coped_name = coped_name if (show_shadow or show_diff) else "[Disabled]"
            
            self.log(f"DEBUG: Toggles - Source: {show_source}, Shadow: {show_shadow}, Diff: {show_diff}")
            self.log(f"DEBUG: Active Names - Current: {self.project_name}, Source: {active_source_name}, Coped: {active_coped_name}")

            if show_diff:
                content += f"Source Project: {source_name}\n"
                content += f"Coped Project: {coped_name}\n"
            else:
                if show_source:
                    content += f"Source Project: {source_name}\n"
                if show_shadow:
                    content += f"Coped Project: {coped_name}\n"
            
            if user_input:
                content += "\n" + user_input + "\n\n"
            else:
                content += "\n(No manual task description provided)\n\n"
                self.log("DEBUG: User input is empty/None")

            # 3. Source Files (Only src_rels)
            if self.btn_toggle_src.isChecked():
                content += f"# Source Files (Context: {os.path.basename(source_root)})\n"
                sorted_src = sorted(src_rels.keys())
                if not sorted_src:
                     content += "(No files selected in Source Context. Hint: Ensure you selected files from the **Source Project** tree in Console.)\n\n"
                
                for rel in sorted_src:
                    path = src_rels[rel]
                    if os.path.exists(path):
                        content += f"## {rel}\n```\n"
                        try:
                            with open(path, "r", encoding="utf-8") as f:
                                # Add line numbers to help Penter Spec
                                lines = f.readlines()
                                for i, line in enumerate(lines, 1):
                                    content += f"{i:4} | {line}"
                        except: content += "(Error reading file)"
                        content += "\n```\n\n"
                    else:
                        content += f"## {rel}\n(File not found in Source Context)\n\n"

            # 4. Shadow Files (Only coped_rels)
            if self.btn_toggle_shadow.isChecked():
                content += f"# Shadow Files (Context: {os.path.basename(coped_root)})\n"
                sorted_coped = sorted(coped_rels.keys())
                if not sorted_coped:
                     content += "(No files selected in Coped Context. Hint: Ensure you selected files from the **Coped Project** tree in Console.)\n\n"

                for rel in sorted_coped:
                    path = coped_rels[rel]
                    if os.path.exists(path):
                        content += f"## (Shadow) {rel}\n```\n"
                        try:
                            with open(path, "r", encoding="utf-8") as f:
                                # Add line numbers to help Penter Spec
                                lines = f.readlines()
                                for i, line in enumerate(lines, 1):
                                    content += f"{i:4} | {line}"
                        except: content += "(Error reading file)"
                        content += "\n```\n\n"
                    else:
                         content += f"## (Shadow) {rel}\n(File not found in Coped Context)\n\n"

            # 5. Diff Report (Intersection of Selected Files)
            if self.btn_toggle_diff.isChecked():
                # Rel paths that exist in BOTH selections
                common_rels = set(src_rels.keys()) & set(coped_rels.keys())
                sorted_common = sorted(list(common_rels))
                
                if sorted_common:
                    diff_report = self.get_diff_report_context(source_root, coped_root, sorted_common)
                    if diff_report:
                        content += "# Diff Report (Source -> Shadow)\n"
                        content += diff_report + "\n\n"
                else:
                    if src_rels or coped_rels:
                        content += "# Diff Report\n(No common files selected between Source and Coped context to compare)\n\n"

            # Save to Project Root (consistent with copy_chat)
            chat_path = os.path.join(self.project_path, "chat.txt")
            
            with open(chat_path, "w", encoding="utf-8") as f:
                f.write(content)
                
            self.log(f"chat.txt generated ({len(content)} chars).")
            self.btn_copy_chat.setEnabled(True)
            self.copy_chat() # Auto-copy convenience
            
        except Exception as e:
            self.log(f"Error generating chat.txt: {e}")
            import traceback
            traceback.print_exc()

    def get_diff_report_context(self, source_root, coped_root, rels):
        try:
            import difflib
            diffs = []
            for rel in rels:
                src_file = os.path.join(source_root, rel)
                dst_file = os.path.join(coped_root, rel)
                
                src_lines = []
                dst_lines = []
                
                if os.path.exists(src_file):
                     with open(src_file, 'r', encoding='utf-8') as f: src_lines = f.readlines()
                if os.path.exists(dst_file):
                     with open(dst_file, 'r', encoding='utf-8') as f: dst_lines = f.readlines()
                     
                matcher = difflib.SequenceMatcher(None, src_lines, dst_lines)
                file_diffs = []
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == "replace":
                        file_diffs.append(f"Line {i1+1}-{i2}: Replace with\n{''.join(dst_lines[j1:j2])}")
                    elif tag == "delete":
                        file_diffs.append(f"Line {i1+1}-{i2}: Delete")
                    elif tag == "insert":
                        file_diffs.append(f"Line {i1+1}: Insert\n{''.join(dst_lines[j1:j2])}")
                
                if file_diffs:
                    diffs.append(f"### {rel}")
                    diffs.extend(file_diffs)
            
            return "\n".join(diffs)
        except Exception as e: return f"Error diffing: {e}"

    def get_diff_report(self):
        try:
            shadow_root = os.path.join(SCRIPT_DIR, "file", "shadow")
            if not os.path.exists(shadow_root):
                return None
            
            import difflib
            diffs = []
            # Compare ALL files in shadow? or just selected? prompt didn't specify. 
            # Ideally comprehensive diff.
            for root, dirs, files in os.walk(shadow_root):
                for file in files:
                    shadow_file = os.path.join(root, file)
                    rel = os.path.relpath(shadow_file, shadow_root)
                    origin_file = os.path.join(self.project_path, rel)
                    
                    with open(shadow_file, 'r', encoding='utf-8') as f: shadow_lines = f.readlines()
                    if os.path.exists(origin_file):
                        with open(origin_file, 'r', encoding='utf-8') as f: origin_lines = f.readlines()
                    else: origin_lines = [] # New file

                    matcher = difflib.SequenceMatcher(None, origin_lines, shadow_lines)
                    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                        if tag == "replace":
                            diffs.append(f"{rel} replace@{i1+1}-{i2}{{\n{''.join(shadow_lines[j1:j2])}}}")
                        elif tag == "delete":
                            diffs.append(f"{rel} del@{i1+1}-{i2}")
                        elif tag == "insert":
                            diffs.append(f"{rel} add@{i1}{{\n{''.join(shadow_lines[j1:j2])}}}")
            
            return "\n".join(diffs) if diffs else "No differences found."
        except: return None

    # ------------------------
    # Copy chat.txt
    # ------------------------
    def copy_chat(self):
        try:
            # Use self.project_path for consistency
            chat_path = os.path.join(self.project_path, "chat.txt")
            if os.path.exists(chat_path):
                with open(chat_path, "r", encoding="utf-8") as f:
                    content = f.read()
                QApplication.clipboard().setText(content)
                self.log("chat.txt copied to clipboard!")
            else:
                self.log("chat.txt not found!")
        except Exception as e:
            self.log(f"Error copying chat.txt: {e}")

    def paste_ai_response(self):
        """Paste AI response from clipboard and append to chat.txt"""
        try:
            clipboard_content = QApplication.clipboard().text()
            if not clipboard_content:
                QMessageBox.warning(self, "Error", "Clipboard is empty!")
                return
            
            # Use self.project_path for consistency
            chat_path = os.path.join(self.project_path, "chat.txt")
            
            if not os.path.exists(chat_path):
                 QMessageBox.warning(self, "Error", "chat.txt not found! Generate it first.")
                 return

            with open(chat_path, "a", encoding="utf-8") as f:
                f.write("\n\n# AI Response\n\n")
                f.write(clipboard_content)
            
            self.log(f"Pasted {len(clipboard_content)} chars to chat.txt")
            QMessageBox.information(self, "Success", "AI response appended to chat.txt!")
            
        except Exception as e:
            self.log(f"Error pasting response: {e}")
            QMessageBox.critical(self, "Error", f"Failed to paste: {e}")

    # ------------------------
    # VS Code Extension
    # ------------------------
    # ------------------------
    # VS Code Extension
    # ------------------------
    def open_vscode_with_extension(self):
        # 1. Save AI commands
        try:
            cmd_path = os.path.join(SCRIPT_DIR, "file", "ai_commands.txt")
            os.makedirs(os.path.join(SCRIPT_DIR, "file"), exist_ok=True)
            with open(cmd_path, "w", encoding="utf-8") as f:
                f.write(self.text_input.toPlainText())
        except: pass

        # 2. Sync selected files to shadow (Initialize if needed)
        # (DISABLED: Legacy shadow logic - coped folders are now per-project under file/<project>/<coped_name>)
        # try:
        #     selected_files = self.data["projects"][self.project_name].get("selected_files", [])
        #     shadow_root = os.path.join("file", "shadow")
        #     os.makedirs(shadow_root, exist_ok=True)
        #     for file_path in selected_files:
        #         if os.path.exists(file_path):
        #             rel = os.path.relpath(file_path, self.project_path)
        #             dest = os.path.join(shadow_root, rel)
        #             # Only copy if not exists to act as init
        #             if not os.path.exists(dest):
        #                 os.makedirs(os.path.dirname(dest), exist_ok=True)
        #                 shutil.copy2(file_path, dest)
        # except: pass

        # 3. Open Shadow Manager Window instead of direct launch
        self.shadow_manager = ShadowManagerWindow(self.project_path, self)
        self.shadow_manager.show()

    def real_launch_vscode(self):
        try:
            import subprocess
            base_dir = os.path.dirname(os.path.abspath(__file__))
            ext_path = os.path.join(base_dir, "ai-coder-helper")
            
            code_cmd = shutil.which("code")
            if not code_cmd:
                # Fallback check
                common_paths = [
                    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles%\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"),
                ]
                for p in common_paths:
                    if os.path.exists(p):
                        code_cmd = p
                        break

            if not code_cmd:
                QMessageBox.warning(self, "Error", "VS Code not found in PATH.")
                return
            
            # Determine which path to open based on context
            # Priority: If Shadow toggle is ON, open Coped. Otherwise open Source.
            if self.btn_toggle_shadow.isChecked():
                coped_context = self.data["projects"][self.project_name].get("coped_context")
                if coped_context and os.path.isabs(coped_context):
                    target_path = coped_context
                elif coped_context:
                    target_path = os.path.abspath(coped_context)
                else:
                    target_path = self.project_path  # Fallback to Origin
            else:
                source_context = self.data["projects"][self.project_name].get("source_context", self.project_path)
                if os.path.isabs(source_context):
                    target_path = source_context
                else:
                    target_path = os.path.abspath(source_context)
            
            # Launch
            self.log(f"Launching VS Code for path: {target_path}")
            subprocess.Popen([code_cmd, target_path, f"--extensionDevelopmentPath={ext_path}"])
            self.log("VS Code launched with AI extension.")
        except Exception as e:
            self.log(f"Error launching VS Code: {e}")

    def open_vscode_logic(self):
        # Open ProjectChooseWindow for user to select which project to open
        self.ide_choose_window = ProjectChooseWindow(
            self.project_name,
            self.project_path,
            self.data,
            context_key="ide_context"  # Use a separate key for IDE selection
        )
        self.ide_choose_window.selection_made.connect(self.launch_vscode_for_selected)
        self.ide_choose_window.show()

    def launch_vscode_for_selected(self):
        # Get the selected path from ide_context
        ide_context = self.data["projects"][self.project_name].get("ide_context")
        if not ide_context:
            self.log("No project selected for IDE.")
            return
        
        # Resolve path
        if os.path.isabs(ide_context):
            target_path = ide_context
        else:
            target_path = os.path.abspath(ide_context)
        
        # Launch VS Code
        try:
            import subprocess
            base_dir = os.path.dirname(os.path.abspath(__file__))
            ext_path = os.path.join(base_dir, "ai-coder-helper")
            
            code_cmd = shutil.which("code")
            if not code_cmd:
                common_paths = [
                    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles%\Microsoft VS Code\bin\code.cmd"),
                    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"),
                ]
                for p in common_paths:
                    if os.path.exists(p):
                        code_cmd = p
                        break

            if not code_cmd:
                QMessageBox.warning(self, "Error", "VS Code not found in PATH.")
                return
            
            self.log(f"Launching VS Code for path: {target_path}")
            subprocess.Popen([code_cmd, target_path, f"--extensionDevelopmentPath={ext_path}"])
            self.log("VS Code launched with AI extension.")
        except Exception as e:
            self.log(f"Error launching VS Code: {e}")

    # ------------------------
    # Save Different to chat.txt
    # ------------------------
    def save_different_to_chat(self):
        try:
            shadow_root = os.path.join(SCRIPT_DIR, "file", "shadow")
            chat_path = os.path.join(SCRIPT_DIR, "file", self.project_name, "chat.txt")
            os.makedirs(os.path.dirname(chat_path), exist_ok=True)
            if not os.path.exists(shadow_root):
                self.log("Shadow layer not found.")
                return

            import difflib
            diffs = []
            for root, dirs, files in os.walk(shadow_root):
                for file in files:
                    shadow_file = os.path.join(root, file)
                    rel = os.path.relpath(shadow_file, shadow_root)
                    origin_file = os.path.join(self.project_path, rel)
                    with open(shadow_file, 'r', encoding='utf-8') as f:
                        shadow_lines = f.readlines()
                    if os.path.exists(origin_file):
                        with open(origin_file, 'r', encoding='utf-8') as f:
                            origin_lines = f.readlines()
                    else:
                        origin_lines = []

                    matcher = difflib.SequenceMatcher(None, origin_lines, shadow_lines)
                    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                        if tag == "equal":
                            continue
                        elif tag == "replace":
                            diffs.append(f"{rel} replace@{i1+1}-{i2}{{\n{''.join(shadow_lines[j1:j2])}}}")
                        elif tag == "delete":
                            diffs.append(f"{rel} del@{i1+1}-{i2}")
                        elif tag == "insert":
                            diffs.append(f"{rel} add@{i1}{{\n{''.join(shadow_lines[j1:j2])}}}")

            if diffs:
                with open(chat_path, "a", encoding="utf-8") as f:
                    f.write("\n\n# Diff Report\n")
                    f.write("\n".join(diffs))
                self.log(f"Diff saved to: {os.path.abspath(chat_path)} ({len(diffs)} changes)")
                QMessageBox.information(self, "Success", f"Diff saved to chat.txt ({len(diffs)} changes).")
            else:
                self.log("No differences found.")
        except Exception as e:
            self.log(f"Error saving diff: {e}")

    # ------------------------
    # Save Shadow to Origin
    # ------------------------
    # ------------------------
    # Save Shadow to Origin
    # ------------------------
    def save_shadow_to_origin(self):
        # Open Sync Window instead of direct sync
        self.sync_window = SyncWindow(self.project_path, self)
        self.sync_window.show()

    # ------------------------
    # Launch Logic
    # ------------------------
    def real_launch_vscode(self, file_list):
        print("Launching VS Code with files:")
        for f in file_list:
            print(f" - {f}")
        # Placeholder: In strict mode, maybe pass these as args to 'code'?
        # But usually 'code .' opens folder. To open specific files: 'code f1 f2 ...'
        if not file_list:
            print("No files to launch.")
            return
            
        try:
            # Find code executable logic (reused from open_vscode_logic or simplified)
            code_cmd = "code" # simplified
            # If you need absolute path detection, reuse open_vscode_logic logic
            
            # Here we just print as requested by user
            QMessageBox.information(self, "Launch", f"Prepared {len(file_list)} files. Check Console for list.")
        except Exception as e:
            print(f"Error in real_launch_vscode: {e}")

    def prepare_and_launch(self):
        final_files = set()
        # Parse selected_files (Convert to absolute sets for easier handling)
        raw_selected = self.data["projects"][self.project_name].get("selected_files", [])
        abs_selected = set()
        for p in raw_selected:
            if os.path.isabs(p):
                 abs_selected.add(os.path.normcase(p))
            else:
                 abs_selected.add(os.path.normcase(os.path.abspath(p)))

        # Context Roots
        source_root = os.path.abspath(self.project_path)
        # Determine Coped Root - coped_context is RELATIVE to SCRIPT DIR, not CWD or project_path
        coped_context = self.data["projects"][self.project_name].get("coped_context", os.path.join(SCRIPT_DIR, "file", self.project_name, "shadow"))
        # Always resolve relative to script directory to avoid CWD issues
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if os.path.isabs(coped_context):
            coped_root = coped_context
        else:
            coped_root = os.path.join(script_dir, coped_context)

        # 1. Source Logic
        if self.btn_toggle_src.isChecked():
            # Add Source-side selected files
            # (Strictly those under source_root)
            for p in abs_selected:
                if p.startswith(os.path.normcase(source_root) + os.sep):
                     final_files.add(p)
                # If user wants ALL selected files regardless of context (as per simple prompt), 
                # uncomment next line and comment above check:
                # final_files.add(p)

        # 2. Shadow Logic - Use selected files that are in Coped context
        if self.btn_toggle_shadow.isChecked():
            print(f"[prepare_and_launch] Filtering selected files under Shadow Root: {coped_root}")
            for p in abs_selected:
                # Check if this file is under coped_root
                if p.startswith(os.path.normcase(coped_root) + os.sep) or p == os.path.normcase(coped_root):
                    final_files.add(p)
                    print(f"[prepare_and_launch] Added Shadow file: {p}")
            print(f"[prepare_and_launch] Files after Shadow Filter: {len(final_files)}")

        # 3. Diff Logic
        if self.btn_toggle_diff.isChecked():
            print("[prepare_and_launch] Diff Filter is ON. Removing identical files...")
            # Filter final_files: Keep only if diff exists
            # We assume "Diff" means "Differs from counterpart".
            # For a file, we find its pair.
            
            diff_kept = set()
            for path in final_files:
                path = os.path.normcase(path)
                
                # Determine Identity
                # Is it Source?
                if path.startswith(os.path.normcase(source_root)):
                    rel = os.path.relpath(path, source_root)
                    counterpart = os.path.join(coped_root, rel)
                elif path.startswith(os.path.normcase(coped_root)):
                    rel = os.path.relpath(path, coped_root)
                    counterpart = os.path.join(source_root, rel)
                else:
                    # Unknown file (not in either root), keep it just in case? Or discard?
                    # "Keep only diffs" implies discarding if irrelevant.
                    continue
                
                counterpart = os.path.normcase(os.path.abspath(counterpart))
                
                # Check Diff
                # Case 1: Counterpart missing -> Diff (Creation/Deletion)
                if not os.path.exists(counterpart):
                    diff_kept.add(path)
                    continue
                
                # Case 2: Content Differs
                try:
                    if not filecmp.cmp(path, counterpart, shallow=False):
                         print(f"Diff Found: {path}")
                         diff_kept.add(path)
                except Exception:
                    # Error reading? Assume diff
                    diff_kept.add(path)
            
            print(f"[prepare_and_launch] Files removed by Diff Filter: {len(final_files) - len(diff_kept)}")
            final_files = diff_kept

        # Output
        print(f"[prepare_and_launch] Final Files Count: {len(final_files)}")
        self.real_launch_vscode(list(final_files))

    # [DUPLICATE generate_chat REMOVED]

    # [DUPLICATE generate_chat REMAINING CODE REMOVED]

    # [DUPLICATE METHODS REMOVED]


# ------------------------
# Main Window
# ------------------------
class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Project Manager")
        self.resize(500, 220)
        self.data = load_data()
        self.current_project = self.data.get("current_project")
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        if not self.current_project:
            self.project_label = QLabel("No project selected")
            self.path_label = QLabel("")
        else:
            proj = self.data["projects"][self.current_project]
            self.project_label = QLabel(f"Current Project: {self.current_project}")
            self.path_label = QLabel(f"Path: {proj['path']}")
        layout.addWidget(self.project_label)
        layout.addWidget(self.path_label)

        btn_layout = QHBoxLayout()
        self.btn_control = QPushButton("Console")
        self.btn_enter = QPushButton("Enter")
        self.btn_exit = QPushButton("Exit")
        btn_layout.addWidget(self.btn_control)
        btn_layout.addWidget(self.btn_enter)
        btn_layout.addWidget(self.btn_exit)
        layout.addLayout(btn_layout)

        self.btn_control.clicked.connect(self.open_control)
        self.btn_enter.clicked.connect(self.open_enter)
        self.btn_exit.clicked.connect(self.close)

        self.setLayout(layout)

    def open_control(self):
        if not self.current_project:
            QMessageBox.warning(self, "Warning", "No project selected.")
            return
        self.console_window = ConsoleWindow(
            self.current_project,
            self.data["projects"][self.current_project]["path"],
            self.data
        )
        self.console_window.show()

    def open_enter(self):
        if not self.current_project:
            QMessageBox.warning(self, "Warning", "No project selected.")
            return
        self.enter_window = EnterWindow(
            self.current_project,
            self.data["projects"][self.current_project]["path"],
            self.data
        )
        self.enter_window.show()

# ------------------------
# Entry Point
# ------------------------
def main():
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
