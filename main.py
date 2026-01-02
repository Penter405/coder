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

DATA_JSON = os.path.join("file", "data.json")

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
        self.selected_files = set(self.data["projects"][self.project_name].get("selected_files", []))
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
        self.tree.addTopLevelItem(self.origin_root)
        
        if os.path.exists(self.project_path):
            self.add_items(self.origin_root, self.project_path)
            
        # Root 2+: Coped Projects (Scan 'file/{project_name}/' directory)
        file_dir = os.path.join("file", self.project_name)
        if not os.path.exists(file_dir):
            os.makedirs(file_dir)
            
        subdirs = sorted([d for d in os.listdir(file_dir) if os.path.isdir(os.path.join(file_dir, d))])
        
        for d in subdirs:
            if d == "__pycache__": continue
            
            full_path = os.path.join(file_dir, d)
            # Display name
            if d == "shadow": display_name = "[Coped] Shadow Layer"
            else: display_name = f"[Coped] {d}"
            
            coped_root = QTreeWidgetItem([display_name])
            coped_root.setData(0, Qt.ItemDataRole.UserRole, full_path)
            self.tree.addTopLevelItem(coped_root)
            
            self.add_items(coped_root, full_path, is_shadow=True)
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
        item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
        
        if is_shadow:
             # Enable checking for Coped Projects too, so we can manage their selection state
             if full_path in self.selected_files:
                item.setCheckState(0, Qt.CheckState.Checked)
             else:
                item.setCheckState(0, Qt.CheckState.Unchecked)
        else:
            # Origin logic
            if full_path in self.selected_files:
                item.setCheckState(0, Qt.CheckState.Checked)
            else:
                item.setCheckState(0, Qt.CheckState.Unchecked)

        parent_item.addChild(item)

        if os.path.isdir(full_path):
             for f in sorted(os.listdir(full_path)):
                 if f in [".git", "__pycache__", "file"]: continue
                 self.add_node_recursive(item, os.path.join(full_path, f), is_shadow)

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
        # Logic for parent check state... simplified
        pass 

    def collect_checked_files(self, parent_item):
        path = parent_item.data(0, Qt.ItemDataRole.UserRole)
        # Skip roots
        if path in ["ORIGIN_ROOT", "SHADOW_ROOT", "NONE_ROOT"]: 
            pass
        elif os.path.isfile(path):
             if parent_item.checkState(0) == Qt.CheckState.Checked and (parent_item.flags() & Qt.ItemFlag.ItemIsUserCheckable):
                 self.selected_files.add(path)
                 print(f"[ConsoleWindow] Added checked file: {path}")
             
        for i in range(parent_item.childCount()):
            self.collect_checked_files(parent_item.child(i))

    def apply_changes(self):
        self.selected_files = set()
        
        # Scan ALL top-level items (Origin and Coped Projects)
        root_count = self.tree.topLevelItemCount()
        print(f"[ConsoleWindow] Scanning {root_count} roots for selection...")
        for i in range(root_count):
            root = self.tree.topLevelItem(i)
            print(f"[ConsoleWindow] Scanning Root: {root.text(0)}")
            self.collect_checked_files(root)
        
        self.data["projects"][self.project_name]["selected_files"] = list(self.selected_files)
        print(f"[ConsoleWindow] Saving {len(self.selected_files)} selected files.")
        self.close()

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
            
            # New Logic: Create in file/{project_name}/
            base_dir = os.path.join("file", self.project_name)
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

                    # Inherit Selection State
                    # Find all currently selected files that are within the source_path
                    current_selected = self.data["projects"][self.project_name].get("selected_files", [])
                    new_selected = []
                    
                    # Normalize source path for comparison
                    abs_source = os.path.abspath(source_path)
                    
                    for path in current_selected:
                        abs_path = os.path.abspath(path)
                        # Check if this selected file belongs to the source project we just copied
                        if abs_path.startswith(abs_source):
                            # Calculate relative path
                            rel_path = os.path.relpath(abs_path, abs_source)
                            # New path in the coped project
                            new_file_path = os.path.join(new_path, rel_path)
                            if os.path.exists(new_file_path):
                                new_selected.append(new_file_path)
                                
                    # Extend the selected_files list with these new paths
                    if new_selected:
                        current_selected.extend(new_selected)
                        # Remove duplicates just in case
                        self.data["projects"][self.project_name]["selected_files"] = list(set(current_selected))
                        save_data(self.data)
                        # Update local set
                        self.selected_files = set(self.data["projects"][self.project_name]["selected_files"])

                    QMessageBox.information(self, "Success", f"Created '{safe_name}' from '{source_name}'.\nCopied {len(new_selected)} selections.")
                else:
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
        self.shadow_root = os.path.join("file", "shadow")
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
        self.shadow_root = os.path.join("file", "shadow")
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
        file_dir = os.path.join("file", self.project_name)
        self.coped_roots = [] # Keep track for radio behavior
        
        if os.path.exists(file_dir):
            subdirs = sorted([d for d in os.listdir(file_dir) if os.path.isdir(os.path.join(file_dir, d))])
            first_coped = True
            for d in subdirs:
                if d == "__pycache__": continue
                
                full_path = os.path.join(file_dir, d)
                if d == "shadow": display_name = "Shadow Layer"
                else: display_name = d
                
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
                # Get selected files for visual marking
                selected_set = set(self.data["projects"][self.project_name].get("selected_files", []))
                
                self.log(f"Found {len(files)} files in {root_path}")
                for f in files:
                    full_path = os.path.join(root_path, f)
                    if f in [".git", "__pycache__", "file"]: 
                        continue # Skip generic ignores
                    
                    item = QTreeWidgetItem([f])
                    item.setData(0, Qt.ItemDataRole.UserRole, full_path)
                    
                    # Visual: Color/Bold for selected
                    if full_path in selected_set:
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
        self.btn_toggle_src = QPushButton("Source Files")
        self.btn_toggle_src.setCheckable(True)
        self.btn_toggle_src.setChecked(True)
        self.btn_toggle_src.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        self.btn_toggle_shadow = QPushButton("Shadow Files")
        self.btn_toggle_shadow.setCheckable(True)
        self.btn_toggle_shadow.setChecked(True)
        self.btn_toggle_shadow.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        self.btn_toggle_diff = QPushButton("Diff (Source vs Coped)")
        self.btn_toggle_diff.setCheckable(True)
        self.btn_toggle_diff.setChecked(True)
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
        self.proj_choose = ProjectChooseWindow(self.project_name, self.project_path, self.data, context_key="source_context")
        self.proj_choose.show()

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
            selected_files = self.data["projects"][self.project_name].get("selected_files", [])
            if not selected_files:
                QMessageBox.warning(self, "Warning", "No files selected. Please select source files first.")
                return

            # Determine Contexts (Ensure Absolute)
            source_root = self.data["projects"][self.project_name].get("source_context", self.project_path)
            coped_root = self.data["projects"][self.project_name].get("coped_context", os.path.join("file", "shadow"))
            
            if not os.path.isabs(source_root): source_root = os.path.join(self.project_path, source_root)
            if not os.path.isabs(coped_root): coped_root = os.path.join(self.project_path, coped_root)

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
                abs_p = os.path.abspath(p)
                # Parse safety check
                rel_check = os.path.relpath(abs_p, self.project_path)
                if not rel_check.startswith(".."):
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
            prompt_file = os.path.join("file", "prompt.txt")
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
                 self.log("DEBUG: prompt.txt NOT found. Using fallback.")
                 content += "// Warning: prompt.txt not found.\n"
                 content += "You are Penter AI.\n\n"

             # 2. Input Prompt
            user_input = self.text_input.toPlainText()
            self.log(f"DEBUG: captured user_input ({len(user_input)} chars): {user_input[:20]}...")
            
            if user_input:
                content += "# Task Description\n" + user_input + "\n\n"
            else:
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
            shadow_root = os.path.join("file", "shadow")
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

    # ------------------------
    # VS Code Extension
    # ------------------------
    # ------------------------
    # VS Code Extension
    # ------------------------
    def open_vscode_with_extension(self):
        # 1. Save AI commands
        try:
            cmd_path = os.path.join("file", "ai_commands.txt")
            os.makedirs("file", exist_ok=True)
            with open(cmd_path, "w", encoding="utf-8") as f:
                f.write(self.text_input.toPlainText())
        except: pass

        # 2. Sync selected files to shadow (Initialize if needed)
        try:
            selected_files = self.data["projects"][self.project_name].get("selected_files", [])
            shadow_root = os.path.join("file", "shadow")
            os.makedirs(shadow_root, exist_ok=True)
            for file_path in selected_files:
                if os.path.exists(file_path):
                    rel = os.path.relpath(file_path, self.project_path)
                    dest = os.path.join(shadow_root, rel)
                    # Only copy if not exists to act as init
                    if not os.path.exists(dest):
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        shutil.copy2(file_path, dest)
        except: pass

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
            shadow_root = os.path.join("file", "shadow")
            chat_path = os.path.join("file", self.project_name, "chat.txt")
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
        coped_context = self.data["projects"][self.project_name].get("coped_context", os.path.join("file", self.project_name, "shadow"))
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

    def generate_chat(self):
        """Generate chat.txt with selected files based on toggle states"""
        try:
            # Use the same file gathering logic as prepare_and_launch
            final_files = set()
            raw_selected = self.data["projects"][self.project_name].get("selected_files", [])
            abs_selected = set()
            for p in raw_selected:
                if os.path.isabs(p):
                     abs_selected.add(os.path.normcase(p))
                else:
                     abs_selected.add(os.path.normcase(os.path.abspath(p)))

            # Context Roots
            script_dir = os.path.dirname(os.path.abspath(__file__))
            
            # Get Source Context (might be Origin or a Coped project)
            source_context = self.data["projects"][self.project_name].get("source_context", self.project_path)
            if os.path.isabs(source_context):
                source_root = source_context
            else:
                source_root = os.path.join(script_dir, source_context)
            source_root = os.path.abspath(source_root)
            
            # Get Coped Context
            coped_context = self.data["projects"][self.project_name].get("coped_context", os.path.join("file", self.project_name, "shadow"))
            if os.path.isabs(coped_context):
                coped_root = coped_context
            else:
                coped_root = os.path.join(script_dir, coped_context)
            coped_root = os.path.abspath(coped_root)

            # Gather files based on toggles
            if self.btn_toggle_src.isChecked():
                for p in abs_selected:
                    # Match if file is within source_root OR is source_root itself
                    if p.startswith(os.path.normcase(source_root) + os.sep) or p == os.path.normcase(source_root):
                         final_files.add(p)

            if self.btn_toggle_shadow.isChecked():
                for p in abs_selected:
                    # Match if file is within coped_root OR is coped_root itself
                    if p.startswith(os.path.normcase(coped_root) + os.sep) or p == os.path.normcase(coped_root):
                        final_files.add(p)

            # Write to chat.txt
            chat_path = os.path.join(script_dir, "file", "chat.txt")
            os.makedirs(os.path.dirname(chat_path), exist_ok=True)

            with open(chat_path, "w", encoding="utf-8") as f:
                # Write Penter Unified Prompt from file
                self.log("DEBUG: Reading prompt.txt...")
                prompt_file = os.path.join("file", "prompt.txt")
                if os.path.exists(prompt_file):
                    try:
                        with open(prompt_file, "r", encoding="utf-8") as pf:
                            f.write(pf.read())
                    except Exception as e:
                        f.write(f"// Error reading prompt.txt: {e}\n\n")
                else:
                    f.write("# System Instructions\n(prompt.txt not found - fallback)\n\n")
                
                # Append Task Description from User Input
                # Note: self.text_input is expected to exist if this is EnterWindow
                if hasattr(self, 'text_input'):
                    user_input = self.text_input.toPlainText()
                    self.log(f"DEBUG: captured user_input from text_input ({len(user_input)} chars)")
                    if user_input:
                        f.write("\n# Task Description\n")
                        f.write(user_input + "\n\n")
                else:
                    self.log("DEBUG: text_input widget not found in this window context.")
                
                # Check if Diff toggle is ON
                show_diff = self.btn_toggle_diff.isChecked()
                
                if show_diff:
                    f.write("# Differences (Source vs Coped)\n\n")
                    # Generate diff for files that exist in both contexts
                    import difflib
                    for file_path in sorted(final_files):
                        try:
                            # Determine which context this file belongs to
                            if file_path.startswith(os.path.normcase(source_root)):
                                rel_path = os.path.relpath(file_path, source_root)
                                counterpart = os.path.join(coped_root, rel_path)
                                if os.path.exists(counterpart):
                                    f.write(f"## {rel_path}\n\n")
                                    with open(file_path, "r", encoding="utf-8", errors="ignore") as src:
                                        source_lines = src.readlines()
                                    with open(counterpart, "r", encoding="utf-8", errors="ignore") as cop:
                                        coped_lines = cop.readlines()
                                    
                                    diff = difflib.unified_diff(source_lines, coped_lines, 
                                                                fromfile=f"Source: {rel_path}",
                                                                tofile=f"Coped: {rel_path}",
                                                                lineterm="")
                                    f.write("```diff\n")
                                    for line in diff:
                                        f.write(line + "\n")
                                    f.write("```\n\n")
                        except Exception as e:
                            f.write(f"(Error generating diff for {file_path}: {e})\n\n")
                    f.write("\n")
                
                f.write("# Selected Files\n\n")
                
                # Write file contents with line numbers
                for file_path in sorted(final_files):
                    try:
                        # Determine context for tagging
                        is_source = file_path.startswith(os.path.normcase(source_root))
                        tag = "[Source]" if is_source else "[Coped]"
                        
                        # Use path relative to Script Dir (Project Root) to ensure uniqueness
                        rel_path = os.path.relpath(file_path, script_dir)
                        f.write(f"## {tag} {rel_path}\n\n")
                        
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as src:
                            lines = src.readlines()
                            for i, line in enumerate(lines, 1):
                                f.write(f"{i:5} | {line}")
                        f.write("\n\n")
                    except Exception as e:
                        f.write(f"(Error reading {file_path}: {e})\n\n")

            self.log(f"Generated chat.txt with {len(final_files)} files at: {chat_path}")
            QMessageBox.information(self, "Success", f"Generated chat.txt with {len(final_files)} files!")
            
        except Exception as e:
            self.log(f"Error generating chat: {e}")
            QMessageBox.critical(self, "Error", f"Failed to generate chat.txt: {e}")

    def copy_chat(self):
        """Copy chat.txt content to clipboard"""
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            chat_path = os.path.join(script_dir, "file", "chat.txt")
            
            if not os.path.exists(chat_path):
                QMessageBox.warning(self, "Error", "chat.txt not found. Generate it first!")
                return
            
            with open(chat_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            QApplication.clipboard().setText(content)
            self.log(f"Copied {len(content)} characters to clipboard")
            QMessageBox.information(self, "Success", "chat.txt copied to clipboard!")
            
        except Exception as e:
            self.log(f"Error copying chat: {e}")
            QMessageBox.critical(self, "Error", f"Failed to copy: {e}")

    def paste_ai_response(self):
        """Paste AI response from clipboard and append to chat.txt"""
        try:
            clipboard_content = QApplication.clipboard().text()
            if not clipboard_content:
                QMessageBox.warning(self, "Error", "Clipboard is empty!")
                return
            
            script_dir = os.path.dirname(os.path.abspath(__file__))
            chat_path = os.path.join(script_dir, "file", "chat.txt")
            
            with open(chat_path, "a", encoding="utf-8") as f:
                f.write("\n\n# AI Response\n\n")
                f.write(clipboard_content)
            
            self.log(f"Pasted {len(clipboard_content)} characters to chat.txt")
            QMessageBox.information(self, "Success", "AI response appended to chat.txt!")
            
        except Exception as e:
            self.log(f"Error pasting response: {e}")
            QMessageBox.critical(self, "Error", f"Failed to paste: {e}")


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
