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
// Color schemes for diff highlighting
const COLOR_SCHEMES = {
    default: {
        added: 'rgba(40, 167, 69, 0.3)', // Green
        deleted: 'rgba(220, 53, 69, 0.3)' // Red
    },
    pastel: {
        added: 'rgba(152, 251, 152, 0.4)', // Pale Green
        deleted: 'rgba(255, 182, 193, 0.4)' // Light Pink
    },
    vivid: {
        added: 'rgba(0, 255, 0, 0.25)', // Bright Green
        deleted: 'rgba(255, 0, 0, 0.25)' // Bright Red
    },
    blue_orange: {
        added: 'rgba(100, 149, 237, 0.3)', // Cornflower Blue
        deleted: 'rgba(255, 165, 0, 0.3)' // Orange
    },
    purple_yellow: {
        added: 'rgba(147, 112, 219, 0.3)', // Medium Purple
        deleted: 'rgba(255, 255, 0, 0.3)' // Yellow
    }
};
class ShadowDiffDecorationProvider {
    constructor(appRoot) {
        this.enabled = false;
        this.colorScheme = 'default';
        this.disposables = [];
        this.appRoot = appRoot;
        this.createDecorations();
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && this.enabled) {
                this.updateDecorations(editor);
            }
        }));
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document && this.enabled) {
                this.updateDecorations(editor);
            }
        }));
    }
    createDecorations() {
        const scheme = COLOR_SCHEMES[this.colorScheme] || COLOR_SCHEMES.default;
        if (this.addedDecoration)
            this.addedDecoration.dispose();
        if (this.deletedDecoration)
            this.deletedDecoration.dispose();
        this.addedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: scheme.added,
            isWholeLine: true,
            overviewRulerColor: scheme.added,
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
        this.deletedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: scheme.deleted,
            isWholeLine: true,
            overviewRulerColor: scheme.deleted,
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }
    setColorScheme(scheme) {
        if (COLOR_SCHEMES[scheme]) {
            this.colorScheme = scheme;
            this.createDecorations();
            const editor = vscode.window.activeTextEditor;
            if (editor && this.enabled) {
                this.updateDecorations(editor);
            }
        }
    }
    getColorSchemes() {
        return Object.keys(COLOR_SCHEMES);
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
        catch (e) { }
        return path.join(this.appRoot, 'file', 'shadow');
    }
    getOpenedProjectPath() {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj && data.projects && data.projects[currentProj]) {
                    const projectInfo = data.projects[currentProj];
                    let ideContext = projectInfo.ide_context || projectInfo.path || '';
                    if (ideContext && !path.isAbsolute(ideContext)) {
                        ideContext = path.join(this.appRoot, ideContext);
                    }
                    return ideContext;
                }
            }
        }
        catch (e) { }
        return '';
    }
    // Line-by-line diff algorithm
    computeDiff(openedLines, shadowLines) {
        const added = [];
        const deleted = [];
        // Use LCS-like approach for better accuracy
        let oi = 0; // opened index
        let si = 0; // shadow index
        while (oi < openedLines.length || si < shadowLines.length) {
            if (oi >= openedLines.length) {
                // Remaining shadow lines are additions
                added.push(si);
                si++;
            }
            else if (si >= shadowLines.length) {
                // Remaining opened lines are deletions
                deleted.push({ lineNum: si > 0 ? si - 1 : 0, content: openedLines[oi] });
                oi++;
            }
            else if (openedLines[oi] === shadowLines[si]) {
                // Lines match, move both
                oi++;
                si++;
            }
            else {
                // Lines differ - check if opened line exists later in shadow
                const futureInShadow = shadowLines.slice(si + 1).indexOf(openedLines[oi]);
                const futureInOpened = openedLines.slice(oi + 1).indexOf(shadowLines[si]);
                if (futureInShadow >= 0 && (futureInOpened < 0 || futureInShadow <= futureInOpened)) {
                    // Shadow line is new (addition)
                    added.push(si);
                    si++;
                }
                else if (futureInOpened >= 0) {
                    // Opened line was deleted
                    deleted.push({ lineNum: si, content: openedLines[oi] });
                    oi++;
                }
                else {
                    // Both lines are different - shadow is added, opened is deleted
                    added.push(si);
                    deleted.push({ lineNum: si, content: openedLines[oi] });
                    oi++;
                    si++;
                }
            }
        }
        return { added, deleted };
    }
    updateDecorations(editor) {
        if (!this.enabled)
            return;
        const filePath = editor.document.uri.fsPath;
        const shadowRoot = this.getShadowRoot();
        if (!filePath.startsWith(shadowRoot)) {
            this.clearDecorations(editor);
            return;
        }
        const relativePath = path.relative(shadowRoot, filePath);
        const openedProjectPath = this.getOpenedProjectPath();
        if (!openedProjectPath) {
            this.clearDecorations(editor);
            return;
        }
        const openedFilePath = path.join(openedProjectPath, relativePath);
        if (!fs.existsSync(openedFilePath)) {
            // All shadow lines are additions
            const allLines = [];
            for (let i = 0; i < editor.document.lineCount; i++) {
                allLines.push({ range: new vscode.Range(i, 0, i, Number.MAX_VALUE) });
            }
            editor.setDecorations(this.addedDecoration, allLines);
            editor.setDecorations(this.deletedDecoration, []);
            return;
        }
        let openedLines;
        try {
            openedLines = fs.readFileSync(openedFilePath, 'utf8').split(/\r?\n/);
        }
        catch (e) {
            this.clearDecorations(editor);
            return;
        }
        const shadowLines = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            shadowLines.push(editor.document.lineAt(i).text);
        }
        // Use proper line-by-line diff
        const diff = this.computeDiff(openedLines, shadowLines);
        // Create decorations
        const addedRanges = diff.added.map(lineNum => ({
            range: new vscode.Range(lineNum, 0, lineNum, Number.MAX_VALUE)
        }));
        // For deleted lines, show at the position where they would have been
        const deletedRanges = [];
        const deletedByLine = new Map();
        for (const { lineNum, content } of diff.deleted) {
            if (!deletedByLine.has(lineNum)) {
                deletedByLine.set(lineNum, []);
            }
            deletedByLine.get(lineNum).push(content);
        }
        for (const [lineNum, contents] of deletedByLine) {
            const safeLineNum = Math.min(lineNum, editor.document.lineCount - 1);
            const hoverText = contents.join('\n');
            deletedRanges.push({
                range: new vscode.Range(safeLineNum, 0, safeLineNum, Number.MAX_VALUE),
                hoverMessage: new vscode.MarkdownString(`** Deleted (${contents.length}):**\n\`\`\`\n${hoverText}\n\`\`\``)
            });
        }
        editor.setDecorations(this.addedDecoration, addedRanges);
        editor.setDecorations(this.deletedDecoration, deletedRanges);
    }
    dispose() {
        this.addedDecoration.dispose();
        this.deletedDecoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.ShadowDiffDecorationProvider = ShadowDiffDecorationProvider;
//# sourceMappingURL=shadowDiffDecorationProvider.js.map