import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileChange {
    filePath: string;
    content: string;
    action: 'create' | 'modify' | 'delete';
}

export interface PenterInstruction {
    id: number; // for tracking
    filePath: string;
    action: 'ADD' | 'ADD_AFTER' | 'REMOVE' | 'CREATE' | 'DELETE' | 'RENAME' | 'MKDIR' | 'RMDIR';
    line?: number;
    start?: number;
    end?: number;
    content?: string;
    oldPath?: string; // for rename
    newPath?: string; // for rename
    // Source Mapping (0-based)
    sourceLineStart: number;
    sourceLineEnd: number;
}

export class ChangeApplier {

    /**
     * Step 1: Parse Text into Structured Instructions
    */
    parseToInstructions(aiResponse: string, rootPath: string): PenterInstruction[] {
        const instructions: PenterInstruction[] = [];
        let penterStartLine = 0; // Relative to the start of aiResponse string

        // 1. Extract Penter Block
        // Search for ```penter ... ```
        const blockMatch = /```\s*penter\s*([\s\S]*?)```/i.exec(aiResponse);

        let blockContent = '';
        if (blockMatch) {
            blockContent = blockMatch[1]; // Use raw content to preserve lines for mapping
            // Calculate start line of the content within the response
            const prefix = aiResponse.substring(0, blockMatch.index + blockMatch[0].indexOf(blockMatch[1]));
            penterStartLine = prefix.split(/\r?\n/).length - 1;
        } else {
            // Fallback: Check if the text itself looks like PCL commands
            // Allow leading whitespace for indented blocks
            if (/^\s*(FILE|CREATE|DELETE|RENAME|MKDIR|RMDIR)\s+/m.test(aiResponse) || /^\s*Penter\s*(\{|[\r\n])/m.test(aiResponse)) {
                console.log("No penter block found, but text looks like PCL. Using raw text.");
                blockContent = aiResponse;
                penterStartLine = 0;
            } else {
                console.log("No penter block found and text does not look like PCL.");
                return [];
            }
        }

        // 2. Check for NO_OP
        if (blockContent.includes("NO_OP")) {
            return [];
        }

        // 3. Parse Operations (Hierarchical)
        const lines = blockContent.split(/\r?\n/);

        // Parser State
        type ParseState = 'ROOT' | 'FILE_BLOCK' | 'OP_BLOCK' | 'CODE_BLOCK';
        let state: ParseState = 'ROOT';
        let currentFilePath: string | null = null;

        // Operation Buffers
        let opAction: PenterInstruction['action'] | null = null;
        let opArgs: any = null;
        let opStartLine = 0; // Relative to blockContent start
        let codeBuffer: string[] = [];

        // Regex Patterns
        const RE_FILE_START = /^FILE\s+"([^"]+)"\s*\{/;
        const RE_OP_ADD = /^(ADD|ADD_AFTER)\s+(\d+)\s*\{/;
        const RE_OP_REMOVE = /^REMOVE\s+(\d+)(?:-(\d+))?\s*\{/;
        const RE_OP_SIMPLE = /^(CREATE|DELETE|MKDIR|RMDIR)\s*\{/;
        const RE_OP_RENAME = /^RENAME\s+"([^"]+)"\s*\{/;

        const BLOCK_END = /^\}\s*$/; // Simple check, might need trimming
        const CODE_START = /^\s*<<<\s*$/;
        const CODE_END = /^\s*>>>\s*$/;

        let idCounter = 0;

        // Helper to push instruction
        const pushInst = (inst: Partial<PenterInstruction>, startLineRel: number, endLineRel: number) => {
            instructions.push({
                id: idCounter++,
                filePath: currentFilePath || inst.filePath || '',
                action: inst.action!,
                ...inst,
                sourceLineStart: penterStartLine + startLineRel,
                sourceLineEnd: penterStartLine + endLineRel
            } as PenterInstruction);
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) continue;
            // Legacy/Penter Wrappers
            if ((state === 'ROOT') && (trimmed === 'Penter' || trimmed === 'BEGIN' || trimmed === 'END' || trimmed === '{' || trimmed === '}')) {
                continue;
            }

