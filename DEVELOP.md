# AI Coder Helper - 開發文檔

## 專案結構

```
coder/
├── main.py              # CLI 入口：生成 chat.txt、套用變更
├── projectIO.py         # 專案管理：新增/刪除/選擇專案
├── init.py              # 初始化：建立 file/ 資料夾
├── DEVELOP.md           # 開發文檔
├── README.md            # 說明文檔
├── .gitignore
│
├── ai-coder-helper/     # VS Code Extension
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── extension.ts
│   │   ├── fileSelector.ts
│   │   ├── chatGenerator.ts
│   │   └── changeApplier.ts
│   └── out/             # 編譯輸出
│
└── file/                # (由 init.py 生成)
    ├── data.json        # 專案資料
    ├── chat.txt         # 生成的聊天內容
    └── log.txt          # 操作記錄
```

---

## 使用流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 專案管理                                                 │
│     python projectIO.py                                      │
│     → 新增/刪除/選擇專案                                     │
├─────────────────────────────────────────────────────────────┤
│  2. 檔案選擇 (兩種方式)                                      │
│     A. VS Code Extension → 點擊檔案勾選                      │
│     B. Control Selected Files (GUI)                         │
├─────────────────────────────────────────────────────────────┤
│  3. 生成 chat.txt                                            │
│     python main.py generate -t "任務描述"                    │
│     → 生成 file/chat.txt 並複製到剪貼簿                     │
├─────────────────────────────────────────────────────────────┤
│  4. 使用 AI                                                  │
│     將 chat.txt 貼入 LLM (ChatGPT, Claude 等)               │
│     複製 AI 回覆                                             │
├─────────────────────────────────────────────────────────────┤
│  5. 套用變更                                                 │
│     python main.py apply                                     │
│     → 解析剪貼簿中的程式碼，套用到專案                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 命令說明

### main.py

```bash
# 互動模式
python main.py

# 生成 chat.txt
python main.py generate
python main.py generate -t "修復登入功能的 bug"

# 套用 AI 回覆
python main.py apply

# 列出選中檔案
python main.py list
```

### projectIO.py

```bash
# 專案管理互動選單
python projectIO.py

# 選項：
# 1. Add      - 新增專案
# 2. Delete   - 刪除專案
# 3. Select   - 選擇當前專案
# 0. Exit     - 離開
```

### init.py

```bash
# 初始化 file/ 資料夾
python init.py
```

---

## VS Code Extension

### 安裝

1. 開啟 `ai-coder-helper/` 資料夾
2. 執行 `npm install && npm run compile`
3. 按 F5 啟動 Extension Development Host

### 功能

- **AI Coder** 圖示出現在 Activity Bar
- 點擊檔案切換選中狀態
- `Ctrl+Shift+P` → `AI Coder: Generate Chat`
- `Ctrl+Shift+P` → `AI Coder: Apply Changes`

---

## 資料格式

### file/data.json

```json
{
  "projects": {
    "my-project": {
      "path": "C:/path/to/project",
      "selected_files": [
        "C:/path/to/project/main.py",
        "C:/path/to/project/utils.py"
      ]
    }
  },
  "current_project": "my-project"
}
```

### .vscode/ai-coder.json (Extension 使用)

```json
{
  "selectedFiles": [
    "C:/path/to/project/main.py",
    "C:/path/to/project/utils.py"
  ]
}
```

---

## 依賴

- Python 3.x
- pyperclip (剪貼簿，可選): `pip install pyperclip`
- Node.js (Extension 編譯用)

---

## Penter Syntax Spec

The AI Coder Helper uses the "Penter" format to apply changes.

### Block Format
```penter
Penter
{
    FILE "path/to/file.ext" {
        ... operations ...
    }
}
```

### Commands

| Command | Syntax | Description |
| :--- | :--- | :--- |
| **FILE** | `FILE "path" { ... }` | Context block for file operations. |
| **ADD** | `ADD n { <<< code >>> }` | Inserts code **BEFORE** line `n`. |
| **ADD_AFTER** | `ADD_AFTER n { <<< code >>> }` | Inserts code **AFTER** line `n`. |
| **REMOVE** | `REMOVE start-end { }` | Removes lines (inclusive). Empty block. |
| **Code Block** | `<<<` ... `>>>` | Encloses content inside ADD/CREATE blocks. |
| **CREATE** | `CREATE { <<< content >>> }` | Creates new file (inside FILE block). |
| **DELETE** | `DELETE { }` | Deletes file (inside FILE block). |
| **RENAME** | `RENAME "new_name" { }` | Renames file (inside FILE block). |
| **MKDIR** | `MKDIR "path" { }` | Creates directory (recursive). |
| **RMDIR** | `RMDIR "path" { }` | Removes directory (recursive). |

