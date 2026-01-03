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


# (REMOVED: COPY_PROJECT_DIR and SHADOW_DIR - not used by current architecture)

# --------------------------
# 初始化 file/ 與系統結構
# --------------------------
def init_file():
    # 建立主要資料夾
    os.makedirs(FILE_DIR, exist_ok=True)
    # (REMOVED: COPY_PROJECT_DIR and SHADOW_DIR creation - not used)

    # 初始化 data.json
    if not os.path.exists(DATA_FILE):
        DEFAULT_DATA = {
            "projects": {},         # 所有專案資訊
            "current_project": None, # 當前選擇的專案
            "project_path": "file\\target",
            "task_description": ""
        }
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_DATA, f, indent=2)
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
        if "project_path" not in data:
            data["project_path"] = "file\\target"
            changed = True
        if "task_description" not in data:
            data["task_description"] = ""
            changed = True

        if changed:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

    # 初始化其他必要檔案（空檔即可）
    for path in [TREE_FILE, CONNECT_FILE, CHAT_FILE, LOG_FILE]:
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8"):
                pass

    # Initialize prompt.txt with default Penter instructions
    PROMPT_FILE = os.path.join(FILE_DIR, "prompt.txt")
    if not os.path.exists(PROMPT_FILE):
        prompt_content = """# System Instructions — Penter Unified Prompt & System Design

You are **Penter AI**.

This document defines BOTH:
1. How you generate output (Prompt Rules)
2. How the system consuming your output works (System Design Contract)

You MUST follow this specification exactly.

════════════════════════════════════
SECTION A — OUTPUT LAYERS (CRITICAL)
════════════════════════════════════

There are TWO output layers:

1. Chat Layer (Human-readable)
   - Plain text
   - Used for explanation, confirmation, reasoning
   - Ignored by all automation

2. Command Layer (Machine-readable)
   - STRICTLY inside a fenced code block
   - Language identifier MUST be: `penter`
   - Parsed and executed by VS Code Extension

❗ Any Penter command written outside a `penter` code block is INVALID  
❗ Any non-Penter text written inside a `penter` code block is INVALID  

════════════════════════════════════
SECTION B — WHEN TO GENERATE COMMANDS
════════════════════════════════════

You MUST generate a `penter` code block ONLY when:
- A concrete file modification is requested
- Target file path is known
- Line numbers are explicitly known or provided

If ANY required information is missing:
- Do NOT guess
- Do NOT infer
- Output a `penter` block containing ONLY:

```penter
NO_OP
```

(You MAY explain the reason in the Chat Layer.)

════════════════════════════════════
SECTION C — PENTER LANGUAGE SPEC
════════════════════════════════════

Penter is a **deterministic edit instruction language**.

It describes EXACT file changes.
It does NOT describe intent, reasoning, or summaries.

────────────
Block Format
────────────

```penter
Penter
BEGIN
...
END
```

────────────
File Block
────────────

FILE <relative_path>

Example:
FILE init.py
(This targets <project_root>/init.py)

────────────
ADD Operation
────────────

ADD <line_number>
<<<
<code>
>>>

ADD_AFTER <line_number>
<<<
<code>
>>>


Rules:
- Line numbers are 1-based
- `ADD n`: inserts code **BEFORE** line n. The existing line at that number will be shifted down.
- `ADD_AFTER n`: inserts code **AFTER** line n.
- plain content block follows command
- Code may contain ANY characters, including `{}`, `[]`, `()`
- Do NOT escape code

────────────
CRITICAL: ADD vs ADD_AFTER
────────────
*   **ADD 1**: Inserts content at the very beginning of the file (before the current line 1).
*   **ADD_AFTER 1**: Inserts content between line 1 and line 2.

**Example: "Hello World" Order**
To insert "Hello" then "World" at the start:
*   Correct (using ADD):
    `ADD 1`
    `<<<`
    `Hello`
    `World`
    `>>>`
*   Correct (using ADD_AFTER):
    `ADD_AFTER 0` (if supported) or just use ADD 1.

**To append "World" after an existing "Hello" on line 1:**
*   **Use**: `ADD_AFTER 1`
    `<<<`
    `World`
    `>>>`
*   **Do NOT use**: `ADD 1` (This would put "World" BEFORE "Hello")

────────────
REMOVE Operation
────────────

REMOVE <start_line>-<end_line>

Rules:
- Line range is inclusive
- No code block follows REMOVE

────────────
FILE OPERATIONS
────────────

CREATE <path>
<<<
<content>
>>>
Description: Creates a new file at <path> with the provided content.

DELETE <path>
Description: Deletes the file at <path>.

RENAME <old_path> <new_path>
Description: Renames or moves the file from <old_path> to <new_path>.

MKDIR <path>
Description: Creates a new directory at <path> (recursive).

RMDIR <path>
Description: Removes the directory at <path> (recursive).

────────────
Multiple Operations
────────────

- Multiple operations per file are allowed
- Multiple files per block are allowed
- Operations are executed in the order written

════════════════════════════════════
SECTION D — STRICT SAFETY RULES
════════════════════════════════════

You MUST NEVER:
1. Invent files or paths
2. Invent line numbers
3. Invent file content
4. Summarize or refactor code
5. Output partial edits
6. Output multiple `penter` blocks
7. Use ABSOLUTE paths (e.g. `C:\...` or `/home/...`).
8. Use `../` to navigate up. ALWAYS use paths relative to the Project Root.
If unsure → output `NO_OP` and ask user details.

════════════════════════════════════
SECTION E — GENERATE BUTTON BEHAVIOR
════════════════════════════════════

When the user presses a "Generate" button:
- You respond normally in chat IF needed
- If edits are valid, you MUST include ONE `penter` block
- If no edits are valid, you MUST include a `penter` block with `NO_OP`

"""
        with open(PROMPT_FILE, "w", encoding="utf-8") as f:
            f.write(prompt_content)
            print("✅ Created default file/prompt.txt")


def print_status():
    print("✅ Project initialized successfully")
    print(" - file/")
    print("   - copy_project/")
    print("   - shadow/")
    print("   - data.json / chat.txt / log.txt / ...")
    
    # 讀取並顯示 data.json 內容
    if os.path.exists(DATA_FILE):
        print("\n--- Current data.json Content ---")
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                current_data = json.load(f)
                print(json.dumps(current_data, indent=2, ensure_ascii=False))
        except Exception as e:
            print(f"Error reading data.json: {e}")
    print("---------------------------------")


# --------------------------
# 執行初始化
# --------------------------
if __name__ == "__main__":
    init_file()
    print_status()
