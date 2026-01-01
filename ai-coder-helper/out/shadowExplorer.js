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
exports.ShadowTreeProvider = exports.ShadowFileItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ShadowFileItem extends vscode.TreeItem {
    constructor(shadowFilePath, relativePath) {
        super(relativePath, vscode.TreeItemCollapsibleState.None);
        this.shadowFilePath = shadowFilePath;
        this.relativePath = relativePath;
        this.tooltip = `Shadow: ${shadowFilePath}`;
        this.contextValue = 'shadowFile';
        this.command = {
            command: 'aiCoder.diffShadow',
            title: 'Review Changes',
            arguments: [this]
        };
        // Find real file path
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.realFilePath = path.join(root, relativePath);
        }
        else {
            this.realFilePath = '';
        }
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}
exports.ShadowFileItem = ShadowFileItem;
class ShadowTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        // Watch for changes in shadow folder
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const shadowPattern = new vscode.RelativePattern(root, 'file/shadow/**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(shadowPattern);
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
        if (element) {
            return []; // Flat list for now
        }
        const items = [];
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const shadowRoot = path.join(root, 'file', 'shadow');
        if (!fs.existsSync(shadowRoot)) {
            return [];
        }
        // Recursive walk
        const walk = (dir, base) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    walk(fullPath, base);
                }
                else {
                    const relative = path.relative(base, fullPath);
                    items.push(new ShadowFileItem(fullPath, relative));
                }
            }
        };
        try {
            walk(shadowRoot, shadowRoot);
        }
        catch (e) {
            console.error(e);
        }
        return items;
    }
    async mergeFile(item) {
        if (fs.existsSync(item.shadowFilePath)) {
            const content = fs.readFileSync(item.shadowFilePath, 'utf8');
            // Ensure target dir exists
            const targetDir = path.dirname(item.realFilePath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            fs.writeFileSync(item.realFilePath, content, 'utf8');
            // Remove shadow file after merge
            fs.unlinkSync(item.shadowFilePath);
            vscode.window.showInformationMessage(`Merged ${item.relativePath}`);
            this.refresh();
        }
    }
    async discardFile(item) {
        if (fs.existsSync(item.shadowFilePath)) {
            fs.unlinkSync(item.shadowFilePath);
            vscode.window.showInformationMessage(`Discarded shadow copy of ${item.relativePath}`);
            this.refresh();
        }
    }
}
exports.ShadowTreeProvider = ShadowTreeProvider;
//# sourceMappingURL=shadowExplorer.js.map