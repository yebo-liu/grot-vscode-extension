import * as vscode from 'vscode';

// ============================================================================
// Types and Interfaces
// ============================================================================

interface Rotation {
    line: number;
    plateId1: number;
    age: number;
    latitude: number;
    longitude: number;
    angle: number;
    plateId2: number;
    metadata: Map<string, string>;
    disabled: boolean;
    rawLine: string;
}

interface MPRS {
    line: number;
    plateId: number;
    code: string;
    name: string;
    platePair: string;
    metadata: Map<string, string>;
    rotations: Rotation[];
}

interface GrotDocument {
    header: Map<string, string>;
    contributors: string[];
    timeScales: string[];
    mprsSequences: MPRS[];
}

// ============================================================================
// Parser
// ============================================================================

class GrotParser {
    private static readonly MPRS_PATTERN = /^>\s*@MPRS:pid"(\d+)"\s*@MPRS:code"([^"]+)"\s*@MPRS:name"([^"]+)"/;
    private static readonly MPRS_COMPACT_PATTERN = /^>\s*@MPRS"(\d+)\s*\|\s*([^|]+)\s*\|\s*([^"]+)"/;
    private static readonly ROTATION_PATTERN = /^\s*(\d{1,4})\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(\d{1,4})/;
    private static readonly DISABLED_ROTATION_PATTERN = /^#\s*(\d{1,4})\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(\d{1,4})/;
    private static readonly ATTRIBUTE_PATTERN = /@([A-Z][A-Za-z0-9_:]*)"([^"]*)"/g;
    private static readonly HEADER_ATTRIBUTE_PATTERN = /^@([A-Z][A-Za-z0-9_:]+)"([^"]*)"/;
    private static readonly PP_PATTERN = /@PP"([^"]+)"/;

    static parse(document: vscode.TextDocument): GrotDocument {
        const result: GrotDocument = {
            header: new Map(),
            contributors: [],
            timeScales: [],
            mprsSequences: []
        };

        let currentMPRS: MPRS | null = null;
        let inHeader = true;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const trimmedLine = line.trim();

            // Skip empty lines
            if (!trimmedLine) continue;

            // Check for header attributes
            if (trimmedLine.startsWith('@') && inHeader) {
                const match = trimmedLine.match(this.HEADER_ATTRIBUTE_PATTERN);
                if (match) {
                    result.header.set(match[1], match[2]);
                    if (match[1].startsWith('DC:contributor')) {
                        result.contributors.push(match[2]);
                    } else if (match[1] === 'GEOTIMESCALE') {
                        result.timeScales.push(match[2]);
                    }
                }
                continue;
            }

            // Check for MPRS header
            if (trimmedLine.startsWith('>')) {
                inHeader = false;
                const mprsMatch = trimmedLine.match(this.MPRS_PATTERN) || 
                                  trimmedLine.match(this.MPRS_COMPACT_PATTERN);
                
                if (mprsMatch) {
                    if (currentMPRS) {
                        result.mprsSequences.push(currentMPRS);
                    }
                    
                    const metadata = this.parseAttributes(trimmedLine);
                    const ppMatch = trimmedLine.match(this.PP_PATTERN);
                    
                    currentMPRS = {
                        line: i,
                        plateId: parseInt(mprsMatch[1]),
                        code: mprsMatch[2].trim(),
                        name: mprsMatch[3].trim(),
                        platePair: ppMatch ? ppMatch[1] : '',
                        metadata: metadata,
                        rotations: []
                    };
                } else if (currentMPRS) {
                    // Additional MPRS header line with metadata
                    const additionalMetadata = this.parseAttributes(trimmedLine);
                    additionalMetadata.forEach((value, key) => {
                        currentMPRS!.metadata.set(key, value);
                    });
                    const ppMatch = trimmedLine.match(this.PP_PATTERN);
                    if (ppMatch) {
                        currentMPRS.platePair = ppMatch[1];
                    }
                }
                continue;
            }

            // Check for rotation line
            const rotationMatch = trimmedLine.match(this.ROTATION_PATTERN);
            if (rotationMatch && currentMPRS) {
                const rotation: Rotation = {
                    line: i,
                    plateId1: parseInt(rotationMatch[1]),
                    age: parseFloat(rotationMatch[2]),
                    latitude: parseFloat(rotationMatch[3]),
                    longitude: parseFloat(rotationMatch[4]),
                    angle: parseFloat(rotationMatch[5]),
                    plateId2: parseInt(rotationMatch[6]),
                    metadata: this.parseAttributes(trimmedLine),
                    disabled: false,
                    rawLine: line
                };
                currentMPRS.rotations.push(rotation);
                continue;
            }

            // Check for disabled rotation
            const disabledMatch = trimmedLine.match(this.DISABLED_ROTATION_PATTERN);
            if (disabledMatch && currentMPRS) {
                const rotation: Rotation = {
                    line: i,
                    plateId1: parseInt(disabledMatch[1]),
                    age: parseFloat(disabledMatch[2]),
                    latitude: parseFloat(disabledMatch[3]),
                    longitude: parseFloat(disabledMatch[4]),
                    angle: parseFloat(disabledMatch[5]),
                    plateId2: parseInt(disabledMatch[6]),
                    metadata: this.parseAttributes(trimmedLine),
                    disabled: true,
                    rawLine: line
                };
                currentMPRS.rotations.push(rotation);
            }
        }

        // Don't forget the last MPRS
        if (currentMPRS) {
            result.mprsSequences.push(currentMPRS);
        }

        return result;
    }

    private static parseAttributes(line: string): Map<string, string> {
        const attributes = new Map<string, string>();
        let match;
        const pattern = new RegExp(this.ATTRIBUTE_PATTERN);
        while ((match = pattern.exec(line)) !== null) {
            attributes.set(match[1], match[2]);
        }
        return attributes;
    }
}

// ============================================================================
// Tree View Provider
// ============================================================================

class GrotTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly lineNumber?: number,
        public readonly contextValue?: string
    ) {
        super(label, collapsibleState);
        if (lineNumber !== undefined) {
            this.command = {
                command: 'grot.goToLine',
                title: 'Go to Line',
                arguments: [lineNumber]
            };
        }
    }
}

class GrotTreeDataProvider implements vscode.TreeDataProvider<GrotTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GrotTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private document: GrotDocument | null = null;

    refresh(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'grot') {
            this.document = GrotParser.parse(editor.document);
        } else {
            this.document = null;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GrotTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: GrotTreeItem): Thenable<GrotTreeItem[]> {
        if (!this.document) {
            return Promise.resolve([]);
        }

        if (!element) {
            // Root level: show Header and MPRS sequences
            const items: GrotTreeItem[] = [];

            // Header section
            if (this.document.header.size > 0) {
                const headerItem = new GrotTreeItem(
                    '📄 Header',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    0,
                    'header'
                );
                headerItem.iconPath = new vscode.ThemeIcon('file-text');
                items.push(headerItem);
            }

            // MPRS sequences
            for (const mprs of this.document.mprsSequences) {
                const mprsItem = new GrotTreeItem(
                    `🌍 ${mprs.code} (${mprs.plateId}) - ${mprs.name}`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    mprs.line,
                    'mprs'
                );
                mprsItem.description = `${mprs.rotations.length} rotations`;
                mprsItem.tooltip = `Plate ID: ${mprs.plateId}\nCode: ${mprs.code}\nName: ${mprs.name}\nPlate Pair: ${mprs.platePair}\nRotations: ${mprs.rotations.length}`;
                mprsItem.iconPath = new vscode.ThemeIcon('globe');
                items.push(mprsItem);
            }

            return Promise.resolve(items);
        }

        // Children of header
        if (element.contextValue === 'header') {
            const items: GrotTreeItem[] = [];
            this.document.header.forEach((value, key) => {
                const item = new GrotTreeItem(
                    `${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`,
                    vscode.TreeItemCollapsibleState.None
                );
                item.tooltip = `${key}: ${value}`;
                item.iconPath = new vscode.ThemeIcon('symbol-property');
                items.push(item);
            });
            return Promise.resolve(items);
        }

        // Children of MPRS
        if (element.contextValue === 'mprs' && element.lineNumber !== undefined) {
            const mprs = this.document.mprsSequences.find(m => m.line === element.lineNumber);
            if (mprs) {
                const showDisabled = vscode.workspace.getConfiguration('grot').get('treeView.showDisabled', true);
                const items: GrotTreeItem[] = [];
                
                for (const rotation of mprs.rotations) {
                    if (!showDisabled && rotation.disabled) continue;
                    
                    const status = rotation.disabled ? '⊘' : '●';
                    const label = `${status} ${rotation.age.toFixed(2)} Ma`;
                    const item = new GrotTreeItem(
                        label,
                        vscode.TreeItemCollapsibleState.None,
                        rotation.line,
                        'rotation'
                    );
                    item.description = `(${rotation.latitude.toFixed(2)}, ${rotation.longitude.toFixed(2)}) ${rotation.angle.toFixed(2)}°`;
                    item.tooltip = `Age: ${rotation.age} Ma\nPole: (${rotation.latitude}, ${rotation.longitude})\nAngle: ${rotation.angle}°\nFixed Plate: ${rotation.plateId2}${rotation.disabled ? '\n[DISABLED]' : ''}`;
                    item.iconPath = new vscode.ThemeIcon(rotation.disabled ? 'circle-slash' : 'circle-filled');
                    items.push(item);
                }
                return Promise.resolve(items);
            }
        }

        return Promise.resolve([]);
    }
}

