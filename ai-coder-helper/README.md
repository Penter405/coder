# AI Coder Helper

A VS Code extension that helps you prepare code for AI coding assistants.

## Features

### 1. File Selection
- Click the AI Coder icon in the Activity Bar
- Select files you want to share with AI
- Selections are saved automatically

### 2. Generate Chat
- Run command: `AI Coder: Generate Chat`
- Enter your task description
- The extension generates a formatted chat.txt with:
  - Your task description
  - Project structure tree
  - Contents of selected files
- Content is automatically copied to clipboard

### 3. Apply Changes
- Copy AI response to clipboard
- Run command: `AI Coder: Apply Changes`
- The extension parses and applies file changes
- All changes are logged to `log.txt`

## Commands

| Command | Description |
|---------|-------------|
| `AI Coder: Generate Chat` | Generate chat.txt from selected files |
| `AI Coder: Apply Changes` | Apply AI response to files |
| `AI Coder: Refresh File List` | Refresh the file tree |
| `AI Coder: Select All Files` | Select all files |
| `AI Coder: Deselect All Files` | Deselect all files |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `aiCoder.outputFile` | `chat.txt` | Output file name |
| `aiCoder.excludePatterns` | `["node_modules", ".git", ...]` | Patterns to exclude |

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Click "..." menu → "Install from VSIX..."
4. Select the `.vsix` file

## Building from Source

```bash
npm install
npm run compile
npx vsce package
```

## License

MIT
