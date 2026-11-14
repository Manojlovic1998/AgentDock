# Publishing a beta release

Beta releases are pre-releases on GitHub. Pushing a version tag builds the Windows, macOS and
Linux installers and publishes them. Installed apps then offer the update to their users.

## How it works

- `.github/workflows/release.yml` runs on every tag that starts with `v`.
- It checks that the tag matches `version` in `package.json`, runs the tests, builds the three
  installers and creates the GitHub release with generated notes.
- A tag with a hyphen (`v0.1.0-beta.2`, `v0.1.0-rc.1`) is marked **pre-release**. A tag without one
  (`v0.1.0`) is a normal release.
- The release carries the installers plus `latest.yml`, `latest-linux.yml` and the `.blockmap`
  file. Installed apps read those to find and verify updates, so never delete them from a release.

## Before you start

- `main` is green on CI (tests, Electron tests, build, installers).
- Everything you want in the beta is merged to `main`.
- You are on an up-to-date `main`: `git checkout main && git pull`.

## Steps

1. **Pick the version.** Betas count up: `0.1.0-beta.1`, `0.1.0-beta.2`, and so on. When it is
   ready, drop the suffix (`0.1.0`).
2. **Set it in both files.**
   ```
   npm version 0.1.0-beta.2 --no-git-tag-version
   ```
   This updates `package.json` and `package-lock.json`.
3. **Commit on a branch and merge it** (the repository merges through pull requests):
   ```
   git checkout -b release/0.1.0-beta.2
   git commit -am "chore: release 0.1.0-beta.2"
   git push -u origin release/0.1.0-beta.2
   ```
   Open a pull request, wait for CI, merge it.
4. **Tag the merged commit on `main` and push the tag.**
   ```
   git checkout main && git pull
   git tag v0.1.0-beta.2
   git push origin v0.1.0-beta.2
   ```
5. **Watch the Release run** in the Actions tab. All three installer jobs must pass before the
   release is created.
6. **Check the release page.** It should be marked *Pre-release* and list:
   - `AgentDock-<version>-win-x64.exe` and its `.blockmap`, and `latest.yml`
   - `AgentDock-<version>-mac-arm64.dmg`
   - `AgentDock-<version>-linux-x86_64.AppImage` and `latest-linux.yml`

   Edit the generated notes if you want. Users see them in the update dialog (shortened).

## What users see

- Installed betas check for updates about ten seconds after launch and offer **Download**,
  **Later** or **Skip this version**. After the download they choose **Restart now** or install on
  the next launch.
- On macOS the dialog opens the release page instead, because the app is not code signed and
  macOS refuses unsigned in-place updates. Users download the new dmg themselves.
- A beta is offered newer betas and the final release. A stable install is never offered a
  pre-release.

## Verifying an update works

You need two published versions. Install the older one from its release, publish the newer one,
then launch the old install:

1. The dialog offers the new version.
2. Download shows progress, then **Restart now** restarts into the new version.
3. Settings → About and updates shows the new version number.

Updates cannot be tried from `npm run electron:dev`: unpackaged builds never check.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| Release job fails on "Tag … does not match package.json version" | The tag and `version` differ. Delete the tag (`git push --delete origin <tag>`; `git tag -d <tag>`), fix the version, tag again. |
| One installer job fails | The release is not created. Fix the cause, then delete and re-push the tag. |
| Bad release already published | Mark it as a draft or delete it on GitHub, then publish a higher version. Do not reuse a version number: installed apps may already have cached it. |
| Users report no update offered | Confirm the release is not a draft, includes `latest*.yml`, and has a higher version than theirs. A skipped version only hides from automatic checks. |

## Known limits

- Installers are not code signed. Windows SmartScreen and macOS Gatekeeper warn on first launch.
- Only the macOS arm64 installer is built.
- Signing the apps is the next step for smooth macOS updates and no SmartScreen warnings.
