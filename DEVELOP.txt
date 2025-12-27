main.py
│
├─ Load file/data.json
│   │
│   ├─ current_project exists?
│   │   │
│   │   ├─ NO
│   │   │   └─ Show warning
│   │   │       └─ Exit
│   │   │
│   │   └─ YES
│   │       └─ Continue
│   │
│   └─ Read projects / selected_files
│
└─ Main Window (GUI)
    │
    ├─ Show:
    │   ├─ Current Project Name
    │   └─ Project Path
    │
    ├─ [ Option 1 ] Control Selected Files
    │   │
    │   └─ Control Selected Files Window
    │       │
    │       ├─ Scan project directory
    │       │   │
    │       │   └─ Build file tree
    │       │       │
    │       │       └─ Checkbox rule
    │       │           ├─ Check folder
    │       │           │   └─ Auto-check all children
    │       │           │
    │       │           └─ Uncheck folder
    │       │               └─ Auto-uncheck all children
    │       │
    │       ├─ User selects files
    │       │
    │       ├─ [ Apply ]
    │       │   └─ Save to data.json
    │       │       └─ projects[<name>].selected_files
    │       │
    │       └─ [ Cancel ]
    │           └─ Discard changes
    │
    ├─ [ Option 2 ] Enter
    │   │
    │   └─ Enter Workspace
    │       │
    │       ├─ Read selected_files
    │       │   │
    │       │   ├─ Empty
    │       │   │   └─ Warn: AI has no permission
    │       │   │
    │       │   └─ Not empty
    │       │       └─ Continue
    │       │
    │       ├─ Generate chat.txt
    │       │   ├─ task_description
    │       │   ├─ project tree
    │       │   └─ contents of selected_files ONLY
    │       │
    │       ├─ User copy → paste to LLM
    │       │
    │       ├─ LLM outputs code / patch
    │       │
    │       └─ User paste back
    │           ├─ Apply changes
    │           └─ Write log.txt
    │
    └─ [ Option 3 ] Exit
        └─ Program End
