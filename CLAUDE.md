# CLAUDE.md

## Project

`toml-editor` — a local SvelteKit app that renders a TOML file on disk as a web
form and writes edits back to it. See README.md for user-facing behaviour.

Not a git repository.

## Commands

```sh
run.cmd              # menu: run / build / publish (double-click entry point)
run.cmd run          # debug mode: dev server + the Electron app, DevTools open
run.cmd run -Browser # dev server + a browser instead
run.cmd build        # check, test, package the installer
run.cmd publish      # version, tag, GitHub release
npm run dev          # vite dev server only
npm run electron     # build, then run the app against the built bundle
npm run dist         # installer -> release/ (build.ps1 wraps this)
npm run check        # svelte-kit sync + svelte-check -- the type/lint gate
npm test             # both unit suites -- run this one
npm run test:toml    # round-trip tests for src/lib/toml/ (node type-stripping)
npm run test:md      # comment Markdown renderer + its escaping guarantees
npm run build        # production build
npm run preview      # serve the production build
```

Run **both** `npm run check` and `npm test` before calling work done.
There is no other test runner, linter, or formatter — don't invent `npm test`
or `npm run lint`.

`npm install` is strict about engines (`engine-strict=true` in `.npmrc`).

## The core invariant

Saving must not reformat the file. `src/lib/toml/` exists to guarantee that:

- `parse.ts` records a `Span` (character offsets into the original source) on
  every value node, plus the comments attached to each key and table header.
- `edit.ts#collectEdits` walks the drafts and emits the **smallest set of
  replacements** that expresses them. An untouched value is never re-serialised,
  so comments, key order, blank lines, `2_500`-style number formatting, quoting
  style and alignment all survive byte for byte.
- A value the user edited back to its original text produces no edit at all.
- Arrays are the one exception: when the item list changes length or order the
  whole array is re-rendered, since new items have no original text.

`npm run test:toml` pins this down — notably "only the edited line changes" and
"no drafts rewrites nothing". If you touch the TOML layer, keep those passing;
they are the difference between this tool and one that mangles configs.

Drafts live in `Drafts { scalars, arrays }`, keyed by node id, and only exist
once a field is actually touched — a *missing* entry is what means "untouched".
Preserve that distinction; seeding drafts eagerly would rewrite the whole file.

## Layout

```
src/lib/toml/            plain TS, no Svelte import -- keep it that way so the
                         node --experimental-strip-types tests can run
  ast.ts                 node types, spans, type labels
  parse.ts               TOML 1.0 parser (spans + comments)
  serialize.ts           value -> text, quoting styles, draft validation
  edit.ts                drafts -> patches; synthetic nodes for new array items
src/lib/markdown.ts      comment Markdown renderer; escape-then-generate only
src/lib/prefs.svelte.ts  remembered UI preferences (comment display mode)
src/lib/editor.svelte.ts Editor class: open/save, drafts, derived edit plan
src/lib/components/      ValueField (recursive), EntryRow, SectionCard, ThemePreview
src/lib/themes.ts        theme metadata; themes.css holds the token overrides
src/routes/api/file/     GET read, POST atomic write with an mtime conflict check
src/routes/api/pick/     spawns the OS file dialog, returns the chosen path
src/routes/gallery/      theme gallery: index + /gallery/[theme] live preview
src/lib/platform.ts      the seam: Electron IPC when present, else fetch /api
src/lib/components/TitleBar.svelte   custom frameless chrome (menus + buttons)
electron/main.cjs        window, IPC, app:// protocol, dev-URL mode
electron/preload.cjs     the whole privileged surface, via contextBridge
scripts/package.mjs      installer build; stages outside the project (see below)
scripts/menu.ps1         the menu, and the verb dispatch behind run.cmd
scripts/run.ps1          debug mode
scripts/build.ps1        check, test, package
scripts/publish.ps1      version, tag, GitHub release
scripts/common.ps1       helpers shared by the PowerShell scripts
run.cmd                  the only thing at the root; forwards to menu.ps1
```

Every .ps1 lives in scripts/ and therefore starts with

```powershell
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
```

`$PSScriptRoot` means scripts/, `$Root` means the project. Getting these
confused in run.ps1 is worse than it looks: **the dev server port is derived
from `$Root`**, so seeding it from `$PSScriptRoot` would silently move
everyone's port.

run.ps1 deliberately does NOT dot-source common.ps1: it is what the double-click
path ends up in, and must not break if a sibling file is missing.

Synthetic nodes (array items the user just added) have `span: null`. Anything
walking the AST has to handle that.

## Stack specifics

- **No `svelte.config.js`.** SvelteKit is configured inside the `sveltekit()`
  plugin call in `vite.config.ts` — adapter, compiler options, `kit` options.
- **Runes mode is forced on** for all non-`node_modules` files. Use `$state`,
  `$derived`, `$props`, `$effect`; `export let`, `$:` and `svelte/store` idioms
  will fail to compile.
