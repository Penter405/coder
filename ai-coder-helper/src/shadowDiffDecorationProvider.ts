import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Provides inline diff decorations for Shadow files.
 * Shows differences between Shadow and Opened project files using:
 * - Green background: Lines in Shadow but not in Opened (additions)
 * - Red inline text: Lines in Opened but not in Shadow (deletions)
 */
export class ShadowDiffDecorationProvider {
    private appRoot: string;
    private enabled: boolean = false;

    // Decoration types
    private addedDecoration: vscode.TextEditorDecorationType;
    private deletedDecoration: vscode.TextEditorDecorationType;

    private disposables: vscode.Disposable[] = [];

    constructor(appRoot: string) {
        this.appRoot = appRoot;

        // Green for added lines
        this.addedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(40, 167, 69, 0.3)',  // Green
            isWholeLine: true,
            overviewRulerColor: 'rgba(40, 167, 69, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        // Red for deleted lines header
        this.deletedDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: false
        });

        // Listen for active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this.enabled) {
                    this.updateDecorations(editor);
                }
            })
        );

        // Listen for document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === event.document && this.enabled) {
                    this.updateDecorations(editor);
                }
            })
        );
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
        } catch (e) {
            console.error('[ShadowDiffDecorationProvider] Error reading data.json:', e);
        }
        return path.join(this.appRoot, 'file', 'shadow');
    }

    private getOpenedProjectPath(): string {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj && data.projects && data.projects[currentProj]) {
                    return data.projects[currentProj].path;
                }
            }
        } catch (e) {
            console.error('[ShadowDiffDecorationProvider] Error getting project path:', e);
        }
        return '';
    }

    updateDecorations(editor: vscode.TextEditor) {
        if (!this.enabled) return;

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
            const allLines: vscode.DecorationOptions[] = [];
            for (let i = 0; i < editor.document.lineCount; i++) {
                allLines.push({ range: new vscode.Range(i, 0, i, Number.MAX_VALUE) });
            }
            editor.setDecorations(this.addedDecoration, allLines);
            editor.setDecorations(this.deletedDecoration, []);
            return;
        }

        // Read opened file
        let openedLines: string[];
        try {
            openedLines = fs.readFileSync(openedFilePath, 'utf8').split(/\r?\n/);
        } catch (e) {
            this.clearDecorations(editor);
            return;
        }

        // Get shadow lines
        const shadowLines: string[] = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            shadowLines.push(editor.document.lineAt(i).text);
        }

        // Diff results
        const addedRanges: vscode.DecorationOptions[] = [];
        const deletedDecorations: vscode.DecorationOptions[] = [];

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