// ============================================================================
// Hover Provider
// ============================================================================

class GrotHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;
        
        // Check if it's a rotation line
        const rotationMatch = line.match(/^\s*#?\s*(\d{1,4})\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(\d{1,4})/);
        if (rotationMatch) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`### Rotation Parameters\n\n`);
            markdown.appendMarkdown(`| Parameter | Value |\n`);
            markdown.appendMarkdown(`|-----------|-------|\n`);
            markdown.appendMarkdown(`| **Moving Plate ID** | ${rotationMatch[1]} |\n`);
            markdown.appendMarkdown(`| **Age** | ${rotationMatch[2]} Ma |\n`);
            markdown.appendMarkdown(`| **Pole Latitude** | ${rotationMatch[3]}° |\n`);
            markdown.appendMarkdown(`| **Pole Longitude** | ${rotationMatch[4]}° |\n`);
            markdown.appendMarkdown(`| **Rotation Angle** | ${rotationMatch[5]}° |\n`);
            markdown.appendMarkdown(`| **Fixed Plate ID** | ${rotationMatch[6]} |\n`);
            
            // Check for attributes
            const attributes = this.extractAttributes(line);
            if (attributes.size > 0) {
                markdown.appendMarkdown(`\n### Metadata\n\n`);
                attributes.forEach((value, key) => {
                    markdown.appendMarkdown(`- **${key}**: ${value}\n`);
                });
            }
            
            if (line.trim().startsWith('#')) {
                markdown.appendMarkdown(`\n⚠️ *This rotation is disabled*`);
            }
            
            return new vscode.Hover(markdown);
        }
        
        // Check for MPRS header
        if (line.trim().startsWith('>')) {
            const pidMatch = line.match(/@MPRS:pid"(\d+)"/);
            const codeMatch = line.match(/@MPRS:code"([^"]+)"/);
            const nameMatch = line.match(/@MPRS:name"([^"]+)"/);
            
            if (pidMatch || codeMatch || nameMatch) {
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`### Moving Plate Rotation Sequence\n\n`);
                if (pidMatch) markdown.appendMarkdown(`- **Plate ID**: ${pidMatch[1]}\n`);
                if (codeMatch) markdown.appendMarkdown(`- **Code**: ${codeMatch[1]}\n`);
                if (nameMatch) markdown.appendMarkdown(`- **Name**: ${nameMatch[1]}\n`);
                
                const attributes = this.extractAttributes(line);
                if (attributes.size > 0) {
                    markdown.appendMarkdown(`\n### Additional Metadata\n\n`);
                    attributes.forEach((value, key) => {
                        if (!key.startsWith('MPRS:')) {
                            markdown.appendMarkdown(`- **${key}**: ${value}\n`);
                        }
                    });
                }
                
                return new vscode.Hover(markdown);
            }
        }
        
        // Check for header attribute
        const headerMatch = line.match(/^@([A-Z][A-Za-z0-9_:]+)"([^"]*)"/);
        if (headerMatch) {
            const attrDescriptions: { [key: string]: string } = {
                'GPLATESROTATIONFILE:version': 'GPlates rotation file format version',
                'DC:namespace': 'Dublin Core namespace URI',
                'DC:title': 'Document title',
                'DC:creator:name': 'Name of the file creator',
                'DC:creator:email': 'Email of the file creator',
                'DC:rights:license': 'License for the data',
                'DC:date:created': 'File creation date',
                'DC:date:modified': 'Last modification date',
                'DC:coverage:temporal': 'Temporal coverage of the data',
                'DC:description': 'Description of the rotation model',
                'DC:contributor': 'Contributor information',
                'GEOTIMESCALE': 'Geological time scale reference',
                'BIBINFO:bibfile': 'Path to bibliography file',
                'GPML:namespace': 'GPlates Markup Language namespace'
            };
            
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`### @${headerMatch[1]}\n\n`);
            
            const description = attrDescriptions[headerMatch[1]];
            if (description) {
                markdown.appendMarkdown(`*${description}*\n\n`);
            }
            
            markdown.appendMarkdown(`**Value**: ${headerMatch[2]}`);
            return new vscode.Hover(markdown);
        }
        
        return null;
    }
    
    private extractAttributes(line: string): Map<string, string> {
        const attributes = new Map<string, string>();
        const pattern = /@([A-Z][A-Za-z0-9_:]*)"([^"]*)"/g;
        let match;
        while ((match = pattern.exec(line)) !== null) {
            attributes.set(match[1], match[2]);
        }
        return attributes;
    }
}

// ============================================================================
// Completion Provider
// ============================================================================

class GrotCompletionProvider implements vscode.CompletionItemProvider {
    private static readonly ATTRIBUTES = [
        { name: '@C', description: 'Free-form comment', snippet: '@C"${1:comment}"' },
        { name: '@REF', description: 'Citation key for bibliographic reference', snippet: '@REF"${1:reference}"' },
        { name: '@DOI', description: 'Digital Object Identifier', snippet: '@DOI"${1:10.xxxx/xxxxx}"' },
        { name: '@AU', description: 'Author ID', snippet: '@AU"${1:author_id}"' },
        { name: '@PP', description: 'Plate pair (e.g., SAM-AFR)', snippet: '@PP"${1:MOV}-${2:FIX}"' },
        { name: '@GTS', description: 'Geological time scale ID', snippet: '@GTS"${1:timescale_id}"' },
        { name: '@CHRONID', description: 'Magnetic anomaly chron ID', snippet: '@CHRONID"${1:C}${2:number}"' },
        { name: '@T', description: 'Modification timestamp', snippet: '@T"${1:$CURRENT_YEAR}-${2:$CURRENT_MONTH}-${3:$CURRENT_DATE}"' },
        { name: '@ABSAGE', description: 'Absolute age flag', snippet: '@ABSAGE' },
        { name: '@MPRS:pid', description: 'Moving plate ID', snippet: '@MPRS:pid"${1:id}"' },
        { name: '@MPRS:code', description: 'Moving plate code', snippet: '@MPRS:code"${1:CODE}"' },
        { name: '@MPRS:name', description: 'Moving plate name', snippet: '@MPRS:name"${1:Plate Name}"' }
    ];

