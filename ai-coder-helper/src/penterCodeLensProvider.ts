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

        // 1. Map Instructions to Document Ranges
        // We rely on the source mappings captured during parsing.
        // Assuming 'reviewProvider' holds instructions parsed *from* this document or similar content.

        // Critical Issue: 'ReviewProvider' might have parsed content from Clipboard or Chat.txt 5 minutes ago.
        // If the user edits chat.txt, the lines shift.
        // However, 'reviewProvider' stores the *snapshot* of instructions currently being reviewed.
        // We should try to show lenses based on *that* snapshot if possible.
        // But CodeLens must point to valid lines in the *current* document.

        // Strategy: We rely on the stored 'sourceLineStart'. 
        // If the document has changed significantly, these might be misaligned.
        // But since this is a "Review" session, we assume validity.

        for (const inst of instructions) {
            // Create Range for the Lens
            // We want it at the start of the instruction block
            const line = inst.sourceLineStart;
            if (line >= document.lineCount) continue;

            const range = new vscode.Range(line, 0, line, 0);

            // Command: Accept
            const cmdAccept: vscode.Command = {
                title: `$(check) Aspect [Accept]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: 'Apply this change to the Shadow Layer'
            };

            // Command: Reject
            const cmdReject: vscode.Command = {
                title: `$(close) [Reject]`,
                command: 'aiCoder.rejectInstructionInline',
                arguments: [inst.id],
                tooltip: 'Discard this change (Shadow Layer only)'
            };

            // If Rejected, maybe show differently? 
            // CodeLens title can change based on state!
            if (this.reviewProvider.isAccepted(inst.id)) {
                lenses.push(new vscode.CodeLens(range, cmdReject));
                // Show "Accepted" state?
                // Or toggle style: "Aspect [✔ Accepted] | [Reject]"
                // Let's show both, but maybe indicate state in title.

                // Better: "Aspect: [✔ Accept]  [Trash]"?
                // For now: "Aspect [Accept] [Reject]" is standard.
                // let's add both.
                lenses.push(new vscode.CodeLens(range, cmdAccept));
            } else {
                // It is Rejected.
                lenses.push(new vscode.CodeLens(range, { ...cmdReject, title: `$(circle-slash) Rejected` }));
                lenses.push(new vscode.CodeLens(range, { ...cmdAccept, title: `[Re-Accept]` }));
            }
        }

        return lenses;
    }
}
