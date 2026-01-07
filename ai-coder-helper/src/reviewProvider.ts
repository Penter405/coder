import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChangeApplier, PenterInstruction, FileChange } from './changeApplier';

export class ReviewItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'file' | 'instruction',
        public readonly data: PenterInstruction | string, // filePath for 'file'
        public readonly accepted: boolean = true
    ) {
        super(label, collapsibleState);
        this.contextValue = type;

        if (type === 'instruction') {
            const inst = data as PenterInstruction;
            this.description = this.getDesc(inst);
            this.tooltip = inst.content;

            // Icon based on status
            this.iconPath = new vscode.ThemeIcon(accepted ? 'check' : 'x');
            // Strikethrough if rejected? VS Code doesn't support strikethrough in tree easily, use icon/color.
            // Gray out if rejected?
            if (!accepted) {
                this.description += " (Rejected)";
            }
        } else {
            this.iconPath = vscode.ThemeIcon.File;
        }
    }

    private getDesc(inst: PenterInstruction): string {
        switch (inst.action) {
            case 'ADD': return `Line ${inst.line}`;
            case 'ADD_AFTER': return `After Line ${inst.line}`;
            case 'REMOVE': return `Lines ${inst.start}-${inst.end}`;
            case 'CREATE': return 'New File';
            case 'DELETE': return 'Delete File';
            case 'RENAME': return `-> ${inst.newPath}`;
            case 'MKDIR': return 'Create Dir';
            case 'RMDIR': return 'Remove Dir';
            default: return '';
        }
    }
}

