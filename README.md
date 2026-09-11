# TOML Editor

Edit a TOML file on your machine as a web form instead of as raw text.

Point it at a `.toml` file, and every key becomes an input — text boxes, number
fields, toggles, date pickers, array list editors — grouped into the same
sections the file uses, with each comment shown next to the key or section it
belongs to. Press **Save** and the file on disk is updated.

It runs entirely on your machine. Nothing is uploaded anywhere.

## Running it

On Windows, double-click **`run.cmd`**. It installs dependencies on first run,
starts the server and opens your browser. (`run.ps1` holds the actual logic;
`run.cmd` exists because Windows opens a double-clicked `.ps1` in an editor
rather than running it.)

The port is derived from this folder's path, so it is the same every time and
will not collide with your other Svelte dev servers. Launching it again while
it is already running just opens the browser at the running copy; if another
program has taken the port, the next free one is used.

To open a file straight away:

```
run.cmd -File C:\path\to\config.toml
```

Or start it by hand:

```sh
npm install
npm run dev
```

Either way, choose a file with **Browse…**, which opens your operating
system's own file dialog, or type a path into the location bar. You can also
deep-link to a file with `?file=C:\path\to\config.toml`.

Keep the terminal window open while you edit; it is what serves the app.

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
npm run dev        # dev server
npm run check      # svelte-check (type checking)
npm test           # both unit suites
npm run test:toml  # round-trip tests for the TOML layer
npm run test:md    # comment Markdown renderer, including its escaping
npm run build      # production build
```

`npm run test:toml` is the important one when touching anything under
`src/lib/toml/`. It asserts, among other things, that editing one value changes
exactly one line and that a file with no pending edits round-trips unchanged.

`examples/sample.toml` exercises every supported value type and is a good file
to open while poking at the UI.

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
src/routes/api/pick/       opens the OS file dialog, returns the chosen path
src/routes/gallery/        theme gallery (see below)
run.ps1 / run.cmd          double-click launcher
```

### Why the file picker is a server call

A browser cannot tell a page the real path of a chosen file -- `<input type="file">` reports `C:\fakepath\name.toml`, and the
File System Access API
hands back an opaque handle. Since saving works by path, `/api/pick` shells out
to the platform's own dialog (a Windows common dialog, `osascript` on macOS,
`zenity` on Linux) and returns the absolute path. The starting directory is
passed through the child process's environment, never interpolated into a
command line.

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

### Deploying it as a standalone app

The project uses `@sveltejs/adapter-auto`, which has no local target, so
`npm run build` produces output but not a runnable server. For a standalone
local app, install `@sveltejs/adapter-node` and swap the import in
`vite.config.ts`; `node build` then serves it without the dev server.
