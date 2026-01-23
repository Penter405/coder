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
exports.InlineReviewDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
/**
 * Provides inline Accept/Reject decorations in shadow files
 * Uses click detection via cursor position change
 */
class InlineReviewDecorationProvider {
    constructor(reviewProvider, appRoot) {
        this.disposables = [];
        this.instructionLineMap = new Map(); // filePath -> lineNum -> instructionId
        this.reviewProvider = reviewProvider;
        this.appRoot = appRoot;
        // Create decoration types
        this.acceptDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' [✅ Accept]',
                backgroundColor: 'rgba(40, 167, 69, 0.3)',
                color: '#28a745',
                margin: '0 0 0 2em',
                fontWeight: 'bold'
            }
        });
        this.rejectDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' [❌ Reject]',
                backgroundColor: 'rgba(220, 53, 69, 0.3)',
                color: '#dc3545',
                margin: '0 0 0 0.5em',
                fontWeight: 'bold'
            }
        });
        // Listen for active editor changes
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor)
                this.updateDecorations(editor);
        }));
        // Listen for review data changes
        this.reviewProvider.onDidChangeTreeData(() => {
            const editor = vscode.window.activeTextEditor;
            if (editor)
                this.updateDecorations(editor);
        });
        // Listen for selection changes (click detection)
        this.disposables.push(vscode.window.onDidChangeTextEditorSelection(event => {
            this.handleClick(event);
        }));
    }
    getShadowRoot() {
        try {
            const dataPath = path.join(this.appRoot, 'file', 'data.json');
            const fs = require('fs');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj) {
                    return path.join(this.appRoot, 'file', currentProj, 'shadow');
                }
            }
        }
        catch (e) { }
        return path.join(this.appRoot, 'file', 'shadow');
    }
    updateDecorations(editor) {
        const filePath = editor.document.uri.fsPath;
        const shadowRoot = this.getShadowRoot();
        // Only show decorations in shadow files
        if (!filePath.startsWith(shadowRoot)) {
            editor.setDecorations(this.acceptDecorationType, []);
            editor.setDecorations(this.rejectDecorationType, []);
            return;
        }
        const instructions = this.reviewProvider.getInstructions();
        const acceptRanges = [];
        const rejectRanges = [];
        // Build line map for click detection
        const lineMap = new Map();
        this.instructionLineMap.set(filePath, lineMap);
        // Get relative path from shadow root
        const relPath = path.relative(shadowRoot, filePath);
        for (const inst of instructions) {
            // Match instruction to this file
            const instRelPath = path.basename(inst.filePath);
            const fileBasename = path.basename(filePath);
            if (instRelPath !== fileBasename)
                continue;
            // Get the line number for this instruction
            let lineNum = 0;
            if (inst.line !== undefined) {
                lineNum = inst.line - 1; // Convert to 0-indexed
            }
            else if (inst.start !== undefined) {
                lineNum = inst.start - 1;
            }
            if (lineNum < 0 || lineNum >= editor.document.lineCount)
                continue;
            const line = editor.document.lineAt(lineNum);
            const range = new vscode.Range(lineNum, line.text.length, lineNum, line.text.length);
            // Store mapping for click detection
            lineMap.set(lineNum, inst.id);
            // Add decorations
            acceptRanges.push({
                range: range,
                hoverMessage: `Accept: ${inst.action} instruction #${inst.id}`
            });
            rejectRanges.push({
                range: range,
                hoverMessage: `Reject: ${inst.action} instruction #${inst.id}`
            });
        }
        editor.setDecorations(this.acceptDecorationType, acceptRanges);
        editor.setDecorations(this.rejectDecorationType, rejectRanges);
    }
    handleClick(event) {
        // Only handle single clicks (not drag selections)
        if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse)
            return;
        if (event.selections.length !== 1)
            return;
        if (!event.selections[0].isEmpty)
            return;
        const editor = event.textEditor;
        const filePath = editor.document.uri.fsPath;
        const lineNum = event.selections[0].active.line;
        const charPos = event.selections[0].active.character;
        // Get the line length
        const line = editor.document.lineAt(lineNum);
        const lineLength = line.text.length;
        // Check if click is in the decoration area (after line content)
        if (charPos <= lineLength)
            return;
        // Get instruction ID for this line
        const lineMap = this.instructionLineMap.get(filePath);
        if (!lineMap)
            return;
        const instId = lineMap.get(lineNum);
        if (instId === undefined)
            return;
        // Determine if Accept or Reject based on position
        // Accept is at lineLength + ~15 chars, Reject is after that
        const acceptEnd = lineLength + 15;
        const rejectStart = acceptEnd + 2;
        if (charPos < acceptEnd) {
            // Accept clicked
            this.reviewProvider.acceptAndRemove(instId);
            vscode.window.showInformationMessage(`Accepted instruction #${instId}`);
        }
        else {
            // Reject clicked
            this.reviewProvider.rejectAndRemove(instId);
            vscode.window.showInformationMessage(`Rejected instruction #${instId}`);
        }
        // Refresh decorations
        this.updateDecorations(editor);
    }
    dispose() {
        this.acceptDecorationType.dispose();
        this.rejectDecorationType.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.InlineReviewDecorationProvider = InlineReviewDecorationProvider;
//# sourceMappingURL=inlineReviewDecorationProvider.js.map