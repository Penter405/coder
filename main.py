import sys
import os
import shutil
import json
import datetime
from PyQt6.QtWidgets import (
    QApplication, QWidget, QTreeWidget, QTreeWidgetItem, QPushButton,
    QLabel, QVBoxLayout, QHBoxLayout, QMessageBox, QTextEdit, QInputDialog, QCheckBox
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

        # Info
        info_label = QLabel(f"Project: {self.project_name}\nPath: {self.project_path}")
        layout.addWidget(info_label)

        # Buttons
        btn_layout = QHBoxLayout()
        self.btn_generate = QPushButton("Generate chat.txt")
        self.btn_generate.clicked.connect(self.generate_chat)
        self.btn_copy = QPushButton("Copy chat.txt to Clipboard")
        self.btn_copy.clicked.connect(self.copy_chat)
        self.btn_copy.setEnabled(False)
        btn_layout.addWidget(self.btn_generate)
        btn_layout.addWidget(self.btn_copy)
        layout.addLayout(btn_layout)

        # VS Code
        self.btn_code_ext = QPushButton("Open VS Code (AI Extension)")
        self.btn_code_ext.setToolTip("Open VS Code with local AI extension loaded")
        self.btn_code_ext.clicked.connect(self.open_vscode_with_extension)
        layout.addWidget(self.btn_code_ext)

        # Shadow context
        self.chk_shadow_context = QCheckBox("Use Shadow Layer as Context")
        layout.addWidget(self.chk_shadow_context)

        # Text input
        layout.addWidget(QLabel("AI Command / Code Input:"))
        self.text_input = QTextEdit()
        self.text_input.setPlaceholderText("Enter AI commands or paste code...")
        layout.addWidget(self.text_input)

        # Save Different / Save Shadow buttons
        btn_shadow_layout = QHBoxLayout()
        self.btn_diff = QPushButton("Save Different to chat.txt")
        self.btn_diff.clicked.connect(self.save_different_to_chat)
        self.btn_shadow = QPushButton("Save Shadow to Origin")
        self.btn_shadow.clicked.connect(self.save_shadow_to_origin)
        btn_shadow_layout.addWidget(self.btn_diff)
        btn_shadow_layout.addWidget(self.btn_shadow)
        layout.addLayout(btn_shadow_layout)

        # Log
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        self.log_output.setMaximumHeight(120)
        layout.addWidget(QLabel("Operation Log:"))
        layout.addWidget(self.log_output)

        self.setLayout(layout)

    def log(self, message):
        self.log_output.append(message)

    # ------------------------
    # Generate chat.txt
    # ------------------------
    def generate_chat(self):
        try:
            chat_folder = os.path.join("file", self.project_name)
            os.makedirs(chat_folder, exist_ok=True)
            chat_path = os.path.join(chat_folder, "chat.txt")
            if not os.path.exists(chat_path):
                with open(chat_path, "w", encoding="utf-8") as f:
                    f.write(f"# Chat log for project {self.project_name}\n")
                self.log(f"chat.txt created at: {os.path.abspath(chat_path)}")
            else:
                self.log(f"chat.txt already exists at: {os.path.abspath(chat_path)}")
            self.btn_copy.setEnabled(True)
        except Exception as e:
            self.log(f"Error generating chat.txt: {e}")

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
    def open_vscode_with_extension(self):
        try:
            import subprocess
            base_dir = os.path.dirname(os.path.abspath(__file__))
            ext_path = os.path.join(base_dir, "ai-coder-helper")
            if not os.path.exists(ext_path):
                QMessageBox.warning(self, "Error", f"Extension not found at:\n{ext_path}")
                return

            # 1. Save AI commands
            cmd_path = os.path.join("file", "ai_commands.txt")
            os.makedirs("file", exist_ok=True)
            with open(cmd_path, "w", encoding="utf-8") as f:
                f.write(self.text_input.toPlainText())
            self.log(f"AI commands saved to: {os.path.abspath(cmd_path)}")

            # 2. Sync selected files to shadow
            selected_files = self.data["projects"][self.project_name].get("selected_files", [])
            shadow_root = os.path.join("file", "shadow")
            os.makedirs(shadow_root, exist_ok=True)
            for file_path in selected_files:
                if os.path.exists(file_path):
                    rel = os.path.relpath(file_path, self.project_path)
                    dest = os.path.join(shadow_root, rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.copy2(file_path, dest)
            self.log(f"{len(selected_files)} files synced to shadow.")

            # 3. Launch VS Code
            code_cmd = shutil.which("code")
            if not code_cmd:
                QMessageBox.warning(self, "Error", "VS Code not found in PATH.")
                return
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
    def save_shadow_to_origin(self):
        try:
            shadow_root = os.path.join("file", "shadow")
            count = 0
            for root, dirs, files in os.walk(shadow_root):
                for file in files:
                    shadow_file = os.path.join(root, file)
                    rel = os.path.relpath(shadow_file, shadow_root)
                    dest = os.path.join(self.project_path, rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.copy2(shadow_file, dest)
                    count += 1
            self.log(f"{count} files synced from shadow to project.")
            QMessageBox.information(self, "Success", f"Synced {count} files to project.")
        except Exception as e:
            self.log(f"Error syncing shadow to origin: {e}")

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
