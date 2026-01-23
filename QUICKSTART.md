# Quick Start Guide

## Prerequisites

- Node.js 18+ (https://nodejs.org/)
- VS Code 1.85+ (https://code.visualstudio.com/)
- npm (comes with Node.js)

## Building the Extension

### 1. Install Dependencies
```bash
cd grot-vscode-extension
npm install
```

### 2. Compile TypeScript
```bash
npm run compile
```

### 3. Package as VSIX
```bash
# Install vsce if you haven't already
npm install -g @vscode/vsce

# Create the .vsix package
vsce package
```

This creates `grot-editor-1.0.0.vsix`

## Installing in VS Code

### Method 1: From VSIX File
1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "Install from VSIX"
4. Select `grot-editor-1.0.0.vsix`
5. Reload VS Code when prompted

### Method 2: Development Mode
1. Open the extension folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a `.grot` file to test

## Testing the Extension

1. Open any `.grot` file (like your uploaded `rot_20191028_Rodinia_W_formatted.grot`)
2. You should see:
   - Syntax highlighting
   - "GROT Structure" panel in Explorer
   - Hover information when you mouse over rotations
   - Auto-completion when typing `@`
   - Problems panel showing any validation issues

## Available Commands

Press `Ctrl+Shift+P` and type "GROT:" to see all available commands.

## Configuration

Go to `Settings` → search for "grot" to customize:
- Validation options
- Formatting preferences
- Tree view display

## Troubleshooting

### Extension not activating?
- Make sure the file has `.grot` or `.rot` extension
- Check VS Code's Output panel for errors

### TypeScript compilation errors?
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again

### VSIX packaging fails?
- Ensure `@vscode/vsce` is installed globally
- Check that all files listed in `package.json` exist
