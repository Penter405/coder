"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileTreeProvider = exports.FileItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class FileItem extends vscode.TreeItem {
    constructor(name, resourceUri, isDirectory, collapsibleState) {
        super(name, collapsibleState);
        this.selected = false;
        this.children = [];
        this.filePath = resourceUri.fsPath;
        this.isDirectory = isDirectory;
        this.resourceUri = resourceUri;
        this.tooltip = resourceUri.fsPath;
        this.contextValue = isDirectory ? 'folder' : 'file';
        // Set icon based on type
        if (isDirectory) {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
        else {
            this.iconPath = new vscode.ThemeIcon('file');
        }
        // Make items clickable to toggle selection
        if (!isDirectory) {
            this.command = {
                command: 'aiCoder.toggleFile',
                title: 'Toggle Selection',
                arguments: [this]
            };
        }
    }
    updateCheckbox() {
        if (!this.isDirectory) {
            this.checkboxState = this.selected
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
            // Clear iconPath so it uses default file icon
            this.iconPath = vscode.ThemeIcon.File;
        }
    }
}
exports.FileItem = FileItem;
class FileTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.selectedFiles = new Set();
        this.rootItems = [];
        this.loadSavedSelection();
        // Watch for chat.txt changes to auto-sync selection
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/{chat.txt,file/chat.txt}'));
            watcher.onDidChange(() => {
                this.loadSavedSelection();
                this.refresh();
            });
            watcher.onDidCreate(() => {
                this.loadSavedSelection();
                this.refresh();
            });
        }
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        element.updateCheckbox();
        return element;
    }
    async getChildren(element) {
        if (!vscode.workspace.workspaceFolders) {
            return [];
        }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration('aiCoder');
        const excludePatterns = config.get('excludePatterns', []);
        if (!element) {
            // Root level
            this.rootItems = await this.getFileItems(workspaceRoot, excludePatterns);
            return this.rootItems;
        }
        else if (element.isDirectory) {
            return await this.getFileItems(element.filePath, excludePatterns);
        }
        return [];
    }
    async getFileItems(dirPath, excludePatterns) {
        const items = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                // Check exclusions
                const shouldExclude = excludePatterns.some(pattern => {
                    if (pattern.startsWith('*')) {
                        return entry.name.endsWith(pattern.slice(1));
                    }
                    return entry.name === pattern;
                });
                if (shouldExclude)
                    continue;
                const fullPath = path.join(dirPath, entry.name);
                const uri = vscode.Uri.file(fullPath);
                const item = new FileItem(entry.name, uri, entry.isDirectory(), entry.isDirectory()
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None);
                // Restore selection state
                if (this.selectedFiles.has(fullPath)) {
                    item.selected = true;
                }
                items.push(item);
            }
            // Sort: directories first, then files, alphabetically
            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory)
                    return -1;
                if (!a.isDirectory && b.isDirectory)
                    return 1;
                return a.label.localeCompare(b.label);
            });
        }
        catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        return items;
    }
    toggleSelection(item) {
        if (item.isDirectory)
            return;
        item.selected = !item.selected;
        if (item.selected) {
            this.selectedFiles.add(item.filePath);
        }
        else {
            this.selectedFiles.delete(item.filePath);
        }
        this.saveSelection();
        this._onDidChangeTreeData.fire(item);
    }
    selectAll() {
        this.selectAllRecursive(this.rootItems, true);
        this.saveSelection();
        this._onDidChangeTreeData.fire();
    }
    deselectAll() {
        this.selectedFiles.clear();
        this.selectAllRecursive(this.rootItems, false);
        this.saveSelection();
        this._onDidChangeTreeData.fire();
    }
    selectAllRecursive(items, select) {
        for (const item of items) {
            if (!item.isDirectory) {
                item.selected = select;
                if (select) {
                    this.selectedFiles.add(item.filePath);
                }
            }
            if (item.children) {
                this.selectAllRecursive(item.children, select);
            }
        }
    }
    getSelectedFiles() {
        return Array.from(this.selectedFiles);
    }
    saveSelection() {
        if (!vscode.workspace.workspaceFolders)
            return;
        const configPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'ai-coder.json');
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const config = {
            selectedFiles: Array.from(this.selectedFiles)
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    loadSavedSelection() {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const configPath = path.join(root, '.vscode', 'ai-coder.json');
        // First try chat.txt (Sync from ConsoleWindow)
        // Check both root/chat.txt and files/chat.txt (path config-dependent)
        const config = vscode.workspace.getConfiguration('aiCoder');
        const outputFile = config.get('outputFile', 'chat.txt');
        const possiblePaths = [
            path.join(root, outputFile),
            path.join(root, 'file', 'chat.txt')
        ];
        let loadedFromChat = false;
        for (const chatPath of possiblePaths) {
            if (fs.existsSync(chatPath)) {
                try {
                    const content = fs.readFileSync(chatPath, 'utf8');
                    // Regex to find ## [Tag] path
                    const matches = content.match(/^## \[(?:Source|Coped)\] (.*)$/gm);
                    if (matches) {
                        this.selectedFiles.clear();
                        matches.forEach(m => {
                            // m is like "## [Source] path/to/file.py"
                            // Extract path
                            const match = /^## \[(?:Source|Coped)\] (.*)$/.exec(m);
                            if (match) {
                                let relPath = match[1].trim();
                                const absPath = path.join(root, relPath);
                                this.selectedFiles.add(absPath);
                            }
                        });
                        loadedFromChat = true;
                        break;
                    }
                }
                catch (e) {
                    console.error('Error reading chat.txt:', e);
                }
            }
        }
        if (loadedFromChat) {
            return;
        }
        // Fallback to saved json config
        try {
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (config.selectedFiles) {
                    this.selectedFiles = new Set(config.selectedFiles);
                }
            }
        }
        catch (error) {
            console.error('Error loading saved selection:', error);
        }
    }
}
exports.FileTreeProvider = FileTreeProvider;
//# sourceMappingURL=fileSelector.js.map