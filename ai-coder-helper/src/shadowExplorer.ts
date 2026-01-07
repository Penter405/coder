import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ShadowFileItem extends vscode.TreeItem {
    public readonly originalPath: string;
    public readonly shadowPath: string;
    public readonly isDirectory: boolean;

    constructor(
        name: string,
        shadowPath: string,
        originalPath: string,
        isDirectory: boolean
    ) {
        super(name, isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this.shadowPath = shadowPath;
        this.originalPath = originalPath;
        this.isDirectory = isDirectory;

        this.resourceUri = vscode.Uri.file(shadowPath);
        this.contextValue = isDirectory ? 'shadowFolder' : 'shadowFile';

        if (isDirectory) {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
            // Open Shadow file directly for editing (not diff view)
            this.command = {
                command: 'vscode.open',
                title: 'Open Shadow File',
                arguments: [vscode.Uri.file(shadowPath)]
            };
        }
    }
}

export class ShadowTreeProvider implements vscode.TreeDataProvider<ShadowFileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ShadowFileItem | undefined | null | void> = new vscode.EventEmitter<ShadowFileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShadowFileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private shadowRoot: string = '';
    private workspaceRoot: string = '';
    private appRoot: string = '';

    constructor(appRoot?: string) {
        this.appRoot = appRoot || '';
        this.initializeRoots();
    }

    private initializeRoots() {
        if (vscode.workspace.workspaceFolders) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.updateShadowRoot();
        }
    }

    private updateShadowRoot() {
        if (!this.workspaceRoot && !this.appRoot) return;

        // Use appRoot if provided, otherwise fall back to searching in workspaceRoot
        const searchRoot = this.appRoot || this.workspaceRoot;
        const dataPath = path.join(searchRoot, 'file', 'data.json');

        console.log(`[ShadowTreeProvider] searchRoot: ${searchRoot}`);
        console.log(`[ShadowTreeProvider] dataPath: ${dataPath}`);

        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;

                if (currentProj) {
                    // Shadow is always at: appRoot/file/{projectName}/shadow/
                    this.shadowRoot = path.join(searchRoot, 'file', currentProj, 'shadow');
                    console.log(`[ShadowTreeProvider] shadowRoot: ${this.shadowRoot}`);

                    // Verify existence
                    if (!fs.existsSync(this.shadowRoot)) {
                        fs.mkdirSync(this.shadowRoot, { recursive: true });
                    }
                } else {
                    this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
                }
            } else {
                console.log(`[ShadowTreeProvider] data.json not found at: ${dataPath}`);
                this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
            }
        } catch (e) {
            console.error('[ShadowTreeProvider] Error reading data.json:', e);
            this.shadowRoot = path.join(searchRoot, 'file', 'shadow');
        }
    }

    refresh(): void {
        this.updateShadowRoot();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ShadowFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ShadowFileItem): Promise<ShadowFileItem[]> {
        if (!this.workspaceRoot) return [];
        if (!this.shadowRoot || !fs.existsSync(this.shadowRoot)) return [];

        const searchDir = element ? element.shadowPath : this.shadowRoot;

        const items: ShadowFileItem[] = [];
        try {
            const entries = fs.readdirSync(searchDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name === '.git' || entry.name === '__pycache__') continue;

                const shadowPath = path.join(searchDir, entry.name);

                // Calculate original path
                // relative from shadowRoot -> apply to workspaceRoot
                // NOTE: shadowRoot is e.g. workspace/file/Project/shadow
                // We want to map to workspace/Project/... (or just workspace/...)
                // Current shadowRoot logic assumes shadow is DEEP inside 'file'.
                // If we want to map back to Source, we take relative path from shadowRoot.

                const relative = path.relative(this.shadowRoot, shadowPath);
                const originalPath = path.join(this.workspaceRoot, relative);

                items.push(new ShadowFileItem(
                    entry.name,
                    shadowPath,
                    originalPath,
                    entry.isDirectory()
                ));
            }

            // Sort: directories first
            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                // Safe access to label (inherited from TreeItem) which is 'name' passed to super
                // But TreeItem.label can be string or TreeItemLabel. We passed string 'name'.
                const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
                const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
                return labelA.localeCompare(labelB);
            });

        } catch (e) {
            console.error('Error in ShadowTreeProvider.getChildren:', e);
        }

        return items;
    }

    private log(message: string) {
        if (this.workspaceRoot) {
            const logPath = path.join(this.workspaceRoot, 'file', 'log.txt');
            // Ensure dir exists
            const dir = path.dirname(logPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const timestamp = new Date().toISOString();
            const entry = `[${timestamp}] SHADOW_ACTION: ${message}\n`;

            try {
                fs.appendFileSync(logPath, entry);
            } catch (e) {
                console.error("Failed to write to log:", e);
            }
        }
    }

    async mergeFile(item: ShadowFileItem) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                const content = fs.readFileSync(item.shadowPath, 'utf8');

                // Ensure target dir exists
                const targetDir = path.dirname(item.originalPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // Handle Deletes (if marker exists, logic from before)
                if (content.trim() === "__DELETED__") {
                    if (fs.existsSync(item.originalPath)) {
                        fs.unlinkSync(item.originalPath);
                        this.log(`Merged DELETE: ${item.originalPath}`);
                    }
                } else {
                    fs.writeFileSync(item.originalPath, content, 'utf8');
                    this.log(`Merged FILE: ${item.originalPath}`);
                }

                // Remove shadow file after merge?
                // Or keep it? Usually merge clears the shadow.
                fs.unlinkSync(item.shadowPath);

                // Refresh
                this.refresh();
                vscode.window.showInformationMessage(`Merged ${path.basename(item.originalPath)}`);

                // Try to refresh Opended Project view too if command available
                vscode.commands.executeCommand('aiCoderFiles.refresh');
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Merge failed: ${e}`);
            console.error(e);
        }
    }

    async discardFile(item: ShadowFileItem) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                fs.unlinkSync(item.shadowPath);
                const msg = `Discarded shadow copy of ${path.basename(item.originalPath)}`;
                vscode.window.showInformationMessage(msg);
                this.log(msg);
                this.refresh();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Discard failed: ${e}`);
        }
    }
}
