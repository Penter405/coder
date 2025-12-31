import sys
import os
import shutil
import json
import datetime
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
class ControlFilesWindow(QWidget):
    def __init__(self, project_name, project_path, data):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data
        self.selected_files = set(self.data["projects"][self.project_name].get("selected_files", []))
        self.updating = False  # 防止 itemChanged 重入

        self.setWindowTitle("Control Selected Files")
        self.resize(600, 500)
        self.init_ui()
        self.build_tree()

    def init_ui(self):
        layout = QVBoxLayout()
        self.info_label = QLabel(f"Project: {self.project_name}\nPath: {self.project_path}")
        layout.addWidget(self.info_label)

        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Project Files")
        layout.addWidget(self.tree)

        btn_layout = QHBoxLayout()
        self.btn_apply = QPushButton("Apply")
        self.btn_cancel = QPushButton("Cancel")
        btn_layout.addWidget(self.btn_apply)
        btn_layout.addWidget(self.btn_cancel)
        layout.addLayout(btn_layout)

        self.btn_apply.clicked.connect(self.apply_changes)
        self.btn_cancel.clicked.connect(self.close)
        self.setLayout(layout)

    def build_tree(self):
        self.tree.clear()
        if not os.path.exists(self.project_path):
            QMessageBox.warning(self, "Error", f"Project path does not exist: {self.project_path}")
            return
        self.add_items(self.tree, self.project_path)
        self.tree.itemChanged.connect(self.handle_item_changed)

    def add_items(self, parent_widget, path):
        name = os.path.basename(path) or path
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.ItemDataRole.UserRole, path)
        item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
        if os.path.isfile(path) and path in self.selected_files:
            item.setCheckState(0, Qt.CheckState.Checked)
        else:
            item.setCheckState(0, Qt.CheckState.Unchecked)

        if isinstance(parent_widget, QTreeWidget):
            parent_widget.addTopLevelItem(item)
        else:
            parent_widget.addChild(item)

        if os.path.isdir(path):
            for f in sorted(os.listdir(path)):
                self.add_items(item, os.path.join(path, f))

    def handle_item_changed(self, item, column):
        if self.updating:
            return
        self.updating = True
        try:
            state = item.checkState(0)
            self.update_children(item, state)
            self.update_parent(item)
        finally:
            self.updating = False

    def update_children(self, item, state):
        for i in range(item.childCount()):
            child = item.child(i)
            child.setCheckState(0, state)
            self.update_children(child, state)

    def update_parent(self, item):
        parent = item.parent()
        if not parent:
            return
        checked_count = sum(parent.child(i).checkState(0) == Qt.CheckState.Checked for i in range(parent.childCount()))
        if checked_count == 0:
            parent.setCheckState(0, Qt.CheckState.Unchecked)
        elif checked_count == parent.childCount():
            parent.setCheckState(0, Qt.CheckState.Checked)
        else:
            parent.setCheckState(0, Qt.CheckState.PartiallyChecked)
        self.update_parent(parent)

    def collect_checked_files(self, parent_item):
        if os.path.isfile(parent_item.data(0, Qt.ItemDataRole.UserRole)):
            if parent_item.checkState(0) == Qt.CheckState.Checked:
                self.selected_files.add(parent_item.data(0, Qt.ItemDataRole.UserRole))
        for i in range(parent_item.childCount()):
            self.collect_checked_files(parent_item.child(i))

    def apply_changes(self):
        self.selected_files = set()
        for i in range(self.tree.topLevelItemCount()):
            self.collect_checked_files(self.tree.topLevelItem(i))
        self.data["projects"][self.project_name]["selected_files"] = list(self.selected_files)
        save_data(self.data)
        QMessageBox.information(self, "Saved", "Selected files updated in data.json")
        self.close()

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

    def __init__(self, project_name, project_path, data):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data
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
        
        # Roots
        self.origin_item = QTreeWidgetItem([f"[Origin] {self.project_name}"])
        self.origin_item.setData(0, Qt.ItemDataRole.UserRole, self.project_path)
        self.origin_item.setCheckState(0, Qt.CheckState.Checked)
        self.tree.addTopLevelItem(self.origin_item)

        self.coped_root = QTreeWidgetItem(["Coped Projects"])
        self.tree.addTopLevelItem(self.coped_root)

        # Shadow
        shadow_path = os.path.join("file", "shadow")
        self.shadow_item = QTreeWidgetItem(["Shadow Layer"])
        self.shadow_item.setData(0, Qt.ItemDataRole.UserRole, shadow_path)
        self.shadow_item.setCheckState(0, Qt.CheckState.Checked)
        self.coped_root.addChild(self.shadow_item)
        
        self.coped_root.setExpanded(True)
        self.origin_item.setExpanded(True)

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

        # Populate NOW (after log widget exists)
        if os.path.exists(self.project_path):
            self.populate_tree(self.origin_item, self.project_path)
        
        if os.path.exists(shadow_path):
            self.populate_tree(self.shadow_item, shadow_path)

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
                self.log(f"Found {len(files)} files in {root_path}")
                for f in files:
                    full_path = os.path.join(root_path, f)
                    if f in [".git", "__pycache__", "file"]: 
                        continue # Skip generic ignores
                    
                    item = QTreeWidgetItem([f])
                    item.setData(0, Qt.ItemDataRole.UserRole, full_path)
                    item.setCheckState(0, Qt.CheckState.Unchecked)
                    
                    parent_item.addChild(item)
                    if os.path.isdir(full_path):
                        self.populate_tree(item, full_path)
            else:
                self.log(f"Not a directory: {root_path}")
        except Exception as e:
            self.log(f"Error populating tree: {e}")

    def apply_changes(self):
        try:
            active = []
            it = QTreeWidgetItemIterator(self.tree)
            while it.value():
                item = it.value()
                if item.checkState(0) == Qt.CheckState.Checked:
                    path = item.data(0, Qt.ItemDataRole.UserRole)
                    if path: active.append(path)
                it += 1
            
            # Save to data (assuming 'active_contexts' list)
            self.data["projects"][self.project_name]["active_contexts"] = active
            save_data(self.data)
            # QMessageBox.information(self, "Saved", "Project selection saved.") # Optional: Reduce popup spam
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
        self.btn_toggle_shadow.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        
        self.btn_toggle_diff = QPushButton("Diff (Source vs Coped)")
        self.btn_toggle_diff.setCheckable(True)
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
        
        # toggle_switch[3] "vscode from source or coped"
        self.btn_toggle_vscode_mode = QPushButton("Target: Coped")
        self.btn_toggle_vscode_mode.setCheckable(True)
        self.btn_toggle_vscode_mode.setChecked(True)
        self.btn_toggle_vscode_mode.setStyleSheet("QPushButton:checked { background-color: #a0d0a0; }")
        self.btn_toggle_vscode_mode.setToolTip("Toggle ON to use Shadow/Coped (Extension), OFF for Source (Standard)")
        
        row4.addWidget(self.btn_gen_chat)
        row4.addWidget(self.btn_open_ide)
        row4.addWidget(self.btn_toggle_vscode_mode)
        layout.addLayout(row4)

        # Log
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMaximumHeight(120)
        layout.addWidget(QLabel("Operation Log:"))
        layout.addWidget(self.log_output)

        self.setLayout(layout)

    # ------------------------
    # Helpers for New Buttons
    # ------------------------
    def open_source_manager(self):
        # Open ProjectChooseWindow
        self.proj_choose = ProjectChooseWindow(self.project_name, self.project_path, self.data)
        self.proj_choose.show()

    def open_shadow_manager_direct(self):
        # Also Open ProjectChooseWindow (as per UIturn.py logic)
        self.proj_choose_coped = ProjectChooseWindow(self.project_name, self.project_path, self.data)
        self.proj_choose_coped.show()

    def open_vscode_logic(self):
        # Open ProjectChooseWindow first
        self.proj_choose_vscode = ProjectChooseWindow(self.project_name, self.project_path, self.data)
        self.proj_choose_vscode.selection_made.connect(self.decide_and_launch_vscode)
        self.proj_choose_vscode.show()

    def decide_and_launch_vscode(self):
        # Decide based on toggle button
        if self.btn_toggle_vscode_mode.isChecked():
            # Coped / Shadow -> Extension
            self.open_vscode_with_extension()
        else:
            # Source -> Standard VS Code
            self.open_vscode_standard()

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
    def generate_chat(self):
        try:
            selected_files = self.data["projects"][self.project_name].get("selected_files", [])
            if not selected_files:
                QMessageBox.warning(self, "Warning", "No files selected. Please select source files first.")
                return

            content = ""
            
            # 1. System Prompt (Reuse existing or simplified)
            content += "# System Instructions\n"
            content += "You are an AI coding assistant.\n\n"
            
            # 2. Input Prompt
            user_input = self.text_input.toPlainText()
            if user_input:
                content += "# User Input / Commands\n" + user_input + "\n\n"

            # 3. Source Files
            if self.btn_toggle_src.isChecked():
                content += "# Source Files\n"
                for file_path in selected_files:
                    if os.path.exists(file_path):
                        rel = os.path.relpath(file_path, self.project_path)
                        content += f"## {rel}\n```\n"
                        try:
                            with open(file_path, "r", encoding="utf-8") as f:
                                content += f.read()
                        except: content += "(Error reading file)"
                        content += "\n```\n\n"

            # 4. Shadow Files
            if self.btn_toggle_shadow.isChecked():
                content += "# Shadow Files\n"
                shadow_root = os.path.join("file", "shadow")
                for file_path in selected_files:
                    rel = os.path.relpath(file_path, self.project_path)
                    shadow_path = os.path.join(shadow_root, rel)
                    if os.path.exists(shadow_path):
                        content += f"## (Shadow) {rel}\n```\n"
                        try:
                            with open(shadow_path, "r", encoding="utf-8") as f:
                                content += f.read()
                        except: content += "(Error reading file)"
                        content += "\n```\n\n"

            # 5. Diff Report
            if self.btn_toggle_diff.isChecked():
                diff_report = self.get_diff_report()
                if diff_report:
                    content += "# Diff Report (Source -> Shadow)\n"
                    content += diff_report + "\n\n"

            # Save
            chat_folder = os.path.join("file", self.project_name)
            os.makedirs(chat_folder, exist_ok=True)
            chat_path = os.path.join(chat_folder, "chat.txt")
            
            with open(chat_path, "w", encoding="utf-8") as f:
                f.write(content)
                
            self.log(f"chat.txt generated ({len(content)} chars).")
            self.btn_copy.setEnabled(True)
            self.copy_chat() # Auto-copy convenience
            
        except Exception as e:
            self.log(f"Error generating chat.txt: {e}")

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
            chat_path = os.path.join("file", self.project_name, "chat.txt")
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
            
            # Launch
            subprocess.Popen([code_cmd, self.project_path, f"--extensionDevelopmentPath={ext_path}"])
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
        self.btn_control = QPushButton("Control Selected Files")
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
        self.control_window = ControlFilesWindow(
            self.current_project,
            self.data["projects"][self.current_project]["path"],
            self.data
        )
        self.control_window.show()

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
