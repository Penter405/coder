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
        for (const inst of instructions) {
            const line = inst.sourceLineStart;
            if (line >= document.lineCount)
                continue;
            const range = new vscode.Range(line, 0, line, 0);
            // Always show both Accept and Reject buttons
            const cmdAccept = {
                title: `✅ Accept [${inst.action}]`,
                command: 'aiCoder.acceptInstructionInline',
                arguments: [inst.id],
                tooltip: `Apply this ${inst.action} instruction to Shadow Layer`
            };
            const cmdReject = {
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
exports.PenterCodeLensProvider = PenterCodeLensProvider;
//# sourceMappingURL=penterCodeLensProvider.js.map