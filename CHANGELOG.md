# Changelog

All notable changes to the "GPlates Rotation File Editor" extension will be documented in this file.

## [1.0.0] - 2026-01-23

### Added
- Initial release
- Syntax highlighting for .grot and .rot files
- Tree view navigation for MPRS sequences and rotations
- Hover information for rotation parameters and attributes
- Auto-completion for attributes and metadata
- Code snippets for common patterns
- Real-time validation with diagnostics
  - Header validation
  - Plate ID consistency
  - Age sequence checking
  - Duplicate detection
- Commands:
  - Add new rotation
  - Toggle rotation (enable/disable)
  - Go to MPRS
  - Show statistics
  - Validate file
  - Format file
  - Export to CSV
- Document outline support
- Configurable settings

### Technical
- Full TypeScript implementation
- TextMate grammar for syntax highlighting
- Document Symbol Provider for outline
- Completion Provider with snippets
- Hover Provider
- Diagnostic Provider
- Formatting Provider
