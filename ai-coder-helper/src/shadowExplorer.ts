import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ShadowFileItem extends vscode.TreeItem {
    public readonly realFilePath: string;

    constructor(
        public readonly shadowFilePath: string,
        public readonly relativePath: string
    ) {
        super(relativePath, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `Shadow: ${shadowFilePath}`;
        this.contextValue = 'shadowFile';
        this.command = {
            command: 'aiCoder.diffShadow',
            title: 'Review Changes',
            arguments: [this]
        };

        // Find real file path
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.realFilePath = path.join(root, relativePath);
        } else {
            this.realFilePath = '';
        }

        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}

export class ShadowTreeProvider implements vscode.TreeDataProvider<ShadowFileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ShadowFileItem | undefined | null | void> =
        new vscode.EventEmitter<ShadowFileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShadowFileItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    constructor() {
        // Watch for changes in shadow folder
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            // Watch recursively under file/ for any shadow folder
            const shadowPattern = new vscode.RelativePattern(root, 'file/**/shadow/**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(shadowPattern);

            watcher.onDidChange(() => this.refresh());
            watcher.onDidCreate(() => this.refresh());
            watcher.onDidDelete(() => this.refresh());
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ShadowFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ShadowFileItem): Promise<ShadowFileItem[]> {
        if (!vscode.workspace.workspaceFolders) {
            return [];
        }

        if (element) {
            return []; // Flat list for now
        }

        const items: ShadowFileItem[] = [];
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // Determine Project Name from data.json to find specific shadow folder
        let projectName = "";
        let shadowRoot: string | undefined;
        try {
            // Helper to search up for file/data.json
            const findDataJson = (startPath: string): string | null => {
                let current = startPath;
                const rootAnchor = path.parse(startPath).root;

                while (current !== rootAnchor) {
                    let candidate = path.join(current, 'file', 'data.json');
                    if (fs.existsSync(candidate)) return candidate;
                    candidate = path.join(current, 'data.json'); // Backup check

                    current = path.dirname(current);
                    if (current === path.dirname(current)) break;
                }
                return null;
            };

            const dataPath = findDataJson(root);
            if (dataPath && fs.existsSync(dataPath)) {
                const dataContent = fs.readFileSync(dataPath, 'utf8');
                const data = JSON.parse(dataContent);
                if (data.current_project) {
                    projectName = data.current_project;
                }

                // Fix: Anchor shadowRoot to App Root
                const appRoot = path.dirname(path.dirname(dataPath));
                if (projectName) {
                    // Overwrite standard logic with absolute app root path
                    shadowRoot = path.join(appRoot, 'file', projectName, 'shadow');
                }
            }
        } catch (e) {
            console.error(e);
        }

        if (!projectName || !shadowRoot) {
            return [];
        }

        // We already set shadowRoot above correctly if data.json was found.
        // If not found, fall back to workspace relative (legacy behavior or empty)
        if (!shadowRoot) shadowRoot = path.join(root, 'file', projectName, 'shadow');

        if (!fs.existsSync(shadowRoot)) {
            return [];
        }

        // Recursive walk
        const walk = (dir: string, base: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    walk(fullPath, base);
                } else {
                    const relative = path.relative(base, fullPath);
                    items.push(new ShadowFileItem(fullPath, relative));
                }
            }
        };

        try {
            walk(shadowRoot, shadowRoot);
        } catch (e) {
            console.error(e);
        }

        return items;
    }

    async mergeFile(item: ShadowFileItem) {
        if (fs.existsSync(item.shadowFilePath)) {
            const content = fs.readFileSync(item.shadowFilePath, 'utf8');
            // Ensure target dir exists
            const targetDir = path.dirname(item.realFilePath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            fs.writeFileSync(item.realFilePath, content, 'utf8');

            // Remove shadow file after merge
            fs.unlinkSync(item.shadowFilePath);

            vscode.window.showInformationMessage(`Merged ${item.relativePath}`);
            this.refresh();
        }
    }

    async discardFile(item: ShadowFileItem) {
        if (fs.existsSync(item.shadowFilePath)) {
            fs.unlinkSync(item.shadowFilePath);
            vscode.window.showInformationMessage(`Discarded shadow copy of ${item.relativePath}`);
            this.refresh();
        }
    }

    async mergeAll() {
        // Iterate all items and merge
        const items = await this.getChildren();
        if (items.length === 0) {
            vscode.window.showInformationMessage("No shadow files to merge.");
            return;
        }

        let mergedCount = 0;
        for (const item of items) {
            if (fs.existsSync(item.shadowFilePath)) {
                // Ensure target dir exists
                const targetDir = path.dirname(item.realFilePath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // Copy Content
                const content = fs.readFileSync(item.shadowFilePath, 'utf8');

                // Handling Deletes: Check for marker?
                // In extension.ts we wrote __DELETED__ for deletes.
                if (content === "__DELETED__") {
                    if (fs.existsSync(item.realFilePath)) {
                        fs.unlinkSync(item.realFilePath);
                    }
                } else {
                    fs.writeFileSync(item.realFilePath, content, 'utf8');
                }

                // Remove shadow file
                fs.unlinkSync(item.shadowFilePath);
                mergedCount++;
            }
        }

        vscode.window.showInformationMessage(`Merged ${mergedCount} files from Shadow Layer.`);
        this.refresh();
    }
}
