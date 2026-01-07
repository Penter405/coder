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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ShadowFileItem extends vscode.TreeItem {
    constructor(name, shadowPath, originalPath, isDirectory) {
        super(name, isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.shadowPath = shadowPath;
        this.originalPath = originalPath;
        this.isDirectory = isDirectory;
        this.resourceUri = vscode.Uri.file(shadowPath);
        this.contextValue = isDirectory ? 'shadowFolder' : 'shadowFile';
        if (isDirectory) {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
        else {
            this.iconPath = new vscode.ThemeIcon('file');
            // Open Shadow file directly for editing (not diff view)
            this.command = {
                command: 'vscode.open',
                title: 'Open Shadow File',
                arguments: [vscode.Uri.file(shadowPath)]
            };
        }
    }
}
exports.ShadowFileItem = ShadowFileItem;
class ShadowTreeProvider {
    constructor(appRoot) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.shadowRoot = '';
        this.workspaceRoot = '';
        this.appRoot = '';
        this.appRoot = appRoot || '';
        this.initializeRoots();
    }
    initializeRoots() {
        if (vscode.workspace.workspaceFolders) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.updateShadowRoot();
        }
    }
    updateShadowRoot() {
        if (!this.workspaceRoot && !this.appRoot)
            return;
        // Use appRoot if provided, otherwise fall back to searching in workspaceRoot
        const searchRoot = this.appRoot || this.workspaceRoot;
        const dataPath = path.join(searchRoot, 'file', 'data.json');
        console.log(`[ShadowTreeProvider] searchRoot: ${searchRoot}`);
        console.log(`[ShadowTreeProvider] dataPath: ${dataPath}`);
        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj) {
                    // Shadow is always at: appRoot/file/{projectName}/shadow/
                    this.shadowRoot = path.join(searchRoot, 'file', currentProj, 'shadow');
                    console.log(`[ShadowTreeProvider] shadowRoot: ${this.shadowRoot}`);
                    // Verify existence
                    if (!fs.existsSync(this.shadowRoot)) {
                        fs.mkdirSync(this.shadowRoot, { recursive: true });
                    }
                }
                else {
                    this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
                }
            }
            else {
                console.log(`[ShadowTreeProvider] data.json not found at: ${dataPath}`);
                this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
            }
        }
        catch (e) {
            console.error('[ShadowTreeProvider] Error reading data.json:', e);
            this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
        }
    }
    refresh() {
        this.updateShadowRoot();
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!this.workspaceRoot)
            return [];
        if (!this.shadowRoot || !fs.existsSync(this.shadowRoot))
            return [];
        const searchDir = element ? element.shadowPath : this.shadowRoot;
        const items = [];
        try {
            const entries = fs.readdirSync(searchDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === '.git' || entry.name === '__pycache__')
                    continue;
                const shadowPath = path.join(searchDir, entry.name);
                // Calculate original path
                // relative from shadowRoot -> apply to workspaceRoot
                // NOTE: shadowRoot is e.g. workspace/file/Project/shadow
                // We want to map to workspace/Project/... (or just workspace/...)
                // Current shadowRoot logic assumes shadow is DEEP inside 'file'.
                // If we want to map back to Source, we take relative path from shadowRoot.
                const relative = path.relative(this.shadowRoot, shadowPath);
                const originalPath = path.join(this.workspaceRoot, relative);
                items.push(new ShadowFileItem(entry.name, shadowPath, originalPath, entry.isDirectory()));
            }
            // Sort: directories first
            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory)
                    return -1;
                if (!a.isDirectory && b.isDirectory)
                    return 1;
                // Safe access to label (inherited from TreeItem) which is 'name' passed to super
                // But TreeItem.label can be string or TreeItemLabel. We passed string 'name'.
                const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
                const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
                return labelA.localeCompare(labelB);
            });
        }
        catch (e) {
            console.error('Error in ShadowTreeProvider.getChildren:', e);
        }
        return items;
    }
    log(message) {
        if (this.workspaceRoot) {
            const logPath = path.join(this.workspaceRoot, 'file', 'log.txt');
            // Ensure dir exists
            const dir = path.dirname(logPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const timestamp = new Date().toISOString();
            const entry = `[${timestamp}] SHADOW_ACTION: ${message}\n`;
            try {
                fs.appendFileSync(logPath, entry);
            }
            catch (e) {
                console.error("Failed to write to log:", e);
            }
        }
    }
    async mergeFile(item) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                const content = fs.readFileSync(item.shadowPath, 'utf8');
                // Ensure target dir exists
                const targetDir = path.dirname(item.originalPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                // Handle Deletes (if marker exists, logic from before)
                if (content.trim() === "__DELETED__") {
                    if (fs.existsSync(item.originalPath)) {
                        fs.unlinkSync(item.originalPath);
                        this.log(`Merged DELETE: ${item.originalPath}`);
                    }
                }
                else {
                    fs.writeFileSync(item.originalPath, content, 'utf8');
                    this.log(`Merged FILE: ${item.originalPath}`);
                }
                // Remove shadow file after merge?
                // Or keep it? Usually merge clears the shadow.
                fs.unlinkSync(item.shadowPath);
                // Refresh
                this.refresh();
                vscode.window.showInformationMessage(`Merged ${path.basename(item.originalPath)}`);
                // Try to refresh Opended Project view too if command available
                vscode.commands.executeCommand('aiCoderFiles.refresh');
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Merge failed: ${e}`);
            console.error(e);
        }
    }
    async discardFile(item) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                fs.unlinkSync(item.shadowPath);
                const msg = `Discarded shadow copy of ${path.basename(item.originalPath)}`;
                vscode.window.showInformationMessage(msg);
                this.log(msg);
                this.refresh();
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Discard failed: ${e}`);
        }
    }
}
exports.ShadowTreeProvider = ShadowTreeProvider;
//# sourceMappingURL=shadowExplorer.js.map