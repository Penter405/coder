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
            const shadowPattern = new vscode.RelativePattern(root, 'file/shadow/**/*');
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
        const shadowRoot = path.join(root, 'file', 'shadow');

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
}
