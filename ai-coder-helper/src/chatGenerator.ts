import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ChatGenerator {
    /**
     * Generate chat.txt content with task description, project tree, and selected files
     */
    async generate(selectedFiles: string[], taskDescription: string, projectName?: string): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        let content = '';

        // Section 1: Task Description
        content += '# Task Description\n';
        if (projectName) {
            content += `Current Project: ${projectName}\n`;
        }
        content += '\n' + taskDescription + '\n\n';

        // Penter Instructions (Injected)
        content += '# Output Format (IMPORTANT)\n';
        content += 'Please provide the solution in the following "Penter" format:\n';
        content += '```penter\n';
        content += 'FILE path/to/file\n';
        content += 'ADD <line_number>\n';
        content += 'code_to_insert_BEFORE_this_line\n';
        content += 'ADD_AFTER <line_number>\n';
        content += 'code_to_insert_AFTER_this_line\n';
        content += 'REMOVE <start_line>-<end_line>\n';
        content += '```\n';
        content += '**Rules:**\n';
        content += '- Use `ADD n` to insert code **BEFORE** line `n` (existing line `n` moves down).\n';
        content += '- Use `ADD_AFTER n` to insert code **AFTER** line `n`.\n';
        content += '- Use plain text for code blocks (no need for extra delimiters).\n\n';

        // Section 2: Project Structure
        content += '# Project Structure\n\n';
        content += '```\n';
        content += this.generateProjectTree(workspaceRoot, selectedFiles);
        content += '```\n\n';

        // Section 3: Selected Files Content
        content += '# Selected Files\n\n';

        for (const filePath of selectedFiles) {
            const relativePath = path.relative(workspaceRoot, filePath);
            const ext = path.extname(filePath).slice(1) || 'txt';

            content += `## ${relativePath}\n\n`;
            content += '```' + ext + '\n';

            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                content += fileContent;
                if (!fileContent.endsWith('\n')) {
                    content += '\n';
                }
            } catch (error) {
                content += `// Error reading file: ${error}\n`;
            }

            content += '```\n\n';
        }

        return content;
    }

    /**
     * Generate a tree view of the project structure
     */
    private generateProjectTree(rootPath: string, selectedFiles: string[]): string {
        const config = vscode.workspace.getConfiguration('aiCoder');
        const excludePatterns = config.get<string[]>('excludePatterns', []);
        const selectedSet = new Set(selectedFiles);

        const rootName = path.basename(rootPath);
        let tree = rootName + '/\n';
        tree += this.buildTree(rootPath, '', excludePatterns, selectedSet);

        return tree;
    }

    private buildTree(
        dirPath: string,
        prefix: string,
        excludePatterns: string[],
        selectedFiles: Set<string>
    ): string {
        let result = '';

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            // Filter and sort entries
            const filteredEntries = entries.filter(entry => {
                return !excludePatterns.some(pattern => {
                    if (pattern.startsWith('*')) {
                        return entry.name.endsWith(pattern.slice(1));
                    }
                    return entry.name === pattern;
                });
            });

            // Sort: directories first, then files
            filteredEntries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

            for (let i = 0; i < filteredEntries.length; i++) {
                const entry = filteredEntries[i];
                const isLast = i === filteredEntries.length - 1;
                const fullPath = path.join(dirPath, entry.name);

                const connector = isLast ? '└── ' : '├── ';
                const childPrefix = isLast ? '    ' : '│   ';

                // Mark selected files with [*]
                const isSelected = selectedFiles.has(fullPath);
                const marker = isSelected ? ' [*]' : '';

                if (entry.isDirectory()) {
                    result += prefix + connector + entry.name + '/\n';
                    result += this.buildTree(fullPath, prefix + childPrefix, excludePatterns, selectedFiles);
                } else {
                    result += prefix + connector + entry.name + marker + '\n';
                }
            }
        } catch (error) {
            // Ignore permission errors
        }

        return result;
    }
}