- Beware `$effect` that reads state it also writes — it re-triggers itself. The
  page's session restore uses `onMount` for exactly this reason.
- `$state.raw` is used for `doc` and `arrays` so the AST is not deep-proxied.
- Import extensions: relative imports inside `src/lib/toml/` use explicit `.ts`
  (required by `rewriteRelativeImportExtensions` and by the node test runner).
  `$lib/...` imports must be **extensionless** — TS only rewrites relative paths.
- Svelte 5, SvelteKit 2, Vite 8, TypeScript 6 (`strict`, `checkJs`),
  `@types/node` for the server routes, and `adapter-static` with an
  `index.html` fallback -- `npm run build` emits a SPA into `build/`, which is
  what Electron ships.
- `tsconfig.json` extends the generated `.svelte-kit/tsconfig.json`; add
  top-level options by extending it, and put path aliases in `kit.alias`.

## Comments

Comments render as Markdown through `src/lib/markdown.ts`, injected with
`{@html}`. That is only safe because the renderer **escapes the text before it
generates a single tag**, and emits nothing outside a fixed tag set. Do not
reorder those steps, and do not swap in an npm Markdown library without
checking it cannot emit raw HTML -- comment text is arbitrary file content.
`npm run test:md` asserts the tag and attribute allowlists directly.

`parse.ts` strips the `#` and at most **one** following space. The remaining
indentation is load-bearing: nested lists and indented code blocks depend on
it, so do not reintroduce a `.trim()` there.

A comment block separated from the next statement by a blank line is *detached*,
not discarded -- it lands in `detachedComments` on the following entry or table.
A detached block above the first key of the root table is hoisted onto the root
table itself, because that is a file banner rather than a note about that key.

## Focus rings in the chrome

An outline is painted **outside** the element, so the global
`:focus-visible { outline: 2px solid; outline-offset: 2px }` draws a ring
visibly larger than the control and overhanging a compact bar. Every control in
the chrome -- title bar buttons, menu items, path bar, tabs, comment modes --
overrides it with `box-shadow: inset 0 0 0 2px var(--accent)` and
`outline: none`. Keep new chrome controls doing the same; the global rule is
fine for content, which has room around it.

## Version and About

`__APP_VERSION__` and `__APP_REPOSITORY__` are Vite `define`s read from
package.json (see vite.config.ts), declared inside the `declare global` block in
`src/app.d.ts` -- that file is a module, so a bare top-level `declare const`
there is NOT global and will not compile. Baking them in means the About box
works in the browser build too; the desktop app adds Electron/Chromium/Node
versions on top via the `app:info` IPC channel.

## Layout: what scrolls

`+page.svelte` is one `.app` column of `height: 100vh` with `overflow: hidden`.
The title bar and the path bar are `flex: none`; **`<main>` is the only scroll
container** (`flex: 1; min-height: 0; overflow-y: auto`). The centred
`max-width` lives on an inner `.main-inner`, not on `<main>`, so the scrollbar
sits at the window edge rather than against the content.

Consequences to keep in mind:

- Nothing in the chrome needs `position: sticky` any more; it is fixed by being
  a flex sibling that does not scroll.
- `.outline` is sticky relative to the scrollport, so its `top` is 0, not an
  offset for a sticky header.
- Anchor jumps (`#section-N`) scroll `<main>`, so `scroll-margin-top` on a card
  only needs to clear the scrollport padding.
- The grid backdrop is an `html` background with `background-attachment: fixed`,
  so it stays still while `<main>` scrolls -- which is what you want.
- The gallery routes are NOT inside `.app`; they scroll normally.

## Theming

The app runs the **Grid** theme: neon cyan on black, translucent edge-lit
panels, 2px radii. It lives in `src/app.css` as the `:root` token set -- there
is no light mode and no `prefers-color-scheme` switch, by design.

Components read design tokens only (`--surface`, `--accent`, `--radius-panel`,
`--panel-shadow`, `--panel-backdrop`, ...), so the palette is entirely that one
file. Keep it that way: if something needs to reach inside a component's scoped
styles to restyle it, add a token instead.

The grid floor and glow are painted as the **`html` background**, not as a
negative-z pseudo-element -- a pseudo-element with `z-index: -1` paints behind
body's own background, where it is invisible. Panels are deliberately
translucent so the grid shows through them; anything sticky over them (the top
bar) needs a `backdrop-filter`.

`/gallery` still hosts the six candidates (`src/lib/themes.css`, scoped under
`[data-theme="id"]`) for comparison, and is how another one would be adopted.

## Electron

Architecture: SvelteKit builds a **static SPA** (`adapter-static`, `ssr = false`),
Electron serves it from a custom `app://` scheme, and all file access goes over
IPC. There is no HTTP server in the packaged app. The `/api/*` routes still
exist and still work under `npm run dev` in a browser; `src/lib/platform.ts` is
the single seam that chooses between them. Anything new that touches the disk
goes through that seam, not through `fetch` in a component.

Non-obvious things that were all found the hard way:

