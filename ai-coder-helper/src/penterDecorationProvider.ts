import * as vscode from 'vscode';
import { ReviewProvider } from './reviewProvider';
import { PenterInstruction } from './changeApplier';

export class PenterDecorationProvider {
    // Styles
    private rejectedTextDecoration: vscode.TextEditorDecorationType;
    private rejectedLabelDecoration: vscode.TextEditorDecorationType;

    constructor(private reviewProvider: ReviewProvider) {
        // Init Styles
        this.rejectedTextDecoration = vscode.window.createTextEditorDecorationType({
            opacity: '0.4', // Greyed out
            textDecoration: 'none' // Optionally 'line-through' but might be too noisy for blocks
        });

        this.rejectedLabelDecoration = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '  ❌ Rejected (Shadow)',
                color: 'rgba(255, 50, 50, 0.8)',
                fontWeight: 'bold',
                fontStyle: 'italic'
            }
        });

        // Listen for updates
        reviewProvider.onDidChangeTreeData(() => {
            this.updateDecorations(vscode.window.activeTextEditor);
        });

        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.updateDecorations(editor);
        });
    }

    public updateDecorations(editor: vscode.TextEditor | undefined) {
        if (!editor || !editor.document.fileName.endsWith('chat.txt')) {
            return;
        }

        const instructions = this.reviewProvider.getInstructions();
        const rejectedRanges: vscode.Range[] = [];
        const rejectedLabelRanges: vscode.Range[] = [];

        for (const inst of instructions) {
            if (!this.reviewProvider.isAccepted(inst.id)) {
                // Determine Range
                const startLine = inst.sourceLineStart;
                const endLine = inst.sourceLineEnd;

                if (startLine < editor.document.lineCount) {
                    // Full Block Grey Out
                    const range = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(Math.min(endLine, editor.document.lineCount - 1)).text.length);
                    rejectedRanges.push(range);

                    // Label at the first line of the block
                    const labelRange = new vscode.Range(startLine, 0, startLine, editor.document.lineAt(startLine).text.length);
                    rejectedLabelRanges.push(labelRange);
                }
            }
        }

        editor.setDecorations(this.rejectedTextDecoration, rejectedRanges);
        editor.setDecorations(this.rejectedLabelDecoration, rejectedLabelRanges);
    }
}
