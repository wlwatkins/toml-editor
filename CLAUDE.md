# CLAUDE.md

## Project

`toml-editor` — a local SvelteKit app that renders a TOML file on disk as a web
form and writes edits back to it. See README.md for user-facing behaviour.

Not a git repository.

## Commands

```sh
run.cmd              # what the user double-clicks: picks a port, opens a browser
npm run dev          # vite dev server
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
run.ps1, run.cmd         launcher; run.cmd exists because Windows opens a
                         double-clicked .ps1 in an editor instead of running it
```

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
  `@types/node` for the server routes, `adapter-auto` (no target pinned, so
  `npm run build` warns and produces no runnable server; `npm run dev` is the
  way to run this).
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

## run.ps1

Two things in there are load-bearing and easy to "simplify" wrongly:

- Vite is invoked as `node node_modules/vite/bin/vite.js`, not via
  `npm run dev -- --port ...`, because PowerShell swallows the `--` separator
  and npm then eats the flags instead of forwarding them.
- Port availability is checked with `Get-NetTCPConnection`. Binding a test
  socket reports a busy port as free (a server on the IPv6 loopback leaves the
  IPv4 address bindable), and a short timed connect is a race a cold process
  loses. Both were tried; both were wrong.

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
