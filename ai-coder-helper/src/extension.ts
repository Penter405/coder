import * as vscode from 'vscode';
import * as path from 'path';
import { FileTreeProvider, FileItem } from './fileSelector';
import { ChatGenerator } from './chatGenerator';
import { ChangeApplier } from './changeApplier';
import { ShadowTreeProvider, ShadowFileItem } from './shadowExplorer';

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Coder Helper is now active!');

    // Initialize the file tree provider
    const fileTreeProvider = new FileTreeProvider();

    // Register the tree view
    const treeView = vscode.window.createTreeView('aiCoderFiles', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true
    });

    // Shadow Explorer
    const shadowProvider = new ShadowTreeProvider();
    vscode.window.registerTreeDataProvider('aiCoderShadow', shadowProvider);

    // Initialize generators
    const chatGenerator = new ChatGenerator();
    const changeApplier = new ChangeApplier();

    // Register commands

    // Shadow Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.diffShadow', (item: ShadowFileItem) => {
            const leftUri = vscode.Uri.file(item.realFilePath);
            const rightUri = vscode.Uri.file(item.shadowFilePath);
            const title = `${path.basename(item.realFilePath)} (Original) ↔ (Shadow)`;

            vscode.commands.executeCommand(
                'vscode.diff',
                leftUri,
                rightUri,
                title
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.mergeShadow', async (item: ShadowFileItem) => {
            await shadowProvider.mergeFile(item);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.discardShadow', async (item: ShadowFileItem) => {
            const confirm = await vscode.window.showWarningMessage(
                `Discard changes for ${item.relativePath}?`,
                'Yes', 'No'
            );
            if (confirm === 'Yes') {
                await shadowProvider.discardFile(item);
            }
        })
    );


    // Toggle file selection when clicked
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.toggleFile', (item: FileItem) => {
            fileTreeProvider.toggleSelection(item);
        })
    );

    // Generate chat.txt
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.generateChat', async () => {
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
                const outputFile = config.get<string>('outputFile', 'chat.txt');

                if (vscode.workspace.workspaceFolders) {
                    const filePath = vscode.Uri.joinPath(
                        vscode.workspace.workspaceFolders[0].uri,
                        outputFile
                    );
                    await vscode.workspace.fs.writeFile(filePath, Buffer.from(chatContent, 'utf8'));
                }

                vscode.window.showInformationMessage(
                    `Chat generated with ${selectedFiles.length} files. Copied to clipboard!`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate chat: ${error}`);
            }
        })
    );

    // Apply changes from AI response
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
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
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to apply changes: ${error}`);
            }
        })
    );

    // Refresh file list
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.refreshFiles', () => {
            fileTreeProvider.refresh();
        })
    );

    // Select all files
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.selectAll', () => {
            fileTreeProvider.selectAll();
        })
    );

    // Deselect all files
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.deselectAll', () => {
            fileTreeProvider.deselectAll();
        })
    );

    context.subscriptions.push(treeView);
}

export function deactivate() { }
