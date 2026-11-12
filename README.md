# AgentDock

A desktop app for editing Claude Code configuration visually: agents, skills, slash commands, MCP servers,
rules and `CLAUDE.md` are shown as a graph you can inspect, rewire and edit, with validation and a
diff of pending changes before anything is saved.

Built with Angular, Electron, Tailwind CSS and a headless UI layer (`@angular/aria` + `@angular/cdk`).

> **Real files in the desktop app.** Choose a project with **Open folder…** in the title bar and
> AgentDock scans its Claude Code configuration; **Save all** writes your edits back. Until a folder
> is chosen, and in the browser (`npm start`), a built-in "Acme Platform" sample is shown and nothing
> is written.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run electron:dev` | Desktop app with live reload (Angular dev server + Electron) |
| `npm start` | Web UI only, at http://localhost:4200 |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production web build into `dist/` |
| `npm run electron:start` | Production build, opened in Electron |
| `npm run electron:build` | Windows installer into `release/` |

If Electron exits immediately with `Cannot find module 'electron'`, the shell has
`ELECTRON_RUN_AS_NODE` set (terminals spawned by some VS Code extensions do). Unset it and run again.

## What is in the app

- **Visual Workspace** — graph canvas with pan, wheel zoom, fit, auto-layout, find, kind filters and a
  mini-map. Drag a skill onto an agent to attach it. Shift-click to multi-select, right-click for actions.
- **Inspector** — overview, configuration (frontmatter, model, permission mode, tools, instructions),
  skills and generated source for the selected resource. Resizable.
- **Source view** — the file each resource would produce, read-only.
- **Overview**, **resource lists**, **Validation**, **Changes** (line diff, discard, save) and **Settings**
  (theme, accent, density, editor, graph and discovery options; stored in `localStorage`).
- **Command palette** (`Ctrl`/`⌘` + `K`), toasts with Undo, delete confirmation.

## Project layout

```
electron/            main process (frameless window, IPC, workspace file access) and preload bridge
src/app/
  core/model/        types and pure functions: layout, edge paths, frontmatter, source, diff, validation
  core/data/         ResourceRepository interface, the sample data and the Electron implementation
  core/state/        signal stores (workspace, UI, viewport, preferences) and app commands
  headless/          behaviour-only directives: drag, tooltip, list navigation, menu dismiss
  ui/                small styled primitives: icon, segmented control, switch, source code
  features/          screens: shell, workspace, inspector, overview, browser, validation, changes,
                     settings, overlays
src/styles.css       design tokens (dark/light, four accents) and component classes for Tailwind
design/              the original interactive prototype, kept as reference
```

Behaviour and styling are kept apart: stores and `headless/` directives hold state and interaction,
Angular Aria supplies tabs and menus, and templates only add Tailwind classes on top.

### Reading and writing configuration

Everything the UI shows comes from `ResourceRepository` (`src/app/core/data/resource-repository.ts`),
which has two implementations chosen in `src/app/app.config.ts`: the sample data, and
`ElectronResourceRepository` for real files.

**What is scanned**

| Scope | Locations |
| --- | --- |
| Project | `.claude/` (agents, skills, commands, rules, output styles, settings), `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json` |
| User (Settings → Include user scope) | the same folders in `~/.claude/`, this project's auto memory, and the MCP servers in `~/.claude.json` |
| Plugins (Settings → Include installed plugins) | agents, skills, commands and `.mcp.json` of each installed plugin |

When the same agent or skill exists in several scopes, the project copy wins, then user, then plugin.
Changes to the scan settings apply on the next scan: **Rescan workspace** in the command palette.

**How it is split**

- `electron/workspace.ts` only touches the disk: it returns file contents and applies writes.
- `core/data/build-snapshot.ts` turns scanned files into nodes, relationships, lists and findings.
- `core/model/frontmatter.ts` and `source.ts` produce the text to save. A scanned file is patched, not
  regenerated: only the frontmatter keys you changed are rewritten, so unknown keys, comments and line
  endings survive.

**What saving does**

- Writes only inside the project's `.claude/`, `CLAUDE.md`, `.mcp.json` and
  `~/.claude/{agents,skills,commands,rules}`. Plugin files are read-only.
- Refuses to overwrite a file that changed on disk since the scan. If any file fails, nothing is
  written and the edits stay pending.
- Deleted resources go to the Recycle Bin / Trash; deleting a skill removes its whole folder.

**Not yet**

- Watching files for external changes, and managed settings (both toggles in Settings are inert).
- Only agent → skill and agent → MCP relationships are saved. Command → agent and CLAUDE.md → rule
  edges are derived from file content, so detaching them does not change a file.
- Settings, hooks, output styles and memory files are listed but cannot be edited.
