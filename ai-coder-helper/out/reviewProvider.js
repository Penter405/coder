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
exports.ReviewProvider = exports.ReviewItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const changeApplier_1 = require("./changeApplier");
class ReviewItem extends vscode.TreeItem {
    constructor(label, collapsibleState, type, data, // filePath for 'file'
    accepted = true) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.type = type;
        this.data = data;
        this.accepted = accepted;
        this.contextValue = type;
        if (type === 'instruction') {
            const inst = data;
            this.description = this.getDesc(inst);
            this.tooltip = inst.content;
            // Icon based on status
            this.iconPath = new vscode.ThemeIcon(accepted ? 'check' : 'x');
            // Strikethrough if rejected? VS Code doesn't support strikethrough in tree easily, use icon/color.
            // Gray out if rejected?
            if (!accepted) {
                this.description += " (Rejected)";
            }
        }
        else {
            this.iconPath = vscode.ThemeIcon.File;
        }
    }
    getDesc(inst) {
        switch (inst.action) {
            case 'ADD': return `Line ${inst.line}`;
            case 'ADD_AFTER': return `After Line ${inst.line}`;
            case 'REMOVE': return `Lines ${inst.start}-${inst.end}`;
            case 'CREATE': return 'New File';
            case 'DELETE': return 'Delete File';
            case 'RENAME': return `-> ${inst.newPath}`;
            case 'MKDIR': return 'Create Dir';
            case 'RMDIR': return 'Remove Dir';
            default: return '';
        }
    }
}
exports.ReviewItem = ReviewItem;
class ReviewProvider {
    constructor(root) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.instructions = [];
        this.acceptedIds = new Set();
        this.workspaceRoot = root;
        this.applier = new changeApplier_1.ChangeApplier();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    loadInstructions(insts) {
        this.instructions = insts;
        this.acceptedIds.clear();
        // DO NOT auto-accept, DO NOT auto-apply
        // User must Accept each instruction individually
        this.refresh();
    }
    toggleInstruction(id) {
        if (this.acceptedIds.has(id)) {
            this.acceptedIds.delete(id);
        }
        else {
            this.acceptedIds.add(id);
        }
        this.refresh();
        this.updateShadow();
    }
    getInstructions() {
        return this.instructions;
    }
    getInstructionIdBySourceLine(line) {
        // Find instruction where line is within sourceLineStart and sourceLineEnd
        // Note: sourceLineStart/End are 0-based relative to the start of the Penter block + block offset?
        // Yes, the parser calculates absolute lines relative to parsed content start + offset.
        // But if there are multiple Penter blocks in a file? The current parser takes ONE aiResponse string.
        // Assumption: chat.txt contains ONE main Penter block at a time usually?
        // Or if we run "Generate Code", it appends? 
        // If we generate multiple times, we might have multiple blocks.
        // But `parseToInstructions` parses the *entire* text input passed to it.
        // So `changeApplier` should handle multiple blocks if we feed it the whole file?
        // Currently `changeApplier` extracts ONE block via regex: /```\s*penter\s*([\s\S]*?)```/i
        // LIMITATION: Current Parser only finds the FIRST Penter block.
        // This is fine for current "Apply Changes" flow which usually takes the latest response.
        // But for "chat.txt", we might want to support multiple.
        // For now, simple range check.
        const inst = this.instructions.find(i => line >= i.sourceLineStart && line <= i.sourceLineEnd);
        return inst ? inst.id : undefined;
    }
    acceptAll() {
        this.instructions.forEach(i => this.acceptedIds.add(i.id));
        this.refresh();
        this.updateShadow();
    }
    rejectAll() {
        this.acceptedIds.clear();
        this.refresh();
        this.updateShadow();
    }
    /**
     * Accept and remove: Apply single instruction to shadow, then remove from list
     */
    async acceptAndRemove(id) {
        const inst = this.instructions.find(i => i.id === id);
        if (!inst)
            return;
        // Apply this single instruction to shadow
        if (this.shadowRoot) {
            await this.applySingleInstruction(inst);
        }
        // Remove from list
        this.instructions = this.instructions.filter(i => i.id !== id);
        this.acceptedIds.delete(id);
        this.refresh();
        // Refresh shadow tree
        vscode.commands.executeCommand('aiCoder.refreshShadow');
    }
    /**
     * Reject and remove: Skip instruction, remove from list
     */
    rejectAndRemove(id) {
        // Just remove from list without applying
        this.instructions = this.instructions.filter(i => i.id !== id);
        this.acceptedIds.delete(id);
        this.refresh();
    }
    /**
     * Apply a single instruction to shadow
     */
    async applySingleInstruction(inst) {
        if (!this.shadowRoot)
            return;
        const changes = this.applier.applyInstructions([inst]);
        for (const change of changes) {
            const relPath = path.relative(this.workspaceRoot, change.filePath);
            const shadowFile = path.join(this.shadowRoot, relPath);
            const shadowDir = path.dirname(shadowFile);
            if (!fs.existsSync(shadowDir)) {
                fs.mkdirSync(shadowDir, { recursive: true });
            }
            if (change.action === 'delete') {
                if (change.content === '__RMDIR__') {
                    if (fs.existsSync(shadowFile)) {
                        fs.rmSync(shadowFile, { recursive: true, force: true });
                    }
                }
                else {
                    if (fs.existsSync(shadowFile))
                        fs.unlinkSync(shadowFile);
                }
            }
            else {
                if (change.content === '__MKDIR__') {
                    if (!fs.existsSync(shadowFile)) {
                        fs.mkdirSync(shadowFile, { recursive: true });
                    }
                }
                else {
                    fs.writeFileSync(shadowFile, change.content, 'utf8');
                }
            }
        }
    }
    /**
     * Apply ALL instructions to shadow at once
     */
    async applyAllToShadow() {
        if (!this.shadowRoot)
            return;
        for (const inst of this.instructions) {
            await this.applySingleInstruction(inst);
        }
    }
    isAccepted(id) {
        return this.acceptedIds.has(id);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            // Root: Files
            const files = Array.from(new Set(this.instructions.map(i => i.filePath)));
            return Promise.resolve(files.map(f => {
                const basename = path.basename(f);
                // Check if any inst in this file is rejected?
                // Just Show file
                return new ReviewItem(basename, vscode.TreeItemCollapsibleState.Expanded, 'file', f);
            }));
        }
        else if (element.type === 'file') {
            const filePath = element.data;
            const insts = this.instructions.filter(i => i.filePath === filePath);
            return Promise.resolve(insts.map(i => {
                const label = i.action;
                const isAccepted = this.acceptedIds.has(i.id);
                return new ReviewItem(label, vscode.TreeItemCollapsibleState.None, 'instruction', i, isAccepted);
            }));
        }
        return Promise.resolve([]);
    }
    setShadowRoot(path) {
        this.shadowRoot = path;
    }
    /**
     * Applies the CURRENTLY ACCEPTED instructions to the Shadow Layer.
     * This effectively "Previews" the result of the selection.
     */
    async updateShadow() {
        if (!this.shadowRoot) {
            // Cannot update if we don't know where shadow is.
            return;
        }
        // Apply to Shadow Directory
        await this.applyToShadowDir(this.shadowRoot);
    }
    async applyToShadowDir(shadowRoot) {
        this.shadowRoot = shadowRoot; // Cache it
        const activeInstructions = this.instructions.filter(i => this.acceptedIds.has(i.id));
        const changes = this.applier.applyInstructions(activeInstructions);
        for (const change of changes) {
            // change.filePath is the ORIGINAL project path (e.g. c:/.../main.py)
            // We need to map it to Shadow Path.
            // Assumption: change.filePath is inside workspaceRoot?
            // Map Logic:
            // Original: <AppRoot>/file/Project/main.py
            // Shadow: <AppRoot>/file/Project/shadow/main.py
            // Wait, "Sync to Shadow" logic in extension.ts handles copying.
            // Here we want to start from the *Clean* shadow file (synced state) and apply changes?
            // "applyInstructions" reads from 'fs.readFileSync(change.filePath)'.
            // If we run `applyInstructions` it reads the *Project* file (Source).
            // Then it modifies it in memory.
            // Then we write to *Shadow*.
            // This is correct! We always re-compute from Source + Edits -> Shadow.
            // So if Source changes, we might need to re-run.
            // But within a session, Source is stable.
            // Compute Shadow Path
            // We need relative path from AppRoot or WorkspaceRoot?
            // change.filePath is absolute.
            // We need the relative path of the file within the Project.
            // We can try to derive it.
            // Actually, we can just use the basename + structure?
            // The safest way is to ask Extension to resolve the shadow path for a given original path.
            // But to decouple, let's assume we pass in a "Rebaser" function?
            // Or just do best effort here.
            const relPath = path.relative(this.workspaceRoot, change.filePath);
            const shadowFile = path.join(shadowRoot, relPath);
            const shadowDir = path.dirname(shadowFile);
            if (!fs.existsSync(shadowDir)) {
                fs.mkdirSync(shadowDir, { recursive: true });
            }
            if (change.action === 'delete') {
                if (change.content === '__RMDIR__') {
                    if (fs.existsSync(shadowFile)) {
                        fs.rmSync(shadowFile, { recursive: true, force: true });
                    }
                }
                else {
                    if (fs.existsSync(shadowFile))
                        fs.unlinkSync(shadowFile);
                }
            }
            else {
                if (change.content === '__MKDIR__') {
                    if (!fs.existsSync(shadowFile)) {
                        fs.mkdirSync(shadowFile, { recursive: true });
                    }
                }
                else {
                    // Ensure parent dir exists
                    const shadowDir = path.dirname(shadowFile);
                    if (!fs.existsSync(shadowDir)) {
                        fs.mkdirSync(shadowDir, { recursive: true });
                    }
                    fs.writeFileSync(shadowFile, change.content, 'utf8');
                }
            }
        }
    }
}
exports.ReviewProvider = ReviewProvider;
//# sourceMappingURL=reviewProvider.js.map