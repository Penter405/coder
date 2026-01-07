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
            // Standard click behavior (open file) is handled by VS Code referencing command in tree view options? 
            // Or we can set command to open file.
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
    }
}
exports.FileItem = FileItem;
class FileTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        // Watch for changes (simplified, no selection sync needed)
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
            // Debounce refresh? For now simple.
            watcher.onDidChange(() => this.refresh());
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
        }
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
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
            return await this.getFileItems(workspaceRoot, excludePatterns);
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
}
exports.FileTreeProvider = FileTreeProvider;
//# sourceMappingURL=fileSelector.js.map