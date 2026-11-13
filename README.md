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
| `npm run electron:build` | Installer for the current platform into `release/` |
| `npm run electron:build:win` / `:mac` / `:linux` | NSIS installer, dmg or AppImage. electron-builder only builds for the system it runs on, so use the matching machine |
| `npm run icon` | Redraw `build/icon.png`, the source of every platform's app icon |

If Electron exits immediately with `Cannot find module 'electron'`, the shell has
`ELECTRON_RUN_AS_NODE` set (terminals spawned by some VS Code extensions do). Unset it and run again.

## What is in the app

- **Visual Workspace** — graph canvas with pan, wheel zoom, fit, auto-layout, find, kind filters and a
  mini-map. Drag a skill onto an agent to attach it. Shift-click to multi-select, right-click for actions.
- **Inspector** — overview, configuration (frontmatter, model, permission mode, tools, instructions),
  skills and generated source for the selected resource. Resizable.
- **Create and edit everything the graph shows** — agents, skills, commands, rules, MCP servers and
  `CLAUDE.md`. **New** in the workspace toolbar, the **New …** button of each list, or the command
  palette. A command's or rule's name is its file path (`git:commit` is `git/commit.md`) and a
  server's name is its key in `.mcp.json`, so those are fixed once saved.
- **Source view** — the file each resource would produce. **Edit source** turns it into a text
  editor: what you type is read back into the fields, so the inspector, the graph and the source
  agree. JSON files are only applied while they are valid.
- **Settings files, output styles and memory files** are listed in the Source view too and can be
  edited there, as can the other `CLAUDE.md` files.
- **Hooks** — add, edit and delete hooks from the Hooks list. They are written into the settings
  file you choose; the rest of that file, indentation included, stays as it is.
- **Overview**, **resource lists**, **Validation**, **Changes** (line diff, discard, save) and **Settings**
  (theme, accent, density, editor, graph and discovery options; stored in `localStorage`).
- **Command palette** (`Ctrl`/`⌘` + `K`), toasts with Undo, delete confirmation.
- **Copy to another project** — right-click a resource (or use the copy button in a list) to copy
  agents, skills, commands, rules and MCP servers into another project folder, with the skills an
  agent uses.
- **Help** (the `?` button in the title bar) — a product tour of the whole app and walkthroughs that
  teach one task each. The tour is offered once on first launch.

## Project layout

```
electron/            main process (frameless window, IPC, workspace file access) and preload bridge
src/app/
  core/model/        types and pure functions: layout, edge paths, frontmatter, source, diff, validation
  core/data/         ResourceRepository interface, the sample data and the Electron implementation
  core/state/        signal stores (workspace, UI, viewport, preferences, tour) and app commands
  core/tour/         tour and walkthrough definitions, coach mark placement
  headless/          behaviour-only directives: drag, tooltip, list navigation, menu dismiss
  ui/                small styled primitives: icon, segmented control, switch, source code
  features/          screens: shell, workspace, inspector, overview, browser, validation, changes,
                     settings, overlays
src/styles.css       design tokens (dark/light, four accents) and component classes for Tailwind
design/              the original interactive prototype, kept as reference
```

Behaviour and styling are kept apart: stores and `headless/` directives hold state and interaction,
Angular Aria supplies tabs and menus, and templates only add Tailwind classes on top.

### Tours and walkthroughs

Three layers, each built on the one below:

- **Coach mark** (`features/overlays/coach-mark.ts`) is the popup itself: a ring around one element
  and a card with a title, text, step counter and buttons. It knows nothing about tours.
- **Product tour** is one read-only pass over the app. It dims everything but the current element
  and is driven with Next / Back, the arrow keys and Escape.
- **Walkthroughs** teach a task. The app stays usable, and a step that asks for an action has no
  Next button: it advances when the user has really done it (created the agent, opened the tab).

All tours are data in `core/tour/tours.ts`. To add a step, mark the element with
`data-tour="some-id"` and add an entry:

