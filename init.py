import os
import json

# --------------------------
# 路徑設定
# --------------------------
FILE_DIR = "file"

DATA_FILE = os.path.join(FILE_DIR, "data.json")
TREE_FILE = os.path.join(FILE_DIR, "tree.txt")
CONNECT_FILE = os.path.join(FILE_DIR, "connect.txt")
CHAT_FILE = os.path.join(FILE_DIR, "chat.txt")
LOG_FILE = os.path.join(FILE_DIR, "log.txt")

COPY_PROJECT_DIR = os.path.join(FILE_DIR, "copy_project")
SHADOW_DIR = os.path.join(FILE_DIR, "shadow")

# --------------------------
# 初始化 file/ 與系統結構
# --------------------------
def init_file():
    # 建立主要資料夾
    os.makedirs(FILE_DIR, exist_ok=True)
    os.makedirs(COPY_PROJECT_DIR, exist_ok=True)
    os.makedirs(SHADOW_DIR, exist_ok=True)

    # 初始化 data.json
    if not os.path.exists(DATA_FILE):
        data = {
            "projects": {},         # 所有專案資訊
            "current_project": None # 當前選擇的專案
        }
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    else:
        # 防呆：補齊必要 key
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = {}

        changed = False
        if "projects" not in data:
            data["projects"] = {}
            changed = True
        if "current_project" not in data:
            data["current_project"] = None
            changed = True

        if changed:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

    # 初始化其他必要檔案（空檔即可）
    for path in [TREE_FILE, CONNECT_FILE, CHAT_FILE, LOG_FILE]:
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8"):
                pass

    print("✅ Project initialized successfully")
    print(" - file/")
    print("   - copy_project/")
    print("   - shadow/")
    print("   - data.json / chat.txt / log.txt / ...")

# --------------------------
# 執行初始化
# --------------------------
if __name__ == "__main__":
    init_file()
