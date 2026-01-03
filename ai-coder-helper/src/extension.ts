import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileTreeProvider, FileItem } from './fileSelector';
import { ChatGenerator } from './chatGenerator';
import { ChangeApplier } from './changeApplier';
import { ShadowTreeProvider, ShadowFileItem } from './shadowExplorer';

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Coder Helper is now active!');
    vscode.window.showInformationMessage('AI Coder Helper is now active!');

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

            // Resolve Project Name from data.json
            let projectName: string | undefined;
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
                } catch (e) {
                    console.error("Failed to read project name:", e);
                }
            }

            try {
                const chatContent = await chatGenerator.generate(selectedFiles, taskDescription, projectName);

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
            let penterContent = '';
            let source = '';

            // 1. Try reading from chat.txt (Prioritize chat.txt as requested)
            const config = vscode.workspace.getConfiguration('aiCoder');
            const outputFile = config.get<string>('outputFile', 'chat.txt');
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
                // Appply DIRECTLY to Workspace
                if (!vscode.workspace.workspaceFolders) return;
                let root = vscode.workspace.workspaceFolders[0].uri.fsPath;

                // TRY TO RESOLVE DYNAMIC ROOT from data.json
                try {
                    const dataPath = path.join(root, 'file', 'data.json');
                    if (fs.existsSync(dataPath)) {
                        const dataContent = fs.readFileSync(dataPath, 'utf8');
                        const data = JSON.parse(dataContent);
                        const currentProj = data.current_project;

                        if (currentProj && data.projects && data.projects[currentProj]) {
                            const projectPath = data.projects[currentProj].path;
                            if (projectPath && fs.existsSync(projectPath)) {
                                console.log(`Dynamic Root: Switching context to ${currentProj} -> ${projectPath}`);
                                root = projectPath;
                                source += ` [Context: ${currentProj}]`;
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to resolve dynamic root:", e);
                }


                // Parse changes applying to Workspace Root
                const changes = changeApplier.parseChanges(penterContent, root);

                if (changes.length === 0) {
                    vscode.window.showWarningMessage(`No valid Penter commands found in ${source}.`);
                    return;
                }

                const confirmApply = await vscode.window.showInformationMessage(
                    `Found ${changes.length} changes in ${source}. Apply to workspace?`,
                    'Yes', 'No'
                );

                if (confirmApply === 'Yes') {
                    await changeApplier.applyChanges(changes);
                    vscode.window.showInformationMessage(`Changes applied to workspace.`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to process changes: ${error}`);
            }
        })
    );

    // Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aiCoder.applyChanges';
    statusBarItem.text = '$(check) Apply AI Changes';
    statusBarItem.tooltip = 'Apply Penter changes from clipboard';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

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
