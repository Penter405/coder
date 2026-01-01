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
exports.ChangeApplier = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ChangeApplier {
    /**
     * Parse Penter formatted AI response
     *
     * Expected Format:
     * ```penter
     * Penter
     * BEGIN
     * FILE <path>
     * ADD <line>
     * <<<
     * ...
     * >>>
     * REMOVE <start>-<end>
     * ...
     * END
     * ```
     */
    parseChanges(aiResponse) {
        const changes = [];
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        // 1. Extract Penter Block
        // Search for ```penter ... ```
        const blockMatch = /```penter\s*([\s\S]*?)```/.exec(aiResponse);
        if (!blockMatch) {
            // Fallback? Or strict? 
            // User spec says: "It IGNORES all text outside penter code blocks"
            // So we return empty if no penter block.
            console.log("No penter block found.");
            return [];
        }
        const blockContent = blockMatch[1].trim();
        // 2. Check for NO_OP
        if (blockContent.includes("NO_OP")) {
            console.log("Penter block is NO_OP.");
            return [];
        }
        // 3. Parse Operations
        // We parse the block line by line to maintain state
        const lines = blockContent.split(/\r?\n/);
        let currentFile = null;
        let fileLines = []; // The content of the current file being edited
        let isReadingCode = false;
        let codeBuffer = [];
        let insertLine = -1;
        // Map to store Final Content for each file
        // RelativePath -> Content string
        const modifiedFiles = new Map();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed === 'Penter' || trimmed === 'BEGIN' || trimmed === 'END') {
                continue;
            }
            // READING CODE BLOCK logic
            if (isReadingCode) {
                if (trimmed === '>>>') {
                    // End of code block, Execute ADD
                    isReadingCode = false;
                    this.executeAdd(fileLines, insertLine, codeBuffer);
                    codeBuffer = [];
                }
                else {
                    codeBuffer.push(line); // Keep original indentation
                }
                continue;
            }
            // COMMAND PARSING
            if (trimmed.startsWith('FILE ')) {
                // If we were processing a file, save it (Wait, we process sequentially in memory?)
                // Actually, if we switch files, we must have finished the previous one.
                // Or does the spec allow interleaving? "Multiple operations per file". "Multiple files per block".
                // Usually implies FILE A ... ops ... FILE B ... ops.
                // Save previous file if exists
                if (currentFile) {
                    modifiedFiles.set(currentFile, fileLines.join('\n'));
                }
                const relPath = trimmed.substring(5).trim();
                currentFile = this.resolveFilePath(relPath, workspaceRoot);
                // Load existing content
                if (fs.existsSync(currentFile)) {
                    // If we ALREADY modified it in this block (interleaved?), load from map.
                    if (modifiedFiles.has(currentFile)) {
                        fileLines = modifiedFiles.get(currentFile).split('\n');
                    }
                    else {
                        fileLines = fs.readFileSync(currentFile, 'utf8').split(/\r?\n/);
                    }
                }
                else {
                    // Create new empty file
                    fileLines = [];
                }
            }
            else if (trimmed.startsWith('ADD ')) {
                if (!currentFile)
                    continue;
                // Parse line number
                const parts = trimmed.split(' ');
                insertLine = parseInt(parts[1]);
                // Expect next line to be <<<
                // But loop handles it. Just set state.
                // However, check next line immediately?
                if (i + 1 < lines.length && lines[i + 1].trim() === '<<<') {
                    isReadingCode = true;
                    i++; // Skip <<< line
                }
            }
            else if (trimmed.startsWith('REMOVE ')) {
                if (!currentFile)
                    continue;
                const parts = trimmed.split(' ');
                // Format: REMOVE 125-129 or REMOVE 125
                const rangeStr = parts[1];
                let start = 0, end = 0;
                if (rangeStr.includes('-')) {
                    const rangeParts = rangeStr.split('-');
                    start = parseInt(rangeParts[0]);
                    end = parseInt(rangeParts[1]);
                }
                else {
                    start = parseInt(rangeStr);
                    end = start;
                }
                this.executeRemove(fileLines, start, end);
            }
        }
        // Save last file
        if (currentFile) {
            modifiedFiles.set(currentFile, fileLines.join('\n'));
        }
        // Convert Map to FileChange[]
        for (const [filePath, content] of modifiedFiles) {
            changes.push({
                filePath: filePath,
                content: content,
                action: 'modify' // logic handles create inside (content is full)
            });
        }
        return changes;
    }
    executeAdd(fileLines, line, codeLines) {
        // Line is 1-based.
        // Index is line-1.
        let index = line - 1;
        if (index < 0)
            index = 0;
        if (index > fileLines.length)
            index = fileLines.length;
        // Insert codeLines at index
        // splice(start, deleteCount, ...items)
        fileLines.splice(index, 0, ...codeLines);
    }
    executeRemove(fileLines, start, end) {
        // Line is 1-based.
        // Index is start-1.
        let index = start - 1;
        let count = end - start + 1;
        if (index < 0)
            index = 0;
        // logic to clamp
        if (index >= fileLines.length)
            return; // Nothing to delete
        // If count goes beyond length
        if (index + count > fileLines.length) {
            count = fileLines.length - index;
        }
        fileLines.splice(index, count);
    }
    resolveFilePath(filePath, workspaceRoot) {
        // Remove common prefixes
        filePath = filePath.replace(/^(file:\/\/|\.\/|\/)/g, '');
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(workspaceRoot, filePath);
    }
    /**
     * Apply parsed changes to files
     */
    async applyChanges(changes) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const logPath = path.join(workspaceRoot, 'log.txt');
        const logEntries = [];
        const timestamp = new Date().toISOString();
        for (const change of changes) {
            try {
                const dir = path.dirname(change.filePath);
                // Ensure directory exists
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                // Write content
                fs.writeFileSync(change.filePath, change.content, 'utf8');
                const action = 'MODIFIED'; // Since we reconstruct full file, mostly modify/create
                logEntries.push(`[${timestamp}] ${action}: ${change.filePath}`);
                // Open the file in editor
                const doc = await vscode.workspace.openTextDocument(change.filePath);
                await vscode.window.showTextDocument(doc, { preview: false });
            }
            catch (error) {
                logEntries.push(`[${timestamp}] ERROR: ${change.filePath} - ${error}`);
                vscode.window.showErrorMessage(`Failed to apply change to ${change.filePath}: ${error}`);
            }
        }
        // Write to log file
        if (logEntries.length > 0) {
            const logContent = logEntries.join('\n') + '\n';
            if (fs.existsSync(logPath)) {
                fs.appendFileSync(logPath, logContent);
            }
            else {
                fs.writeFileSync(logPath, logContent);
            }
        }
    }
}
exports.ChangeApplier = ChangeApplier;
//# sourceMappingURL=changeApplier.js.map