    private static readonly HEADER_ATTRIBUTES = [
        { name: '@GPLATESROTATIONFILE:version', description: 'File format version', snippet: '@GPLATESROTATIONFILE:version"1.0"' },
        { name: '@DC:namespace', description: 'Dublin Core namespace', snippet: '@DC:namespace"http://purl.org/dc/elements/1.1/"' },
        { name: '@DC:title', description: 'Document title', snippet: '@DC:title"${1:GPlates rotation file}"' },
        { name: '@DC:creator:name', description: 'Creator name', snippet: '@DC:creator:name"${1:Your Name}"' },
        { name: '@DC:creator:email', description: 'Creator email', snippet: '@DC:creator:email"${1:email@example.com}"' },
        { name: '@DC:rights:license', description: 'License', snippet: '@DC:rights:license"${1:CC BY-NC-SA 4.0}"' },
        { name: '@DC:date:created', description: 'Creation date', snippet: '@DC:date:created"${1:$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE}"' },
        { name: '@DC:coverage:temporal', description: 'Temporal coverage', snippet: '@DC:coverage:temporal"${1:0}-${2:600} Ma"' },
        { name: '@DC:description', description: 'Description', snippet: '@DC:description"""${1:Description of the rotation model}"""' },
        { name: '@DC:contributor', description: 'Contributor', snippet: '@DC:contributor"${1:ID} | ${2:Name} | ${3:email@example.com} | ${4:URL} | ${5:Institution}"' },
        { name: '@GEOTIMESCALE', description: 'Time scale definition', snippet: '@GEOTIMESCALE"${1:ID} | ${2:DOI} | ${3:CiteKey} | ${4:Description}"' },
        { name: '@GPML:namespace', description: 'GPML namespace', snippet: '@GPML:namespace"http://www.earthbyte.org/Resources/GPGIM/public/"' }
    ];

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const items: vscode.CompletionItem[] = [];

        // Check if we're in the header (before any MPRS)
        let inHeader = true;
        for (let i = 0; i < position.line; i++) {
            if (document.lineAt(i).text.trim().startsWith('>')) {
                inHeader = false;
                break;
            }
        }

        // Suggest @ if starting a new attribute
        if (linePrefix.endsWith('@') || linePrefix.match(/\s@$/)) {
            const attributes = inHeader ? GrotCompletionProvider.HEADER_ATTRIBUTES : GrotCompletionProvider.ATTRIBUTES;
            
            for (const attr of attributes) {
                const item = new vscode.CompletionItem(attr.name, vscode.CompletionItemKind.Property);
                item.detail = attr.description;
                item.insertText = new vscode.SnippetString(attr.snippet.substring(1)); // Remove leading @
                items.push(item);
            }
        }

        // Suggest MPRS template
        if (linePrefix.trim() === '>' || linePrefix.trim() === '') {
            const mprsItem = new vscode.CompletionItem('New MPRS Header', vscode.CompletionItemKind.Snippet);
            mprsItem.detail = 'Insert a new Moving Plate Rotation Sequence header';
            mprsItem.insertText = new vscode.SnippetString(
                '> @MPRS:pid"${1:plateId}" @MPRS:code"${2:CODE}" @MPRS:name"${3:Plate Name}"\n' +
                '> @PP"${2:CODE}-${4:FIX}" @C"${5:comment}"'
            );
            items.push(mprsItem);

            // Rotation line template
            const rotItem = new vscode.CompletionItem('New Rotation', vscode.CompletionItemKind.Snippet);
            rotItem.detail = 'Insert a new rotation line';
            rotItem.insertText = new vscode.SnippetString(
                '${1:001}  ${2:0.0000}    ${3:0.0000}   ${4:0.0000}    ${5:0.0000}    ${6:000}   @C"${7:comment}"'
            );
            items.push(rotItem);
        }

        return items;
    }
}

// ============================================================================
// Document Symbol Provider (Outline)
// ============================================================================

class GrotDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const grotDoc = GrotParser.parse(document);
        const symbols: vscode.DocumentSymbol[] = [];

        // Header section
        if (grotDoc.header.size > 0) {
            const headerRange = new vscode.Range(0, 0, 0, 0);
            const headerSymbol = new vscode.DocumentSymbol(
                'Header',
                'File metadata',
                vscode.SymbolKind.Namespace,
                headerRange,
                headerRange
            );
            symbols.push(headerSymbol);
        }

        // MPRS sequences
        for (const mprs of grotDoc.mprsSequences) {
            const startLine = mprs.line;
            const endLine = mprs.rotations.length > 0 
                ? mprs.rotations[mprs.rotations.length - 1].line 
                : mprs.line;
            
            const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
            const selectionRange = new vscode.Range(startLine, 0, startLine, document.lineAt(startLine).text.length);
            
            const mprsSymbol = new vscode.DocumentSymbol(
                `${mprs.code} (${mprs.plateId})`,
                mprs.name,
                vscode.SymbolKind.Class,
                range,
                selectionRange
            );

            // Add rotations as children
            for (const rotation of mprs.rotations) {
                const rotRange = new vscode.Range(rotation.line, 0, rotation.line, document.lineAt(rotation.line).text.length);
                const rotSymbol = new vscode.DocumentSymbol(
                    `${rotation.age} Ma`,
                    `(${rotation.latitude}, ${rotation.longitude}) ${rotation.angle}°`,
                    rotation.disabled ? vscode.SymbolKind.Null : vscode.SymbolKind.Field,
                    rotRange,
                    rotRange
                );
                mprsSymbol.children.push(rotSymbol);
            }

            symbols.push(mprsSymbol);
        }

        return symbols;
    }
}

// ============================================================================
// Diagnostics Provider
// ============================================================================

class GrotDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('grot');
    }

    updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'grot') {
            return;
        }

        const config = vscode.workspace.getConfiguration('grot');
        if (!config.get('validation.enabled', true)) {
            this.diagnosticCollection.clear();
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const grotDoc = GrotParser.parse(document);

        // Check for required header attributes
        const requiredHeaders = ['GPLATESROTATIONFILE:version'];
        for (const required of requiredHeaders) {
            if (!grotDoc.header.has(required)) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1),
                    `Missing required header attribute: @${required}`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        // Validate MPRS sequences
        for (const mprs of grotDoc.mprsSequences) {
            // Check for consistent plate IDs
            if (config.get('validation.checkPlateIds', true)) {
                for (const rotation of mprs.rotations) {
                    if (rotation.plateId1 !== mprs.plateId) {
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(rotation.line, 0, rotation.line, 5),
                            `Plate ID ${rotation.plateId1} doesn't match MPRS plate ID ${mprs.plateId}`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }

            // Check age sequence
            if (config.get('validation.checkAgeSequence', true)) {
                let prevAge = -Infinity;
                for (const rotation of mprs.rotations) {
                    if (rotation.disabled) continue;
                    if (rotation.age < prevAge) {
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(rotation.line, 0, rotation.line, document.lineAt(rotation.line).text.length),
                            `Age ${rotation.age} Ma is out of sequence (previous: ${prevAge} Ma)`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                    prevAge = rotation.age;
                }
            }

            // Check for missing 0 Ma rotation
            const hasZeroAge = mprs.rotations.some(r => !r.disabled && r.age === 0);
            if (!hasZeroAge && mprs.rotations.length > 0) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(mprs.line, 0, mprs.line, document.lineAt(mprs.line).text.length),
                    `MPRS ${mprs.code} is missing a 0 Ma (present-day) rotation`,
                    vscode.DiagnosticSeverity.Hint
                ));
            }

            // Check for duplicate ages
            const ages = new Map<number, number[]>();
            for (const rotation of mprs.rotations) {
                if (rotation.disabled) continue;
                if (!ages.has(rotation.age)) {
                    ages.set(rotation.age, []);
                }
                ages.get(rotation.age)!.push(rotation.line);
            }
            ages.forEach((lines, age) => {
                if (lines.length > 1) {
                    for (const line of lines) {
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(line, 0, line, document.lineAt(line).text.length),
                            `Duplicate age ${age} Ma in MPRS ${mprs.code}`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            });
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

// ============================================================================
// Formatting Provider
// ============================================================================

class GrotFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.ProviderResult<vscode.TextEdit[]> {
        const edits: vscode.TextEdit[] = [];
        const config = vscode.workspace.getConfiguration('grot');
        const alignColumns = config.get('formatting.alignColumns', true);
        const decimalPlaces = config.get('formatting.decimalPlaces', 4);

        const rotationPattern = /^(\s*)(#?\s*)(\d{1,4})\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(\d{1,4})(.*)$/;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const match = line.text.match(rotationPattern);
            
            if (match && alignColumns) {
                const [, indent, prefix, pid1, age, lat, lon, angle, pid2, rest] = match;
                
                const formattedAge = parseFloat(age).toFixed(decimalPlaces).padStart(10);
                const formattedLat = parseFloat(lat).toFixed(decimalPlaces).padStart(10);
                const formattedLon = parseFloat(lon).toFixed(decimalPlaces).padStart(10);
                const formattedAngle = parseFloat(angle).toFixed(decimalPlaces).padStart(10);
                
                const newLine = `${prefix}${pid1.padStart(3)}  ${formattedAge}  ${formattedLat}  ${formattedLon}  ${formattedAngle}  ${pid2.padStart(3)}${rest ? '  ' + rest.trim() : ''}`;
                
                if (newLine !== line.text) {
                    edits.push(vscode.TextEdit.replace(line.range, newLine));
                }
            }
        }

        return edits;
    }
}

// ============================================================================
// Commands
// ============================================================================

async function showStatistics(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        vscode.window.showErrorMessage('No .grot file is open');
        return;
    }

    const grotDoc = GrotParser.parse(editor.document);
    
    let totalRotations = 0;
    let disabledRotations = 0;
    let minAge = Infinity;
    let maxAge = -Infinity;
    
    for (const mprs of grotDoc.mprsSequences) {
        totalRotations += mprs.rotations.length;
        for (const rot of mprs.rotations) {
            if (rot.disabled) disabledRotations++;
            if (!rot.disabled) {
                minAge = Math.min(minAge, rot.age);
                maxAge = Math.max(maxAge, rot.age);
            }
        }
    }

    const panel = vscode.window.createWebviewPanel(
        'grotStatistics',
        'GROT File Statistics',
        vscode.ViewColumn.Beside,
        {}
    );

    panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        h1 { color: var(--vscode-foreground); }
        .stat { margin: 10px 0; padding: 10px; background: var(--vscode-editor-background); border-radius: 5px; }
        .stat-label { font-weight: bold; color: var(--vscode-textLink-foreground); }
        .stat-value { font-size: 1.5em; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; }
        th { background: var(--vscode-editor-selectionBackground); }
    </style>
</head>
<body>
    <h1>📊 GROT File Statistics</h1>
    
    <div class="stat">
        <span class="stat-label">Total MPRS Sequences:</span>
        <span class="stat-value">${grotDoc.mprsSequences.length}</span>
    </div>
    
    <div class="stat">
        <span class="stat-label">Total Rotations:</span>
        <span class="stat-value">${totalRotations}</span>
        <span>(${disabledRotations} disabled)</span>
    </div>
    
    <div class="stat">
        <span class="stat-label">Time Range:</span>
        <span class="stat-value">${minAge === Infinity ? 'N/A' : minAge} - ${maxAge === -Infinity ? 'N/A' : maxAge} Ma</span>
    </div>
    
    <h2>MPRS Summary</h2>
    <table>
        <tr>
            <th>Plate ID</th>
            <th>Code</th>
            <th>Name</th>
            <th>Rotations</th>
            <th>Age Range</th>
        </tr>
        ${grotDoc.mprsSequences.map(mprs => {
            const ages = mprs.rotations.filter(r => !r.disabled).map(r => r.age);
            const ageRange = ages.length > 0 ? `${Math.min(...ages)} - ${Math.max(...ages)}` : 'N/A';
            return `<tr>
                <td>${mprs.plateId}</td>
                <td>${mprs.code}</td>
                <td>${mprs.name}</td>
                <td>${mprs.rotations.length}</td>
                <td>${ageRange} Ma</td>
            </tr>`;
        }).join('')}
    </table>
</body>
</html>`;
}

async function goToMPRS(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        return;
    }

    const grotDoc = GrotParser.parse(editor.document);
    
    const items = grotDoc.mprsSequences.map(mprs => ({
        label: `${mprs.code} (${mprs.plateId})`,
        description: mprs.name,
        detail: `${mprs.rotations.length} rotations`,
        line: mprs.line
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select MPRS to navigate to...'
    });

    if (selected) {
        const position = new vscode.Position(selected.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
}

async function toggleRotation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        return;
    }

    const line = editor.document.lineAt(editor.selection.active.line);
    const text = line.text;

    // Check if it's a rotation line
    const rotationPattern = /^(\s*)(#?)(\s*)(\d{1,4}\s+.*)$/;
    const match = text.match(rotationPattern);

    if (match) {
        const [, indent, hash, space, rotation] = match;
        let newText: string;
        
        if (hash) {
            // Enable: remove #
            newText = `${indent}${rotation}`;
        } else {
            // Disable: add #
            newText = `${indent}#${rotation}`;
        }

        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, newText);
        });
    }
}

async function addRotation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        return;
    }

    // Find current MPRS context
    const currentLine = editor.selection.active.line;
    let plateId = '001';
    let fixedPlateId = '000';
    
    for (let i = currentLine; i >= 0; i--) {
        const line = editor.document.lineAt(i).text;
        const mprsMatch = line.match(/@MPRS:pid"(\d+)"/);
        if (mprsMatch) {
            plateId = mprsMatch[1].padStart(3, '0');
            break;
        }
        const rotMatch = line.match(/^\s*(\d{1,4})\s+.*\s+(\d{1,4})/);
        if (rotMatch) {
            plateId = rotMatch[1].padStart(3, '0');
            fixedPlateId = rotMatch[2].padStart(3, '0');
        }
    }

    const age = await vscode.window.showInputBox({
        prompt: 'Enter age (Ma)',
        value: '0.0'
    });
    if (!age) return;

    const lat = await vscode.window.showInputBox({
        prompt: 'Enter pole latitude',
        value: '0.0'
    });
    if (!lat) return;

    const lon = await vscode.window.showInputBox({
        prompt: 'Enter pole longitude',
        value: '0.0'
    });
    if (!lon) return;

    const angle = await vscode.window.showInputBox({
        prompt: 'Enter rotation angle',
        value: '0.0'
    });
    if (!angle) return;

    const comment = await vscode.window.showInputBox({
        prompt: 'Enter comment (optional)',
        value: ''
    });

    const rotationLine = `${plateId}  ${parseFloat(age).toFixed(4).padStart(10)}  ${parseFloat(lat).toFixed(4).padStart(10)}  ${parseFloat(lon).toFixed(4).padStart(10)}  ${parseFloat(angle).toFixed(4).padStart(10)}  ${fixedPlateId}${comment ? `  @C"${comment}"` : ''}`;

    await editor.edit(editBuilder => {
        const insertPosition = new vscode.Position(currentLine + 1, 0);
        editBuilder.insert(insertPosition, rotationLine + '\n');
    });
}

async function exportToCSV(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        return;
    }

    const grotDoc = GrotParser.parse(editor.document);
    
    const items = grotDoc.mprsSequences.map(mprs => ({
        label: `${mprs.code} (${mprs.plateId})`,
        description: mprs.name,
        mprs: mprs
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select MPRS to export...'
    });

    if (!selected) return;

    const csv = [
        'PlateID1,Age,Latitude,Longitude,Angle,PlateID2,Disabled,Comment,Reference'
    ];

    for (const rot of selected.mprs.rotations) {
        const comment = rot.metadata.get('C') || '';
        const ref = rot.metadata.get('REF') || '';
        csv.push(`${rot.plateId1},${rot.age},${rot.latitude},${rot.longitude},${rot.angle},${rot.plateId2},${rot.disabled},${comment.replace(/,/g, ';')},${ref.replace(/,/g, ';')}`);
    }

    const doc = await vscode.workspace.openTextDocument({
        content: csv.join('\n'),
        language: 'csv'
    });
    await vscode.window.showTextDocument(doc);
}

