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
function activate(context) {
    console.log('AI Coder Helper is now active!');
    vscode.window.showInformationMessage('AI Coder Helper is now active!');
    // Initialize the file tree provider
    const fileTreeProvider = new fileSelector_1.FileTreeProvider();
    // Register the tree view
    const treeView = vscode.window.createTreeView('aiCoderFiles', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true
    });
    // Shadow Explorer
    const shadowProvider = new shadowExplorer_1.ShadowTreeProvider();
    vscode.window.registerTreeDataProvider('aiCoderShadow', shadowProvider);
    // Initialize generators
    const chatGenerator = new chatGenerator_1.ChatGenerator();
    const changeApplier = new changeApplier_1.ChangeApplier();
    // Register commands
    // Shadow Commands
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.diffShadow', (item) => {
        const leftUri = vscode.Uri.file(item.realFilePath);
        const rightUri = vscode.Uri.file(item.shadowFilePath);
        const title = `${path.basename(item.realFilePath)} (Opened) ↔ (Shadow)`;
        if (fs.existsSync(item.realFilePath)) {
            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        }
        else {
            // New file (only in shadow): Open normally
            vscode.window.showInformationMessage(`New File: ${item.relativePath}`);
            vscode.commands.executeCommand('vscode.open', rightUri);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.mergeShadow', async (item) => {
        await shadowProvider.mergeFile(item);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.discardShadow', async (item) => {
        const confirm = await vscode.window.showWarningMessage(`Discard changes for ${item.relativePath}?`, 'Yes', 'No');
        if (confirm === 'Yes') {
            await shadowProvider.discardFile(item);
        }
    }));
    // Toggle file selection when clicked
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.toggleFile', (item) => {
        fileTreeProvider.toggleSelection(item);
    }));
    // Generate chat.txt
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.generateChat', async () => {
        const selectedFiles = fileTreeProvider.getSelectedFiles();
        if (selectedFiles.length === 0) {
            vscode.window.showWarningMessage('No files selected. Please select files first.');
            return;
        }
        // Ask for task description
        const taskDescription = await vscode.window.showInputBox({
            prompt: 'Enter task description for AI',
            placeHolder: 'e.g., Fix the bug in login function...'
        });
        if (!taskDescription) {
            return;
        }
        // Resolve Project Name from data.json
        let projectName;
        if (vscode.workspace.workspaceFolders) {
            try {
                const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const dataPath = path.join(root, 'file', 'data.json');
                if (fs.existsSync(dataPath)) {
                    const dataContent = fs.readFileSync(dataPath, 'utf8');
                    const data = JSON.parse(dataContent);
                    if (data.current_project) {
                        projectName = data.current_project;
                    }
                }
            }
            catch (e) {
                console.error("Failed to read project name:", e);
            }
        }
        try {
            const chatContent = await chatGenerator.generate(selectedFiles, taskDescription, projectName);
            // Copy to clipboard
            await vscode.env.clipboard.writeText(chatContent);
            // Also save to file
            const config = vscode.workspace.getConfiguration('aiCoder');
            const outputFile = config.get('outputFile', 'chat.txt');
            if (vscode.workspace.workspaceFolders) {
                const filePath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, outputFile);
                await vscode.workspace.fs.writeFile(filePath, Buffer.from(chatContent, 'utf8'));
            }
            vscode.window.showInformationMessage(`Chat generated with ${selectedFiles.length} files. Copied to clipboard!`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to generate chat: ${error}`);
        }
    }));
    // Apply changes from AI response (Stage to Shadow)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
        let penterContent = '';
        let source = '';
        // 1. Try reading from chat.txt (Prioritize chat.txt)
        const config = vscode.workspace.getConfiguration('aiCoder');
        const outputFile = config.get('outputFile', 'chat.txt');
        if (vscode.workspace.workspaceFolders) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            // Check "file/chat.txt" (standard location) and configured output file
            const pathsToCheck = [
                path.join(workspaceRoot, 'file', 'chat.txt'),
                path.join(workspaceRoot, outputFile)
            ];
            for (const p of pathsToCheck) {
                if (fs.existsSync(p)) {
                    const content = fs.readFileSync(p, 'utf8');
                    // Find LAST Penter block (robust regex)
                    const matches = content.match(/```\s*penter([\s\S]*?)```/gi);
                    if (matches && matches.length > 0) {
                        penterContent = matches[matches.length - 1];
                        source = `chat.txt (${path.basename(p)})`;
                        break;
                    }
                }
            }
        }
        // 2. If no penter in chat.txt, try Clipboard
        if (!penterContent) {
            penterContent = await vscode.env.clipboard.readText();
            source = 'Clipboard';
        }
        if (!penterContent) {
            vscode.window.showWarningMessage('No Penter code found in chat.txt or Clipboard.');
            return;
        }
        try {
            if (!vscode.workspace.workspaceFolders)
                return;
            let root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            // Helper to search up for file/data.json (Hoisted for reuse)
            const findDataJson = (startPath) => {
                let current = startPath;
                const rootAnchor = path.parse(startPath).root;
                while (current !== rootAnchor) {
                    let candidate = path.join(current, 'file', 'data.json');
                    if (fs.existsSync(candidate))
                        return candidate;
                    candidate = path.join(current, 'data.json'); // Backup check
                    current = path.dirname(current);
                    if (current === path.dirname(current))
                        break;
                }
                return null;
            };
            // TRY TO RESOLVE DYNAMIC ROOT from data.json
            // We need to find 'file/data.json'. The workspace might be the root or a Coped Project subfolder.
            let projectName = "Unknown";
            try {
                const dataPath = findDataJson(root); // Use hoisted function
                if (dataPath && fs.existsSync(dataPath)) {
                    // vscode.window.showInformationMessage(`DEBUG: Found data.json at ${dataPath}`); 
                    const dataContent = fs.readFileSync(dataPath, 'utf8');
                    const data = JSON.parse(dataContent);
                    const currentProj = data.current_project;
                    // Set projectName immediately if found
                    if (currentProj) {
                        projectName = currentProj;
                    }
                    if (currentProj) {
                        projectName = currentProj;
                    }
                    // REMOVED: Dynamic Root Switching.
                    // We must stay in the current workspace context (e.g. Coped Project) so that
                    // relative paths in Penter apply to the current workspace, and the sync function
                    // copies the *current workspace* to the shadow layer.
                    if (currentProj) {
                        source += ` [Project: ${currentProj}]`;
                    }
                }
                else {
                    // vscode.window.showWarningMessage(`DEBUG: Could not find file/data.json starting from ${root}`);
                }
            }
            catch (e) {
                console.error("Failed to resolve dynamic root:", e);
            }
            // Parse changes
            // Note: We use 'root' to resolve relative paths in the Penter block correctly.
            const changes = changeApplier.parseChanges(penterContent, root);
            if (changes.length === 0) {
                vscode.window.showWarningMessage(`No valid Penter commands found in ${source}.`);
                return;
            }
            // Confirm STAGE
            const confirmStage = await vscode.window.showInformationMessage(`Found ${changes.length} changes in ${source}. Stage to Shadow Layer for Review?`, 'Stage to Shadow', 'Cancel');
            if (confirmStage !== 'Stage to Shadow')
                return;
            // STAGE TO SHADOW LOGIC
            // Manual write to file/<project_name>/shadow/...
            // Determine Shadow Base Path
            // FIX: Use Coder App Root (derived from dataPath) instead of Workspace Root
            // dataPath is .../coder/file/data.json
            // appRoot is .../coder
            let shadowBase;
            // We need to retrieve dataPath again or store it in a wider scope. 
            // Since we resolved it earlier, let's re-resolve or assume logic holds.
            const dataPath = findDataJson(root); // Re-run helper or scope it out. 
            // Ideally scroping it out in previous change would be better but for replace block:
            if (dataPath && projectName && projectName !== "Unknown") {
                const appRoot = path.dirname(path.dirname(dataPath));
                shadowBase = path.join(appRoot, 'file', projectName, 'shadow');
                // console.log(`Debug: Resolved Shadow Path to ${shadowBase}`);
            }
            else {
                const extWorkspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                shadowBase = path.join(extWorkspaceRoot, 'file', 'shadow'); // Fallback
                vscode.window.showWarningMessage("Could not determine Coder App Root. Staging to workspace-relative 'file/shadow'.");
            }
            if (!fs.existsSync(shadowBase)) {
                fs.mkdirSync(shadowBase, { recursive: true });
            }
            // --- SYNC PROJECT TO SHADOW (User Feature) ---
            try {
                const copyRecursive = (src, dest) => {
                    if (!fs.existsSync(dest))
                        fs.mkdirSync(dest, { recursive: true });
                    const entries = fs.readdirSync(src, { withFileTypes: true });
                    for (const entry of entries) {
                        const srcPath = path.join(src, entry.name);
                        const destPath = path.join(dest, entry.name);
                        // Ignored folders
                        if (entry.name === '.git' || entry.name === 'file' || entry.name === '__pycache__' || entry.name === 'node_modules' || entry.name === '.vscode' || entry.name === 'shadow') {
                            continue;
                        }
                        if (entry.isDirectory()) {
                            copyRecursive(srcPath, destPath);
                        }
                        else {
                            fs.copyFileSync(srcPath, destPath);
                        }
                    }
                };
                // console.log(`Syncing project ${root} to shadow ${shadowBase}...`);
                copyRecursive(root, shadowBase);
            }
            catch (e) {
                console.error("Failed to sync project to shadow:", e);
                vscode.window.showErrorMessage(`Shadow Sync Failed: ${e}`);
            }
            // ---------------------------------------------
            let stagedCount = 0;
            for (const change of changes) {
                // Calculate relative path from the 'root' (Target Project Root)
                let relPath = path.relative(root, change.filePath);
                // --- PATH FIX: Prevent nested file/order/file/order ---
                // If AI outputs absolute paths or includes 'file/project', strip it
                // Heuristic: If path starts with 'file' or contains project name twice
                if (path.isAbsolute(change.filePath)) {
                    // If outside root, try to force relative
                    if (!change.filePath.startsWith(root)) {
                        // console.warn(`File ${change.filePath} is outside project root ${root}.`);
                        // Try to match basename
                        relPath = path.basename(change.filePath);
                    }
                }
                // Remove common prefixes if AI added them hallucinated
                // e.g. "file/order/main.py" when root is already ".../file/order/two_none"
                // We simply trust that the AI meant a file relative to the project root.
                // But if relPath looks like "file/order/two_none/main.py", that's bad.
                // Actually, the user said: "Coder//file//order//two_none//file//order"
                // If root is ".../file/order/two_none"
                // And relPath is "file/order/..."
                // Then dest is ".../shadow/file/order/..." (BAD)
                // If relPath starts with "file/" or "file\", strip it?
                // Safe bet: If relPath starts with nested structure that mimics root, likely a mistake.
                // Simple fix from user request: Just ensure we don't duplicate.
                // For now, let's strip "file/<projectName>" if it appears at start of relPath
                const prefix = `file${path.sep}${projectName}`; // file\order
                if (relPath.startsWith(prefix) || relPath.startsWith(`file/${projectName}`)) {
                    relPath = relPath.substring(prefix.length + 1); // + separator
                    // Handle potential remaining separator
                    if (relPath.startsWith(path.sep) || relPath.startsWith('/'))
                        relPath = relPath.substring(1);
                }
                // -----------------------------------------------------
                if (path.isAbsolute(change.filePath) && !change.filePath.startsWith(root)) {
                    console.warn(`File ${change.filePath} is outside project root ${root}. Shadowing by basename only.`);
                    relPath = path.basename(change.filePath);
                }
                const shadowPath = path.join(shadowBase, relPath);
                const shadowDir = path.dirname(shadowPath);
                if (!fs.existsSync(shadowDir)) {
                    fs.mkdirSync(shadowDir, { recursive: true });
                }
                if (change.action === 'delete') {
                    fs.writeFileSync(shadowPath, "__DELETED__", 'utf8');
                }
                else {
                    fs.writeFileSync(shadowPath, change.content, 'utf8');
                }
                stagedCount++;
            }
            vscode.window.showInformationMessage(`Staged ${stagedCount} files to Shadow Layer (${projectName}). Check Shadow view.`);
            // Trigger refresh of Shadow view
            vscode.commands.executeCommand('aiCoder.refreshShadow');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to stage changes: ${error}`);
        }
    }));
    // Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aiCoder.applyChanges';
    statusBarItem.text = '$(check) Apply AI Changes';
    statusBarItem.tooltip = 'Apply Penter changes from clipboard';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Command: Test Shadow (Run specific shadow file)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.testShadow', (item) => {
        if (!item || !item.shadowFilePath) {
            vscode.window.showWarningMessage("No shadow file selected.");
            return;
        }
        // Open terminal and run python
        const terminal = vscode.window.createTerminal(`Test Shadow: ${item.label}`);
        terminal.show();
        // Assuming Python. If needed, we can detect language or use configured runner.
        // Using "python"
        terminal.sendText(`python "${item.shadowFilePath}"`);
    }));
    // Command: Apply All & Run
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyAllAndRun', async () => {
        // 1. Merge All
        await shadowProvider.mergeAll();
        // 2. Run Project
        // We need to find the entry point. Defaulting to main.py or current file?
        // User Request: "Apply All + Run" -> "Run after apply".
        // We'll try to run "main.py" in root, or ask user?
        // Let's assume "main.py" as per context.
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const mainPath = path.join(root, 'main.py'); // Assumption based on project
            if (fs.existsSync(mainPath)) {
                const terminal = vscode.window.createTerminal("Run Project");
                terminal.show();
                terminal.sendText(`python "${mainPath}"`);
            }
            else {
                vscode.window.showWarningMessage("Could not find main.py to run. Merged successfully.");
            }
        }
    }));
    // Command: Run Original
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.runOriginal', () => {
        // Just run the project without merging
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const mainPath = path.join(root, 'main.py');
            if (fs.existsSync(mainPath)) {
                const terminal = vscode.window.createTerminal("Run Original");
                terminal.show();
                terminal.sendText(`python "${mainPath}"`);
            }
            else {
                vscode.window.showWarningMessage("Could not find main.py to run.");
            }
        }
    }));
    // Command: Local PR (Merge Shadow to Project)
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.localPR', async () => {
        const answer = await vscode.window.showInformationMessage("Are you sure you want to merge ALL changes from the Shadow Link to the Project?", "Yes, Merge All", "Cancel");
        if (answer === "Yes, Merge All") {
            await shadowProvider.mergeAll();
            vscode.window.showInformationMessage("Merged all shadow changes to project.");
        }
    }));
    // Refresh file list
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.refreshFiles', () => {
        fileTreeProvider.refresh();
    }));
    // Select all files
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.selectAll', () => {
        fileTreeProvider.selectAll();
    }));
    // Deselect all files
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.deselectAll', () => {
        fileTreeProvider.deselectAll();
    }));
    context.subscriptions.push(treeView);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map