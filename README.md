# GPlates Rotation File Editor (.grot)

A comprehensive VS Code extension for editing and managing GPlates rotation files (.grot format).

![Extension Demo](media/demo.gif)

## Features

### 🎨 Syntax Highlighting
Full syntax highlighting for:
- Header attributes (`@DC:*`, `@GPML:*`, etc.)
- MPRS headers with `>` markers
- Rotation data lines with plate IDs, ages, coordinates, and angles
- Metadata attributes (`@C`, `@REF`, `@DOI`, `@AU`, `@CHRONID`, etc.)
- Comments (`#`) and disabled rotations

### 🗂️ Tree View Navigation
The **GROT Structure** panel in the Explorer provides:
- Hierarchical view of all MPRS sequences
- Quick navigation to any rotation
- At-a-glance statistics (rotation count, age range)
- Visual indication of disabled rotations

### 💡 IntelliSense & Auto-Completion
- Auto-complete for all standard attributes
- Snippets for common patterns:
  - `grotheader` - Complete file header
  - `mprs` - New MPRS sequence
  - `rot` - Rotation line
  - `rotref` - Rotation with reference
  - And many more...

### 🔍 Hover Information
Hover over any element to see:
- Rotation parameters explained
- Metadata attributes
- Header attribute descriptions

### ✅ Validation & Diagnostics
Real-time validation for:
- Missing required header attributes
- Plate ID consistency within MPRS
- Age sequence order
- Missing present-day (0 Ma) rotations
- Duplicate ages

### 📊 Statistics View
View comprehensive statistics including:
- Total MPRS count
- Total rotations (enabled/disabled)
- Time range coverage
- Per-MPRS breakdown

### ⚡ Commands
| Command | Description |
|---------|-------------|
| `GROT: Add New Rotation` | Insert a new rotation line |
| `GROT: Add New MPRS` | Create a new plate rotation sequence |
| `GROT: Toggle Rotation` | Enable/disable a rotation |
| `GROT: Go to MPRS...` | Quick navigation picker |
| `GROT: Show Statistics` | Open statistics panel |
| `GROT: Validate File` | Run full validation |
| `GROT: Format File` | Align columns and standardize formatting |
| `GROT: Export MPRS to CSV` | Export rotations to CSV |

## Installation

### From VSIX (Local)
1. Download the `.vsix` file
2. In VS Code: `Extensions` → `...` → `Install from VSIX...`

### From Marketplace (Coming Soon)
Search for "GPlates Rotation Editor" in the VS Code Extensions marketplace.

### Build from Source
```bash
git clone https://github.com/gplates-community/grot-vscode-extension
cd grot-vscode-extension
npm install
npm run compile
npm run package
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `grot.validation.enabled` | `true` | Enable real-time validation |
| `grot.validation.checkPlateIds` | `true` | Validate plate ID consistency |
| `grot.validation.checkAgeSequence` | `true` | Check ascending age order |
| `grot.formatting.alignColumns` | `true` | Align rotation data columns |
| `grot.formatting.decimalPlaces` | `4` | Decimal places for values |
| `grot.treeView.showDisabled` | `true` | Show disabled rotations in tree |
| `grot.hover.showPlateInfo` | `true` | Show plate info on hover |

## File Format Reference

The `.grot` format is the GPlates rotation file format. Key elements:

### Header Attributes
```
@GPLATESROTATIONFILE:version"1.0"
@DC:title"My Rotation Model"
@DC:creator:name"Author Name"
@DC:coverage:temporal"0-600 Ma"
```

### MPRS (Moving Plate Rotation Sequence)
```
> @MPRS:pid"101" @MPRS:code"NAM" @MPRS:name"North America"
> @PP"NAM-AFR" @C"Comment" @REF"Reference"
```

### Rotation Lines
```
101  0.0000    90.0000   0.0000    0.0000    000   @C"Present day"
101  10.9000   81.0000   22.9000   2.8400    714   @CHRONID"C5"
```

Format: `PID1 AGE LATITUDE LONGITUDE ANGLE PID2 [metadata]`

### Disable a Rotation
Prefix with `#`:
```
#101  10.9000   81.0000   22.9000   2.8400    714
```

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+P` → "GROT:" | Access all GROT commands |
| `F12` | Go to definition (MPRS) |
| `Ctrl+Shift+O` | Open symbol outline |

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [GPlates Software](https://www.gplates.org/)
- [GROT Format Specification](https://www.gplates.org/grot/)
- [EarthByte Group](https://www.earthbyte.org/)

---

**Enjoy editing your plate tectonic reconstructions!** 🌍
