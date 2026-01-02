import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface FileChange {
    filePath: string;
    content: string;
    action: 'create' | 'modify' | 'delete';
}

export class ChangeApplier {
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
    parseChanges(aiResponse: string, rootPath?: string): FileChange[] {
        const changes: FileChange[] = [];
        const workspaceRoot = rootPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        // 1. Extract Penter Block
        // Search for ```penter ... ```
        const blockMatch = /```\s*penter\s*([\s\S]*?)```/i.exec(aiResponse);

        let blockContent = '';
        if (blockMatch) {
            blockContent = blockMatch[1].trim();
        } else {
            // Fallback: Check if the text itself looks like PCL commands
            // (User might have copied content without backticks)
            if (/^(FILE|CREATE|DELETE|RENAME|MKDIR|RMDIR)\s+/m.test(aiResponse)) {
                console.log("No penter block found, but text looks like PCL. Using raw text.");
                blockContent = aiResponse.trim();
            } else {
                console.log("No penter block found and text does not look like PCL.");
                return [];
            }
        }

        // 2. Check for NO_OP
        if (blockContent.includes("NO_OP")) {
            console.log("Penter block is NO_OP.");
            return [];
        }

        // 3. Parse Operations
        // We parse the block line by line to maintain state
        const lines = blockContent.split(/\r?\n/);

        // State
        let currentFile: string | null = null;
        let fileLines: string[] = [];
        let isReadingCode = false;
        let isImplicitCode = false; // New flag for code blocks without <<< >>>
        let codeBuffer: string[] = [];
        let insertLine = -1;

        // Map to store Final Content for each file
        const modifiedFiles = new Map<string, string>();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed === 'Penter' || trimmed === 'BEGIN' || trimmed === 'END') {
                // If we are in implicit mode, these keywords end the block
                if (isImplicitCode) {
                    isReadingCode = false;
                    isImplicitCode = false;
                    if (currentFile && insertLine !== -1) { // ADD
                        this.executeAdd(fileLines, insertLine, codeBuffer);
                    } else if (currentFile && insertLine === 0) { // CREATE
                        // For CREATE in implicit mode, codeBuffer IS the content
                        // handled when we eventually save currentFile
                        // actually CREATE sets fileLines=[] and insertLine=0
                        // so executeAdd works for valid fileLines.
                        // But for CREATE, fileLines is empty.
                        this.executeAdd(fileLines, insertLine, codeBuffer);
                    }
                    codeBuffer = [];
                }
                continue;
            }

            // READING CODE BLOCK logic
            if (isReadingCode) {
                if (!isImplicitCode && trimmed === '>>>') {
                    // explicit end
                    isReadingCode = false;
                    this.executeAdd(fileLines, insertLine, codeBuffer);
                    codeBuffer = [];
                    continue;
                } else if (isImplicitCode) {
                    // Check if this line looks like a command
                    if (/^(FILE|ADD|REMOVE|CREATE|DELETE|RENAME|MKDIR|RMDIR)\s+/.test(trimmed)) {
                        // End implicit block and Reprocess this line
                        isReadingCode = false;
                        isImplicitCode = false;
                        this.executeAdd(fileLines, insertLine, codeBuffer);
                        codeBuffer = [];
                        i--; // Go back to process this command line
                        continue;
                    }
                }

                codeBuffer.push(line);
                continue;
            }

