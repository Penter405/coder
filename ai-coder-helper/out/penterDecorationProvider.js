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
exports.PenterDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
class PenterDecorationProvider {
    constructor(reviewProvider) {
        this.reviewProvider = reviewProvider;
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
    updateDecorations(editor) {
        if (!editor || !editor.document.fileName.endsWith('chat.txt')) {
            return;
        }
        const instructions = this.reviewProvider.getInstructions();
        const rejectedRanges = [];
        const rejectedLabelRanges = [];
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
exports.PenterDecorationProvider = PenterDecorationProvider;
//# sourceMappingURL=penterDecorationProvider.js.map