import * as vscode from 'vscode';
import { ReviewProvider } from './reviewProvider';
import { PenterInstruction } from './changeApplier';

export class PenterCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(private reviewProvider: ReviewProvider) {
        // Refresh lenses when review data changes
        reviewProvider.onDidChangeTreeData(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        if (!document.fileName.endsWith('chat.txt')) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        const instructions = this.reviewProvider.getInstructions();

        for (const inst of instructions) {
            const line = inst.sourceLineStart;
            if (line >= document.lineCount) continue;

            const range = new vscode.Range(line, 0, line, 0);

            // Always show both Accept and Reject buttons
            const cmdAccept: vscode.Command = {
                title: `✅ Accept [${inst.action}]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: `Apply this ${inst.action} instruction to Shadow Layer`
            };

            const cmdReject: vscode.Command = {
                title: `❌ Reject`,
                command: 'aiCoder.rejectInstructionInline',
                arguments: [inst.id],
                tooltip: 'Skip this instruction'
            };

            lenses.push(new vscode.CodeLens(range, cmdAccept));
            lenses.push(new vscode.CodeLens(range, cmdReject));
        }

        return lenses;
    }
}
