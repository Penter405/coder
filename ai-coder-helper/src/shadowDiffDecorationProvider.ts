import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Color schemes for diff highlighting
const COLOR_SCHEMES = {
    default: {
        added: 'rgba(40, 167, 69, 0.3)',      // Green
        deleted: 'rgba(220, 53, 69, 0.3)'      // Red
    },
    pastel: {
        added: 'rgba(152, 251, 152, 0.4)',     // Pale Green
        deleted: 'rgba(255, 182, 193, 0.4)'    // Light Pink
    },
    vivid: {
        added: 'rgba(0, 255, 0, 0.25)',        // Bright Green
        deleted: 'rgba(255, 0, 0, 0.25)'       // Bright Red
    },
    blue_orange: {
        added: 'rgba(100, 149, 237, 0.3)',     // Cornflower Blue
        deleted: 'rgba(255, 165, 0, 0.3)'      // Orange
    },
    purple_yellow: {
        added: 'rgba(147, 112, 219, 0.3)',     // Medium Purple
        deleted: 'rgba(255, 255, 0, 0.3)'      // Yellow
    }
};

export class ShadowDiffDecorationProvider {
    private appRoot: string;
    private enabled: boolean = false;
    private colorScheme: string = 'default';
    private addedDecoration!: vscode.TextEditorDecorationType;
    private deletedDecoration!: vscode.TextEditorDecorationType;

    private disposables: vscode.Disposable[] = [];

    constructor(appRoot: string) {
        this.appRoot = appRoot;
        this.createDecorations();

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this.enabled) {
                    this.updateDecorations(editor);
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === event.document && this.enabled) {
                    this.updateDecorations(editor);
                }
            })
        );
    }

    private createDecorations() {
        const scheme = COLOR_SCHEMES[this.colorScheme as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES.default;
        
        if (this.addedDecoration) this.addedDecoration.dispose();
        if (this.deletedDecoration) this.deletedDecoration.dispose();

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

    setColorScheme(scheme: string) {
        if (COLOR_SCHEMES[scheme as keyof typeof COLOR_SCHEMES]) {
            this.colorScheme = scheme;
            this.createDecorations();
            const editor = vscode.window.activeTextEditor;
            if (editor && this.enabled) {
                this.updateDecorations(editor);
            }
        }
    }

    getColorSchemes(): string[] {
        return Object.keys(COLOR_SCHEMES);
    }

    toggle(): boolean {
        this.enabled = !this.enabled;
        const editor = vscode.window.activeTextEditor;

        if (this.enabled && editor) {
            this.updateDecorations(editor);
        } else if (!this.enabled && editor) {
            this.clearDecorations(editor);
        }

        return this.enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    private clearDecorations(editor: vscode.TextEditor) {
        editor.setDecorations(this.addedDecoration, []);
        editor.setDecorations(this.deletedDecoration, []);
    }

    private getShadowRoot(): string {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj) {
                    return path.join(this.appRoot, 'file', currentProj, 'shadow');
                }
            }
        } catch (e) {}
        return path.join(this.appRoot, 'file', 'shadow');
    }

    private getOpenedProjectPath(): string {
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
        } catch (e) {}
        return '';
    }

    // Line-by-line diff algorithm
    private computeDiff(openedLines: string[], shadowLines: string[]): { added: number[]; deleted: { lineNum: number; content: string }[] } {
        const added: number[] = [];
        const deleted: { lineNum: number; content: string }[] = [];

        // Use LCS-like approach for better accuracy
        let oi = 0; // opened index
        let si = 0; // shadow index

        while (oi < openedLines.length || si < shadowLines.length) {
            if (oi >= openedLines.length) {
                // Remaining shadow lines are additions
                added.push(si);
                si++;
            } else if (si >= shadowLines.length) {
                // Remaining opened lines are deletions
                deleted.push({ lineNum: si > 0 ? si - 1 : 0, content: openedLines[oi] });
                oi++;
            } else if (openedLines[oi] === shadowLines[si]) {
                // Lines match, move both
                oi++;
                si++;
            } else {
                // Lines differ - check if opened line exists later in shadow
                const futureInShadow = shadowLines.slice(si + 1).indexOf(openedLines[oi]);
                const futureInOpened = openedLines.slice(oi + 1).indexOf(shadowLines[si]);

                if (futureInShadow >= 0 && (futureInOpened < 0 || futureInShadow <= futureInOpened)) {
                    // Shadow line is new (addition)
                    added.push(si);
                    si++;
                } else if (futureInOpened >= 0) {
                    // Opened line was deleted
                    deleted.push({ lineNum: si, content: openedLines[oi] });
                    oi++;
                } else {
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

    updateDecorations(editor: vscode.TextEditor) {
        if (!this.enabled) return;

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
            const allLines: vscode.DecorationOptions[] = [];
            for (let i = 0; i < editor.document.lineCount; i++) {
                allLines.push({ range: new vscode.Range(i, 0, i, Number.MAX_VALUE) });
            }
            editor.setDecorations(this.addedDecoration, allLines);
            editor.setDecorations(this.deletedDecoration, []);
            return;
        }

        let openedLines: string[];
        try {
            openedLines = fs.readFileSync(openedFilePath, 'utf8').split(/\r?\n/);
        } catch (e) {
            this.clearDecorations(editor);
            return;
        }

        const shadowLines: string[] = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            shadowLines.push(editor.document.lineAt(i).text);
        }

        // Use proper line-by-line diff
        const diff = this.computeDiff(openedLines, shadowLines);

        // Create decorations
        const addedRanges: vscode.DecorationOptions[] = diff.added.map(lineNum => ({
            range: new vscode.Range(lineNum, 0, lineNum, Number.MAX_VALUE)
        }));

        // For deleted lines, show at the position where they would have been
        const deletedRanges: vscode.DecorationOptions[] = [];
        const deletedByLine = new Map<number, string[]>();
        
        for (const { lineNum, content } of diff.deleted) {
            if (!deletedByLine.has(lineNum)) {
                deletedByLine.set(lineNum, []);
            }
            deletedByLine.get(lineNum)!.push(content);
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