            // COMMAND PARSING
            if (trimmed.startsWith('FILE ')) {
                // Save previous file if exists
                if (currentFile) {
                    modifiedFiles.set(currentFile, fileLines.join('\n'));
                }

                const relPath = trimmed.substring(5).trim();
                currentFile = this.resolveFilePath(relPath, workspaceRoot);

                // Load existing content
                if (fs.existsSync(currentFile)) {
                    if (modifiedFiles.has(currentFile)) {
                        fileLines = modifiedFiles.get(currentFile)!.split('\n');
                    } else {
                        fileLines = fs.readFileSync(currentFile, 'utf8').split(/\r?\n/);
                    }
                } else {
                    fileLines = [];
                }
            }
            else if (trimmed.startsWith('ADD ')) {
                if (!currentFile) continue;
                const parts = trimmed.split(' ');
                insertLine = parseInt(parts[1]);

                // Check for explicit block start
                if (i + 1 < lines.length && lines[i + 1].trim() === '<<<') {
                    isReadingCode = true;
                    isImplicitCode = false;
                    i++; // Skip <<< line
                } else {
                    // Implicit block start
                    isReadingCode = true;
                    isImplicitCode = true;
                }
            }
            else if (trimmed.startsWith('ADD_AFTER ')) {
                if (!currentFile) continue;
                const parts = trimmed.split(' ');
                // ADD_AFTER 1 means we append AFTER line 1.
                // This effectively means we behave like ADD 2.
                // So we just increment the parsed line number by 1.
                insertLine = parseInt(parts[1]) + 1;

                // Reuse ADD logic for parsing block
                if (i + 1 < lines.length && lines[i + 1].trim() === '<<<') {
                    isReadingCode = true;
                    isImplicitCode = false;
                    i++;
                } else {
                    isReadingCode = true;
                    isImplicitCode = true;
                }
            }
            else if (trimmed.startsWith('REMOVE ')) {
                if (!currentFile) continue;
                const parts = trimmed.split(' ');
                const rangeStr = parts[1];
                let start = 0, end = 0;
                if (rangeStr.includes('-')) {
                    const rangeParts = rangeStr.split('-');
                    start = parseInt(rangeParts[0]);
                    end = parseInt(rangeParts[1]);
                } else {
                    start = parseInt(rangeStr);
                    end = start;
                }
                this.executeRemove(fileLines, start, end);
            }
            else if (trimmed.startsWith('CREATE ')) {
                const relPath = trimmed.substring(7).trim();
                const filePath = this.resolveFilePath(relPath, workspaceRoot);

                if (i + 1 < lines.length && lines[i + 1].trim() === '<<<') {
                    isReadingCode = true;
                    isImplicitCode = false;
                    currentFile = filePath;
                    fileLines = [];
                    insertLine = 0;
                    i++;
                } else {
                    // Implicit CREATE?
                    isReadingCode = true;
                    isImplicitCode = true;
                    currentFile = filePath;
                    fileLines = [];
                    insertLine = 0;
                }
            }
            else if (trimmed.startsWith('DELETE ')) {
                const relPath = trimmed.substring(7).trim();
                const filePath = this.resolveFilePath(relPath, workspaceRoot);
                changes.push({
                    filePath: filePath,
                    content: '',
                    action: 'delete'
                });
            }
            else if (trimmed.startsWith('RENAME ')) {
                const parts = trimmed.substring(7).trim().split(/\s+/);
                if (parts.length >= 2) {
                    const oldPath = this.resolveFilePath(parts[0], workspaceRoot);
                    const newPath = this.resolveFilePath(parts[1], workspaceRoot);
                    if (fs.existsSync(oldPath)) {
                        const content = fs.readFileSync(oldPath, 'utf8');
                        changes.push({
                            filePath: newPath,
                            content: content,
                            action: 'create'
                        });
                        changes.push({
                            filePath: oldPath,
                            content: '',
                            action: 'delete'
                        });
                    }
                }
            }
            else if (trimmed.startsWith('MKDIR ')) {
                const relPath = trimmed.substring(6).trim();
                const dirPath = this.resolveFilePath(relPath, workspaceRoot);
                changes.push({
                    filePath: dirPath,
                    content: '__MKDIR__',
                    action: 'create'
                });
            }
            else if (trimmed.startsWith('RMDIR ')) {
                const relPath = trimmed.substring(6).trim();
                const dirPath = this.resolveFilePath(relPath, workspaceRoot);
                changes.push({
                    filePath: dirPath,
                    content: '__RMDIR__',
                    action: 'delete'
                });
            }
        }

        // Finish any open implicit block at end of file
        if (isReadingCode && isImplicitCode) {
            this.executeAdd(fileLines, insertLine, codeBuffer);
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

    private executeAdd(fileLines: string[], line: number, codeLines: string[]) {
        // Line is 1-based.
        // Index is line-1.
        let index = line - 1;

        console.log(`[ExecuteAdd] Request Line: ${line}, Parsed Index: ${index}, FileLength: ${fileLines.length}`);

        if (index < 0) {
            console.log(`[ExecuteAdd] Index ${index} clamped to 0`);
            index = 0;
        }
        if (index > fileLines.length) {
            console.log(`[ExecuteAdd] Index ${index} clamped to ${fileLines.length} (Appended)`);
            index = fileLines.length;
        }

        // Insert codeLines at index
        // splice(start, deleteCount, ...items)
        fileLines.splice(index, 0, ...codeLines);
    }

    private executeRemove(fileLines: string[], start: number, end: number) {
        // Line is 1-based.
        // Index is start-1.
        let index = start - 1;
        let count = end - start + 1;

        if (index < 0) index = 0;
        // logic to clamp
        if (index >= fileLines.length) return; // Nothing to delete

        // If count goes beyond length
        if (index + count > fileLines.length) {
            count = fileLines.length - index;
        }

        fileLines.splice(index, count);
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
    async applyChanges(changes: FileChange[]): Promise<void> {
        const workspaceEdit = new vscode.WorkspaceEdit();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const logPath = path.join(workspaceRoot, 'log.txt');
        const logEntries: string[] = [];
        const timestamp = new Date().toISOString();

        for (const change of changes) {
            try {
                const uri = vscode.Uri.file(change.filePath);

                if (change.action === 'create' || change.action === 'modify') {
                    if (change.content === '__MKDIR__') {
                        // WorkspaceEdit doesn't explicitly foster directories, ignoring
                        // But we can ensure it exists?
                        if (!fs.existsSync(change.filePath)) {
                            fs.mkdirSync(change.filePath, { recursive: true });
                        }
                        continue;
                    }

                    // For modify/create, we can use textual edits or full replacement.
                    // Since we reconstructed the FULL file content in memory (fileLines),
                    // we can just replace the entire file.

                    // But to replace, we need the Range of the entire file.
                    // Or we can use createFile with overwrite?
                    // "createFile" has options: { overwrite: true, ignoreIfExists: false }

                    // Checking if file exists to decide logic
                    // Actually, WorkspaceEdit.createFile will throw if exists and overwrite is false.
                    // WorkspaceEdit.replace needs a valid range.

                    // Simple approach: Delete and Create? (Too destructive?)
                    // Better approach: Calculate full range if exists.

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
                    } else {
                        workspaceEdit.deleteFile(uri, { ignoreIfNotExists: true });
                    }
                    logEntries.push(`[${timestamp}] DELETED: ${change.filePath}`);
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
