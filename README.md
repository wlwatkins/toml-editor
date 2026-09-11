# TOML Editor

Edit a TOML file on your machine as a web form instead of as raw text.

Point it at a `.toml` file, and every key becomes an input — text boxes, number
fields, toggles, date pickers, array list editors — grouped into the same
sections the file uses, with each comment shown next to the key or section it
belongs to. Press **Save** and the file on disk is updated.

It runs entirely on your machine. Nothing is uploaded anywhere.

## Installing it

Run `release/TOML Editor Setup 0.0.1.exe`. It installs per-user (no admin
prompt), lets you choose the folder, and adds Start menu and desktop shortcuts.
`.toml` files get an "open with" entry, and passing a file on the command line
works too:

```
"TOML Editor.exe" C:\path\to\config.toml
```

To build the installer yourself:

```
run.cmd build                  # -> release/TOML Editor Setup <version>.exe
run.cmd build -SkipChecks      # skip type checks and tests
run.cmd build -Unpacked        # just the app directory, no installer
```

There is no HTTP server in the packaged app. The page is served from a custom
`app://` protocol and all file access goes over IPC to Electron's main process,
which is also where the native Open dialog comes from.

## Running it from source

Double-click **`run.cmd`**. It opens a terminal and asks what you want:

```
  TOML Editor  v0.0.1

   [1] Run               debug mode: dev server + app, DevTools open
   [2] Run in browser    dev server only, opens your browser
   [3] Build             check, test and package the installer
   [4] Publish (dry run) show what a release would do, change nothing
   [5] Publish           bump, tag and release to GitHub
   [Q] Quit
```

It comes back to the menu after each action, so you can build and then publish
without relaunching. `run.cmd` exists separately from the PowerShell scripts
because Windows opens a double-clicked `.ps1` in an editor rather than running
it.

To skip the menu, name the action:

```
run.cmd run                    debug mode
run.cmd build                  build the installer
run.cmd publish                cut a release
run.cmd -File C:\path\to\config.toml   debug mode, opening that file
```

Anything after the verb is passed straight through, so `run.cmd publish
-DryRun` and `run.cmd build -SkipChecks` work. The scripts themselves live in
`scripts/` and can be run directly.

### Debug mode

`run.cmd run` starts the Vite dev server and opens the app against it, so the
UI hot-reloads as you edit. DevTools opens docked at the bottom, and a remote
debugging port (printed on start) is available for an external inspector.
Closing the window stops the dev server too.

| Switch | Effect |
| --- | --- |
| `-File <path>` | open that `.toml` on launch |
| `-Browser` | serve to a browser instead of launching the app |
| `-NoDevTools` | launch the app without opening DevTools |

The dev server's port is derived from the project folder's path, so it is the
same every time and will not collide with your other Svelte dev servers; if
another program has taken it, the next free port is used.

## What saving actually does

The thing that usually makes a config GUI unusable is that saving reformats the
whole file and throws the comments away. This editor does not rebuild the file
from a parsed object. It parses TOML into a tree where every value remembers its
exact character range in the original text, and a save replaces **only the ranges
whose values you changed**.

Everything else survives byte for byte:

- comments, both on their own line and trailing a value
- key order, blank lines and section order
- number formatting such as `2_500`, `0xff`, `1e6`
- quoting style — `'literal'` stays literal, `"""multi-line"""` stays multi-line
- your alignment, e.g. `host = "127.0.0.1"   # bind address`

Editing two fields in a 400-line file produces a two-line diff.

Two other safeguards:

- **Writes are atomic.** The new text goes to a temp file which is then renamed
  over the original, so an interrupted save cannot truncate your config.
- **External edits are detected.** If the file changed on disk after you opened
  it, saving is refused with a conflict message instead of overwriting the
  newer version.

Only `.toml` and `.tml` files can be opened or written, so a mistyped path
fails loudly rather than clobbering something unrelated.

## What you can edit

