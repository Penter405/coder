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
        this.ideContext = ''; // Target path for merge (from data.json)
        this.appRoot = '';
        this.appRoot = appRoot ? path.normalize(appRoot) : '';
        console.log('[ShadowTreeProvider] Constructor appRoot:', this.appRoot);
        this.initializeRoots();
    }
    initializeRoots() {
        this.updateShadowRoot();
    }
    updateShadowRoot() {
        if (!this.appRoot) {
            console.log('[ShadowTreeProvider] appRoot is empty');
            return;
        }
        const dataPath = path.join(this.appRoot, 'file', 'data.json');
        console.log('[ShadowTreeProvider] dataPath:', dataPath);
        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj && data.projects && data.projects[currentProj]) {
                    this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', currentProj, 'shadow'));
                    // Get ide_context for merge target
                    const projectInfo = data.projects[currentProj];
                    this.ideContext = projectInfo.ide_context || projectInfo.path || '';
                    // If ide_context is relative, make it absolute
                    if (this.ideContext && !path.isAbsolute(this.ideContext)) {
                        this.ideContext = path.join(this.appRoot, this.ideContext);
                    }
                    console.log('[ShadowTreeProvider] shadowRoot:', this.shadowRoot);
                    console.log('[ShadowTreeProvider] ideContext (merge target):', this.ideContext);
                    if (!fs.existsSync(this.shadowRoot)) {
                        fs.mkdirSync(this.shadowRoot, { recursive: true });
                    }
                }
                else {
                    this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', 'shadow'));
                }
            }
        }
        catch (e) {
            console.error('[ShadowTreeProvider] Error:', e);
            this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', 'shadow'));
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
        console.log('[ShadowTreeProvider] getChildren called');
        if (!this.shadowRoot || !fs.existsSync(this.shadowRoot)) {
            console.log('[ShadowTreeProvider] shadowRoot missing or does not exist');
            return [];
        }
        const searchDir = element ? path.normalize(element.shadowPath) : this.shadowRoot;
        console.log('[ShadowTreeProvider] searchDir:', searchDir);
        const items = [];
        try {
            const entries = fs.readdirSync(searchDir, { withFileTypes: true });
            console.log('[ShadowTreeProvider] entries count:', entries.length);
            for (const entry of entries) {
                if (entry.name === '.git' || entry.name === '__pycache__')
                    continue;
                const shadowPath = path.join(searchDir, entry.name);
                const relative = path.relative(this.shadowRoot, shadowPath);
                // Use ideContext as the merge target base path
                const originalPath = this.ideContext
                    ? path.join(this.ideContext, relative)
                    : shadowPath;
                items.push(new ShadowFileItem(entry.name, shadowPath, originalPath, entry.isDirectory()));
            }
            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory)
                    return -1;
                if (!a.isDirectory && b.isDirectory)
                    return 1;
                const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
                const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
                return labelA.localeCompare(labelB);
            });
        }
        catch (e) {
            console.error('[ShadowTreeProvider] getChildren error:', e);
        }
        console.log('[ShadowTreeProvider] returning items:', items.length);
        return items;
    }
    async mergeFile(item) {
        console.log('[ShadowTreeProvider] mergeFile called');
        console.log('[ShadowTreeProvider] shadowPath:', item.shadowPath);
        console.log('[ShadowTreeProvider] originalPath (target):', item.originalPath);
        try {
            if (fs.existsSync(item.shadowPath)) {
                const content = fs.readFileSync(item.shadowPath, 'utf8');
                const targetDir = path.dirname(item.originalPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                if (content.trim() === "__DELETED__") {
                    if (fs.existsSync(item.originalPath)) {
                        fs.unlinkSync(item.originalPath);
                        console.log('[ShadowTreeProvider] Deleted file:', item.originalPath);
                    }
                }
                else {
                    fs.writeFileSync(item.originalPath, content, 'utf8');
                    console.log('[ShadowTreeProvider] Wrote file:', item.originalPath);
                }
                fs.unlinkSync(item.shadowPath);
                this.refresh();
                vscode.window.showInformationMessage(`Merged ${path.basename(item.originalPath)}`);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Merge failed: ${e}`);
            console.error('[ShadowTreeProvider] mergeFile error:', e);
        }
    }
    async discardFile(item) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                fs.unlinkSync(item.shadowPath);
                vscode.window.showInformationMessage(`Discarded shadow copy of ${path.basename(item.originalPath)}`);
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