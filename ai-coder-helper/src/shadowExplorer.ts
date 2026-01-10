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
    private ideContext: string = '';  // Target path for merge (from data.json)
    private appRoot: string = '';

    constructor(appRoot?: string) {
        this.appRoot = appRoot ? path.normalize(appRoot) : '';
        console.log('[ShadowTreeProvider] Constructor appRoot:', this.appRoot);
        this.initializeRoots();
    }

    private initializeRoots() {
        this.updateShadowRoot();
    }

    private updateShadowRoot() {
        if (!this.appRoot) {
            console.log('[ShadowTreeProvider] appRoot is empty');
            return;
        }

        const dataPath = path.join(this.appRoot, 'file', 'data.json');
        console.log('[ShadowTreeProvider] dataPath:', dataPath);

        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;

                if (currentProj && data.projects && data.projects[currentProj]) {
                    this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', currentProj, 'shadow'));
                    
                    // Get ide_context for merge target
                    const projectInfo = data.projects[currentProj];
                    this.ideContext = projectInfo.ide_context || projectInfo.path || '';
                    
                    // If ide_context is relative, make it absolute
                    if (this.ideContext && !path.isAbsolute(this.ideContext)) {
                        this.ideContext = path.join(this.appRoot, this.ideContext);
                    }
                    
                    console.log('[ShadowTreeProvider] shadowRoot:', this.shadowRoot);
                    console.log('[ShadowTreeProvider] ideContext (merge target):', this.ideContext);

                    if (!fs.existsSync(this.shadowRoot)) {
                        fs.mkdirSync(this.shadowRoot, { recursive: true });
                    }
                } else {
                    this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', 'shadow'));
                }
            }
        } catch (e) {
            console.error('[ShadowTreeProvider] Error:', e);
            this.shadowRoot = path.normalize(path.join(this.appRoot, 'file', 'shadow'));
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
        console.log('[ShadowTreeProvider] getChildren called');
        
        if (!this.shadowRoot || !fs.existsSync(this.shadowRoot)) {
            console.log('[ShadowTreeProvider] shadowRoot missing or does not exist');
            return [];
        }

        const searchDir = element ? path.normalize(element.shadowPath) : this.shadowRoot;
        console.log('[ShadowTreeProvider] searchDir:', searchDir);

        const items: ShadowFileItem[] = [];
        try {
            const entries = fs.readdirSync(searchDir, { withFileTypes: true });
            console.log('[ShadowTreeProvider] entries count:', entries.length);

            for (const entry of entries) {
                if (entry.name === '.git' || entry.name === '__pycache__') continue;

                const shadowPath = path.join(searchDir, entry.name);
                const relative = path.relative(this.shadowRoot, shadowPath);
                
                // Use ideContext as the merge target base path
                const originalPath = this.ideContext 
                    ? path.join(this.ideContext, relative)
                    : shadowPath;

                items.push(new ShadowFileItem(
                    entry.name,
                    shadowPath,
                    originalPath,
                    entry.isDirectory()
                ));
            }

            items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                const labelA = typeof a.label === 'string' ? a.label : a.label?.label || '';
                const labelB = typeof b.label === 'string' ? b.label : b.label?.label || '';
                return labelA.localeCompare(labelB);
            });

        } catch (e) {
            console.error('[ShadowTreeProvider] getChildren error:', e);
        }

        console.log('[ShadowTreeProvider] returning items:', items.length);
        return items;
    }

    async mergeFile(item: ShadowFileItem) {
        console.log('[ShadowTreeProvider] mergeFile called');
        console.log('[ShadowTreeProvider] shadowPath:', item.shadowPath);
        console.log('[ShadowTreeProvider] originalPath (target):', item.originalPath);
        
        try {
            if (fs.existsSync(item.shadowPath)) {
                const content = fs.readFileSync(item.shadowPath, 'utf8');
                const targetDir = path.dirname(item.originalPath);
                
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                
                if (content.trim() === "__DELETED__") {
                    if (fs.existsSync(item.originalPath)) {
                        fs.unlinkSync(item.originalPath);
                        console.log('[ShadowTreeProvider] Deleted file:', item.originalPath);
                    }
                } else {
                    fs.writeFileSync(item.originalPath, content, 'utf8');
                    console.log('[ShadowTreeProvider] Wrote file:', item.originalPath);
                }
                
                fs.unlinkSync(item.shadowPath);
                this.refresh();
                vscode.window.showInformationMessage(`Merged ${path.basename(item.originalPath)}`);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Merge failed: ${e}`);
            console.error('[ShadowTreeProvider] mergeFile error:', e);
        }
    }

    async discardFile(item: ShadowFileItem) {
        try {
            if (fs.existsSync(item.shadowPath)) {
                fs.unlinkSync(item.shadowPath);
                vscode.window.showInformationMessage(`Discarded shadow copy of ${path.basename(item.originalPath)}`);
                this.refresh();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Discard failed: ${e}`);
        }
    }
}