            // --- CODE BLOCK STATE ---
            if (state === 'CODE_BLOCK') {
                if (CODE_END.test(trimmed)) {
                    state = 'OP_BLOCK'; // Return to OP block
                    continue;
                }
                codeBuffer.push(line);
                continue;
            }

            // --- ROOT STATE: Look for FILE or Global Ops ---
            if (state === 'ROOT') {
                const fileMatch = RE_FILE_START.exec(trimmed);
                if (fileMatch) {
                    currentFilePath = this.resolveFilePath(fileMatch[1], rootPath);
                    state = 'FILE_BLOCK';
                    continue;
                }
                const mkDirMatch = /^MKDIR\s+"([^"]+)"\s*\{/.exec(trimmed);
                if (mkDirMatch) {
                    const pathVal = this.resolveFilePath(mkDirMatch[1], rootPath);
                    pushInst({ filePath: pathVal, action: 'MKDIR' }, i, i);
                    // Since MKDIR usually closes immediately or has empty block.
                    // If it has block, we need to wait for '}'.
                    // The regex `^MKDIR... {` implies start of block.
                    // Assuming one-liner or block.
                    state = 'OP_BLOCK'; opAction = null; // Mark opAction null to avoid duplicated if logic handled here
                    // Actually, better to unify logic.
                    opAction = 'MKDIR'; opArgs = {}; opStartLine = i;
                    continue;
                }
                // Simplify ROOT level ops handling => Treat same as OP_BLOCK logic if possible?
                // But they change state.
            }

            const rmDirMatch = /^RMDIR\s+"([^"]+)"\s*\{/.exec(trimmed);
            if (rmDirMatch) {
                const pathVal = this.resolveFilePath(rmDirMatch[1], rootPath);
                pushInst({ filePath: pathVal, action: 'RMDIR' }, i, i);
                state = 'OP_BLOCK';
                opAction = 'RMDIR'; opArgs = {}; opStartLine = i;
                continue;
            }

            const renameMatch = RE_OP_RENAME.exec(trimmed);
            if (renameMatch) {
                // RENAME implies moving file.
                // The FILE block usually wraps commands for a single file. 
                // But RENAME is structural.
                const oldP = this.resolveFilePath(renameMatch[1], rootPath);
                currentFilePath = oldP; // Source
                state = 'OP_BLOCK';
                opAction = 'RENAME'; opArgs = {}; opStartLine = i;
                continue;
            }

            // --- FILE BLOCK STATE ---
            if (state === 'FILE_BLOCK') {
                if (BLOCK_END.test(trimmed)) {
                    state = 'ROOT';
                    currentFilePath = null;
                    continue;
                }

                // Parse Ops: ADD, ADD_AFTER, REMOVE
                const addMatch = RE_OP_ADD.exec(trimmed);
                if (addMatch) {
                    opAction = addMatch[1] as any;
                    opArgs = { line: parseInt(addMatch[2]) };
                    state = 'OP_BLOCK';
                    opStartLine = i;
                    continue;
                }

                const removeMatch = RE_OP_REMOVE.exec(trimmed);
                if (removeMatch) {
                    opAction = 'REMOVE';
                    const startRaw = parseInt(removeMatch[1]);
                    const endRaw = removeMatch[2] ? parseInt(removeMatch[2]) : startRaw;
                    opArgs = { start: startRaw, end: endRaw };
                    state = 'OP_BLOCK';
                    opStartLine = i;
                    continue;
                }

                const createMatch = RE_OP_SIMPLE.exec(trimmed);
                if (createMatch) {
                    opAction = createMatch[1] as any;
                    opArgs = {};
                    state = 'OP_BLOCK';
                    opStartLine = i;
                    continue;
                }
            }

            // --- OP BLOCK STATE ---
            if (state === 'OP_BLOCK') {
                if (BLOCK_END.test(trimmed)) {
                    // Start of close
                    if (opAction) {
                        // Check if we have code buffer (for ADD/CREATE)
                        let content: string | undefined = undefined;
                        if (codeBuffer.length > 0) {
                            content = this.dedent(codeBuffer).join('\n');
                        }

                        // Special RENAME logic: looking for NEW_NAME inside?
                        // Current spec: RENAME "old" { NEW_NAME "new" }?
                        // Assuming simple block for now.

                        pushInst({
                            filePath: currentFilePath || '',
                            action: opAction,
                            ...opArgs,
                            content
                        }, opStartLine, i);
                    }

                    // Reset Op
                    opAction = null;
                    opArgs = null;
                    codeBuffer = [];
                    // Return to FILE block unless we were valid top-level (MKDIR/RMDIR/RENAME)
                    // If currentFilePath is set and state was FILE_BLOCK... wait, we need to know parent state.
                    // Simplified: If currentFilePath exists, go to FILE_BLOCK. Else ROOT.
                    state = currentFilePath ? 'FILE_BLOCK' : 'ROOT';
                    // Correct: MKDIR/RMDIR set their own path but don't set 'currentFilePath' persistently?
                    // Logic check: I set currentFilePath for FILE block. MKDIR sets it temporarily?
                    // If we are in FILE block, currentFilePath != null.

                    continue;
                }

                if (CODE_START.test(trimmed)) {
                    state = 'CODE_BLOCK';
                    codeBuffer = [];
                    continue;
                }

                // Parse inner props? (e.g. TO "newname")
                if (opAction === 'RENAME') {
                    const toMatch = /^TO\s+"([^"]+)"/.exec(trimmed);
                    if (toMatch && opArgs) {
                        opArgs.newPath = this.resolveFilePath(toMatch[1], rootPath);
                    }
                }
            }
        }

        return instructions;
    }

    private dedent(lines: string[]): string[] {
        if (lines.length === 0) return [];

        // Find minimum indentation of non-empty lines
        let minIndent = Infinity;
        let hasContent = false;

        for (const line of lines) {
            if (line.trim().length > 0) {
                const indent = line.match(/^\s*/)?.[0].length || 0;
                if (indent < minIndent) minIndent = indent;
                hasContent = true;
            }
        }

        if (!hasContent) return lines; // All empty
        if (minIndent === 0 || minIndent === Infinity) return lines;

        // Strip indent
        return lines.map(line => {
            if (line.trim().length === 0) return ''; // Empty lines become truly empty
            return line.substring(minIndent);
        });
    }

    /**
     * Step 2: Apply Instructions to Files to generate Final Content
     */
    public applyInstructions(instructions: PenterInstruction[]): FileChange[] {
        // Group instructions by file path to process all changes for one file sequentially
        const fileOps = new Map<string, PenterInstruction[]>();
        for (const inst of instructions) {
            // For RENAME, the original filePath is the target for deletion, newPath for creation.
            // We need to ensure the original file path is tracked for its operations.
            const targetPath = inst.action === 'RENAME' ? inst.filePath : inst.filePath;
            if (!fileOps.has(targetPath)) fileOps.set(targetPath, []);
            fileOps.get(targetPath)!.push(inst);
        }

        const changes: FileChange[] = [];

        // Process each file's operations
        for (const [originalFilePath, ops] of fileOps) {
            let fileLines: string[] = [];
            let currentContentLoaded = false; // Track if content was loaded from disk

            // Load initial content
            // Priority: CREATE (content provided) > Disk
            // Check if ANY op is CREATE
            const createOp = ops.find(o => o.action === 'CREATE');
            if (createOp) {
                fileLines = createOp.content ? createOp.content.split(/\r?\n/) : [];
                currentContentLoaded = true;
            } else if (fs.existsSync(originalFilePath)) {
                fileLines = fs.readFileSync(originalFilePath, 'utf8').split(/\r?\n/);
                currentContentLoaded = true;
            }

            let wasDeleted = false;
            let wasRenamed = false;
            let finalPath = originalFilePath;

            // Sort Ops: Descending Line Number
            // This ensures lower edits don't shift indices for higher edits.
            // Priority:
            // 1. Modifications (ADD/REMOVE) - Sort Descending
            // 2. File Ops (RENAME/DELETE/MKDIR) - Logic handles them via flags/direct application
            // If we have CREATE, we already handled content load.

            // Filter Mod Ops
            const modOps = ops.filter(o => ['ADD', 'ADD_AFTER', 'REMOVE'].includes(o.action));

            modOps.sort((a, b) => {
                const getLine = (op: PenterInstruction) => {
                    if (op.action === 'ADD') return op.line || 0;
                    if (op.action === 'ADD_AFTER') return (op.line || 0) + 1; // Effective insertion index
                    if (op.action === 'REMOVE') return op.start || 0;
                    return 0;
                };
                // Descending
                return getLine(b) - getLine(a);
            });

            // Apply Mods
            for (const op of modOps) {
                if (op.action === 'ADD' && op.line !== undefined) {
                    const idx = Math.max(0, op.line - 1);
                    const newLines = op.content ? op.content.split(/\r?\n/) : [];
                    // Splice supports inserting at index. Since we go descending, this index is valid implies original file structure
                    // relative to this point is preserved.
                    // Wait. If we insert at 100, then insert at 10. 10 is valid.
                    // If we insert at 10, then insert at 100. 10 changes 100's position.
                    // So Descending is correct.
                    // However, splice modifies array.
                    // fileLines[100] is the 100th line.
                    // If I insert at 100, checking length: if 100 > length, append?
                    // Parser executeAdd clamped to length.

                    const safeIdx = Math.min(idx, fileLines.length);
                    fileLines.splice(safeIdx, 0, ...newLines);
                }
                else if (op.action === 'ADD_AFTER' && op.line !== undefined) {
                    const idx = Math.max(0, op.line); // 1-based, insert AFTER line 1 => index 1.
                    const safeIdx = Math.min(idx, fileLines.length);
                    const newLines = op.content ? op.content.split(/\r?\n/) : [];
                    fileLines.splice(safeIdx, 0, ...newLines);
                }
                else if (op.action === 'REMOVE' && op.start !== undefined && op.end !== undefined) {
                    const startIdx = Math.max(0, op.start - 1);
                    const count = op.end - op.start + 1;

                    // Logic check: if we delete 50-60.
                    // And previously (higher up processing) deleted 80-90.
                    // Array has length.
                    // Deleting 50-60 is safe.
                    // what if ranges overlap?
                    // "REMOVE 10-20" and "REMOVE 15-25".
                    // If sorted by start: 15-25, then 10-20.
                    // 15-25 removed first.
                    // Then 10-20.
                    // If 15-25 removed, 10-20 is now ???
                    // Usually AI shouldn't output overlapping ranges.

                    if (startIdx < fileLines.length) {
                        fileLines.splice(startIdx, count);
                    }
                }
            }

            // Check other ops
            for (const op of ops) {
                if (op.action === 'DELETE') {
                    fileLines = [];
                    wasDeleted = true;
                }
                else if (op.action === 'RENAME' && op.newPath) {
                    finalPath = op.newPath;
                    wasRenamed = true;
                }
                else if (op.action === 'MKDIR') {
                    changes.push({ filePath: op.filePath, content: '__MKDIR__', action: 'create' });
                }
                else if (op.action === 'RMDIR') {
                    changes.push({ filePath: op.filePath, content: '__RMDIR__', action: 'delete' });
                }
            }

            // Finalize
            if (wasDeleted) {
                changes.push({ filePath: originalFilePath, content: '', action: 'delete' });
            } else if (wasRenamed) {
                changes.push({ filePath: originalFilePath, content: '', action: 'delete' });
                changes.push({ filePath: finalPath, content: fileLines.join('\n'), action: 'create' });
            } else {
                // Push modify if we have content or relevant ops
                // If ModOps > 0 or CreateOp
                if (currentContentLoaded || modOps.length > 0 || createOp) {
                    changes.push({ filePath: finalPath, content: fileLines.join('\n'), action: 'modify' });
                }
            }
        }

        return changes;
    }

    private resolveFilePath(filePath: string, workspaceRoot: string): string {
        // Strip [Source] or [Coped] tags (case insensitive, flexible spacing)
        filePath = filePath.replace(/^\[(Source|Coped)\]\s*/i, '');

        // Remove common prefixes
        filePath = filePath.replace(/^(file:\/\/|\.\/|\/)/g, '');

        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        return path.join(workspaceRoot, filePath);
    }

    /**
     * Apply parsed changes to files using WorkspaceEdit
     */
    async applyChanges(aiResponse: string): Promise<void> {
        const workspaceEdit = new vscode.WorkspaceEdit();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const logPath = path.join(workspaceRoot, 'log.txt');
        const logEntries: string[] = [];
        const timestamp = new Date().toISOString();

        if (!workspaceRoot) {
            vscode.window.showErrorMessage("No workspace folder open. Cannot apply changes.");
            return;
        }

        // Step 1: Parse AI response into structured instructions
        const instructions = this.parseToInstructions(aiResponse, workspaceRoot);
        if (instructions.length === 0) {
            vscode.window.showInformationMessage("No valid Penter instructions found or NO_OP specified.");
            return;
        }

        // Step 2: Apply instructions to generate FileChange objects
        const changes = this.applyInstructions(instructions);

        for (const change of changes) {
            try {
                const uri = vscode.Uri.file(change.filePath);

                if (change.action === 'create' || change.action === 'modify') {
                    if (change.content === '__MKDIR__') {
                        // WorkspaceEdit doesn't explicitly foster directories, ignoring
                        // But we can ensure it exists?
                        if (!fs.existsSync(change.filePath)) {
                            fs.mkdirSync(change.filePath, { recursive: true });
                            logEntries.push(`[${timestamp}] MKDIR: ${change.filePath}`);
                        }
                        continue;
                    }

                    if (fs.existsSync(change.filePath) && change.action === 'modify') {
                        // Read current file to get range? 
                        // Actually, we can just replace assuming 0 to infinity?
                        // We need a proper range. 
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const fullRange = new vscode.Range(
                            doc.positionAt(0),
                            doc.positionAt(doc.getText().length)
                        );
                        workspaceEdit.replace(uri, fullRange, change.content);
                        logEntries.push(`[${timestamp}] MODIFIED (Edit): ${change.filePath}`);
                    } else {
                        // File doesn't exist, or it's a "Create" action (which implies new?)
                        // We used 'modify' for everything in parseChanges.
                        // So if fs.exists, replace. If not, create.

                        // Ensure directory exists (fs operation needed as WorkspaceEdit might not create parents?)
                        // Actually WorkspaceEdit createFile usually handles it, but let's be safe.
                        const dir = path.dirname(change.filePath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }

                        workspaceEdit.createFile(uri, { overwrite: true });
                        // Insert content into the new file
                        // createFile creates empty. We need to insert.
                        workspaceEdit.insert(uri, new vscode.Position(0, 0), change.content);
                        logEntries.push(`[${timestamp}] CREATED: ${change.filePath}`);
                    }

                } else if (change.action === 'delete') {
                    if (change.content === '__RMDIR__') {
                        // Delete directory (recursive)
                        // WorkspaceEdit.deleteFile doesn't do recursive dir delete easily?
                        // Use fs for directories?
                        // VSCode API: workspaceEdit.deleteFile(uri, { recursive: true })
                        workspaceEdit.deleteFile(uri, { recursive: true, ignoreIfNotExists: true });
                        logEntries.push(`[${timestamp}] RMDIR: ${change.filePath}`);
                    } else {
                        workspaceEdit.deleteFile(uri, { ignoreIfNotExists: true });
                        logEntries.push(`[${timestamp}] DELETED: ${change.filePath}`);
                    }
                }

            } catch (error) {
                logEntries.push(`[${timestamp}] ERROR: ${change.filePath} - ${error}`);
                vscode.window.showErrorMessage(`Failed to stage change for ${change.filePath}: ${error}`);
            }
        }

        // Apply all edits
        const applied = await vscode.workspace.applyEdit(workspaceEdit);

        if (applied) {
            vscode.window.showInformationMessage(`Changes applied (Unsaved). Please Save to Accept, or Undo to Reject.`);
        } else {
            vscode.window.showErrorMessage(`Failed to apply changes via WorkspaceEdit.`);
        }

        // Write to log file
        if (logEntries.length > 0) {
            const logContent = logEntries.join('\n') + '\n';
            if (fs.existsSync(logPath)) {
                fs.appendFileSync(logPath, logContent);
            } else {
                fs.writeFileSync(logPath, logContent);
            }
        }
    }
}
