import sys
import os
import shutil
import json
from PyQt6.QtWidgets import (
    QApplication, QWidget, QTreeWidget, QTreeWidgetItem, QPushButton,
    QLabel, QVBoxLayout, QHBoxLayout, QMessageBox, QFileDialog, QTextEdit
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
# Enter Window (IDE-like)
# ------------------------
class EnterWindow(QWidget):
    def __init__(self, project_name, project_path, data):
        super().__init__()
        self.project_name = project_name
        self.project_path = project_path
        self.data = data
        self.current_file = None

        self.setWindowTitle(f"{project_name} Workspace")
        self.resize(800, 600)
        self.init_ui()
        self.build_tree()

    def init_ui(self):
        layout = QHBoxLayout()

        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("Files")
        self.tree.itemClicked.connect(self.load_file)
        layout.addWidget(self.tree, 1)

        right_layout = QVBoxLayout()
        self.editor = QTextEdit()
        right_layout.addWidget(self.editor)

        btn_layout = QHBoxLayout()
        self.btn_save = QPushButton("Save")
        self.btn_add = QPushButton("Add")
        self.btn_delete = QPushButton("Delete")
        self.btn_close = QPushButton("Close")
        btn_layout.addWidget(self.btn_save)
        btn_layout.addWidget(self.btn_add)
        btn_layout.addWidget(self.btn_delete)
        btn_layout.addWidget(self.btn_close)
        right_layout.addLayout(btn_layout)

        layout.addLayout(right_layout, 3)
        self.setLayout(layout)

        self.btn_save.clicked.connect(self.save_file)
        self.btn_add.clicked.connect(self.add_file)
        self.btn_delete.clicked.connect(self.delete_file)
        self.btn_close.clicked.connect(self.close)

    def build_tree(self):
        self.tree.clear()
        self.add_items(self.tree, self.project_path)

    def add_items(self, parent_widget, path):
        name = os.path.basename(path) or path
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.ItemDataRole.UserRole, path)
        if os.path.isdir(path):
            for f in sorted(os.listdir(path)):
                self.add_items(item, os.path.join(path, f))
        if isinstance(parent_widget, QTreeWidget):
            parent_widget.addTopLevelItem(item)
        else:
            parent_widget.addChild(item)

    def load_file(self, item, column):
        path = item.data(0, Qt.ItemDataRole.UserRole)
        if os.path.isfile(path):
            self.current_file = path
            try:
                with open(path, "r", encoding="utf-8") as f:
                    self.editor.setPlainText(f.read())
            except Exception as e:
                QMessageBox.warning(self, "Error", f"Cannot read file: {e}")

    def save_file(self):
        if not self.current_file:
            QMessageBox.warning(self, "Warning", "No file selected")
            return
        try:
            with open(self.current_file, "w", encoding="utf-8") as f:
                f.write(self.editor.toPlainText())
            QMessageBox.information(self, "Saved", f"{self.current_file} saved")
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to save: {e}")

    def add_file(self):
        path, _ = QFileDialog.getSaveFileName(self, "Add New File", self.project_path)
        if path:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write("")
                self.build_tree()
            except Exception as e:
                QMessageBox.warning(self, "Error", f"Failed to add file: {e}")

    def delete_file(self):
        item = self.tree.currentItem()
        if not item:
            QMessageBox.warning(self, "Warning", "Please select a file or folder to delete.")
            return
        path = item.data(0, Qt.ItemDataRole.UserRole)
        confirm = QMessageBox.question(
            self,
            "Confirm Delete",
            f"Are you sure you want to delete:\n{path}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        try:
            if os.path.isfile(path):
                os.remove(path)
            elif os.path.isdir(path):
                shutil.rmtree(path)
            # 移除不存在的 selected_files
            sel_files = self.data["projects"][self.project_name].get("selected_files", [])
            sel_files = [f for f in sel_files if os.path.exists(f)]
            self.data["projects"][self.project_name]["selected_files"] = sel_files
            save_data(self.data)
            self.build_tree()
            self.editor.clear()
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to delete: {e}")

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
