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
const fileSelector_1 = require("./fileSelector");
const chatGenerator_1 = require("./chatGenerator");
const changeApplier_1 = require("./changeApplier");
function activate(context) {
    console.log('AI Coder Helper is now active!');
    // Initialize the file tree provider
    const fileTreeProvider = new fileSelector_1.FileTreeProvider();
    // Register the tree view
    const treeView = vscode.window.createTreeView('aiCoderFiles', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true
    });
    // Initialize generators
    const chatGenerator = new chatGenerator_1.ChatGenerator();
    const changeApplier = new changeApplier_1.ChangeApplier();
    // Register commands
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
        try {
            const chatContent = await chatGenerator.generate(selectedFiles, taskDescription);
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
    // Apply changes from AI response
    context.subscriptions.push(vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
        // Get text from clipboard
        const clipboardText = await vscode.env.clipboard.readText();
        if (!clipboardText) {
            vscode.window.showWarningMessage('Clipboard is empty. Copy AI response first.');
            return;
        }
        try {
            const changes = changeApplier.parseChanges(clipboardText);
            if (changes.length === 0) {
                vscode.window.showWarningMessage('No file changes detected in clipboard content.');
                return;
            }
            // Show preview and confirm
            const confirmApply = await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: `Apply changes to ${changes.length} file(s)?`
            });
            if (confirmApply === 'Yes') {
                await changeApplier.applyChanges(changes);
                vscode.window.showInformationMessage(`Applied changes to ${changes.length} file(s).`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
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