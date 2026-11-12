# AgentDock

A desktop app for editing Claude Code configuration visually: agents, skills, slash commands, MCP servers,
rules and `CLAUDE.md` are shown as a graph you can inspect, rewire and edit, with validation and a
diff of pending changes before anything is saved.

Built with Angular, Electron, Tailwind CSS and a headless UI layer (`@angular/aria` + `@angular/cdk`).

> **Sample data only.** This build runs on a built-in "Acme Platform" workspace. It does not read or
> write `.claude/` on disk yet; "Save all" only moves the in-memory baseline.

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
electron/            main process (frameless window, IPC) and preload bridge
src/app/
  core/model/        types and pure functions: layout, edge paths, source generation, diff, validation
  core/data/         ResourceRepository interface + the mock implementation
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

### Reading real configuration

Everything the UI shows comes from `ResourceRepository.load()`
(`src/app/core/data/resource-repository.ts`). To work on real projects, add an implementation that
scans `.claude/` and `.mcp.json` (through an Electron IPC channel in `electron/preload.ts`), provide it
in `src/app/app.config.ts` in place of `MockResourceRepository`, and write files in
`WorkspaceStore.saveAll()`.
