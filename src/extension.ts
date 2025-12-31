import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface GoModule {
  root: string;
  watcher: vscode.FileSystemWatcher;
}

let modules: Map<string, GoModule> = new Map();

export function activate(context: vscode.ExtensionContext) {
  console.log("cfgo extension activated");

  // Find all Go modules in workspace
  findAndWatchGoModules(context);

  // Watch for new go.mod files
  const goModWatcher = vscode.workspace.createFileSystemWatcher("**/go.mod");

  goModWatcher.onDidCreate((uri) => {
    const moduleRoot = path.dirname(uri.fsPath);
    setupModuleWatcher(moduleRoot, context);
  });

  goModWatcher.onDidDelete((uri) => {
    const moduleRoot = path.dirname(uri.fsPath);
    removeModuleWatcher(moduleRoot);
  });

  context.subscriptions.push(goModWatcher);
}

async function findAndWatchGoModules(context: vscode.ExtensionContext) {
  const goModFiles = await vscode.workspace.findFiles(
    "**/go.mod",
    "**/node_modules/**"
  );

  for (const goModFile of goModFiles) {
    const moduleRoot = path.dirname(goModFile.fsPath);
    setupModuleWatcher(moduleRoot, context);
  }
}

function setupModuleWatcher(
  moduleRoot: string,
  context: vscode.ExtensionContext
) {
  if (modules.has(moduleRoot)) {
    return;
  }

  const configPath = path.join(moduleRoot, "config");

  // Check if config folder exists
  if (!fs.existsSync(configPath)) {
    return;
  }

  // Watch only JSON files in the config folder (no recursion)
  const pattern = new vscode.RelativePattern(configPath, "*.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidChange((uri) => handleFileChange(uri, moduleRoot));
  watcher.onDidCreate((uri) => handleFileChange(uri, moduleRoot));

  modules.set(moduleRoot, { root: moduleRoot, watcher });
  context.subscriptions.push(watcher);

  console.log(`Watching Go module: ${moduleRoot}`);
}

function removeModuleWatcher(moduleRoot: string) {
  const module = modules.get(moduleRoot);
  if (module) {
    module.watcher.dispose();
    modules.delete(moduleRoot);
    console.log(`Stopped watching Go module: ${moduleRoot}`);
  }
}

async function handleFileChange(uri: vscode.Uri, moduleRoot: string) {
  const fileName = path.basename(uri.fsPath);
  const inputFile = path.join(moduleRoot, "config", fileName);
  const outputFile = path.join(
    moduleRoot,
    "config",
    "generated",
    fileName.replace(".json", ".go")
  );

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Running cfgo for ${fileName}`);

  try {
    const { stdout, stderr } = await execAsync(
      `cfgo "${inputFile}" "${outputFile}"`
    );

    if (stdout) {
      console.log(stdout);
    }

    vscode.window.showInformationMessage(
      `cfgo: Generated ${fileName.replace(".json", ".go")}`
    );
  } catch (error: any) {
    const errorMsg = error.stderr || error.message;
    console.error(`cfgo error: ${errorMsg}`);
    vscode.window.showErrorMessage(`cfgo failed: ${errorMsg}`);
  }
}

export function deactivate() {
  for (const [_, module] of modules) {
    module.watcher.dispose();
  }
  modules.clear();
}