| TOML                     | Control                                      |
| ------------------------ | -------------------------------------------- |
| String                   | Text box, or a textarea for multi-line values |
| Integer / float          | Number input (text, for hex/octal/underscored) |
| Boolean                  | Toggle                                        |
| Local date / time        | Native date and time pickers                  |
| Local date-time          | Native date-time picker                       |
| Offset date-time         | Text box (no browser control keeps the zone)  |
| Array                    | List editor: edit, reorder and add/remove items |
| Inline table `{ a = 1 }` | Nested fields, patched in place               |
| `[table]`, `[[array]]`   | A section card each, nested by path depth     |

Values are validated as you type — an invalid integer or date is flagged inline
and blocks saving, so the file never receives something that will not parse.

The **Raw** tab shows the exact text that Save will write, which is worth a
glance before committing to a change.

## Comments

Comments are rendered as Markdown, because that is how people already write
them. A block like this:

```toml
# ---------------------------------------------------------------------------
# The parts
# ---------------------------------------------------------------------------
# What this instrument is made of, each named once. Every path is relative to
# THIS file, so the whole `config` tree can be moved or checked out anywhere
# without editing a line of it.
```

comes out as a rule, a heading and a paragraph, with `config` set as code. The
supported subset is headings (`##` in the file, since the first `#` is the
comment marker), the rule-title-rule banner style above, bullet and numbered
lists, block quotes, fenced and indented code, and inline code, **bold**,
*italic*, ~~strikethrough~~ and links.

Any block longer than two lines gets a disclosure triangle, so a wall of
explanation can be folded down to its first line. The **Comments** control in
the toolbar sets the default for the whole file:

- **Full** -- everything expanded
- **Brief** -- every long block folded to a one-line summary
- **Off** -- comments hidden entirely

That choice is remembered between sessions.

Comment text is escaped before any markup is generated, so nothing in a file
can turn into live HTML; a `<script>` in a comment is displayed as the text it
is. A link is only made clickable for `http`, `https` and `mailto`.

Comments the editor cannot attach to a specific key -- a banner at the top of
the file, or a note sitting on its own between blank lines -- are kept and
shown above whatever follows them, rather than dropped.

### Not supported

Adding or removing **keys and sections** — the form edits the values of what is
already in the file. Array items are the exception: those can be added and
removed. Restructuring a file is still a text-editor job.

## Development

```sh
run.cmd            # menu: run, build or publish
npm run dev        # dev server only (browser)
npm run check      # svelte-check (type checking)
npm test           # both unit suites
npm run test:toml  # round-trip tests for the TOML layer
npm run test:md    # comment Markdown renderer, including its escaping
```

`npm test` is the one to run when touching anything under `src/lib/toml/` or
`src/lib/markdown.ts`. The TOML suite asserts, among other things, that editing
one value changes exactly one line and that a file with no pending edits
round-trips unchanged; the Markdown suite asserts that nothing in a comment can
become live HTML.

`examples/sample.toml` exercises every supported value type and is a good file
to open while poking at the UI.

## Releasing

```
run.cmd publish              # predicts the version, asks, then does everything
run.cmd publish -DryRun      # print every step, change nothing
run.cmd publish -Bump minor  # force the bump size
```

It runs entirely on this machine -- there is no CI and no GitHub Actions. In
order it checks the remote and `gh` login; works out the next version and
confirms it; bumps `package.json` and the lockfile; builds the installer;
commits **everything in the working tree** as `release for version x.y.z`; tags
and pushes; then creates the GitHub release with the installer, its blockmap and
`latest.yml` attached. If the build fails, the version bump is rolled back and
nothing is committed.

Because the version bump itself dirties the tree, the release commit takes the
whole tree rather than just `package.json`. Everything that will be committed --
including untracked files, since it uses `git add -A` -- is listed for you
before anything happens, so check that list if you have stray files about.

The proposed version is read off the commits since the last tag, using
Conventional Commit prefixes:

| Commits since the last tag | Proposed |
| --- | --- |
| a `!` marker, or a `BREAKING CHANGE:` footer | major |
| a `feat:` | minor |
| anything else | patch |
| no tags yet | the version already in `package.json` |

You are shown the guess and can type a different one. Other switches:
`-Version <x.y.z>`, `-Draft`, `-PreRelease`, `-Notes "..."`, `-SkipBuild`,
`-SkipChecks`, `-Yes`.

### About

