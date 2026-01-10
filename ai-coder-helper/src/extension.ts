import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileTreeProvider, FileItem } from './fileSelector';
import { ChatGenerator } from './chatGenerator';
import { ChangeApplier, PenterInstruction } from './changeApplier';
import { ShadowTreeProvider, ShadowFileItem } from './shadowExplorer';
import { ReviewProvider, ReviewItem } from './reviewProvider';
import { PenterCodeLensProvider } from './penterCodeLensProvider';
import { PenterDecorationProvider } from './penterDecorationProvider';
import { ShadowDiffDecorationProvider } from './shadowDiffDecorationProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Coder Helper is now active!');
    console.log('[Extension] extensionPath: ' + context.extensionPath);
    vscode.window.showInformationMessage('AI Coder Helper is now active!');

    // Initialize the file tree provider
    const fileTreeProvider = new FileTreeProvider();

    // Register the tree view
    const treeView = vscode.window.createTreeView('aiCoderFiles', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true,
        canSelectMany: true
    });

    // Shadow Explorer - pass appRoot for reliable data.json location
    const appRoot = path.dirname(context.extensionPath);
    const shadowProvider = new ShadowTreeProvider(appRoot);
    const shadowTreeView = vscode.window.createTreeView('aiCoderShadow', {
        treeDataProvider: shadowProvider,
        canSelectMany: true,
        showCollapseAll: true
    });

    // Shadow Diff Decoration Provider
    const shadowDiffProvider = new ShadowDiffDecorationProvider(appRoot);
    context.subscriptions.push({ dispose: () => shadowDiffProvider.dispose() });

    // Review Explorer
    const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const reviewProvider = new ReviewProvider(workspaceRoot);
    const reviewTreeView = vscode.window.createTreeView('aiCoderReview', {
        treeDataProvider: reviewProvider,
        showCollapseAll: true
    });

    // Initialize generators
    const chatGenerator = new ChatGenerator();
    const changeApplier = new ChangeApplier();


    // --- COMMANDS ---

    // 1. Generate Prompt (chat.txt) - READS FROM data.json
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.generateChat', async () => {
            if (!vscode.workspace.workspaceFolders) return;
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

            try {
                const chatContent = await chatGenerator.generateFromData(root);

                // Copy to clipboard
                await vscode.env.clipboard.writeText(chatContent);

                // Save to file
                const config = vscode.workspace.getConfiguration('aiCoder');
                const outputFile = config.get<string>('outputFile', 'chat.txt');
                const filePath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, outputFile);
                await vscode.workspace.fs.writeFile(filePath, Buffer.from(chatContent, 'utf8'));

                vscode.window.showInformationMessage(`Chat generated and copied to clipboard!`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate chat: ${error}`);
            }
        })
    );

    // 2. Diff Shadow (Shadow vs Original) - Single Tab
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.diffShadow', (item: ShadowFileItem) => {
            const leftUri = vscode.Uri.file(item.originalPath);
            const rightUri = vscode.Uri.file(item.shadowPath);
            const title = `${path.basename(item.originalPath)} (Opened) ??(Shadow)`;

            if (fs.existsSync(item.originalPath)) {
                vscode.commands.executeCommand(
                    'vscode.diff',
                    leftUri,
                    rightUri,
                    title,
                    { preview: true }
                );
            } else {
                vscode.window.showInformationMessage(`New Shadow File: ${item.shadowPath}`);
                vscode.commands.executeCommand('vscode.open', rightUri);
            }
        })
    );

    // 2.5 Toggle Shadow Diff Decorations
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.toggleShadowDiff', () => {
            const enabled = shadowDiffProvider.toggle();
            vscode.window.showInformationMessage(`Shadow Diff Highlights: ${enabled ? 'ON' : 'OFF'}`);
        })
    );


    // Shadow Diff Color Scheme Selection
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.selectDiffColorScheme', async () => {
            const schemes = shadowDiffProvider.getColorSchemes();
            const selected = await vscode.window.showQuickPick(schemes, {
                placeHolder: 'Select a color scheme for diff highlighting'
            });
            if (selected) {
                shadowDiffProvider.setColorScheme(selected);
                vscode.window.showInformationMessage(`Color scheme: ${selected}`);
            }
        })
    );
    // 3. New PR (Sync Shadow) - Handles Context Selection
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.newPR', async (item?: FileItem | any, nodes?: FileItem[] | any) => {
            // Determine items to sync
            const itemsToSync: string[] = [];

            // VS Code passes passed item mainly. If multi-select, second arg (nodes) has list.
            // Check type safety loosely
            if (nodes && Array.isArray(nodes) && nodes.length > 0) {
                nodes.forEach((n: any) => { if (n.filePath) itemsToSync.push(n.filePath); });
            } else if (item && item.filePath) {
                itemsToSync.push(item.filePath);
            }

            // Require at least one file to be selected
            if (itemsToSync.length === 0) {
                vscode.window.showWarningMessage('Please select files in the Opened Project tree first.');
                return;
            }

            await vscode.commands.executeCommand('aiCoder.syncShadow', itemsToSync);
        })
    );

    // 4. Sync Shadow (The worker logic)
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.syncShadow', async (specificFiles?: string[]) => {
            if (!vscode.workspace.workspaceFolders) return;
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
            } catch (e) { console.error('[syncShadow] Error:', e); }

            if (!shadowBase) shadowBase = path.join(appRoot, 'file', 'shadow');
            if (!fs.existsSync(projectSourcePath)) {
                vscode.window.showErrorMessage(`Source path not found: ${projectSourcePath}`);
                return;
            }
            if (!fs.existsSync(shadowBase)) fs.mkdirSync(shadowBase, { recursive: true });

            try {
                // If specific files provided, only copy those.
                // Else clear shadow and full copy.
                if (specificFiles && specificFiles.length > 0) {
                    vscode.window.showInformationMessage(`Syncing ${specificFiles.length} selected items to Shadow...`);
                    let count = 0;
                    for (const srcPath of specificFiles) {
                        const relative = path.relative(projectSourcePath, srcPath);
                        if (relative.startsWith('..')) continue;

                        const destPath = path.join(shadowBase, relative);

                        if (fs.statSync(srcPath).isDirectory()) {
                            const copyDir = (s: string, d: string) => {
                                if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                                const entries = fs.readdirSync(s, { withFileTypes: true });
                                for (const entry of entries) {
                                    if (['.git', 'file', 'shadow', '__pycache__', '.vscode', 'node_modules'].includes(entry.name)) continue;
                                    const sp = path.join(s, entry.name);
                                    const dp = path.join(d, entry.name);
                                    if (entry.isDirectory()) copyDir(sp, dp);
                                    else fs.copyFileSync(sp, dp);
                                }
                            };
                            copyDir(srcPath, destPath);
                        } else {
                            const dir = path.dirname(destPath);
                            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                            fs.copyFileSync(srcPath, destPath);
                        }
                        count++;
                    }
                    vscode.window.showInformationMessage(`Synced ${count} items to Shadow.`);
                } else {
                    // FULL SYNC
                    vscode.window.showInformationMessage(`Full Sync: ${projectName} -> Shadow`);
                    fs.rmSync(shadowBase, { recursive: true, force: true });
                    fs.mkdirSync(shadowBase, { recursive: true });

                    const copyRecursive = (src: string, dest: string) => {
                        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                        const entries = fs.readdirSync(src, { withFileTypes: true });
                        for (const entry of entries) {
                            if (['.git', 'file', 'shadow', '__pycache__', '.vscode', 'node_modules'].includes(entry.name)) continue;
                            const sp = path.join(src, entry.name);
                            const dp = path.join(dest, entry.name);
                            if (entry.isDirectory()) copyRecursive(sp, dp);
                            else fs.copyFileSync(sp, dp);
                        }
                    };
                    copyRecursive(projectSourcePath, shadowBase);
                    vscode.window.showInformationMessage("Full Sync Complete.");
                }

                vscode.commands.executeCommand('aiCoder.refreshShadow');
            } catch (e) {
                vscode.window.showErrorMessage(`Sync Error: ${e}`);
            }
        })
    );

    // 5. Shadow Manager Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.refreshShadow', () => shadowProvider.refresh()),
        vscode.commands.registerCommand('aiCoder.mergeShadow', async (item: ShadowFileItem) => {
            await shadowProvider.mergeFile(item);
        }),
        vscode.commands.registerCommand('aiCoder.discardShadow', async (item: ShadowFileItem) => {
            const confirm = await vscode.window.showWarningMessage(`Discard ${item.label}?`, 'Yes', 'No');
            if (confirm === 'Yes') await shadowProvider.discardFile(item);
        }),

        vscode.commands.registerCommand('aiCoder.refreshFiles', () => fileTreeProvider.refresh()),
        // Local PR: Merge selected or all shadow files to opened project
        vscode.commands.registerCommand('aiCoder.localPR', async () => {
            try {
                let filesToMerge: ShadowFileItem[] = [];

                // Helper function to recursively collect files
                const collectAllFiles = async (items: ShadowFileItem[]): Promise<ShadowFileItem[]> => {
                    const allFiles: ShadowFileItem[] = [];
                    for (const i of items) {
                        if (i.isDirectory) {
                            const children = await shadowProvider.getChildren(i);
                            allFiles.push(...await collectAllFiles(children));
                        } else {
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
                    } catch (e) {
                        console.error('[localPR] Error merging file:', file.shadowPath, e);
                        errorCount++;
                    }
                }

                if (errorCount > 0) {
                    vscode.window.showWarningMessage(`Local PR completed: ${successCount} merged, ${errorCount} failed.`);
                } else {
                    vscode.window.showInformationMessage(`Local PR completed: ${successCount} file(s) merged successfully!`);
                }

                shadowProvider.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(`Local PR failed: ${e}`);
                console.error('[localPR] Error:', e);
            }
        }),
        // Test Shadow
        vscode.commands.registerCommand('aiCoder.testShadow', async (item: ShadowFileItem) => {
            if (item && item.shadowPath) {
                const terminal = vscode.window.createTerminal('Shadow Test');
                terminal.show();
                terminal.sendText(`python "${item.shadowPath}"`);
            }
        }),
        // Apply All And Run
        vscode.commands.registerCommand('aiCoder.applyAllAndRun', async () => {
            vscode.window.showInformationMessage('Apply All & Run: Not implemented');
        }),
        // Run Original
        vscode.commands.registerCommand('aiCoder.runOriginal', async () => {
            vscode.window.showInformationMessage('Run Original: Not implemented');
        }),
        // Select/Deselect All
        vscode.commands.registerCommand('aiCoder.selectAll', () => { vscode.window.showInformationMessage('Select All: Not implemented'); }),
        vscode.commands.registerCommand('aiCoder.deselectAll', () => { vscode.window.showInformationMessage('Deselect All: Not implemented'); })
    );

    // 6. Apply Changes (Re-implemented simplified logic)
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.applyChanges', async () => {
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

            if (!vscode.workspace.workspaceFolders) return;
            const projectSourcePath = vscode.workspace.workspaceFolders[0].uri.fsPath; // Ideally from data.json but fallback ok
            const instructions = changeApplier.parseToInstructions(penterContent, projectSourcePath);

            if (instructions.length === 0) {
                vscode.window.showWarningMessage(`No instructions parsed from ${source}.`);
                return;
            }

            const ans = await vscode.window.showInformationMessage(`Stage ${instructions.length} instructions from ${source}?`, 'Yes', 'No');
            if (ans !== 'Yes') return;

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
        })
    );

    // 7. Review / CodeLens Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aiCoder.acceptInstructionInline', (id: number) => {
            if (!reviewProvider.isAccepted(id)) reviewProvider.toggleInstruction(id);
        }),
        vscode.commands.registerCommand('aiCoder.rejectInstructionInline', (id: number) => {
            if (reviewProvider.isAccepted(id)) reviewProvider.toggleInstruction(id);
        }),
        vscode.commands.registerCommand('aiCoder.acceptInstruction', (item: ReviewItem) => {
            if (item.type === 'instruction') reviewProvider.toggleInstruction((item.data as any).id);
        }),
        vscode.commands.registerCommand('aiCoder.rejectInstruction', (item: ReviewItem) => {
            if (item.type === 'instruction') reviewProvider.toggleInstruction((item.data as any).id);
        }),
        vscode.commands.registerCommand('aiCoder.acceptAllInstructions', () => reviewProvider.acceptAll()),
        vscode.commands.registerCommand('aiCoder.rejectAllInstructions', () => reviewProvider.rejectAll())
    );

    // Status Bar
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aiCoder.applyChanges';
    statusBarItem.text = '$(check) Apply AI Changes';
    statusBarItem.tooltip = 'Apply Penter changes from clipboard/chat.txt';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Add CodeLens
    const codeLensProvider = new PenterCodeLensProvider(reviewProvider);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*chat.txt' }, codeLensProvider));

    const decorationProvider = new PenterDecorationProvider(reviewProvider);
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName.endsWith('chat.txt')) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }
}

export function deactivate() { }
