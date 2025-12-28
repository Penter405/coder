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
     * Parse AI response to extract file changes
     * Supports formats:
     * - ```filename.ext ... ``` blocks
     * - ## path/to/file + code block
     * - [FILE: path/to/file] markers
     */
    parseChanges(aiResponse: string): FileChange[] {
        const changes: FileChange[] = [];
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        // Pattern 1: ## filename followed by code block
        const pattern1 = /##\s+([^\n]+)\n+```[\w]*\n([\s\S]*?)```/g;
        let match;

        while ((match = pattern1.exec(aiResponse)) !== null) {
            const filePath = match[1].trim();
            const content = match[2];

            changes.push({
                filePath: this.resolveFilePath(filePath, workspaceRoot),
                content: content,
                action: 'modify'
            });
        }

        // Pattern 2: [FILE: path/to/file] followed by code block
        const pattern2 = /\[FILE:\s*([^\]]+)\]\n*```[\w]*\n([\s\S]*?)```/g;

        while ((match = pattern2.exec(aiResponse)) !== null) {
            const filePath = match[1].trim();
            const content = match[2];

            // Avoid duplicates
            if (!changes.some(c => c.filePath === this.resolveFilePath(filePath, workspaceRoot))) {
                changes.push({
                    filePath: this.resolveFilePath(filePath, workspaceRoot),
                    content: content,
                    action: 'modify'
                });
            }
        }

        // Pattern 3: Single code block with filename in first line comment
        // e.g., ```python\n# filename.py\n...```
        if (changes.length === 0) {
            const pattern3 = /```(\w+)\n(?:#|\/\/|\/\*)\s*(\S+\.\w+)[^\n]*\n([\s\S]*?)```/g;

            while ((match = pattern3.exec(aiResponse)) !== null) {
                const filePath = match[2].trim();
                const content = match[3];

                changes.push({
                    filePath: this.resolveFilePath(filePath, workspaceRoot),
                    content: content,
                    action: 'modify'
                });
            }
        }

        return changes;
    }

    private resolveFilePath(filePath: string, workspaceRoot: string): string {
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
    async applyChanges(changes: FileChange[]): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const logPath = path.join(workspaceRoot, 'log.txt');
        const logEntries: string[] = [];
        const timestamp = new Date().toISOString();

        for (const change of changes) {
            try {
                const dir = path.dirname(change.filePath);

                // Ensure directory exists
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const existed = fs.existsSync(change.filePath);

                if (change.action === 'delete') {
                    if (existed) {
                        fs.unlinkSync(change.filePath);
                        logEntries.push(`[${timestamp}] DELETED: ${change.filePath}`);
                    }
                } else {
                    fs.writeFileSync(change.filePath, change.content, 'utf8');

                    const action = existed ? 'MODIFIED' : 'CREATED';
                    logEntries.push(`[${timestamp}] ${action}: ${change.filePath}`);

                    // Open the file in editor
                    const doc = await vscode.workspace.openTextDocument(change.filePath);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }

            } catch (error) {
                logEntries.push(`[${timestamp}] ERROR: ${change.filePath} - ${error}`);
                vscode.window.showErrorMessage(`Failed to apply change to ${change.filePath}: ${error}`);
            }
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