- **Never return a value from a callback handed across `contextBridge`.**
  `onWindowState((s) => (win = s))` returns the assigned value, which Svelte has
  wrapped in a `$state` proxy, and Electron cannot structured-clone a proxy --
  it throws on every event. `platform.ts` wraps subscription callbacks so they
  return undefined; keep it that way.
- **`electron.exe` is a GUI-subsystem binary**, so PowerShell's call operator
  does not wait for it. run.ps1 uses `Start-Process -PassThru` + `WaitForExit`;
  with `& $electron` the script races ahead and kills the dev server.
- **Vite must be pinned with `--host 127.0.0.1` in debug mode.** Left alone it
  binds whatever `localhost` resolves to, which can be `::1` only, and Chromium
  asking for 127.0.0.1 then gets connection refused.
- **The dev URL load is retried** in `main.cjs`: the dev server's socket accepts
  a moment before it will answer, and a failed `loadURL` never retries itself.
- The window is frameless; `frame: false` keeps `WS_THICKFRAME`, so edge-drag
  resize, Aero Snap and double-click-maximise still come from the OS. The title
  bar declares `-webkit-app-region: drag` and buttons opt out with `no-drag`.
- Menu dropdowns must stay **opaque**. Translucent panels over the translucent
  title bar and the moving grid are unreadable at any blur radius.

## run.ps1

- Vite is invoked as `node node_modules/vite/bin/vite.js`, not via
  `npm run dev -- --port ...`, because PowerShell swallows the `--` separator
  and npm then eats the flags instead of forwarding them.
- Port availability is checked with `Get-NetTCPConnection`. Binding a test
  socket reports a busy port as free (a server on the IPv6 loopback leaves the
  IPv4 address bindable), and a short timed connect is a race a cold process
  loses. Both were tried; both were wrong.
- Paths in the script use forward slashes. Backslash literals in these files
  have repeatedly been mangled into control characters by tooling.

## Packaging

`npm run dist` runs `scripts/package.mjs`, which stages the build under the OS
temp directory and copies only the finished installer into `release/`.
electron-builder renames `win-unpacked.tmp` into place straight after unpacking
~200 MB of binaries, and a real-time scanner still holding those files makes the
rename fail with EPERM -- reliably, inside a watched project tree. The script
also invokes electron-builder's `cli.js` with `process.execPath` rather than
going through `npx`, because Node refuses to spawn a `.cmd` without a shell.

## Releasing

`publish.ps1` does the whole release on this machine. There is no CI and no
GitHub Actions, and that is deliberate -- do not add a workflow that duplicates
it.

- The proposed version comes from Conventional Commit prefixes since the last
  tag (`!`/`BREAKING CHANGE` -> major, `feat` -> minor, else patch). With no
  tags, the version already in package.json is offered, because it has never
  shipped.
- The version bump goes through `npm version --no-git-tag-version`, so
  package.json and the lockfile stay in sync and keep their formatting.
- Order matters: bump, then build (the installer filename carries the version),
  then commit, tag, push, release. A failure after the bump rolls it back and
  commits nothing.
- The release commit is `git add -A` with the message `release for version
  x.y.z`. Bumping the version dirties the tree by definition, so refusing to
  run on a dirty tree just made the script unusable; instead everything that
  will be committed is listed for confirmation first. Do not "fix" this back
  into a dirty-tree guard.

PowerShell specifics that bit:

- **Splatting an array binds positionally, not by name.** `& $script @args`
  with `@('-DryRun')` puts the literal string `-DryRun` into the first
  positional parameter. menu.ps1 forwards arguments by invoking a child
  PowerShell instead, because native commands get the normal command-line
  parser.
- **A function's success-stream output is its return value.** `return
  $LASTEXITCODE` after calling a child swallowed everything the child printed.
  menu.ps1 lets output flow and reads `$LASTEXITCODE` afterwards.

- Native commands write to stderr for ordinary conditions -- `git describe` with
  no tags, for one -- and under `$ErrorActionPreference = 'Stop'` PowerShell
  turns that into a terminating error. Anything allowed to fail goes through
  `Invoke-Quiet` / `Invoke-GitQuiet` in scripts/common.ps1.
- Native commands never raise on a non-zero exit, so every step that must
  succeed goes through `Invoke-Checked` rather than its own forgotten
  `$LASTEXITCODE` test.

## Gotchas

- Server routes refuse any path that is not `.toml`/`.tml`, on both read and
  write. Keep that guard — it is what stops a typo overwriting an unrelated file.
- `/api/pick` passes the starting directory through the child process's
  environment rather than interpolating it into a command line. Do not tidy
  that into string concatenation.
- The picker has to be a server-side OS dialog: a browser reports
  `C:\fakepath\name.toml` for a file input and the File System Access API
  returns an opaque handle, but saving works by absolute path.
- Writes go to a temp file and are renamed; saves send the `mtimeMs` from the
  read and are rejected with 409 if the file changed underneath.
- Adding or removing keys and sections is deliberately unsupported. Only values,
  and array items, can change.
