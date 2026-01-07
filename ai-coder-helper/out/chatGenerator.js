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
exports.ChatGenerator = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ChatGenerator {
    /**
     * Generate chat.txt content using data.json configuration (matching main.py logic)
     */
    async generateFromData(workspaceRoot) {
        // 1. Read data.json
        const dataPath = path.join(workspaceRoot, 'file', 'data.json');
        if (!fs.existsSync(dataPath)) {
            // Fallback or Error
            return "// Error: file/data.json not found. Please manage project via AI Coder App.";
        }
        let data;
        try {
            data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        catch (e) {
            return `// Error reading data.json: ${e}`;
        }
        // 2. Identify Project
        // We assume the workspaceRoot corresponds to a project path in data.json.
        let projectName = '';
        let projectInfo = {};
        if (data.projects) {
            for (const name in data.projects) {
                const info = data.projects[name];
                // Check if paths match (relative is empty)
                if (info.path && path.relative(workspaceRoot, info.path) === '') {
                    projectName = name;
                    projectInfo = info;
                    break;
                }
            }
        }
        if (!projectName && data.current_project) {
            // Fallback: Use current_project if path check failed (maybe differing conventions)
            projectName = data.current_project;
            if (data.projects && data.projects[projectName]) {
                projectInfo = data.projects[projectName];
            }
        }
        if (!projectName) {
            return "// Error: Current workspace not found in data.json projects.";
        }
        // 3. Extract Settings
        const selectedFiles = projectInfo.selected_files || [];
        const toggles = projectInfo.toggles || { source: true, shadow: true, diff: true };
        const rawSourceContext = projectInfo.source_context;
        const rawCopedContext = projectInfo.coped_context;
        // Default Contexts
        // If not set, Source is Project Root
        const sourceRoot = rawSourceContext ? rawSourceContext : (projectInfo.path || workspaceRoot);
        // If not set, Coped is file/shadow (absolute path preferred logic)
        // main.py logic: if relative, verify against project or file dir.
        // Simplified: Resolve absolute.
        let copedRoot = rawCopedContext;
        if (!copedRoot) {
            // Fallback to implicit shadow
            // Try file/{project}/shadow first
            const pShadow = path.join(workspaceRoot, 'file', projectName, 'shadow');
            if (fs.existsSync(pShadow))
                copedRoot = pShadow;
            else
                copedRoot = path.join(workspaceRoot, 'file', 'shadow');
        }
        // 4. Map Files
        // selectedFiles are Source Paths (absolute)
        const srcFiles = selectedFiles;
        const copedMapping = new Map(); // SourcePath -> ShadowPath
        for (const f of selectedFiles) {
            // Calculate relative path from sourceRoot
            const rel = path.relative(sourceRoot, f);
            if (!rel.startsWith('..')) {
                const shadowPath = path.join(copedRoot, rel);
                copedMapping.set(f, shadowPath);
            }
        }
        // 5. Build Content
        let content = '';
        // Header
        content += '# Task Description\n';
        content += `Origin Project: ${projectName}\n`;
        if (toggles.diff) {
            content += `Source Project: ${path.basename(sourceRoot)}\n`;
            content += `Coped Project: ${path.basename(copedRoot)}\n`;
        }
        else {
            if (toggles.source)
                content += `Source Project: ${path.basename(sourceRoot)}\n`;
            if (toggles.shadow)
                content += `Coped Project: ${path.basename(copedRoot)}\n`;
        }
        content += '\n';
        // Penter Instructions (Standard Header)
        content += '# Output Format (IMPORTANT)\n';
        content += 'Please provide the solution in the following "Penter" format:\n';
        content += '```penter\nFILE path/to/file\nADD <line_number>\n...\n```\n\n';
        // Project Structure (Optional: Show tree of Source Context if toggled)
        if (toggles.source) {
            content += '# Project Structure (Source)\n```\n';
            content += this.generateProjectTree(sourceRoot, new Set(selectedFiles));
            content += '```\n\n';
        }
        // Source Files
        if (toggles.source) {
            content += `# Source Files (Context: ${path.basename(sourceRoot)})\n`;
            if (srcFiles.length === 0)
                content += "(No source files selected)\n\n";
            for (const f of srcFiles.sort()) {
                const rel = path.relative(sourceRoot, f);
                content += `## ${rel}\n\`\`\`${path.extname(f).slice(1) || 'txt'}\n`;
                try {
                    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
                    lines.forEach((line, i) => content += `${(i + 1).toString().padEnd(4)} | ${line}\n`);
                }
                catch (e) {
                    content += `(Error reading file: ${e})\n`;
                }
                content += '```\n\n';
            }
        }
        // Shadow Files
        if (toggles.shadow) {
            content += `# Shadow Files (Context: ${path.basename(copedRoot)})\n`;
            if (copedMapping.size === 0)
                content += "(No shadow files mapped)\n\n";
            // Sort by source path for consistency
            const sortedKeys = Array.from(copedMapping.keys()).sort();
            for (const src of sortedKeys) {
                const shadowPath = copedMapping.get(src);
                const rel = path.relative(copedRoot, shadowPath); // Should match src relative
                content += `## (Shadow) ${rel}\n\`\`\`${path.extname(shadowPath).slice(1) || 'txt'}\n`;
                try {
                    if (fs.existsSync(shadowPath)) {
                        const lines = fs.readFileSync(shadowPath, 'utf8').split(/\r?\n/);
                        lines.forEach((line, i) => content += `${(i + 1).toString().padEnd(4)} | ${line}\n`);
                    }
                    else {
                        content += "(File does not exist in Shadow Layer)\n";
                    }
                }
                catch (e) {
                    content += `(Error reading file: ${e})\n`;
                }
                content += '```\n\n';
            }
        }
        // Diff Report
        if (toggles.diff) {
            content += '# Diff Report (Source -> Shadow)\n';
            const sortedKeys = Array.from(copedMapping.keys()).sort();
            if (sortedKeys.length === 0) {
                content += "(No files selected for diff)\n\n";
            }
            else {
                const diffReport = this.generateDiffReport(sortedKeys, copedMapping);
                content += diffReport + "\n\n";
            }
        }
        return content;
    }
    generateDiffReport(srcFiles, copedMapping) {
        // Simple line-based diff simulation or minimal report
        // Since we don't have python's difflib easily available in node without import, 
        // we'll just implement a basic check or placeholder. 
        // Actually, 'diff' package is common but maybe not available here.
        // We will output a basic "Files differ" or "Files identical" message, 
        // OR try to implement a naive diff.
        // Given complexity, let's list Modified files.
        let report = "";
        for (const sPath of srcFiles) {
            const dPath = copedMapping.get(sPath);
            const rel = path.basename(sPath); // Or relative path?
            try {
                if (!fs.existsSync(dPath)) {
                    report += `### ${rel}\n[New File in Source / Missing in Shadow]\n`;
                    continue;
                }
                const sContent = fs.readFileSync(sPath, 'utf8');
                const dContent = fs.readFileSync(dPath, 'utf8');
                if (sContent !== dContent) {
                    report += `### ${rel}\n[Modified]\n`;
                }
            }
            catch (e) {
                report += `### ${rel}\n(Error comparing)\n`;
            }
        }
        return report || "(No differences found in selected files)";
    }
    generateProjectTree(rootPath, selectedSet) {
        const config = vscode.workspace.getConfiguration('aiCoder');
        const excludePatterns = config.get('excludePatterns', []);
        let tree = path.basename(rootPath) + '/\n';
        tree += this.buildTree(rootPath, '', excludePatterns, selectedSet);
        return tree;
    }
    buildTree(dirPath, prefix, excludePatterns, selectedFiles) {
        let result = '';
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            // Filter
            const filtered = entries.filter(e => {
                return !excludePatterns.some(p => {
                    if (p.startsWith('*'))
                        return e.name.endsWith(p.slice(1));
                    return e.name === p;
                });
            });
            filtered.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory())
                    return -1;
                if (!a.isDirectory() && b.isDirectory())
                    return 1;
                return a.name.localeCompare(b.name);
            });
            for (let i = 0; i < filtered.length; i++) {
                const entry = filtered[i];
                const isLast = i === filtered.length - 1;
                const fullPath = path.join(dirPath, entry.name);
                const connector = isLast ? '└── ' : '├── ';
                const childPrefix = isLast ? '    ' : '│   ';
                // Check if this file or any child is selected (to prune tree)? 
                // User didn't ask for pruning, just tree.
                // Mark selection
                const isSelected = selectedFiles.has(fullPath);
                const marker = isSelected ? ' [*]' : '';
                if (entry.isDirectory()) {
                    result += prefix + connector + entry.name + '/\n';
                    result += this.buildTree(fullPath, prefix + childPrefix, excludePatterns, selectedFiles);
                }
                else {
                    result += prefix + connector + entry.name + marker + '\n';
                }
            }
        }
        catch (e) { }
        return result;
    }
}
exports.ChatGenerator = ChatGenerator;
//# sourceMappingURL=chatGenerator.js.map