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
exports.PenterCodeLensProvider = void 0;
const vscode = __importStar(require("vscode"));
class PenterCodeLensProvider {
    constructor(reviewProvider) {
        this.reviewProvider = reviewProvider;
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
        // Refresh lenses when review data changes
        reviewProvider.onDidChangeTreeData(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }
    provideCodeLenses(document, token) {
        if (!document.fileName.endsWith('chat.txt')) {
            return [];
        }
        const lenses = [];
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
            if (line >= document.lineCount)
                continue;
            const range = new vscode.Range(line, 0, line, 0);
            // Command: Accept
            const cmdAccept = {
                title: `$(check) Aspect [Accept]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: 'Apply this change to the Shadow Layer'
            };
            // Command: Reject
            const cmdReject = {
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
            }
            else {
                // It is Rejected.
                lenses.push(new vscode.CodeLens(range, { ...cmdReject, title: `$(circle-slash) Rejected` }));
                lenses.push(new vscode.CodeLens(range, { ...cmdAccept, title: `[Re-Accept]` }));
            }
        }
        return lenses;
    }
}
exports.PenterCodeLensProvider = PenterCodeLensProvider;
//# sourceMappingURL=penterCodeLensProvider.js.map