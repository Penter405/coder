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
        # New structure with separate origin/shadow/coped sections
        DEFAULT_DATA = {
            "projects": {},         # 所有專案資訊
            "current_project": None # 當前選擇的專案
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
        prompt_content = r"""# System Instructions — Penter Unified Prompt & System Design

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
SECTION C — PENTER LANGUAGE SPEC (HIERARCHICAL)
════════════════════════════════════

Penter uses a **nested block structure**.
String arguments must be quoted. integers can be plain.

────────────
Structure
────────────

```penter
Penter
{
    FILE "relative/path.ext" {
        ... operations ...
    }
}
```

────────────
OPERATIONS
────────────

ADD <line_number> {
    <<<
    <code>
    >>>
}

ADD_AFTER <line_number> {
    <<<
    <code>
    >>>
}

REMOVE <start_line>-<end_line> {
}
(Empty block for REMOVE, reserved for future options)

CREATE {
    <<<
    <content>
    >>>
}
(Used inside FILE block)

DELETE {
}

RENAME "new_name.ext" {
}

MKDIR "path/to/dir" {
}
(Creates directory recursively)

RMDIR "path/to/dir" {
}
(Removes directory recursively)

────────────
INDENTATION RULES
────────────
Code inside `<<< ... >>>` blocks is **Auto-Dedented**.
This means the common leading whitespace is stripped.
You can indent the code block for readability in your output.

**CRITICAL: Use 4 spaces for indentation. Do NOT use tabs.**
Mixed indentation causes syntax errors.

Example of Auto-Dedent:
```penter
    FILE "example.py" {
        ADD 10 {
            <<<
            def foo():
                pass
            >>>
        }
    }
```
Is interpreted as:
```python
def foo():
    pass
```

If you need to insert indented code (e.g., inside a class), ensure it has *extra* indentation relative to the block start, OR just write it cleanly.
Typically, write the code as it should appear in the file, treating the column aligned with `<<<` (or the first line) as column 0.

────────────
Example
────────────

```penter
Penter
{
    FILE "main.py" {
        ADD 10 {
            <<<
            print("Hello")
            >>>
        }

        REMOVE 15-20 {
        }
    }

    FILE "utils.py" {
        CREATE {
            <<<
            def help(): pass
            >>>
        }
    }
}
```

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
