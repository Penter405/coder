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
exports.ShadowDiffDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Provides inline diff decorations for Shadow files.
 * Shows differences between Shadow and Opened project files using:
 * - Green background: Lines in Shadow but not in Opened (additions)
 * - Red inline text: Lines in Opened but not in Shadow (deletions)
 */
class ShadowDiffDecorationProvider {
    constructor(appRoot) {
        this.enabled = false;
        this.disposables = [];
        this.appRoot = appRoot;
        // Green for added lines
        this.addedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(40, 167, 69, 0.3)', // Green
            isWholeLine: true,
            overviewRulerColor: 'rgba(40, 167, 69, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
        // Red for deleted lines header
        this.deletedDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: false
        });
        // Listen for active editor changes
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && this.enabled) {
                this.updateDecorations(editor);
            }
        }));
        // Listen for document changes
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document && this.enabled) {
                this.updateDecorations(editor);
            }
        }));
    }
    toggle() {
        this.enabled = !this.enabled;
        const editor = vscode.window.activeTextEditor;
        if (this.enabled && editor) {
            this.updateDecorations(editor);
        }
        else if (!this.enabled && editor) {
            this.clearDecorations(editor);
        }
        return this.enabled;
    }
    isEnabled() {
        return this.enabled;
    }
    clearDecorations(editor) {
        editor.setDecorations(this.addedDecoration, []);
        editor.setDecorations(this.deletedDecoration, []);
    }
    getShadowRoot() {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj) {
                    return path.join(this.appRoot, 'file', currentProj, 'shadow');
                }
            }
        }
        catch (e) {
            console.error('[ShadowDiffDecorationProvider] Error reading data.json:', e);
        }
        return path.join(this.appRoot, 'file', 'shadow');
    }
    getOpenedProjectPath() {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj && data.projects && data.projects[currentProj]) {
                    return data.projects[currentProj].path;
                }
            }
        }
        catch (e) {
            console.error('[ShadowDiffDecorationProvider] Error getting project path:', e);
        }
        return '';
    }
    updateDecorations(editor) {
        if (!this.enabled)
            return;
        const filePath = editor.document.uri.fsPath;
        const shadowRoot = this.getShadowRoot();
        // Check if this file is in the shadow directory
        if (!filePath.startsWith(shadowRoot)) {
            this.clearDecorations(editor);
            return;
        }
        // Get relative path from shadow root
        const relativePath = path.relative(shadowRoot, filePath);
        // Get corresponding opened project file
        const openedProjectPath = this.getOpenedProjectPath();
        if (!openedProjectPath) {
            this.clearDecorations(editor);
            return;
        }
        const openedFilePath = path.join(openedProjectPath, relativePath);
        // If opened file doesn't exist, entire shadow file is "added"
        if (!fs.existsSync(openedFilePath)) {
            const allLines = [];
            for (let i = 0; i < editor.document.lineCount; i++) {
                allLines.push({ range: new vscode.Range(i, 0, i, Number.MAX_VALUE) });
            }
            editor.setDecorations(this.addedDecoration, allLines);
            editor.setDecorations(this.deletedDecoration, []);
            return;
        }
        // Read opened file
        let openedLines;
        try {
            openedLines = fs.readFileSync(openedFilePath, 'utf8').split(/\r?\n/);
        }
        catch (e) {
            this.clearDecorations(editor);
            return;
        }
        // Get shadow lines
        const shadowLines = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            shadowLines.push(editor.document.lineAt(i).text);
        }
        // Diff results
        const addedRanges = [];
        const deletedDecorations = [];
        // Create sets for quick lookup
        const openedSet = new Set(openedLines);
        const shadowSet = new Set(shadowLines);
        // Check each shadow line for additions (GREEN)
        for (let i = 0; i < shadowLines.length; i++) {
            const line = shadowLines[i];
            if (!openedSet.has(line)) {
                addedRanges.push({ range: new vscode.Range(i, 0, i, Number.MAX_VALUE) });
            }
        }
        // Find deleted lines (RED) - lines in Opened but not in Shadow
        const deletedLines = openedLines.filter(line => !shadowSet.has(line) && line.trim() !== '');
        if (deletedLines.length > 0) {
            // Show deleted lines as red text at the beginning of line 0
            const deletedPreview = deletedLines.slice(0, 3).map(l => l.substring(0, 30)).join(' | ');
            const moreText = deletedLines.length > 3 ? ` (+${deletedLines.length - 3} more)` : '';
            deletedDecorations.push({
                range: new vscode.Range(0, 0, 0, 0),
                renderOptions: {
                    before: {
                        contentText: `⛔ DELETED: ${deletedPreview}${moreText} `,
                        color: '#dc3545',
                        backgroundColor: 'rgba(220, 53, 69, 0.2)',
                        fontStyle: 'italic',
                        textDecoration: 'line-through'
                    }
                },
                hoverMessage: new vscode.MarkdownString(`**Deleted lines (${deletedLines.length}):**\n\`\`\`\n${deletedLines.join('\n')}\n\`\`\``)
            });
        }
        editor.setDecorations(this.addedDecoration, addedRanges);
        editor.setDecorations(this.deletedDecoration, deletedDecorations);
    }
    dispose() {
        this.addedDecoration.dispose();
        this.deletedDecoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.ShadowDiffDecorationProvider = ShadowDiffDecorationProvider;
//# sourceMappingURL=shadowDiffDecorationProvider.js.map