// ============================================================================
// Go to Plate ID - Quick Navigation
// ============================================================================

async function goToPlateId(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        vscode.window.showErrorMessage('No .grot file is open');
        return;
    }

    const grotDoc = GrotParser.parse(editor.document);
    
    // Build a map of plate IDs for quick lookup
    const plateIdMap = new Map<number, MPRS>();
    for (const mprs of grotDoc.mprsSequences) {
        plateIdMap.set(mprs.plateId, mprs);
    }

    const plateIdInput = await vscode.window.showInputBox({
        prompt: 'Enter Plate ID to navigate to',
        placeHolder: 'e.g., 101, 609, 801',
        validateInput: (value) => {
            if (!value) return 'Please enter a plate ID';
            const id = parseInt(value);
            if (isNaN(id)) return 'Please enter a valid number';
            if (!plateIdMap.has(id)) {
                // Show available plate IDs as hint
                const available = Array.from(plateIdMap.keys()).slice(0, 10).join(', ');
                return `Plate ID ${id} not found. Available: ${available}...`;
            }
            return null;
        }
    });

    if (!plateIdInput) return;

    const plateId = parseInt(plateIdInput);
    const mprs = plateIdMap.get(plateId);
    
    if (mprs) {
        const position = new vscode.Position(mprs.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        vscode.window.showInformationMessage(`Jumped to ${mprs.code} (${mprs.plateId}) - ${mprs.name}`);
    }
}

// ============================================================================
// MPRS Metadata Editor Panel
// ============================================================================