```ts
{
  title: 'Add an agent',
  body: 'Click New and choose Agent.',
  target: 'new',                                    // the data-tour id
  placement: 'left',                                // preferred side; flips when there is no room
  prepare: toCanvas,                                // bring the app to where the step happens
  snapshot: ({ ws }) => ws.counts()['agents'],      // baseline when the step starts
  done: ({ ws }, before) => ws.counts()['agents'] > (before as number),
}
```

Leave out `done` for a step that is only read. `TourStore` (`core/state/tour.store.ts`) runs the
steps; because every store is a signal, `done` is simply re-evaluated whenever something it read
changes. `tour-outlet.ts` follows the target on screen, and falls back to a centred card when the
element is not there. Finished tours and the first-run offer are remembered with the preferences.

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
| Managed (Settings → Include managed settings) | `managed-settings.json`, its `managed-settings.d/` folder and `managed-mcp.json` in the system folder an organization deploys to: `C:\Program Files\ClaudeCode`, `/Library/Application Support/ClaudeCode` or `/etc/claude-code`. Always read-only |

When the same agent or skill exists in several scopes, the project copy wins, then user, then plugin.
Managed settings come first. Changes to the scan settings apply on the next scan: **Rescan workspace** in the command palette.

**Keeping up with the disk.** With **Watch files for external changes** on (the default) the app watches
the project's `.claude/` and top-level files, and with user scope `~/.claude/`. When something changes and you have no
pending edits it reloads by itself. With pending edits it never reloads: the status bar shows
**Changed on disk**, and saving still refuses to overwrite a file that changed. `~/.claude.json` is not
watched, because Claude Code rewrites it constantly; use **Rescan workspace** for its MCP servers.

**How it is split**

- `electron/workspace.ts` only touches the disk: it returns file contents and applies writes.
- `core/data/build-snapshot.ts` turns scanned files into nodes, relationships, lists and findings.
- `core/model/frontmatter.ts` and `source.ts` produce the text to save. A scanned file is patched, not
  regenerated: only the frontmatter keys you changed are rewritten, so unknown keys, comments and line
  endings survive. With **Normalize frontmatter on save** on, the files you change also get their
  known keys in a fixed order and two-space indentation (the Changes diff shows it).

**What saving does**

- Writes only inside the project's `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`,
  `~/.claude/{agents,skills,commands,rules,output-styles}`, `~/.claude/CLAUDE.md`,
  `~/.claude/settings.json` and this project's auto memory. Plugin and managed files are read-only.
- Refuses to overwrite a file that changed on disk since the scan. If any file fails, nothing is
  written and the edits stay pending.
- Deleted resources go to the Recycle Bin / Trash; deleting a skill removes its whole folder.
- MCP servers share one JSON file. All changes to it are applied together in one write, and only the
  server keys you changed are touched.
- With **Write changes immediately** on, edits are saved a second after you stop typing. A save that
  fails (for example because the file changed on disk) is not retried until you change something.

**What copying to another project does**

- Copies project-scope agents, skills, commands, rules and MCP servers as they are on disk: pending
  edits are not included, and a resource that was never saved cannot be copied. A skill is copied as
  its whole folder. CLAUDE.md and user, plugin and managed resources are not copied.
- Files go into the destination's `.claude/agents`, `skills`, `commands` and `rules`, keeping their
  subfolders. An MCP server is merged into the destination's `.mcp.json` as one key; the rest of that
  file is kept. A resource the destination already has is skipped unless **Replace** is on; a replaced
  file goes to the Recycle Bin / Trash, a replaced server is overwritten.
- Servers an agent uses are not copied along with it, because they hold addresses and credentials
  you should choose to share.
- Does not touch the open project, and does not open the destination. It is added to the recent
  folders in the workspace switcher.

**Limits**

- A command's or rule's name and an MCP server's name cannot be changed after the first save: they
  are the file path or the key in the file.
- Command → agent and CLAUDE.md → rule relationships come from file content, so they follow the
  text and cannot be detached on the graph.
- Plugin and managed files are read-only. User-scope files are editable only for the folders listed
  under "What saving does".
- Real files need the desktop app. The browser build (`npm start`) always shows the sample.
- Installers are not code signed and there is no auto-update. macOS and Linux builds are configured
  but only the Windows installer has been run so far.

## License

Apache License 2.0. See [LICENSE](LICENSE).
