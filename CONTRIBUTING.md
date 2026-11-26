# Contributing to AgentDock

Thanks for your interest in improving AgentDock. Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and asking for features

Open an issue with the [bug report](https://github.com/Manojlovic1998/AgentDock/issues/new?template=bug_report.yml)
or [feature request](https://github.com/Manojlovic1998/AgentDock/issues/new?template=feature_request.yml)
form. For bugs, include your AgentDock version (Settings → About and updates), your operating
system, the steps that cause the problem and what you expected to happen.

For anything bigger than a small fix, please open an issue first so the approach can be agreed on
before you spend time on it.

## Setting up

You need Node.js 22 or newer and npm 10 or newer.

```
git clone https://github.com/Manojlovic1998/AgentDock.git
cd AgentDock
npm install
npm run electron:dev
```

`npm run electron:dev` starts the Angular dev server and opens the desktop app with live reload.
`npm start` runs only the web UI at http://localhost:4200, which always shows the built-in sample
project and never writes files.

If Electron exits immediately with `Cannot find module 'electron'`, your shell has
`ELECTRON_RUN_AS_NODE` set. Unset it and run again.

The [README](README.md) describes the project layout and how reading and writing configuration
works.

## Tests

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests for the Angular app (Vitest, `src/**/*.spec.ts`) |
| `npm run test:electron` | Tests for the Electron main process (`electron/**/*.spec.ts`) |
| `npm run build` | Production web build |
| `npm run electron:compile` | Type-checks and compiles the Electron code |

CI runs all four on Windows, macOS and Linux for every pull request, and builds the installers.
Please run them locally before opening a pull request, and add or update tests when you change
behaviour.

## Branches

- `main` holds released code. Releases are tagged on `main` (see [docs/releasing.md](docs/releasing.md)).
- `develop` collects the work for the next release. Branch from it and open your pull request
  against it.
- `release/<version>` branches prepare a release and are merged into `main`.

Name your branch after the kind of change, for example `feat/hook-editor`, `fix/empty-workspace-path`
or `docs/contributing`. Changes reach `main` and `develop` through pull requests only.

## Commit messages

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) style used in the
history:

- `feat:` a new feature
- `fix:` a bug fix
- `test:` tests only
- `docs:` documentation only
- `chore:` build, CI, dependencies, releases and other maintenance

Write the summary in the imperative and lower case, and reference the issue when there is one, for
example `fix: handle empty workspace path (#12)`.

## Pull requests

- Keep a pull request to one change. Unrelated fixes are easier to review separately.
- Fill in the pull request template: what changed, why, and how you tested it.
- Follow the existing code style. Behaviour lives in the stores and `headless/` directives,
  templates only add Tailwind classes on top.
- Update the README or `docs/` when user-facing behaviour changes.
- Do not change the version number. That happens in release branches.

## License

AgentDock is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your
contributions are licensed under the same terms.
