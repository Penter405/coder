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
// InlineReviewDecorationProvider removed - functionality merged into PenterCodeLensProvider
function activate(context) {
    console.log('AI Coder Helper is now active!');
    console.log('[Extension] extensionPath: ' + context.extensionPath);
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
    const shadowTreeView = vscode.window.createTreeView('aiCoderShadow', {
        treeDataProvider: shadowProvider,
        canSelectMany: true,
        showCollapseAll: true
    });
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
    // Note: Accept/Reject functionality is handled by PenterCodeLensProvider
    // --- COMMANDS ---
    // 1. Generate Prompt (chat.txt) - READS FROM data.json
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.generateChat', async () => {
        if (!vscode.workspace.workspaceFolders)
            return;
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        try {
            // Pass appRoot so data.json is found in coder-main/file/data.json
            const chatContent = await chatGenerator.generateFromData(root, appRoot);
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
        const title = `${path.basename(item.originalPath)} (Opened) ??(Shadow)`;
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
    // Shadow Diff Color Scheme Selection
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.selectDiffColorScheme', async () => {
        const schemes = shadowDiffProvider.getColorSchemes();
        const selected = await vscode.window.showQuickPick(schemes, {
            placeHolder: 'Select a color scheme for diff highlighting'
        });
        if (selected) {
            shadowDiffProvider.setColorScheme(selected);
            vscode.window.showInformationMessage(`Color scheme: ${selected}`);
        }
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
        // Use appRoot for reliable data.json location
        const dataPath = path.join(appRoot, 'file', 'data.json');
        console.log('[syncShadow] appRoot:', appRoot);
        console.log('[syncShadow] dataPath:', dataPath);
        let shadowBase = '';
        let projectName = 'Unknown';
        const projectSourcePath = root; // workspace is always the source
        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                const currentProj = data.current_project;
                if (currentProj) {
                    projectName = currentProj;
                    shadowBase = path.join(appRoot, 'file', projectName, 'shadow');
                    console.log('[syncShadow] project:', projectName, 'shadowBase:', shadowBase);
                }
            }
        }
        catch (e) {
            console.error('[syncShadow] Error:', e);
        }
        if (!shadowBase)
            shadowBase = path.join(appRoot, 'file', 'shadow');
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
    }), vscode.commands.registerCommand('aiCoder.refreshFiles', () => fileTreeProvider.refresh()), 
    // Local PR: Merge selected or all shadow files to opened project
    vscode.commands.registerCommand('aiCoder.localPR', async () => {
        try {
            let filesToMerge = [];
            // Helper function to recursively collect files
            const collectAllFiles = async (items) => {
                const allFiles = [];
                for (const i of items) {
                    if (i.isDirectory) {
                        const children = await shadowProvider.getChildren(i);
                        allFiles.push(...await collectAllFiles(children));
                    }
                    else {
                        allFiles.push(i);
                    }
                }
                return allFiles;
            };
            // Use TreeView selection for multi-select (Shift/Ctrl click)
            const selectedItems = shadowTreeView.selection;
            if (selectedItems && selectedItems.length > 0) {
                filesToMerge = await collectAllFiles([...selectedItems]);
            }
            // No selection: merge all
            else {
                vscode.window.showInformationMessage('Local PR: Merging all shadow changes...');
                const rootItems = await shadowProvider.getChildren();
                filesToMerge = await collectAllFiles(rootItems);
            }
            if (filesToMerge.length === 0) {
                vscode.window.showWarningMessage('No shadow files to merge.');
                return;
            }
            let successCount = 0;
            let errorCount = 0;
            for (const file of filesToMerge) {
                try {
                    await shadowProvider.mergeFile(file);
                    successCount++;
                }
                catch (e) {
                    console.error('[localPR] Error merging file:', file.shadowPath, e);
                    errorCount++;
                }
            }
            if (errorCount > 0) {
                vscode.window.showWarningMessage(`Local PR completed: ${successCount} merged, ${errorCount} failed.`);
            }
            else {
                vscode.window.showInformationMessage(`Local PR completed: ${successCount} file(s) merged successfully!`);
            }
            shadowProvider.refresh();
        }
        catch (e) {
            vscode.window.showErrorMessage(`Local PR failed: ${e}`);
            console.error('[localPR] Error:', e);
        }
    }), 
    // Test Shadow
    vscode.commands.registerCommand('aiCoder.testShadow', async (item) => {
        if (item && item.shadowPath) {
            const terminal = vscode.window.createTerminal('Shadow Test');
            terminal.show();
            terminal.sendText(`python "${item.shadowPath}"`);
        }
    }), 
    // Apply All And Run - Apply all shadow changes and run the main file
    vscode.commands.registerCommand('aiCoder.applyAllAndRun', async () => {
        try {
            // First, merge all shadow files (Local PR)
            await vscode.commands.executeCommand('aiCoder.localPR');
            // Find main entry point (main.py, index.js, etc.)
            if (!vscode.workspace.workspaceFolders)
                return;
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const mainFiles = ['main.py', 'app.py', 'index.js', 'index.ts', 'main.js', 'main.ts'];
            let mainFile = '';
            for (const f of mainFiles) {
                const filePath = path.join(root, f);
                if (fs.existsSync(filePath)) {
                    mainFile = filePath;
                    break;
                }
            }
            if (mainFile) {
                const terminal = vscode.window.createTerminal('Run Project');
                terminal.show();
                if (mainFile.endsWith('.py')) {
                    terminal.sendText(`python "${mainFile}"`);
                }
                else {
                    terminal.sendText(`node "${mainFile}"`);
                }
            }
            else {
                vscode.window.showWarningMessage('No main file found (main.py, app.py, index.js, etc.)');
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Apply All & Run failed: ${e}`);
        }
    }), 
    // Run Original - Run the original project without shadow changes
    vscode.commands.registerCommand('aiCoder.runOriginal', async () => {
        try {
            if (!vscode.workspace.workspaceFolders)
                return;
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const mainFiles = ['main.py', 'app.py', 'index.js', 'index.ts', 'main.js', 'main.ts'];
            let mainFile = '';
            for (const f of mainFiles) {
                const filePath = path.join(root, f);
                if (fs.existsSync(filePath)) {
                    mainFile = filePath;
                    break;
                }
            }
            if (mainFile) {
                const terminal = vscode.window.createTerminal('Run Original');
                terminal.show();
                if (mainFile.endsWith('.py')) {
                    terminal.sendText(`python "${mainFile}"`);
                }
                else {
                    terminal.sendText(`node "${mainFile}"`);
                }
            }
            else {
                vscode.window.showWarningMessage('No main file found (main.py, app.py, index.js, etc.)');
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Run Original failed: ${e}`);
        }
    }), 
    // Select All - Select all files in the file tree
    vscode.commands.registerCommand('aiCoder.selectAll', async () => {
        // Get all items from file tree and select them
        const items = await fileTreeProvider.getChildren();
        if (items && items.length > 0) {
            // Note: VS Code TreeView doesn't support programmatic multi-select easily
            // Show info about using Ctrl+A or Shift+Click
            vscode.window.showInformationMessage(`Found ${items.length} top-level items. Use Ctrl+Click or Shift+Click in the tree to multi-select, then use "New PR" to sync selected files.`);
        }
    }), 
    // Deselect All - Clear selection
    vscode.commands.registerCommand('aiCoder.deselectAll', () => {
        vscode.window.showInformationMessage('Click on empty space in the tree view to clear selection.');
    }));
    // 6. Apply Changes (Fixed: Read from appRoot/file/chat.txt, proper shadow path, confirmation flow)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
        let penterContent = '';
        let source = '';
        let projectName = 'Unknown';
        // Read data.json to get current project
        const dataPath = path.join(appRoot, 'file', 'data.json');
        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                projectName = data.current_project || 'Unknown';
            }
        }
        catch (e) {
            console.error('[applyChanges] Error reading data.json:', e);
        }
        // ONLY read from appRoot/file/chat.txt (forced location)
        const chatPath = path.join(appRoot, 'file', 'chat.txt');
        console.log('[applyChanges] Looking for chat.txt at:', chatPath);
        if (fs.existsSync(chatPath)) {
            const content = fs.readFileSync(chatPath, 'utf8');
            const matches = content.match(/```\s*penter([\s\S]*?)```/gi);
            if (matches && matches.length > 0) {
                penterContent = matches[matches.length - 1];
                source = 'file/chat.txt';
            }
        }
        // Fallback to clipboard only if chat.txt not found
        if (!penterContent) {
            penterContent = await vscode.env.clipboard.readText();
            source = 'Clipboard';
        }
        if (!penterContent) {
            vscode.window.showWarningMessage("No Penter code found in file/chat.txt or Clipboard.");
            return;
        }
        if (!vscode.workspace.workspaceFolders)
            return;
        const projectSourcePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const instructions = changeApplier.parseToInstructions(penterContent, projectSourcePath);
        if (instructions.length === 0) {
            vscode.window.showWarningMessage(`No instructions parsed from ${source}.`);
            return;
        }
        // Show instructions for review
        vscode.window.showInformationMessage(`Found ${instructions.length} instructions from ${source}. Applying to Shadow...`);
        // Calculate correct shadow path: appRoot/file/{projectName}/shadow
        const shadowBase = path.join(appRoot, 'file', projectName, 'shadow');
        console.log('[applyChanges] Shadow base:', shadowBase);
        // Ensure shadow directory exists
        if (!fs.existsSync(shadowBase)) {
            fs.mkdirSync(shadowBase, { recursive: true });
        }
        // Sync project to shadow FIRST (so we have a base to apply changes to)
        await vscode.commands.executeCommand('aiCoder.syncShadow');
        // Set shadow root BEFORE loading instructions
        reviewProvider.setShadowRoot(shadowBase);
        // Load instructions into Review panel
        reviewProvider.loadInstructions(instructions);
        // Apply ALL instructions to shadow immediately (user can reject to undo)
        await reviewProvider.applyAllToShadow();
        // Enable inline diff mode (not side-by-side) AND CodeLens in diff editor
        const config = vscode.workspace.getConfiguration('diffEditor');
        await config.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
        await config.update('codeLens', true, vscode.ConfigurationTarget.Global);
        // Get unique affected files and open diff views in inline mode
        const affectedFiles = Array.from(new Set(instructions.map(i => i.filePath)));
        for (const filePath of affectedFiles) {
            // Calculate shadow file path
            const relPath = path.relative(projectSourcePath, filePath);
            const shadowFilePath = path.join(shadowBase, relPath);
            if (fs.existsSync(shadowFilePath)) {
                // Open diff view: Original vs Shadow (will be inline mode)
                const originalUri = vscode.Uri.file(filePath);
                const shadowUri = vscode.Uri.file(shadowFilePath);
                const title = `${path.basename(filePath)} (Original ↔ Shadow)`;
                await vscode.commands.executeCommand('vscode.diff', originalUri, shadowUri, title, { preview: false });
            }
        }
        // Show info about next steps
        vscode.window.showInformationMessage(`✅ Applied ${instructions.length} instructions. ` +
            `Review inline diff. Accept/Reject in 'Penter Review' panel.`);
        // Refresh shadow tree
        vscode.commands.executeCommand('aiCoder.refreshShadow');
    }));
    // 6.5 NEW: Apply Accepted Instructions to Shadow (explicit user action)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyToShadow', async () => {
        const instructions = reviewProvider.getInstructions();
        if (instructions.length === 0) {
            vscode.window.showWarningMessage('No instructions loaded. Run "Apply AI Changes" first.');
            return;
        }
        // Get project name from data.json
        let projectName = 'Unknown';
        const dataPath = path.join(appRoot, 'file', 'data.json');
        try {
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                projectName = data.current_project || 'Unknown';
            }
        }
        catch (e) {
            console.error('[applyToShadow] Error:', e);
        }
        const shadowBase = path.join(appRoot, 'file', projectName, 'shadow');
        // Sync first
        await vscode.commands.executeCommand('aiCoder.syncShadow');
        // Apply accepted instructions to shadow
        await reviewProvider.applyToShadowDir(shadowBase);
        vscode.commands.executeCommand('aiCoder.refreshShadow');
        vscode.window.showInformationMessage('✅ Applied accepted instructions to Shadow. Review changes and use Local PR to merge.');
    }));
    // 7. Review / CodeLens Commands
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.acceptInstructionInline', async (id) => {
        // Accept: Apply to shadow and remove from list
        await reviewProvider.acceptAndRemove(id);
    }), vscode.commands.registerCommand('aiCoder.rejectInstructionInline', async (id) => {
        // Reject: Revert changes from shadow and remove from list
        await reviewProvider.rejectAndRemove(id);
    }), vscode.commands.registerCommand('aiCoder.acceptInstruction', async (item) => {
        if (item.type === 'instruction') {
            await reviewProvider.acceptAndRemove(item.data.id);
        }
    }), vscode.commands.registerCommand('aiCoder.rejectInstruction', async (item) => {
        if (item.type === 'instruction') {
            await reviewProvider.rejectAndRemove(item.data.id);
        }
    }), vscode.commands.registerCommand('aiCoder.acceptAllInstructions', () => reviewProvider.acceptAll()), vscode.commands.registerCommand('aiCoder.rejectAllInstructions', () => reviewProvider.rejectAll()));
    // Status Bar
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aiCoder.applyChanges';
    statusBarItem.text = '$(check) Apply AI Changes';
    statusBarItem.tooltip = 'Apply Penter changes from clipboard/chat.txt';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Add CodeLens - register for all files to work in diff editor
    const codeLensProvider = new penterCodeLensProvider_1.PenterCodeLensProvider(reviewProvider);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, codeLensProvider));
    const decorationProvider = new penterDecorationProvider_1.PenterDecorationProvider(reviewProvider);
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName.endsWith('chat.txt')) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map