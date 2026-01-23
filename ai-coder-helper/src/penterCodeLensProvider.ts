import * as vscode from 'vscode';
import * as path from 'path';
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

        // Also refresh when active editor changes (important for diff editor)
        vscode.window.onDidChangeActiveTextEditor(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const instructions = this.reviewProvider.getInstructions();

        if (instructions.length === 0) {
            return lenses;
        }

        const docPath = document.uri.fsPath;
        const docBasename = path.basename(docPath);

        // Detect document context
        const isChat = docPath.endsWith('chat.txt');
        const isShadow = docPath.includes('shadow');
        const isDiffEditor = vscode.window.activeTextEditor?.document.uri.scheme === 'diff' ||
            docPath.includes('shadow'); // Inline diff typically opens shadow file

        for (const inst of instructions) {
            const instBasename = path.basename(inst.filePath);

            let showLens = false;
            let lineNum = 0;

            // Case 1: chat.txt - show at source line
            if (isChat && inst.sourceLineStart !== undefined) {
                showLens = true;
                lineNum = inst.sourceLineStart;
            }
            // Case 2: Shadow file or diff editor - match by filename
            else if ((isShadow || isDiffEditor) && docBasename === instBasename) {
                showLens = true;
                // Calculate target line based on instruction type
                if (inst.action === 'ADD' || inst.action === 'ADD_AFTER') {
                    lineNum = inst.line !== undefined ? inst.line - 1 : 0;
                } else if (inst.action === 'REMOVE') {
                    lineNum = inst.start !== undefined ? inst.start - 1 : 0;
                } else if (inst.action === 'CREATE') {
                    lineNum = 0; // Show at top for new files
                } else {
                    lineNum = 0;
                }
            }
            // Case 3: Original file that matches instruction (for diff context)
            else if (!isChat && !isShadow && docBasename === instBasename) {
                showLens = true;
                if (inst.action === 'ADD' || inst.action === 'ADD_AFTER') {
                    lineNum = inst.line !== undefined ? inst.line - 1 : 0;
                } else if (inst.action === 'REMOVE') {
                    lineNum = inst.start !== undefined ? inst.start - 1 : 0;
                } else {
                    lineNum = 0;
                }
            }

            if (!showLens) continue;
            if (lineNum < 0) lineNum = 0;
            if (lineNum >= document.lineCount) lineNum = document.lineCount - 1;

            const range = new vscode.Range(lineNum, 0, lineNum, 0);

            // Create descriptive text for the action
            let actionDesc: string = inst.action;
            if (inst.action === 'ADD' || inst.action === 'ADD_AFTER') {
                actionDesc = `${inst.action} at line ${inst.line ?? '?'}`;
            } else if (inst.action === 'REMOVE') {
                actionDesc = `REMOVE lines ${inst.start ?? '?'}-${inst.end ?? '?'}`;
            }

            // Accept button
            const cmdAccept: vscode.Command = {
                title: `✅ Accept [${actionDesc}]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: `Apply this ${inst.action} instruction to shadow and remove from pending`
            };

            // Reject button
            const cmdReject: vscode.Command = {
                title: `❌ Reject`,
                command: 'aiCoder.rejectInstructionInline',
                arguments: [inst.id],
                tooltip: 'Skip this instruction (will not be applied)'
            };

            lenses.push(new vscode.CodeLens(range, cmdAccept));
            lenses.push(new vscode.CodeLens(range, cmdReject));
        }

        return lenses;
    }
}