class MPRSEditorPanel {
    public static currentPanel: MPRSEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _mprs: MPRS;
    private _document: vscode.TextDocument;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, mprs: MPRS, document: vscode.TextDocument) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._mprs = mprs;
        this._document = document;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'save':
                        await this._saveMetadata(message.data);
                        break;
                    case 'goToLine':
                        this._goToLine(message.line);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, mprs: MPRS, document: vscode.TextDocument): void {
        const column = vscode.ViewColumn.Beside;

        if (MPRSEditorPanel.currentPanel) {
            MPRSEditorPanel.currentPanel._mprs = mprs;
            MPRSEditorPanel.currentPanel._document = document;
            MPRSEditorPanel.currentPanel._update();
            MPRSEditorPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mprsEditor',
            `Edit MPRS: ${mprs.code} (${mprs.plateId})`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        MPRSEditorPanel.currentPanel = new MPRSEditorPanel(panel, extensionUri, mprs, document);
    }

    private _goToLine(line: number): void {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === this._document);
        if (editor) {
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }

    private async _saveMetadata(data: { originalPlateId: string; newPlateId: string; code: string; name: string; platePair: string; comment: string }): Promise<void> {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === this._document);
        if (!editor) {
            vscode.window.showErrorMessage('Could not find the editor for this document');
            return;
        }

        const originalId = parseInt(data.originalPlateId);
        const newId = parseInt(data.newPlateId);
        const plateIdChanged = originalId !== newId;

        // Check if new plate ID is already taken (if changed)
        if (plateIdChanged) {
            const grotDoc = GrotParser.parse(this._document);
            const existingMprs = grotDoc.mprsSequences.find(m => m.plateId === newId);
            if (existingMprs) {
                vscode.window.showErrorMessage(`Plate ID ${newId} is already taken by MPRS: ${existingMprs.code} - ${existingMprs.name}`);
                return;
            }
        }

        // Find the MPRS header lines (could be 1 or 2+ lines starting with > or containing multi-line comment)
        const startLine = this._mprs.line;
        let endLine = startLine;
        
        // Check for additional header lines and multi-line comments
        for (let i = startLine + 1; i < this._document.lineCount; i++) {
            const lineText = this._document.lineAt(i).text.trim();
            // Stop if we hit a rotation line or another MPRS
            if (lineText.match(/^\d/) || (lineText.startsWith('>') && lineText.match(/@MPRS:pid/))) {
                break;
            }
            // Continue if it's a header continuation line or part of multi-line comment
            if (lineText.startsWith('>') || lineText.includes('"""') || (!lineText.startsWith('#') && !lineText.match(/^\d/))) {
                endLine = i;
                // If we find closing triple quotes, stop
                if (lineText.endsWith('"""') && i > startLine) {
                    break;
                }
            } else {
                break;
            }
        }

        // Build new header lines
        const newLine1 = `> @MPRS:pid"${data.newPlateId}" @MPRS:code"${data.code}" @MPRS:name"${data.name}"`;
        
        // Format comment: use triple quotes for multi-line, single quotes for single-line
        let commentStr = '';
        if (data.comment) {
            const trimmedComment = data.comment.trim();
            if (trimmedComment.includes('\n')) {
                commentStr = ` @C"""${trimmedComment}"""`;
            } else {
                commentStr = ` @C"${trimmedComment}"`;
            }
        }
        const newLine2 = `> @PP"${data.platePair}"${commentStr}`;

        const range = new vscode.Range(startLine, 0, endLine, this._document.lineAt(endLine).text.length);
        
        await editor.edit(editBuilder => {
            editBuilder.replace(range, `${newLine1}\n${newLine2}`);
        });

        // If plate ID changed, update all rotation lines in this MPRS
        if (plateIdChanged) {
            const newPlateIdPadded = data.newPlateId.padStart(3, '0');
            const oldPlateIdPattern = new RegExp(`^(\\s*)${originalId}(\\s+)`, 'gm');
            
            // Re-read document after first edit
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Find and update rotation lines
            const updatedDoc = editor.document;
            const edits: { line: number; oldText: string; newText: string }[] = [];
            
            for (const rotation of this._mprs.rotations) {
                const lineNum = rotation.line + (endLine - startLine - 1); // Adjust for header change
                if (lineNum < updatedDoc.lineCount) {
                    const lineText = updatedDoc.lineAt(rotation.line).text;
                    const newLineText = lineText.replace(/^(\s*)\d+/, `$1${newPlateIdPadded}`);
                    if (newLineText !== lineText) {
                        edits.push({ line: rotation.line, oldText: lineText, newText: newLineText });
                    }
                }
            }
            
            if (edits.length > 0) {
                await editor.edit(editBuilder => {
                    for (const edit of edits) {
                        const lineRange = updatedDoc.lineAt(edit.line).range;
                        editBuilder.replace(lineRange, edit.newText);
                    }
                });
            }
        }

        vscode.window.showInformationMessage(`Updated MPRS ${data.code} (${data.newPlateId})${plateIdChanged ? ` - Plate ID changed from ${originalId} to ${newId}` : ''}`);
        
        // Re-parse and update panel
        const grotDoc = GrotParser.parse(this._document);
        const updatedMprs = grotDoc.mprsSequences.find(m => m.plateId === newId);
        if (updatedMprs) {
            this._mprs = updatedMprs;
            this._update();
        }
    }

    private _update(): void {
        this._panel.title = `Edit MPRS: ${this._mprs.code} (${this._mprs.plateId})`;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getMultiLineComment(): string {
        // Extract comment from MPRS header, handling multi-line triple-quoted comments
        let comment = this._mprs.metadata.get('C') || '';
        
        // If we have a simple comment, return it
        if (comment) {
            return comment;
        }
        
        // Otherwise, try to extract multi-line comment from the document
        const startLine = this._mprs.line;
        let fullComment = '';
        let inMultiLineComment = false;
        
        for (let i = startLine; i < Math.min(startLine + 20, this._document.lineCount); i++) {
            const lineText = this._document.lineAt(i).text;
            
            // Check for start of triple-quoted comment
            const tripleQuoteStart = lineText.match(/@C"""(.*)$/);
            if (tripleQuoteStart && !inMultiLineComment) {
                inMultiLineComment = true;
                const content = tripleQuoteStart[1];
                // Check if it ends on the same line
                if (content.endsWith('"""')) {
                    return content.slice(0, -3);
                }
                fullComment = content;
                continue;
            }
            
            if (inMultiLineComment) {
                // Check for end of triple-quoted comment
                if (lineText.includes('"""')) {
                    const endIdx = lineText.indexOf('"""');
                    fullComment += '\n' + lineText.substring(0, endIdx);
                    return fullComment;
                }
                fullComment += '\n' + lineText;
            }
            
            // Stop if we hit a rotation line
            if (lineText.trim().match(/^\d/)) {
                break;
            }
        }
        
        return comment;
    }

    private _getHtmlForWebview(): string {
        const mprs = this._mprs;
        const comment = this._getMultiLineComment();
        
        // Get all existing plate IDs for validation
        const grotDoc = GrotParser.parse(this._document);
        const existingPlateIds = grotDoc.mprsSequences
            .filter(m => m.plateId !== mprs.plateId)
            .map(m => m.plateId);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit MPRS</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --accent: var(--vscode-textLink-foreground);
            --error: #f44336;
            --warning: #ff9800;
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background: var(--bg);
            color: var(--fg);
        }
        h1 {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 24px;
            font-size: 1.4em;
            border-bottom: 1px solid var(--input-border);
            padding-bottom: 12px;
        }
        h1 .icon { font-size: 1.5em; }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            color: var(--accent);
        }
        input, textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--input-border);
            background: var(--input-bg);
            color: var(--input-fg);
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
            box-sizing: border-box;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: var(--accent);
        }
        input.error {
            border-color: var(--error);
        }
        input:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }
        textarea {
            resize: vertical;
            min-height: 80px;
        }
        .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .row-3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
        }
        .actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--input-border);
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-primary {
            background: var(--button-bg);
            color: var(--button-fg);
        }
        .btn-primary:hover:not(:disabled) {
            background: var(--button-hover);
        }
        .btn-secondary {
            background: transparent;
            color: var(--fg);
            border: 1px solid var(--input-border);
        }
        .btn-secondary:hover {
            background: var(--input-bg);
        }
        .info-box {
            background: var(--input-bg);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .info-box h3 {
            margin: 0 0 8px 0;
            font-size: 0.9em;
            color: var(--accent);
        }
        .info-box .stat {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
        }
        .info-box .stat-value {
            font-weight: 600;
        }
        .hint {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .error-msg {
            font-size: 0.85em;
            color: var(--error);
            margin-top: 4px;
            display: none;
        }
        .error-msg.visible {
            display: block;
        }
        .warning-box {
            background: rgba(255, 152, 0, 0.1);
            border: 1px solid var(--warning);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 16px;
            display: none;
        }
        .warning-box.visible {
            display: block;
        }
        .section-title {
            font-size: 1em;
            font-weight: 600;
            margin: 20px 0 12px 0;
            color: var(--accent);
        }
    </style>
</head>
<body>
    <h1><span class="icon">🌍</span> Edit MPRS Metadata</h1>
    
    <div class="info-box">
        <h3>📊 Sequence Statistics</h3>
        <div class="stat">
            <span>Total Rotations:</span>
            <span class="stat-value">${mprs.rotations.length}</span>
        </div>
        <div class="stat">
            <span>Enabled:</span>
            <span class="stat-value">${mprs.rotations.filter(r => !r.disabled).length}</span>
        </div>
        <div class="stat">
            <span>Age Range:</span>
            <span class="stat-value">${mprs.rotations.length > 0 ? 
                `${Math.min(...mprs.rotations.filter(r => !r.disabled).map(r => r.age))} - ${Math.max(...mprs.rotations.filter(r => !r.disabled).map(r => r.age))} Ma` : 
                'N/A'}</span>
        </div>
        <div class="stat">
            <span>Line Number:</span>
            <span class="stat-value"><a href="#" onclick="goToLine(${mprs.line})">${mprs.line + 1}</a></span>
        </div>
    </div>

    <div class="warning-box" id="plateIdWarning">
        ⚠️ <strong>Warning:</strong> Changing the plate ID will also update all <span id="rotationCount">${mprs.rotations.length}</span> rotation lines in this MPRS.
    </div>

    <form id="mprsForm">
        <div class="section-title">Plate Identification</div>
        
        <div class="row-3">
            <div class="form-group">
                <label for="originalPlateId">Original Plate ID</label>
                <input type="number" id="originalPlateId" value="${mprs.plateId}" disabled>
                <div class="hint">Current ID (read-only)</div>
            </div>
            <div class="form-group">
                <label for="newPlateId">New Plate ID</label>
                <input type="number" id="newPlateId" value="${mprs.plateId}" required min="1">
                <div class="hint">Change to reassign ID</div>
                <div class="error-msg" id="plateIdError">This plate ID is already taken!</div>
            </div>
            <div class="form-group">
                <label for="code">Plate Code</label>
                <input type="text" id="code" value="${mprs.code}" required maxlength="10">
                <div class="hint">Short code (3-4 chars)</div>
            </div>
        </div>

        <div class="form-group">
            <label for="name">Plate Name</label>
            <input type="text" id="name" value="${mprs.name}" required>
            <div class="hint">Full name of the tectonic plate</div>
        </div>

        <div class="form-group">
            <label for="platePair">Plate Pair (@PP)</label>
            <input type="text" id="platePair" value="${mprs.platePair}" placeholder="MOV-FIX">
            <div class="hint">Moving plate - Fixed plate relationship (e.g., NAM-AFR)</div>
        </div>

        <div class="form-group">
            <label for="comment">Comment (@C)</label>
            <textarea id="comment" rows="4">${this._escapeHtml(comment)}</textarea>
            <div class="hint">Optional description or notes (multi-line supported)</div>
        </div>

        <div class="actions">
            <button type="submit" class="btn-primary" id="saveBtn">💾 Save Changes</button>
            <button type="button" class="btn-secondary" onclick="goToLine(${mprs.line})">📍 Go to Line</button>
        </div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();
        const existingPlateIds = [${existingPlateIds.join(',')}];
        const originalPlateId = ${mprs.plateId};
        
        const newPlateIdInput = document.getElementById('newPlateId');
        const plateIdError = document.getElementById('plateIdError');
        const plateIdWarning = document.getElementById('plateIdWarning');
        const saveBtn = document.getElementById('saveBtn');
        
        function validatePlateId() {
            const newId = parseInt(newPlateIdInput.value);
            const isDuplicate = existingPlateIds.includes(newId);
            const isChanged = newId !== originalPlateId;
            
            // Show/hide error
            if (isDuplicate) {
                newPlateIdInput.classList.add('error');
                plateIdError.classList.add('visible');
                saveBtn.disabled = true;
            } else {
                newPlateIdInput.classList.remove('error');
                plateIdError.classList.remove('visible');
                saveBtn.disabled = false;
            }
            
            // Show/hide warning about rotation updates
            if (isChanged && !isDuplicate) {
                plateIdWarning.classList.add('visible');
            } else {
                plateIdWarning.classList.remove('visible');
            }
        }
        
        newPlateIdInput.addEventListener('input', validatePlateId);
        
        document.getElementById('mprsForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const newId = parseInt(newPlateIdInput.value);
            if (existingPlateIds.includes(newId)) {
                return; // Don't submit if duplicate
            }
            
            vscode.postMessage({
                command: 'save',
                data: {
                    originalPlateId: document.getElementById('originalPlateId').value,
                    newPlateId: document.getElementById('newPlateId').value,
                    code: document.getElementById('code').value,
                    name: document.getElementById('name').value,
                    platePair: document.getElementById('platePair').value,
                    comment: document.getElementById('comment').value
                }
            });
        });

        function goToLine(line) {
            vscode.postMessage({
                command: 'goToLine',
                line: line
            });
        }
        
        // Initial validation
        validatePlateId();
    </script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    public dispose(): void {
        MPRSEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

async function editMPRSMetadata(context: vscode.ExtensionContext, mprsLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'grot') {
        vscode.window.showErrorMessage('No .grot file is open');
        return;
    }

    const grotDoc = GrotParser.parse(editor.document);
    
    let targetMprs: MPRS | undefined;
    
    if (mprsLine !== undefined) {
        // Called from tree view with specific line
        targetMprs = grotDoc.mprsSequences.find(m => m.line === mprsLine);
    } else {
        // Called from command palette - show picker
        const items = grotDoc.mprsSequences.map(mprs => ({
            label: `${mprs.code} (${mprs.plateId})`,
            description: mprs.name,
            detail: `${mprs.rotations.length} rotations | Line ${mprs.line + 1}`,
            mprs: mprs
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select MPRS to edit...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            targetMprs = selected.mprs;
        }
    }

    if (targetMprs) {
        MPRSEditorPanel.createOrShow(context.extensionUri, targetMprs, editor.document);
    }
}

// ============================================================================
// Add New MPRS Panel
// ============================================================================

class AddMPRSPanel {
    public static currentPanel: AddMPRSPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _document: vscode.TextDocument;
    private _disposables: vscode.Disposable[] = [];
    private _treeDataProvider: GrotTreeDataProvider;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, document: vscode.TextDocument, treeDataProvider: GrotTreeDataProvider) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._document = document;
        this._treeDataProvider = treeDataProvider;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'create':
                        await this._createMPRS(message.data);
                        break;
                    case 'cancel':
                        this._panel.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument, treeDataProvider: GrotTreeDataProvider): void {
        const column = vscode.ViewColumn.Beside;

        if (AddMPRSPanel.currentPanel) {
            AddMPRSPanel.currentPanel._document = document;
            AddMPRSPanel.currentPanel._update();
            AddMPRSPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'addMPRS',
            'Add New MPRS',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        AddMPRSPanel.currentPanel = new AddMPRSPanel(panel, extensionUri, document, treeDataProvider);
    }

    private async _createMPRS(data: { 
        plateId: string; 
        code: string; 
        name: string; 
        platePair: string; 
        comment: string;
        fixedPlateId: string;
        insertPosition: string;
    }): Promise<void> {
        const editor = vscode.window.visibleTextEditors.find(e => e.document === this._document);
        if (!editor) {
            vscode.window.showErrorMessage('Could not find the editor for this document');
            return;
        }

        // Parse the document to find existing MPRS sequences
        const grotDoc = GrotParser.parse(this._document);
        
        // Build the new MPRS content
        const plateIdPadded = data.plateId.padStart(3, '0');
        const fixedPlateIdPadded = data.fixedPlateId.padStart(3, '0');
        
        // Format comment: use triple quotes for multi-line, single quotes for single-line
        let commentStr = '';
        if (data.comment) {
            const trimmedComment = data.comment.trim();
            if (trimmedComment.includes('\n')) {
                commentStr = ` @C"""${trimmedComment}"""`;
            } else {
                commentStr = ` @C"${trimmedComment}"`;
            }
        }
        
        const newMPRSContent = [
            `> @MPRS:pid"${data.plateId}" @MPRS:code"${data.code}" @MPRS:name"${data.name}"`,
            `> @PP"${data.platePair}"${commentStr}`,
            `${plateIdPadded}  0.0000    90.0000   0.0000    0.0000    ${fixedPlateIdPadded}   @C"Present day"`
        ].join('\n');

        // Determine insert position
        let insertLine: number;
        const newPlateId = parseInt(data.plateId);
        
        if (data.insertPosition === 'sorted') {
            // Find the correct position based on plate ID (sorted order)
            insertLine = this._findSortedInsertPosition(grotDoc, newPlateId);
        } else if (data.insertPosition === 'end') {
            // Insert at end of file
            insertLine = this._document.lineCount;
        } else {
            // Insert after specific MPRS (value is the plate ID to insert after)
            const afterPlateId = parseInt(data.insertPosition);
            const afterMprs = grotDoc.mprsSequences.find(m => m.plateId === afterPlateId);
            if (afterMprs) {
                // Insert after the last rotation of this MPRS
                const lastRotation = afterMprs.rotations[afterMprs.rotations.length - 1];
                insertLine = lastRotation ? lastRotation.line + 1 : afterMprs.line + 2;
            } else {
                insertLine = this._document.lineCount;
            }
        }

        await editor.edit(editBuilder => {
            const insertPosition = new vscode.Position(insertLine, 0);
            editBuilder.insert(insertPosition, newMPRSContent + '\n');
        });

        vscode.window.showInformationMessage(`Created new MPRS: ${data.code} (${data.plateId}) - ${data.name}`);
        
        // Refresh tree view
        this._treeDataProvider.refresh();
        
        // Navigate to the new MPRS
        const newPosition = new vscode.Position(insertLine, 0);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
        
        // Close the panel
        this._panel.dispose();
    }

    private _findSortedInsertPosition(grotDoc: GrotDocument, newPlateId: number): number {
        // Find where to insert based on sorted plate ID order
        for (const mprs of grotDoc.mprsSequences) {
            if (mprs.plateId > newPlateId) {
                return mprs.line;
            }
        }
        // Insert at end if no larger plate ID found
        if (grotDoc.mprsSequences.length > 0) {
            const lastMprs = grotDoc.mprsSequences[grotDoc.mprsSequences.length - 1];
            const lastRotation = lastMprs.rotations[lastMprs.rotations.length - 1];
            return lastRotation ? lastRotation.line + 1 : lastMprs.line + 2;
        }
        return this._document.lineCount;
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        // Parse document to get existing MPRS for the dropdown
        const grotDoc = GrotParser.parse(this._document);
        const existingMPRS = grotDoc.mprsSequences;
        
        // Find suggested next plate ID
        const existingIds = existingMPRS.map(m => m.plateId);
        const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
        const suggestedId = maxId + 1;
        
        // Build insert position options
        const insertOptions = existingMPRS.map(mprs => 
            `<option value="${mprs.plateId}">After ${mprs.code} (${mprs.plateId})</option>`
        ).join('\n');
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Add New MPRS</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --accent: var(--vscode-textLink-foreground);
            --success: #4caf50;
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            background: var(--bg);
            color: var(--fg);
        }
        h1 {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 24px;
            font-size: 1.4em;
            border-bottom: 1px solid var(--input-border);
            padding-bottom: 12px;
        }
        h1 .icon { font-size: 1.5em; }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            color: var(--accent);
        }
        input, textarea, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--input-border);
            background: var(--input-bg);
            color: var(--input-fg);
            border-radius: 4px;
            font-family: inherit;
            font-size: 14px;
            box-sizing: border-box;
        }
        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: var(--accent);
        }
        textarea {
            resize: vertical;
            min-height: 60px;
        }
        .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .row-3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
        }
        .actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--input-border);
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s;
        }
        .btn-primary {
            background: var(--success);
            color: white;
        }
        .btn-primary:hover {
            background: #45a049;
        }
        .btn-secondary {
            background: transparent;
            color: var(--fg);
            border: 1px solid var(--input-border);
        }
        .btn-secondary:hover {
            background: var(--input-bg);
        }
        .hint {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .info-box {
            background: var(--input-bg);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .info-box p {
            margin: 0;
            font-size: 0.9em;
        }
        .section-title {
            font-size: 1em;
            font-weight: 600;
            margin: 20px 0 12px 0;
            color: var(--accent);
        }
        .preview {
            background: var(--input-bg);
            border-radius: 6px;
            padding: 12px;
            font-family: monospace;
            font-size: 12px;
            white-space: pre;
            overflow-x: auto;
            margin-top: 16px;
            border: 1px solid var(--input-border);
        }
    </style>
</head>
<body>
    <h1><span class="icon">➕</span> Add New MPRS</h1>
    
    <div class="info-box">
        <p>Create a new Moving Plate Rotation Sequence. A default 0 Ma (present-day) rotation will be added automatically.</p>
    </div>

    <form id="mprsForm">
        <div class="section-title">Basic Information</div>
        
        <div class="row-3">
            <div class="form-group">
                <label for="plateId">Plate ID *</label>
                <input type="number" id="plateId" value="${suggestedId}" required min="1">
                <div class="hint">Unique numeric ID</div>
            </div>
            <div class="form-group">
                <label for="code">Plate Code *</label>
                <input type="text" id="code" required maxlength="10" placeholder="e.g., NAM">
                <div class="hint">Short code (3-4 chars)</div>
            </div>
            <div class="form-group">
                <label for="fixedPlateId">Fixed Plate ID *</label>
                <input type="number" id="fixedPlateId" value="0" required min="0">
                <div class="hint">Reference plate (0 = absolute)</div>
            </div>
        </div>

        <div class="form-group">
            <label for="name">Plate Name *</label>
            <input type="text" id="name" required placeholder="e.g., North America">
            <div class="hint">Full descriptive name of the tectonic plate</div>
        </div>

        <div class="row">
            <div class="form-group">
                <label for="platePair">Plate Pair (@PP)</label>
                <input type="text" id="platePair" placeholder="e.g., NAM-AFR">
                <div class="hint">Moving-Fixed plate code pair</div>
            </div>
            <div class="form-group">
                <label for="insertPosition">Insert Position</label>
                <select id="insertPosition">
                    <option value="sorted">Auto (sorted by Plate ID)</option>
                    <option value="end">End of file</option>
                    ${insertOptions}
                </select>
                <div class="hint">Where to insert in the file</div>
            </div>
        </div>

        <div class="form-group">
            <label for="comment">Comment (@C)</label>
            <textarea id="comment" rows="2" placeholder="Optional description or notes"></textarea>
        </div>

        <div class="section-title">Preview</div>
        <div class="preview" id="preview"></div>

        <div class="actions">
            <button type="submit" class="btn-primary">✨ Create MPRS</button>
            <button type="button" class="btn-secondary" onclick="cancel()">Cancel</button>
        </div>
    </form>

    <script>
        const vscode = acquireVsCodeApi();
        
        function updatePreview() {
            const plateId = document.getElementById('plateId').value.padStart(3, '0');
            const code = document.getElementById('code').value || 'CODE';
            const name = document.getElementById('name').value || 'Plate Name';
            const platePair = document.getElementById('platePair').value || (code + '-FIX');
            const comment = document.getElementById('comment').value;
            const fixedPlateId = document.getElementById('fixedPlateId').value.padStart(3, '0');
            
            let preview = '> @MPRS:pid"' + document.getElementById('plateId').value + '" @MPRS:code"' + code + '" @MPRS:name"' + name + '"\\n';
            preview += '> @PP"' + platePair + '"' + (comment ? ' @C"' + comment + '"' : '') + '\\n';
            preview += plateId + '  0.0000    90.0000   0.0000    0.0000    ' + fixedPlateId + '   @C"Present day"';
            
            document.getElementById('preview').textContent = preview.replace(/\\\\n/g, '\\n');
        }
        
        // Auto-update plate pair when code changes
        document.getElementById('code').addEventListener('input', function() {
            const platePairInput = document.getElementById('platePair');
            if (!platePairInput.value || platePairInput.dataset.autoFilled === 'true') {
                const fixedId = document.getElementById('fixedPlateId').value;
                platePairInput.value = this.value + '-' + (fixedId === '0' ? 'ABS' : fixedId.padStart(3, '0'));
                platePairInput.dataset.autoFilled = 'true';
            }
            updatePreview();
        });
        
        document.getElementById('platePair').addEventListener('input', function() {
            this.dataset.autoFilled = 'false';
            updatePreview();
        });
        
        // Update preview on any input change
        document.querySelectorAll('input, textarea, select').forEach(el => {
            el.addEventListener('input', updatePreview);
            el.addEventListener('change', updatePreview);
        });
        
        document.getElementById('mprsForm').addEventListener('submit', (e) => {
            e.preventDefault();
            vscode.postMessage({
                command: 'create',
                data: {
                    plateId: document.getElementById('plateId').value,
                    code: document.getElementById('code').value,
                    name: document.getElementById('name').value,
                    platePair: document.getElementById('platePair').value || (document.getElementById('code').value + '-ABS'),
                    comment: document.getElementById('comment').value,
                    fixedPlateId: document.getElementById('fixedPlateId').value,
                    insertPosition: document.getElementById('insertPosition').value
                }
            });
        });
        
        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }
        
        // Initial preview
        updatePreview();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        AddMPRSPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

// ============================================================================
// Extension Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext): void {
    console.log('GROT Editor extension is now active');

    // Register Tree View
    const treeDataProvider = new GrotTreeDataProvider();
    vscode.window.registerTreeDataProvider('grotExplorer', treeDataProvider);

    // Register providers
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('grot', new GrotHoverProvider()),
        vscode.languages.registerCompletionItemProvider('grot', new GrotCompletionProvider(), '@'),
        vscode.languages.registerDocumentSymbolProvider('grot', new GrotDocumentSymbolProvider()),
        vscode.languages.registerDocumentFormattingEditProvider('grot', new GrotFormattingProvider())
    );

    // Register diagnostics
    const diagnosticsProvider = new GrotDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    // Update diagnostics on document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'grot') {
                diagnosticsProvider.updateDiagnostics(e.document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'grot') {
                diagnosticsProvider.updateDiagnostics(doc);
                treeDataProvider.refresh();
                vscode.commands.executeCommand('setContext', 'grotFileOpen', true);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'grot') {
                treeDataProvider.refresh();
                vscode.commands.executeCommand('setContext', 'grotFileOpen', true);
            } else {
                vscode.commands.executeCommand('setContext', 'grotFileOpen', false);
            }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('grot.refreshTreeView', () => treeDataProvider.refresh()),
        vscode.commands.registerCommand('grot.goToLine', (line: number) => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const position = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        }),
        vscode.commands.registerCommand('grot.showStatistics', showStatistics),
        vscode.commands.registerCommand('grot.goToMPRS', goToMPRS),
        vscode.commands.registerCommand('grot.goToPlateId', goToPlateId),
        vscode.commands.registerCommand('grot.toggleRotation', toggleRotation),
        vscode.commands.registerCommand('grot.addRotation', addRotation),
        vscode.commands.registerCommand('grot.addMPRS', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'grot') {
                vscode.window.showErrorMessage('No .grot file is open');
                return;
            }
            AddMPRSPanel.createOrShow(context.extensionUri, editor.document, treeDataProvider);
        }),
        vscode.commands.registerCommand('grot.exportToCSV', exportToCSV),
        vscode.commands.registerCommand('grot.editMPRS', (mprsLine?: number) => editMPRSMetadata(context, mprsLine)),
        vscode.commands.registerCommand('grot.editMPRSFromTree', (item: GrotTreeItem) => {
            if (item.lineNumber !== undefined) {
                editMPRSMetadata(context, item.lineNumber);
            }
        }),
        vscode.commands.registerCommand('grot.validateFile', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'grot') {
                diagnosticsProvider.updateDiagnostics(editor.document);
                vscode.window.showInformationMessage('Validation complete. Check the Problems panel for issues.');
            }
        }),
        vscode.commands.registerCommand('grot.formatFile', () => {
            vscode.commands.executeCommand('editor.action.formatDocument');
        })
    );

    // Initial refresh if a grot file is already open
    if (vscode.window.activeTextEditor?.document.languageId === 'grot') {
        treeDataProvider.refresh();
        diagnosticsProvider.updateDiagnostics(vscode.window.activeTextEditor.document);
        vscode.commands.executeCommand('setContext', 'grotFileOpen', true);
    }
}

export function deactivate(): void {
    console.log('GROT Editor extension is now deactivated');
}
