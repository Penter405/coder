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
        this.rejectedIds = new Set(); // Track rejected instructions for offset calculation
        this.allOriginalInstructions = []; // Keep original instructions for rebuild
        this.workspaceRoot = root;
        this.applier = new changeApplier_1.ChangeApplier();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    loadInstructions(insts) {
        this.instructions = insts;
        this.allOriginalInstructions = [...insts]; // Keep a copy of all original instructions
        this.acceptedIds.clear();
        this.rejectedIds.clear();
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
     * Accept and remove: Just remove from pending list (changes are already in shadow)
     * NOTE: applyAllToShadow has already applied all changes, so Accept = "keep the change"
     */
    async acceptAndRemove(id) {
        const inst = this.instructions.find(i => i.id === id);
        if (!inst)
            return;
        // DO NOT re-apply! Changes are already in shadow from applyAllToShadow()
        // Accept = "I want to keep this change" = just remove from pending list
        // Remove from list
        this.instructions = this.instructions.filter(i => i.id !== id);
        this.acceptedIds.delete(id);
        this.refresh();
        // Refresh shadow tree
        vscode.commands.executeCommand('aiCoder.refreshShadow');
    }
    /**
     * Reject and remove: Mark instruction as rejected, rebuild shadow with only active instructions
     * This uses the "rebuild" approach to correctly handle offset adjustments
     */
    async rejectAndRemove(id) {
        const inst = this.instructions.find(i => i.id === id);
        if (!inst)
            return;
        // Add to rejected set (for offset calculation)
        this.rejectedIds.add(id);
        // Remove from pending list
        this.instructions = this.instructions.filter(i => i.id !== id);
        this.acceptedIds.delete(id);
        // REBUILD: Sync shadow from original, then apply remaining instructions with offset adjustment
        if (this.shadowRoot) {
            await this.rebuildShadowWithActiveInstructions();
        }
        this.refresh();
        vscode.commands.executeCommand('aiCoder.refreshShadow');
    }
    /**
     * Rebuild shadow from original and apply only active (non-rejected) instructions
     * with correct offset adjustments
     */
    async rebuildShadowWithActiveInstructions() {
        if (!this.shadowRoot)
            return;
        // Step 1: Re-sync shadow from original (copy original files to shadow)
        await vscode.commands.executeCommand('aiCoder.syncShadow');
        // Step 2: Get active instructions (instructions still in the pending list)
        const activeInstructions = this.instructions;
        // Step 3: Apply active instructions with offset adjustment
        await this.applyInstructionsWithOffset(activeInstructions);
    }
    /**
     * Apply instructions with offset adjustment based on rejected REMOVEs
     */
    async applyInstructionsWithOffset(instructions) {
        if (!this.shadowRoot)
            return;
        // Group by file
        const byFile = new Map();
        for (const inst of instructions) {
            const key = inst.filePath;
            if (!byFile.has(key))
                byFile.set(key, []);
            byFile.get(key).push(inst);
        }
        // Process each file
        for (const [filePath, insts] of byFile) {
            // Get rejected REMOVEs for this file (for offset calculation)
            const rejectedRemoves = this.allOriginalInstructions.filter(i => i.filePath === filePath &&
                i.action === 'REMOVE' &&
                this.rejectedIds.has(i.id));
            // Sort by descending line number
            const sorted = [...insts].sort((a, b) => {
                const getLine = (inst) => {
                    if (inst.action === 'ADD')
                        return inst.line || 0;
                    if (inst.action === 'ADD_AFTER')
                        return (inst.line || 0) + 1;
                    if (inst.action === 'REMOVE')
                        return inst.start || 0;
                    return 0;
                };
                return getLine(b) - getLine(a);
            });
            // Apply each instruction with offset
            for (const inst of sorted) {
                const adjustedInst = this.adjustInstructionOffset(inst, rejectedRemoves);
                await this.applySingleInstruction(adjustedInst);
            }
        }
    }
    /**
     * Calculate and apply offset to an instruction based on rejected REMOVEs
     * When a REMOVE is rejected, lines that would have been deleted are still present,
     * so subsequent instructions need to shift their line numbers
     */
    adjustInstructionOffset(inst, rejectedRemoves) {
        // Calculate offset: sum of lines that would have been removed by rejected REMOVEs
        // that are at or before this instruction's target line
        let offset = 0;
        const instLine = inst.line || inst.start || 0;
        for (const rem of rejectedRemoves) {
            const remStart = rem.start || 1;
            const remEnd = rem.end || remStart;
            const linesNotRemoved = remEnd - remStart + 1;
            // If this REMOVE was at or before our instruction's line, add offset
            if (remStart <= instLine) {
                offset += linesNotRemoved;
            }
        }
        if (offset === 0)
            return inst; // No adjustment needed
        // Create adjusted copy
        const adjusted = { ...inst };
        if (adjusted.line !== undefined) {
            adjusted.line = adjusted.line + offset;
        }
        if (adjusted.start !== undefined) {
            adjusted.start = adjusted.start + offset;
        }
        if (adjusted.end !== undefined) {
            adjusted.end = adjusted.end + offset;
        }
        console.log(`[adjustInstructionOffset] ${inst.action} line ${instLine} -> ${instLine + offset} (offset: ${offset})`);
        return adjusted;
    }
    /**
     * Revert a single instruction from shadow (reverse operation)
     * This is called when user clicks Reject to undo the already-applied change
     */
    async revertSingleInstruction(inst) {
        if (!this.shadowRoot)
            return;
        const relPath = path.relative(this.workspaceRoot, inst.filePath);
        const shadowFile = path.join(this.shadowRoot, relPath);
        // Handle different actions - perform the REVERSE operation
        switch (inst.action) {
            case 'CREATE': {
                // Reverse of CREATE = DELETE the file
                if (fs.existsSync(shadowFile)) {
                    fs.unlinkSync(shadowFile);
                    console.log(`[revertSingleInstruction] Reverted CREATE (deleted): ${shadowFile}`);
                }
                break;
            }
            case 'DELETE': {
                // Reverse of DELETE = Restore from original
                // We need to copy from the original file
                const originalFile = inst.filePath;
                if (fs.existsSync(originalFile)) {
                    const content = fs.readFileSync(originalFile, 'utf8');
                    const shadowDir = path.dirname(shadowFile);
                    if (!fs.existsSync(shadowDir)) {
                        fs.mkdirSync(shadowDir, { recursive: true });
                    }
                    fs.writeFileSync(shadowFile, content, 'utf8');
                    console.log(`[revertSingleInstruction] Reverted DELETE (restored): ${shadowFile}`);
                }
                break;
            }
            case 'ADD':
            case 'ADD_AFTER': {
                // Reverse of ADD = REMOVE the added lines
                if (!fs.existsSync(shadowFile))
                    break;
                let lines = fs.readFileSync(shadowFile, 'utf8').split(/\r?\n/);
                const addedLineCount = inst.content ? inst.content.split(/\r?\n/).length : 0;
                if (addedLineCount === 0)
                    break;
                // Calculate where the lines were inserted
                let insertIdx;
                if (inst.action === 'ADD') {
                    insertIdx = Math.max(0, (inst.line || 1) - 1);
                }
                else { // ADD_AFTER
                    insertIdx = Math.min(inst.line || 1, lines.length);
                }
                // Remove the added lines
                if (insertIdx < lines.length) {
                    lines.splice(insertIdx, addedLineCount);
                    fs.writeFileSync(shadowFile, lines.join('\n'), 'utf8');
                    console.log(`[revertSingleInstruction] Reverted ${inst.action} (removed ${addedLineCount} lines at ${insertIdx}): ${shadowFile}`);
                }
                break;
            }
            case 'REMOVE': {
                // Reverse of REMOVE = Restore the removed lines
                // We need to get the original lines from the original file
                const originalFile = inst.filePath;
                if (!fs.existsSync(originalFile))
                    break;
                const originalLines = fs.readFileSync(originalFile, 'utf8').split(/\r?\n/);
                const startLine = inst.start || 1;
                const endLine = inst.end || startLine;
                const startIdx = Math.max(0, startLine - 1);
                const count = Math.max(1, endLine - startLine + 1);
                // Get the lines that were removed
                const removedLines = originalLines.slice(startIdx, startIdx + count);
                // Read current shadow and insert the lines back
                let shadowLines = [];
                if (fs.existsSync(shadowFile)) {
                    shadowLines = fs.readFileSync(shadowFile, 'utf8').split(/\r?\n/);
                }
                // Insert at the original position (but clamped to current shadow length)
                const insertAt = Math.min(startIdx, shadowLines.length);
                shadowLines.splice(insertAt, 0, ...removedLines);
                fs.writeFileSync(shadowFile, shadowLines.join('\n'), 'utf8');
                console.log(`[revertSingleInstruction] Reverted REMOVE (restored ${count} lines at ${insertAt}): ${shadowFile}`);
                break;
            }
            case 'MKDIR': {
                // Reverse of MKDIR = RMDIR
                if (fs.existsSync(shadowFile)) {
                    try {
                        fs.rmdirSync(shadowFile);
                        console.log(`[revertSingleInstruction] Reverted MKDIR (removed dir): ${shadowFile}`);
                    }
                    catch (e) {
                        console.warn(`[revertSingleInstruction] Could not remove dir (not empty?): ${shadowFile}`);
                    }
                }
                break;
            }
            case 'RMDIR': {
                // Reverse of RMDIR = MKDIR
                if (!fs.existsSync(shadowFile)) {
                    fs.mkdirSync(shadowFile, { recursive: true });
                    console.log(`[revertSingleInstruction] Reverted RMDIR (created dir): ${shadowFile}`);
                }
                break;
            }
            case 'RENAME': {
                // Reverse of RENAME = Rename back
                if (inst.newPath) {
                    const newRelPath = path.relative(this.workspaceRoot, inst.newPath);
                    const newShadowFile = path.join(this.shadowRoot, newRelPath);
                    if (fs.existsSync(newShadowFile)) {
                        const shadowDir = path.dirname(shadowFile);
                        if (!fs.existsSync(shadowDir)) {
                            fs.mkdirSync(shadowDir, { recursive: true });
                        }
                        fs.renameSync(newShadowFile, shadowFile);
                        console.log(`[revertSingleInstruction] Reverted RENAME: ${newShadowFile} -> ${shadowFile}`);
                    }
                }
                break;
            }
            default:
                console.warn(`[revertSingleInstruction] Unknown action: ${inst.action}`);
        }
    }
    /**
     * Apply a single instruction to shadow
     * IMPORTANT: Reads from SHADOW file (not original) to ensure sequential changes work
     */
    async applySingleInstruction(inst) {
        if (!this.shadowRoot)
            return;
        const relPath = path.relative(this.workspaceRoot, inst.filePath);
        const shadowFile = path.join(this.shadowRoot, relPath);
        const shadowDir = path.dirname(shadowFile);
        // Ensure directory exists
        if (!fs.existsSync(shadowDir)) {
            fs.mkdirSync(shadowDir, { recursive: true });
        }
        // Handle different actions
        switch (inst.action) {
            case 'CREATE': {
                // Create new file with content
                const content = inst.content || '';
                fs.writeFileSync(shadowFile, content, 'utf8');
                console.log(`[applySingleInstruction] CREATE: ${shadowFile}`);
                break;
            }
            case 'DELETE': {
                if (fs.existsSync(shadowFile)) {
                    fs.unlinkSync(shadowFile);
                    console.log(`[applySingleInstruction] DELETE: ${shadowFile}`);
                }
                break;
            }
            case 'MKDIR': {
                if (!fs.existsSync(shadowFile)) {
                    fs.mkdirSync(shadowFile, { recursive: true });
                    console.log(`[applySingleInstruction] MKDIR: ${shadowFile}`);
                }
                break;
            }
            case 'RMDIR': {
                if (fs.existsSync(shadowFile)) {
                    fs.rmSync(shadowFile, { recursive: true, force: true });
                    console.log(`[applySingleInstruction] RMDIR: ${shadowFile}`);
                }
                break;
            }
            case 'ADD': {
                // Read CURRENT shadow file content (not original!)
                let lines = [];
                if (fs.existsSync(shadowFile)) {
                    lines = fs.readFileSync(shadowFile, 'utf8').split(/\r?\n/);
                }
                const lineNum = inst.line || 1;
                const insertIdx = Math.max(0, Math.min(lineNum - 1, lines.length));
                const newLines = inst.content ? inst.content.split(/\r?\n/) : [];
                // Insert at line position
                lines.splice(insertIdx, 0, ...newLines);
                fs.writeFileSync(shadowFile, lines.join('\n'), 'utf8');
                console.log(`[applySingleInstruction] ADD at line ${lineNum}: ${shadowFile}`);
                break;
            }
            case 'ADD_AFTER': {
                let lines = [];
                if (fs.existsSync(shadowFile)) {
                    lines = fs.readFileSync(shadowFile, 'utf8').split(/\r?\n/);
                }
                const lineNum = inst.line || 1;
                const insertIdx = Math.min(lineNum, lines.length);
                const newLines = inst.content ? inst.content.split(/\r?\n/) : [];
                lines.splice(insertIdx, 0, ...newLines);
                fs.writeFileSync(shadowFile, lines.join('\n'), 'utf8');
                console.log(`[applySingleInstruction] ADD_AFTER line ${lineNum}: ${shadowFile}`);
                break;
            }
            case 'REMOVE': {
                if (!fs.existsSync(shadowFile))
                    break;
                let lines = fs.readFileSync(shadowFile, 'utf8').split(/\r?\n/);
                const startLine = inst.start || 1;
                const endLine = inst.end || startLine;
                const startIdx = Math.max(0, startLine - 1);
                const count = Math.max(1, endLine - startLine + 1);
                if (startIdx < lines.length) {
                    lines.splice(startIdx, count);
                    fs.writeFileSync(shadowFile, lines.join('\n'), 'utf8');
                    console.log(`[applySingleInstruction] REMOVE lines ${startLine}-${endLine}: ${shadowFile}`);
                }
                break;
            }
            case 'RENAME': {
                if (inst.newPath) {
                    const newRelPath = path.relative(this.workspaceRoot, inst.newPath);
                    const newShadowFile = path.join(this.shadowRoot, newRelPath);
                    const newShadowDir = path.dirname(newShadowFile);
                    if (!fs.existsSync(newShadowDir)) {
                        fs.mkdirSync(newShadowDir, { recursive: true });
                    }
                    if (fs.existsSync(shadowFile)) {
                        fs.renameSync(shadowFile, newShadowFile);
                        console.log(`[applySingleInstruction] RENAME: ${shadowFile} -> ${newShadowFile}`);
                    }
                }
                break;
            }
            default:
                console.warn(`[applySingleInstruction] Unknown action: ${inst.action}`);
        }
    }
    /**
     * Apply ALL instructions to shadow at once
     * IMPORTANT: Sort instructions by descending line number per file to avoid line shift issues
     */
    async applyAllToShadow() {
        if (!this.shadowRoot)
            return;
        // Group instructions by file
        const byFile = new Map();
        for (const inst of this.instructions) {
            const key = inst.filePath;
            if (!byFile.has(key))
                byFile.set(key, []);
            byFile.get(key).push(inst);
        }
        // Process each file's instructions in sorted order
        for (const [filePath, insts] of byFile) {
            // Sort by descending line number to avoid line shift
            // Higher line numbers first, so earlier edits don't affect later ones
            const sorted = [...insts].sort((a, b) => {
                const getLine = (inst) => {
                    if (inst.action === 'ADD')
                        return inst.line || 0;
                    if (inst.action === 'ADD_AFTER')
                        return (inst.line || 0) + 1;
                    if (inst.action === 'REMOVE')
                        return inst.start || 0;
                    return 0; // CREATE, DELETE, etc. don't have line numbers
                };
                return getLine(b) - getLine(a); // Descending
            });
            for (const inst of sorted) {
                await this.applySingleInstruction(inst);
            }
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