export class ReviewProvider implements vscode.TreeDataProvider<ReviewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ReviewItem | undefined | null | void> = new vscode.EventEmitter<ReviewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ReviewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private instructions: PenterInstruction[] = [];
    private acceptedIds: Set<number> = new Set();
    private applier: ChangeApplier;
    private workspaceRoot: string;

    constructor(root: string) {
        this.workspaceRoot = root;
        this.applier = new ChangeApplier();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public loadInstructions(insts: PenterInstruction[]) {
        this.instructions = insts;
        this.acceptedIds.clear();
        // Default all accepted
        insts.forEach(i => this.acceptedIds.add(i.id));
        this.refresh();
        this.updateShadow();
    }

    public toggleInstruction(id: number) {
        if (this.acceptedIds.has(id)) {
            this.acceptedIds.delete(id);
        } else {
            this.acceptedIds.add(id);
        }
        this.refresh();
        this.updateShadow();
    }

    public getInstructions(): PenterInstruction[] {
        return this.instructions;
    }

    public getInstructionIdBySourceLine(line: number): number | undefined {
        // Find instruction where line is within sourceLineStart and sourceLineEnd
        // Note: sourceLineStart/End are 0-based relative to the start of the Penter block + block offset?
        // Yes, the parser calculates absolute lines relative to parsed content start + offset.
        // But if there are multiple Penter blocks in a file? The current parser takes ONE aiResponse string.
        // Assumption: chat.txt contains ONE main Penter block at a time usually?
        // Or if we run "Generate Code", it appends? 
        // If we generate multiple times, we might have multiple blocks.
        // But `parseToInstructions` parses the *entire* text input passed to it.
        // So `changeApplier` should handle multiple blocks if we feed it the whole file?
        // Currently `changeApplier` extracts ONE block via regex: /```\s*penter\s*([\s\S]*?)```/i

        // LIMITATION: Current Parser only finds the FIRST Penter block.
        // This is fine for current "Apply Changes" flow which usually takes the latest response.
        // But for "chat.txt", we might want to support multiple.

        // For now, simple range check.
        const inst = this.instructions.find(i => line >= i.sourceLineStart && line <= i.sourceLineEnd);
        return inst ? inst.id : undefined;
    }

    public acceptAll() {
        this.instructions.forEach(i => this.acceptedIds.add(i.id));
        this.refresh();
        this.updateShadow();
    }

    public rejectAll() {
        this.acceptedIds.clear();
        this.refresh();
        this.updateShadow();
    }

    public isAccepted(id: number): boolean {
        return this.acceptedIds.has(id);
    }

    getTreeItem(element: ReviewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ReviewItem): Thenable<ReviewItem[]> {
        if (!element) {
            // Root: Files
            const files = Array.from(new Set(this.instructions.map(i => i.filePath)));
            return Promise.resolve(files.map(f => {
                const basename = path.basename(f);
                // Check if any inst in this file is rejected?
                // Just Show file
                return new ReviewItem(basename, vscode.TreeItemCollapsibleState.Expanded, 'file', f);
            }));
        } else if (element.type === 'file') {
            const filePath = element.data as string;
            const insts = this.instructions.filter(i => i.filePath === filePath);
            return Promise.resolve(insts.map(i => {
                const label = i.action;
                const isAccepted = this.acceptedIds.has(i.id);
                return new ReviewItem(label, vscode.TreeItemCollapsibleState.None, 'instruction', i, isAccepted);
            }));
        }
        return Promise.resolve([]);
    }

    private shadowRoot: string | undefined;

    public setShadowRoot(path: string) {
        this.shadowRoot = path;
    }

    /**
     * Applies the CURRENTLY ACCEPTED instructions to the Shadow Layer.
     * This effectively "Previews" the result of the selection.
     */
    public async updateShadow() {
        if (!this.shadowRoot) {
            // Cannot update if we don't know where shadow is.
            return;
        }

        // Apply to Shadow Directory
        await this.applyToShadowDir(this.shadowRoot);
    }

    public async applyToShadowDir(shadowRoot: string) {
        this.shadowRoot = shadowRoot; // Cache it

        const activeInstructions = this.instructions.filter(i => this.acceptedIds.has(i.id));
        const changes = this.applier.applyInstructions(activeInstructions);

        for (const change of changes) {
            // change.filePath is the ORIGINAL project path (e.g. c:/.../main.py)
            // We need to map it to Shadow Path.
            // Assumption: change.filePath is inside workspaceRoot?

            // Map Logic:
            // Original: <AppRoot>/file/Project/main.py
            // Shadow: <AppRoot>/file/Project/shadow/main.py

            // Wait, "Sync to Shadow" logic in extension.ts handles copying.
            // Here we want to start from the *Clean* shadow file (synced state) and apply changes?
            // "applyInstructions" reads from 'fs.readFileSync(change.filePath)'.
            // If we run `applyInstructions` it reads the *Project* file (Source).
            // Then it modifies it in memory.
            // Then we write to *Shadow*.

            // This is correct! We always re-compute from Source + Edits -> Shadow.
            // So if Source changes, we might need to re-run.
            // But within a session, Source is stable.

            // Compute Shadow Path
            // We need relative path from AppRoot or WorkspaceRoot?
            // change.filePath is absolute.

            // We need the relative path of the file within the Project.
            // We can try to derive it.

            // Actually, we can just use the basename + structure?
            // The safest way is to ask Extension to resolve the shadow path for a given original path.

            // But to decouple, let's assume we pass in a "Rebaser" function?
            // Or just do best effort here.

            const relPath = path.relative(this.workspaceRoot, change.filePath);
            const shadowFile = path.join(shadowRoot, relPath);

            const shadowDir = path.dirname(shadowFile);
            if (!fs.existsSync(shadowDir)) {
                fs.mkdirSync(shadowDir, { recursive: true });
            }

            if (change.action === 'delete') {
                if (change.content === '__RMDIR__') {
                    if (fs.existsSync(shadowFile)) {
                        fs.rmSync(shadowFile, { recursive: true, force: true });
                    }
                } else {
                    if (fs.existsSync(shadowFile)) fs.unlinkSync(shadowFile);
                }
            } else {
                if (change.content === '__MKDIR__') {
                    if (!fs.existsSync(shadowFile)) {
                        fs.mkdirSync(shadowFile, { recursive: true });
                    }
                } else {
                    // Ensure parent dir exists
                    const shadowDir = path.dirname(shadowFile);
                    if (!fs.existsSync(shadowDir)) {
                        fs.mkdirSync(shadowDir, { recursive: true });
                    }
                    fs.writeFileSync(shadowFile, change.content, 'utf8');
                }
            }
        }
    }
}
