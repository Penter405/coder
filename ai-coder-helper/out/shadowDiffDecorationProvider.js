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
// Adjusted opacity to be more transparent as requested (0.15)
const COLOR_SCHEMES = {
    default: {
        added: 'rgba(40, 167, 69, 0.15)', // Green (transparent)
        deleted: 'rgba(220, 53, 69, 0.15)' // Red (transparent)
    },
    pastel: {
        added: 'rgba(152, 251, 152, 0.2)',
        deleted: 'rgba(255, 182, 193, 0.2)'
    },
    vivid: {
        added: 'rgba(0, 255, 0, 0.15)',
        deleted: 'rgba(255, 0, 0, 0.15)'
    }
};
class ShadowDiffDecorationProvider {
    constructor(appRoot) {
        this.enabled = false;
        this.colorScheme = 'vivid'; // Default to vivid for brightness
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
        const scheme = COLOR_SCHEMES[this.colorScheme] || COLOR_SCHEMES.vivid;
        if (this.addedDecoration)
            this.addedDecoration.dispose();
        if (this.deletedDecoration)
            this.deletedDecoration.dispose();
        // Green for added lines (in Shadow)
        this.addedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: scheme.added,
            isWholeLine: true,
            overviewRulerColor: scheme.added,
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });
        // Red for deleted lines (shows as virtual text)
        this.deletedDecoration = vscode.window.createTextEditorDecorationType({
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
        let oi = 0; // opened index
        let si = 0; // shadow index
        while (oi < openedLines.length || si < shadowLines.length) {
            if (oi >= openedLines.length) {
                added.push(si);
                si++;
            }
            else if (si >= shadowLines.length) {
                // Deletion after the end of shadow file
                deleted.push({ lineNum: si, content: openedLines[oi] }); // si = lineCount
                oi++;
            }
            else if (openedLines[oi] === shadowLines[si]) {
                oi++;
                si++;
            }
            else {
                const futureInShadow = shadowLines.slice(si + 1).indexOf(openedLines[oi]);
                const futureInOpened = openedLines.slice(oi + 1).indexOf(shadowLines[si]);
                if (futureInShadow >= 0 && (futureInOpened < 0 || futureInShadow <= futureInOpened)) {
                    added.push(si);
                    si++;
                }
                else if (futureInOpened >= 0) {
                    deleted.push({ lineNum: si, content: openedLines[oi] });
                    oi++;
                }
                else {
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
        let openedLines;
        try {
            if (fs.existsSync(openedFilePath)) {
                openedLines = fs.readFileSync(openedFilePath, 'utf8').split(/\r?\n/);
            }
            else {
                openedLines = [];
            }
        }
        catch (e) {
            this.clearDecorations(editor);
            return;
        }
        const shadowLines = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            shadowLines.push(editor.document.lineAt(i).text);
        }
        const diff = this.computeDiff(openedLines, shadowLines);
        // Added lines (Green)
        const addedRanges = diff.added.map(lineNum => ({
            range: new vscode.Range(lineNum, 0, lineNum, Number.MAX_VALUE)
        }));
        // Deleted lines (Red)
        const deletedRangesBefore = [];
        const deletedRangesAfter = [];
        const scheme = COLOR_SCHEMES[this.colorScheme] || COLOR_SCHEMES.default;
        const deletedByLine = new Map();
        for (const { lineNum, content } of diff.deleted) {
            if (!deletedByLine.has(lineNum))
                deletedByLine.set(lineNum, []);
            deletedByLine.get(lineNum).push(content);
        }
        deletedByLine.forEach((contents, lineNum) => {
            // Prepare content with preserved indentation (using NBSP)
            const fixedContents = contents.map(line => {
                // Replace spaces with non-breaking spaces to preserve indentation
                const preservedLine = line.replace(/ /g, '\u00a0');
                // Ensure we have some content
                return preservedLine.length === 0 ? '\u00a0' : preservedLine;
            });
            // Determines whether to use 'after' (previous line) or 'before' (current line)
            // Using 'after' on the previous line is generally safer to avoid merging with the current line's background.
            if (lineNum > 0) {
                // Try to attach to previous line
                let targetLineIndex = lineNum - 1;
                // If previous line exists, use 'after'
                const virtualText = '\n' + fixedContents.join('\n');
                deletedRangesAfter.push({
                    range: new vscode.Range(targetLineIndex, Number.MAX_VALUE, targetLineIndex, Number.MAX_VALUE),
                    renderOptions: {
                        after: {
                            contentText: virtualText,
                            backgroundColor: scheme.deleted,
                            color: 'rgba(150, 150, 150, 0.7)',
                            margin: '0 0 0 0',
                            fontStyle: 'italic',
                            fontWeight: 'normal'
                        }
                    }
                });
            }
            else {
                // Line 0 case. Must use 'before' on Line 0 itself.
                const virtualText = fixedContents.join('\n') + '\n';
                deletedRangesBefore.push({
                    range: new vscode.Range(0, 0, 0, 0),
                    renderOptions: {
                        before: {
                            contentText: virtualText,
                            backgroundColor: scheme.deleted,
                            color: 'rgba(150, 150, 150, 0.7)',
                            margin: '0 0 0 0',
                            fontStyle: 'italic',
                            fontWeight: 'normal'
                        }
                    }
                });
            }
        });
        editor.setDecorations(this.addedDecoration, addedRanges);
        // Merge ranges
        const allDeletedRanges = [...deletedRangesBefore, ...deletedRangesAfter];
        editor.setDecorations(this.deletedDecoration, allDeletedRanges);
    }
    dispose() {
        this.addedDecoration.dispose();
        this.deletedDecoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.ShadowDiffDecorationProvider = ShadowDiffDecorationProvider;
//# sourceMappingURL=shadowDiffDecorationProvider.js.map