**Help -> About TOML Editor** shows the version, plus the Electron, Chromium and
Node builds it is running on and a link to the repository. The version is baked
in from `package.json` at build time, so `publish.ps1` bumping the version is
all it takes to keep it accurate.

### Layout

```
src/lib/toml/          the comment-preserving TOML layer (no UI, no Svelte)
  ast.ts               node types; every node carries its source span
  parse.ts             TOML 1.0 parser that records spans and comments
  serialize.ts         value -> text, quoting styles, validation
  edit.ts              drafts -> minimal source patches
src/lib/markdown.ts        comment Markdown renderer (escapes first, always)
src/lib/editor.svelte.ts   open/save state, pending edits keyed by node id
src/lib/prefs.svelte.ts    remembered UI preferences (comment display mode)
src/lib/components/        form controls and section cards
src/lib/themes.ts          theme metadata for the gallery
src/lib/themes.css         the six candidate themes, as token overrides
src/routes/api/file/       GET reads a file, POST writes it atomically
src/routes/api/pick/       opens the OS file dialog (browser mode only)
src/routes/gallery/        theme gallery (see below)
src/lib/platform.ts        one seam: Electron IPC, or fetch to /api in a browser
electron/main.cjs          window, menus, file IPC, the app:// protocol
electron/preload.cjs       the entire privileged surface exposed to the page
scripts/package.mjs        installer build (stages outside the project, see below)
scripts/menu.ps1           the menu, and the verb dispatch behind run.cmd
scripts/run.ps1            debug mode: dev server + the app
scripts/build.ps1          check, test and package the installer
scripts/publish.ps1        version, tag and publish a GitHub release
scripts/common.ps1         helpers shared by the PowerShell scripts
run.cmd                    double-click entry point
```

### Why the installer stages in the temp directory

electron-builder unpacks ~200 MB of Electron into `<output>/win-unpacked.tmp`
and immediately renames that directory into place. A real-time scanner is often
still reading those freshly written binaries, and the rename fails with EPERM --
reliably so, when the output is inside a watched project tree. `npm run dist`
therefore stages under the OS temp directory and copies only the finished
installer back into `release/`.

### Why the file picker is not a browser dialog

A browser cannot tell a page the real path of a chosen file: `<input
type="file">` reports `C:\fakepath\name.toml`, and the File System Access API
hands back an opaque handle. Since saving works by absolute path, the picker
has to come from outside the page. The desktop app uses Electron's native
dialog; the browser build falls back to `/api/pick`, which shells out to the
platform's own dialog (a Windows common dialog, `osascript` on macOS, `zenity`
on Linux).

### Theme

The editor wears **Grid**: neon cyan on black, hairline borders that glow, a
perspective grid on the backdrop and translucent panels that read as edge-lit
glass. It is defined as the `:root` design tokens in `src/app.css`; there is no
light mode.

`/gallery` keeps five other candidates (Nostromo, Flight Deck, Holo, Night City,
Observatory) for comparison, each rendering the real components with live
fields. They are token overrides in `src/lib/themes.css` scoped under
`[data-theme="..."]`, so swapping the app to a different one is a matter of
moving that block into `app.css`.

The `src/lib/toml/` modules are plain TypeScript with no Svelte dependency,
which is why they can be tested with `node --experimental-strip-types`.

### About

**Help -> About TOML Editor** shows the version, plus the Electron, Chromium and
Node builds it is running on and a link to the repository. The version is baked
in from `package.json` at build time, so `publish.ps1` bumping the version is
all it takes to keep it accurate.

### Layout

The window is one full-height column: the title bar and the path bar are fixed,
and only the form area scrolls. The scrollbar belongs to `<main>` and sits at
the window edge; the section outline stays pinned beside the content.

### The window chrome

The window is frameless (`frame: false`) and the title bar, menu bar and
minimise/maximise/close buttons are Svelte components, so they follow the
theme. Everything the OS normally provides still works: `frame: false` keeps
the native sizing border, so edge-drag resizing, Aero Snap, double-click to
maximise and Win+Arrow all behave as usual. The drag region is declared with
`-webkit-app-region: drag`, and the buttons opt back out with `no-drag`.
