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
const path = __importStar(require("path"));
class PenterCodeLensProvider {
    constructor(reviewProvider) {
        this.reviewProvider = reviewProvider;
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
        // Refresh lenses when review data changes
        reviewProvider.onDidChangeTreeData(() => {
            this._onDidChangeCodeLenses.fire();
        });
        // Also refresh when active editor changes (important for diff editor)
        vscode.window.onDidChangeActiveTextEditor(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }
    provideCodeLenses(document, token) {
        const lenses = [];
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
                }
                else if (inst.action === 'REMOVE') {
                    lineNum = inst.start !== undefined ? inst.start - 1 : 0;
                }
                else if (inst.action === 'CREATE') {
                    lineNum = 0; // Show at top for new files
                }
                else {
                    lineNum = 0;
                }
            }
            // Case 3: Original file that matches instruction (for diff context)
            else if (!isChat && !isShadow && docBasename === instBasename) {
                showLens = true;
                if (inst.action === 'ADD' || inst.action === 'ADD_AFTER') {
                    lineNum = inst.line !== undefined ? inst.line - 1 : 0;
                }
                else if (inst.action === 'REMOVE') {
                    lineNum = inst.start !== undefined ? inst.start - 1 : 0;
                }
                else {
                    lineNum = 0;
                }
            }
            if (!showLens)
                continue;
            if (lineNum < 0)
                lineNum = 0;
            if (lineNum >= document.lineCount)
                lineNum = document.lineCount - 1;
            const range = new vscode.Range(lineNum, 0, lineNum, 0);
            // Create descriptive text for the action
            let actionDesc = inst.action;
            if (inst.action === 'ADD' || inst.action === 'ADD_AFTER') {
                actionDesc = `${inst.action} at line ${inst.line ?? '?'}`;
            }
            else if (inst.action === 'REMOVE') {
                actionDesc = `REMOVE lines ${inst.start ?? '?'}-${inst.end ?? '?'}`;
            }
            // Accept button
            const cmdAccept = {
                title: `✅ Accept [${actionDesc}]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: `Apply this ${inst.action} instruction to shadow and remove from pending`
            };
            // Reject button
            const cmdReject = {
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
exports.PenterCodeLensProvider = PenterCodeLensProvider;
//# sourceMappingURL=penterCodeLensProvider.js.map