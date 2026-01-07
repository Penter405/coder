import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class FileItem extends vscode.TreeItem {
    public readonly filePath: string;
    public readonly isDirectory: boolean;

    constructor(
        name: string,
        resourceUri: vscode.Uri,
        isDirectory: boolean,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(name, collapsibleState);

        this.filePath = resourceUri.fsPath;
        this.isDirectory = isDirectory;
        this.resourceUri = resourceUri;
        this.tooltip = resourceUri.fsPath;
        this.contextValue = isDirectory ? 'folder' : 'file';

        // Set icon based on type
        if (isDirectory) {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
            // Standard click behavior (open file) is handled by VS Code referencing command in tree view options? 
            // Or we can set command to open file.
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }
    }
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> =
        new vscode.EventEmitter<FileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    constructor() {
        // Watch for changes (simplified, no selection sync needed)
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
            
            // Debounce refresh? For now simple.
            watcher.onDidChange(() => this.refresh());
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {
        if (!vscode.workspace.workspaceFolders) {
            return [];
        }

        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const config = vscode.workspace.getConfiguration('aiCoder');
        const excludePatterns = config.get<string[]>('excludePatterns', []);

        if (!element) {
            // Root level
            return await this.getFileItems(workspaceRoot, excludePatterns);
        } else if (element.isDirectory) {
            return await this.getFileItems(element.filePath, excludePatterns);
        }

        return [];
    }

    private async getFileItems(dirPath: string, excludePatterns: string[]): Promise<FileItem[]> {
        const items: FileItem[] = [];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                // Check exclusions
                const shouldExclude = excludePatterns.some(pattern => {
                    if (pattern.startsWith('*')) {
                        return entry.name.endsWith(pattern.slice(1));
                    }
                    return entry.name === pattern;
                });

                if (shouldExclude) continue;

                const fullPath = path.join(dirPath, entry.name);
                const uri = vscode.Uri.file(fullPath);

                const item = new FileItem(
                    entry.name,
                    uri,
                    entry.isDirectory(),
                    entry.isDirectory()
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                );

                items.push(item);
            }

            // Sort: directories first, then files, alphabetically
            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return (a.label as string).localeCompare(b.label as string);
            });

        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }

        return items;
    }
}
