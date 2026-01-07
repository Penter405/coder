"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fileSelector_1 = require("./fileSelector");
const chatGenerator_1 = require("./chatGenerator");
const changeApplier_1 = require("./changeApplier");
const shadowExplorer_1 = require("./shadowExplorer");
const reviewProvider_1 = require("./reviewProvider");
const penterCodeLensProvider_1 = require("./penterCodeLensProvider");
const penterDecorationProvider_1 = require("./penterDecorationProvider");
const shadowDiffDecorationProvider_1 = require("./shadowDiffDecorationProvider");
function activate(context) {
    console.log('AI Coder Helper is now active!');
    vscode.window.showInformationMessage('AI Coder Helper is now active!');
    // Initialize the file tree provider
    const fileTreeProvider = new fileSelector_1.FileTreeProvider();
    // Register the tree view
    const treeView = vscode.window.createTreeView('aiCoderFiles', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true,
        canSelectMany: true
    });
    // Shadow Explorer - pass appRoot for reliable data.json location
    const appRoot = path.dirname(context.extensionPath);
    const shadowProvider = new shadowExplorer_1.ShadowTreeProvider(appRoot);
    vscode.window.registerTreeDataProvider('aiCoderShadow', shadowProvider);
    // Shadow Diff Decoration Provider
    const shadowDiffProvider = new shadowDiffDecorationProvider_1.ShadowDiffDecorationProvider(appRoot);
    context.subscriptions.push({ dispose: () => shadowDiffProvider.dispose() });
    // Review Explorer
    const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const reviewProvider = new reviewProvider_1.ReviewProvider(workspaceRoot);
    const reviewTreeView = vscode.window.createTreeView('aiCoderReview', {
        treeDataProvider: reviewProvider,
        showCollapseAll: true
    });
    // Initialize generators
    const chatGenerator = new chatGenerator_1.ChatGenerator();
    const changeApplier = new changeApplier_1.ChangeApplier();
    // --- COMMANDS ---
    // 1. Generate Prompt (chat.txt) - READS FROM data.json
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.generateChat', async () => {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        try {
            const chatContent = await chatGenerator.generateFromData(root);
            // Copy to clipboard
            await vscode.env.clipboard.writeText(chatContent);
            // Save to file
            const config = vscode.workspace.getConfiguration('aiCoder');
            const outputFile = config.get('outputFile', 'chat.txt');
            const filePath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, outputFile);
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(chatContent, 'utf8'));
            vscode.window.showInformationMessage(`Chat generated and copied to clipboard!`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to generate chat: ${error}`);
        }
    }));
    // 2. Diff Shadow (Shadow vs Original) - Single Tab
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.diffShadow', (item) => {
        const leftUri = vscode.Uri.file(item.originalPath);
        const rightUri = vscode.Uri.file(item.shadowPath);
        const title = `${path.basename(item.originalPath)} (Opened) ↔ (Shadow)`;
        if (fs.existsSync(item.originalPath)) {
            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, { preview: true });
        }
        else {
            vscode.window.showInformationMessage(`New Shadow File: ${item.shadowPath}`);
            vscode.commands.executeCommand('vscode.open', rightUri);
        }
    }));
    // 2.5 Toggle Shadow Diff Decorations
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.toggleShadowDiff', () => {
        const enabled = shadowDiffProvider.toggle();
        vscode.window.showInformationMessage(`Shadow Diff Highlights: ${enabled ? 'ON' : 'OFF'}`);
    }));
    // 3. New PR (Sync Shadow) - Handles Context Selection
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.newPR', async (item, nodes) => {
        // Determine items to sync
        const itemsToSync = [];
        // VS Code passes passed item mainly. If multi-select, second arg (nodes) has list.
        // Check type safety loosely
        if (nodes && Array.isArray(nodes) && nodes.length > 0) {
            nodes.forEach((n) => { if (n.filePath)
                itemsToSync.push(n.filePath); });
        }
        else if (item && item.filePath) {
            itemsToSync.push(item.filePath);
        }
        // Require at least one file to be selected
        if (itemsToSync.length === 0) {
            vscode.window.showWarningMessage('Please select files in the Opened Project tree first.');
            return;
        }
        await vscode.commands.executeCommand('aiCoder.syncShadow', itemsToSync);
    }));
    // 4. Sync Shadow (The worker logic)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.syncShadow', async (specificFiles) => {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        // Resolve Project/Shadow Paths
        const findDataJson = (startPath) => {
            let current = startPath;
            const rootAnchor = path.parse(startPath).root;
            while (current !== rootAnchor) {
                let candidate = path.join(current, 'file', 'data.json');
                if (fs.existsSync(candidate))
                    return candidate;
                candidate = path.join(current, 'data.json');
                current = path.dirname(current);
                if (current === path.dirname(current))
                    break;
            }
            return null;
        };
        let shadowBase = "";
        let projectName = "Unknown";
        let projectSourcePath = "";
        try {
            const dataPath = findDataJson(root);
            if (dataPath && fs.existsSync(dataPath)) {
                const dataContent = fs.readFileSync(dataPath, 'utf8');
                const data = JSON.parse(dataContent);
                const currentProj = data.current_project;
                if (currentProj) {
                    projectName = currentProj;
                    const appRoot = path.dirname(path.dirname(dataPath));
                    shadowBase = path.join(appRoot, 'file', projectName, 'shadow');
                    if (data.projects && data.projects[currentProj]) {
                        projectSourcePath = data.projects[currentProj].path;
                    }
                }
            }
        }
        catch (e) {
            console.error(e);
        }
        if (!projectSourcePath)
            projectSourcePath = root;
        if (!shadowBase)
            shadowBase = path.join(root, 'file', 'shadow');
        if (!fs.existsSync(projectSourcePath)) {
            vscode.window.showErrorMessage(`Source path not found: ${projectSourcePath}`);
            return;
        }
        if (!fs.existsSync(shadowBase))
            fs.mkdirSync(shadowBase, { recursive: true });
        try {
            // If specific files provided, only copy those.
            // Else clear shadow and full copy.
            if (specificFiles && specificFiles.length > 0) {
                vscode.window.showInformationMessage(`Syncing ${specificFiles.length} selected items to Shadow...`);
                let count = 0;
                for (const srcPath of specificFiles) {
                    const relative = path.relative(projectSourcePath, srcPath);
                    if (relative.startsWith('..'))
                        continue;
                    const destPath = path.join(shadowBase, relative);
                    if (fs.statSync(srcPath).isDirectory()) {
                        const copyDir = (s, d) => {
                            if (!fs.existsSync(d))
                                fs.mkdirSync(d, { recursive: true });
                            const entries = fs.readdirSync(s, { withFileTypes: true });
                            for (const entry of entries) {
                                if (['.git', 'file', 'shadow', '__pycache__', '.vscode', 'node_modules'].includes(entry.name))
                                    continue;
                                const sp = path.join(s, entry.name);
                                const dp = path.join(d, entry.name);
                                if (entry.isDirectory())
                                    copyDir(sp, dp);
                                else
                                    fs.copyFileSync(sp, dp);
                            }
                        };
                        copyDir(srcPath, destPath);
                    }
                    else {
                        const dir = path.dirname(destPath);
                        if (!fs.existsSync(dir))
                            fs.mkdirSync(dir, { recursive: true });
                        fs.copyFileSync(srcPath, destPath);
                    }
                    count++;
                }
                vscode.window.showInformationMessage(`Synced ${count} items to Shadow.`);
            }
            else {
                // FULL SYNC
                vscode.window.showInformationMessage(`Full Sync: ${projectName} -> Shadow`);
                fs.rmSync(shadowBase, { recursive: true, force: true });
                fs.mkdirSync(shadowBase, { recursive: true });
                const copyRecursive = (src, dest) => {
                    if (!fs.existsSync(dest))
                        fs.mkdirSync(dest, { recursive: true });
                    const entries = fs.readdirSync(src, { withFileTypes: true });
                    for (const entry of entries) {
                        if (['.git', 'file', 'shadow', '__pycache__', '.vscode', 'node_modules'].includes(entry.name))
                            continue;
                        const sp = path.join(src, entry.name);
                        const dp = path.join(dest, entry.name);
                        if (entry.isDirectory())
                            copyRecursive(sp, dp);
                        else
                            fs.copyFileSync(sp, dp);
                    }
                };
                copyRecursive(projectSourcePath, shadowBase);
                vscode.window.showInformationMessage("Full Sync Complete.");
            }
            vscode.commands.executeCommand('aiCoder.refreshShadow');
        }
        catch (e) {
            vscode.window.showErrorMessage(`Sync Error: ${e}`);
        }
    }));
    // 5. Shadow Manager Commands
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.refreshShadow', () => shadowProvider.refresh()), vscode.commands.registerCommand('aiCoder.mergeShadow', async (item) => {
        await shadowProvider.mergeFile(item);
    }), vscode.commands.registerCommand('aiCoder.discardShadow', async (item) => {
        const confirm = await vscode.window.showWarningMessage(`Discard ${item.label}?`, 'Yes', 'No');
        if (confirm === 'Yes')
            await shadowProvider.discardFile(item);
    }), vscode.commands.registerCommand('aiCoder.refreshFiles', () => fileTreeProvider.refresh()));
    // 6. Apply Changes (Re-implemented simplified logic)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
        let penterContent = '';
        let source = '';
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const p = path.join(root, 'chat.txt'); // Look in root
            if (fs.existsSync(p)) {
                const c = fs.readFileSync(p, 'utf8');
                const matches = c.match(/```\s*penter([\s\S]*?)```/gi);
                if (matches && matches.length > 0) {
                    penterContent = matches[matches.length - 1];
                    source = 'chat.txt';
                }
            }
            // Try file/chat.txt
            const p2 = path.join(root, 'file', 'chat.txt');
            if (!penterContent && fs.existsSync(p2)) {
                const c = fs.readFileSync(p2, 'utf8');
                const matches = c.match(/```\s*penter([\s\S]*?)```/gi);
                if (matches && matches.length > 0) {
                    penterContent = matches[matches.length - 1];
                    source = 'file/chat.txt';
                }
            }
        }
        if (!penterContent) {
            penterContent = await vscode.env.clipboard.readText();
            source = 'Clipboard';
        }
        if (!penterContent) {
            vscode.window.showWarningMessage("No Penter code found in chat.txt or Clipboard.");
            return;
        }
        if (!vscode.workspace.workspaceFolders)
            return;
        const projectSourcePath = vscode.workspace.workspaceFolders[0].uri.fsPath; // Ideally from data.json but fallback ok
        const instructions = changeApplier.parseToInstructions(penterContent, projectSourcePath);
        if (instructions.length === 0) {
            vscode.window.showWarningMessage(`No instructions parsed from ${source}.`);
            return;
        }
        const ans = await vscode.window.showInformationMessage(`Stage ${instructions.length} instructions from ${source}?`, 'Yes', 'No');
        if (ans !== 'Yes')
            return;
        // 1. Sync
        await vscode.commands.executeCommand('aiCoder.syncShadow');
        // 2. Load Review
        reviewProvider.loadInstructions(instructions);
        // 3. Apply to Shadow (Find shadow root)
        // ... We rely on shadowProvider internal knowledge or recalculate.
        // reviewProvider needs applyToShadowDir path.
        // Quick hack: Use default shadow path or let user configure.
        // We'll use file/shadow in workspace.
        // Ideally we pass the one calculated in syncShadow.
        // We can store it in extension context? Or re-calculate.
        // We'll re-calculate simply.
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const shadowBase = path.join(root, 'file', 'shadow');
        // Try to be smarter if possible, but for now this is the safest fallback.
        await reviewProvider.applyToShadowDir(shadowBase);
        vscode.commands.executeCommand('aiCoder.refreshShadow');
        vscode.window.showInformationMessage("Applied to Shadow. Review changes now.");
    }));
    // 7. Review / CodeLens Commands
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.acceptInstructionInline', (id) => {
        if (!reviewProvider.isAccepted(id))
            reviewProvider.toggleInstruction(id);
    }), vscode.commands.registerCommand('aiCoder.rejectInstructionInline', (id) => {
        if (reviewProvider.isAccepted(id))
            reviewProvider.toggleInstruction(id);
    }), vscode.commands.registerCommand('aiCoder.acceptInstruction', (item) => {
        if (item.type === 'instruction')
            reviewProvider.toggleInstruction(item.data.id);
    }), vscode.commands.registerCommand('aiCoder.rejectInstruction', (item) => {
        if (item.type === 'instruction')
            reviewProvider.toggleInstruction(item.data.id);
    }), vscode.commands.registerCommand('aiCoder.acceptAllInstructions', () => reviewProvider.acceptAll()), vscode.commands.registerCommand('aiCoder.rejectAllInstructions', () => reviewProvider.rejectAll()));
    // Status Bar
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aiCoder.applyChanges';
    statusBarItem.text = '$(check) Apply AI Changes';
    statusBarItem.tooltip = 'Apply Penter changes from clipboard/chat.txt';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Add CodeLens
    const codeLensProvider = new penterCodeLensProvider_1.PenterCodeLensProvider(reviewProvider);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*chat.txt' }, codeLensProvider));
    const decorationProvider = new penterDecorationProvider_1.PenterDecorationProvider(reviewProvider);
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName.endsWith('chat.txt')) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map