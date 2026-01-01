import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class FileItem extends vscode.TreeItem {
    public selected: boolean = false;
    public children: FileItem[] = [];
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
        }

        // Make items clickable to toggle selection
        if (!isDirectory) {
            this.command = {
                command: 'aiCoder.toggleFile',
                title: 'Toggle Selection',
                arguments: [this]
            };
        }
    }

    updateCheckbox() {
        if (!this.isDirectory) {
            this.checkboxState = this.selected
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked;
            // Clear iconPath so it uses default file icon
            this.iconPath = vscode.ThemeIcon.File;
        }
    }
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> =
        new vscode.EventEmitter<FileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private selectedFiles: Set<string> = new Set();
    private rootItems: FileItem[] = [];

    constructor() {
        this.loadSavedSelection();

        // Watch for chat.txt changes to auto-sync selection
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/{chat.txt,file/chat.txt}'));
            watcher.onDidChange(() => {
                this.loadSavedSelection();
                this.refresh();
            });
            watcher.onDidCreate(() => {
                this.loadSavedSelection();
                this.refresh();
            });
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        element.updateCheckbox();
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
            this.rootItems = await this.getFileItems(workspaceRoot, excludePatterns);
            return this.rootItems;
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

                // Restore selection state
                if (this.selectedFiles.has(fullPath)) {
                    item.selected = true;
                }

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

    toggleSelection(item: FileItem): void {
        if (item.isDirectory) return;

        item.selected = !item.selected;

        if (item.selected) {
            this.selectedFiles.add(item.filePath);
        } else {
            this.selectedFiles.delete(item.filePath);
        }

        this.saveSelection();
        this._onDidChangeTreeData.fire(item);
    }

    selectAll(): void {
        this.selectAllRecursive(this.rootItems, true);
        this.saveSelection();
        this._onDidChangeTreeData.fire();
    }

    deselectAll(): void {
        this.selectedFiles.clear();
        this.selectAllRecursive(this.rootItems, false);
        this.saveSelection();
        this._onDidChangeTreeData.fire();
    }

    private selectAllRecursive(items: FileItem[], select: boolean): void {
        for (const item of items) {
            if (!item.isDirectory) {
                item.selected = select;
                if (select) {
                    this.selectedFiles.add(item.filePath);
                }
            }
            if (item.children) {
                this.selectAllRecursive(item.children, select);
            }
        }
    }

    getSelectedFiles(): string[] {
        return Array.from(this.selectedFiles);
    }

    private saveSelection(): void {
        if (!vscode.workspace.workspaceFolders) return;

        const configPath = path.join(
            vscode.workspace.workspaceFolders[0].uri.fsPath,
            '.vscode',
            'ai-coder.json'
        );

        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const config = {
            selectedFiles: Array.from(this.selectedFiles)
        };

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    private loadSavedSelection(): void {
        if (!vscode.workspace.workspaceFolders) return;

        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const configPath = path.join(root, '.vscode', 'ai-coder.json');

        // First try chat.txt (Sync from ConsoleWindow)
        // Check both root/chat.txt and files/chat.txt (path config-dependent)
        const config = vscode.workspace.getConfiguration('aiCoder');
        const outputFile = config.get<string>('outputFile', 'chat.txt');
        const possiblePaths = [
            path.join(root, outputFile),
            path.join(root, 'file', 'chat.txt')
        ];

        let loadedFromChat = false;
        for (const chatPath of possiblePaths) {
            if (fs.existsSync(chatPath)) {
                try {
                    const content = fs.readFileSync(chatPath, 'utf8');
                    // Regex to find ## [Tag] path
                    const matches = content.match(/^## \[(?:Source|Coped)\] (.*)$/gm);
                    if (matches) {
                        this.selectedFiles.clear();
                        matches.forEach(m => {
                            // m is like "## [Source] path/to/file.py"
                            // Extract path
                            const match = /^## \[(?:Source|Coped)\] (.*)$/.exec(m);
                            if (match) {
                                let relPath = match[1].trim();
                                const absPath = path.join(root, relPath);
                                this.selectedFiles.add(absPath);
                            }
                        });
                        loadedFromChat = true;
                        break;
                    }
                } catch (e) {
                    console.error('Error reading chat.txt:', e);
                }
            }
        }

        if (loadedFromChat) {
            return;
        }

        // Fallback to saved json config
        try {
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (config.selectedFiles) {
                    this.selectedFiles = new Set(config.selectedFiles);
                }
            }
        } catch (error) {
            console.error('Error loading saved selection:', error);
        }
    }
}
