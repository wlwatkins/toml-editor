<div align="center">

<img src="build-resources/icon.png" width="96" alt="TOML Editor icon">

# TOML Editor

**Edit a TOML, JSON, JSONC or YAML file as a form. Save it back without touching a byte you didn't change.**

[![Latest release](https://img.shields.io/github/v/release/wlwatkins/toml-editor?label=release&color=00e5ff&labelColor=0a0a0a)](https://github.com/wlwatkins/toml-editor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/wlwatkins/toml-editor/total?color=00e5ff&labelColor=0a0a0a)](https://github.com/wlwatkins/toml-editor/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-00e5ff?labelColor=0a0a0a)](#installing-it)
[![Formats](https://img.shields.io/badge/TOML%20%C2%B7%20JSON%20%C2%B7%20JSONC%20%C2%B7%20YAML-supported-00e5ff?labelColor=0a0a0a)](#what-you-can-edit)
[![Runs offline](https://img.shields.io/badge/runs-100%25%20local-00e5ff?labelColor=0a0a0a)](#private-by-construction)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-00e5ff?labelColor=0a0a0a)](LICENSE)

[![Svelte 5](https://img.shields.io/badge/Svelte-5-ff3e00?logo=svelte&logoColor=white&labelColor=0a0a0a)](https://svelte.dev)
[![Electron 44](https://img.shields.io/badge/Electron-44-47848f?logo=electron&logoColor=white&labelColor=0a0a0a)](https://www.electronjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white&labelColor=0a0a0a)](https://www.typescriptlang.org)

<br>

<img src="assets/editor.png" width="900" alt="TOML Editor with sample.toml open: a section outline on the left, a Top level card with typed inputs for a string, a bool toggle, an int shown as 2_500 and a float, each with its comment above it">

<sub>Every key becomes a control, every section a card, and every comment from the file sits beside the key it describes. Note the <code>2_500</code>: number formatting is kept exactly as written.</sub>

<br><br>

[**Download the installer**](https://github.com/wlwatkins/toml-editor/releases/latest) · [Features](#features) · [What saving actually does](#what-saving-actually-does) · [Comments](#comments)

</div>

---

## Why

Config GUIs usually have one fatal flaw: they parse the file into an object,
let you edit the object, and write the object back out. Comments vanish, keys
get re-ordered, `2_500` becomes `2500`, and the diff for a one-line change is
the whole file.

TOML Editor does not rebuild the file. It records where every value sits in
the original text and, on save, **replaces only the characters of the values
you changed**. Edit two fields in a 400-line config and you get a two-line diff.

It does this for **TOML, JSON, JSON with comments and YAML**. The format comes
from the file's extension, and each keeps its own conventions: TOML keeps
`2_500` and its quoting styles, JSON keeps your indentation, YAML keeps block
scalars, flow versus block style, and anchors.

## Features

- **The right control for every key.** Text boxes, number fields, toggles,
  date and time pickers, list editors for arrays, nested fields for inline
  tables. Sections become cards, nested by path depth, with an outline pinned
  beside the content for jumping around.
- **Comments are first-class.** Each comment is shown next to the key or section
  it belongs to and rendered as Markdown: headings, banners, lists, code, links.
  Long blocks fold to their first line. Nothing is dropped, not even a note
  sitting on its own between blank lines.
- **Filter as you type.** The **Filter** box under the path bar narrows the form
  to the fields whose key, value or comment contains what you typed, section
  outline included. Naming a section keeps all of it. Comments only count while
  they are being shown -- with **Comments: off** the filter searches keys and
  values only. `Ctrl+F` jumps to the box, `Esc` empties it.
- **Saving is surgical.** Comments, key order, blank lines, number formatting,
  quoting style and alignment survive byte for byte.
- **Validated as you type.** An invalid integer or date is flagged inline and
  blocks saving, so the file never receives something that will not parse.
- **Raw view before you commit.** The **Raw** tab shows the exact text Save will
  write.
- **Four formats, one editor.** `.toml`, `.tml`, `.json`, `.jsonc`, `.yaml` and
  `.yml`. The format is chosen from the extension and shown in the toolbar; the
  form, the comments and the surgical save work the same way in all of them.
- **Convert between them.** **Convert…** in the toolbar (File -> Convert to…)
  writes the open file out as any of the other three. It tells you what the
  target format cannot hold *before* it writes anything, shows the full output,
  and saves to a new file -- the one you have open is never touched.
- **Safe on disk.** Writes are atomic, external edits are detected and refused
  with a conflict message, and only those extensions can be opened or written,
  so a mistyped path fails loudly rather than clobbering something else.
- **A proper desktop app.** Frameless window, native Open dialog, an
  "open with" entry for `.toml` files, and a file path accepted on the command
  line.
- **Keeps itself current.** On start-up it quietly asks GitHub for a newer
  release and, if there is one, offers it. Nothing downloads until you say so,
  and nothing installs until you choose **Restart and install**. **Help ->
  Check for updates…** does it on demand. Windows and Linux only; the macOS
  build is unsigned and cannot self-update.

### Private by construction

It runs entirely on your machine. There is no server and no telemetry, and
nothing is uploaded anywhere. The only network request it ever makes is the
update check against this repository's GitHub releases.

## Installing it

Every release on the
[releases page](https://github.com/wlwatkins/toml-editor/releases/latest)
carries a build for each platform:

| Platform | File | Notes |
| --- | --- | --- |
| Windows x64 | `TOML-Editor-Setup-<version>.exe` | Installs per-user with no admin prompt, lets you choose the folder, adds Start menu and desktop shortcuts. Self-updates. |
| macOS | `TOML-Editor-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel) | Unsigned, see below. No self-update. |
| Linux x64 | `TOML-Editor-<version>-x86_64.AppImage` | Mark it executable and run it. Self-updates. |

Passing a file on the command line works on every platform:

```
"TOML Editor.exe" C:\path\to\config.toml
```

> **The macOS and Linux builds are untested.** I only have a Windows machine.
> Those two are built by GitHub Actions on Apple's and Ubuntu's runners from
> the same commit as the Windows installer, and I have never run either. If
> you try one, please [open an issue](https://github.com/wlwatkins/toml-editor/issues)
> and say how it went, good or bad. That feedback is the only testing they get.
>
> The macOS app is not signed or notarised, since that needs a paid Apple
> developer account. On first launch macOS will refuse it; open **System
> Settings -> Privacy & Security** and choose **Open Anyway**, or clear the
> quarantine flag with `xattr -d com.apple.quarantine "/Applications/TOML Editor.app"`.

<div align="center">
<img src="assets/welcome.png" width="720" alt="The empty editor: a path bar with Open, Browse and Save buttons over a perspective grid, and a Browse for a file button in the centre">
<br>
<sub>Launch it, type or browse to a path, and the form appears.</sub>
</div>

## What you can edit

| Value                    | Control                                         |
| ------------------------ | ----------------------------------------------- |
| String                   | Text box, or a textarea for multi-line values   |
| Integer / float          | Number input (text, for hex/octal/underscored)  |
| Boolean                  | Toggle                                          |
| Local date / time        | Native date and time pickers (TOML)             |
| Local date-time          | Native date-time picker (TOML)                  |
| Offset date-time         | Text box (no browser control keeps the zone)    |
| `null`, `~`              | Text box taking any single value of that format |
| Array / sequence         | List editor: edit, reorder and add/remove items |
| One-line table or object | Nested fields, patched in place                 |
| Nested table or mapping  | A section card each, nested by path depth       |

### Per format

| Format | Extensions | Notes |
| --- | --- | --- |
| TOML | `.toml`, `.tml` | `[table]` and `[[array]]` headers become sections. Number formatting (`2_500`, `0xff`) and every quoting style survive. |
| JSON | `.json` | Strict: no comments, no trailing commas. A nested object becomes a section; an object written on one line stays a single field. Your indentation width is read back from the file and reused. |
| JSONC | `.jsonc` | JSON plus `//` and `/* */` comments and trailing commas. Comments are attached and rendered like TOML's. |
| YAML | `.yaml`, `.yml` | Block and flow style are each kept as written, along with block scalars (`|`, `>`), quoting style, and comments. A plain string that would read back as a number, a boolean or `null` is quoted on save so its type cannot drift. |

**Close** (File -> Close file, or Ctrl+W) puts the editor back to its empty
state. With unsaved changes it asks first, naming how many would be lost; the
path stays in the location bar so the file is one click away again.

### Not supported

Adding or removing **keys and sections**. The form edits the values of what is
already in the file; array items are the exception and can be added and
removed. Restructuring a file is still a text-editor job.

In YAML specifically: a file holding **several documents** separated by `---`
is refused rather than edited, and an **alias** (`*ref`, including a `<<` merge
key) is shown but read-only — rewriting the reference in one place would not
change what it points at.

## Converting between formats

**Convert…** in the toolbar, or **File -> Convert to…**, rewrites the open
document in one of the other three formats. It is the one thing in this editor
that is *not* surgical: the target has different syntax for everything, so the
file is generated afresh rather than patched.

So the dialog leads with the cost. It lists exactly what this conversion will
change or lose -- with counts, and with the keys named where that helps --
before the button that writes anything:

| Going to | What it costs |
| --- | --- |
| Any format | Blank lines, indentation, alignment and your quoting style. Keys, values and comments are what carry over. |
| JSON | Every comment, because JSON has none. Dates and times become quoted strings. `inf` and `nan` become `null`. |
| JSONC | Nothing beyond the layout: comments are rewritten with `//`, in the same places. |
| TOML | `null` (TOML has no such value) -- those keys are listed by name and left out. Keys move above their sub-sections, as TOML requires. A YAML alias or tagged node, which cannot be re-expressed anywhere else. A file whose top level is a list cannot become TOML at all, and is refused rather than mangled. |
| YAML | Nothing, usually. `inf` becomes `.inf`; a date becomes an unquoted scalar, which a YAML 1.2 reader hands back as text. |
| TOML-flavoured numbers | `2_500`, `0xff` and `0o17` are rewritten in plain decimal anywhere but TOML. The value is the same; the spelling is not. |

What does carry over is more than you might expect: comments (to any format
that has them, including the ones that sit alone between blank lines),
key order, sections, arrays of tables, multi-line strings as block scalars,
and strings that would otherwise read back as a number or a boolean, which
stay quoted so their type cannot drift.

The output is shown in full under **Preview** first. Unsaved edits are included
in it. **Convert** writes to the path in the box -- the same name with the new
extension, by default -- and asks first if something is already there. Nothing
is written to the file you have open, which keeps its pending changes either
way. **Copy** puts the output on the clipboard instead.

## What saving actually does

The parser turns the file into a tree where every value remembers its exact
character range in the original text. A save replaces **only the ranges whose
values you changed**. Everything else survives byte for byte:

- comments, both on their own line and trailing a value
- key order, blank lines and section order
- number formatting such as `2_500`, `0xff`, `1e6`
- quoting style: `'literal'` stays literal, `"""multi-line"""` stays multi-line,
  a YAML block scalar stays a block scalar at the same indentation
- your alignment, e.g. `host = "127.0.0.1"   # bind address`

A value edited back to its original text produces no change at all. Arrays are
the one exception: when items are added, removed or reordered the whole array
is re-rendered, since new items have no original text.

Two other safeguards:

- **Writes are atomic.** The new text goes to a temp file which is then renamed
  over the original, so an interrupted save cannot truncate your config.
- **External edits are detected.** If the file changed on disk after you opened
  it, saving is refused with a conflict message instead of overwriting the
  newer version.

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

The same applies to YAML's `#` comments and to JSONC's `//` and `/* */` ones.
Plain JSON has no comments, so the **Comments** control is hidden for it.

Any block longer than two lines gets a disclosure triangle. The **Comments**
control in the toolbar sets the default for the whole file, and the choice is
remembered between sessions:

| Mode      | Effect                                        |
| --------- | --------------------------------------------- |
| **Full**  | everything expanded                           |
| **Brief** | every long block folded to a one-line summary |
| **Off**   | comments hidden entirely                      |

Comment text is escaped before any markup is generated, so nothing in a file
can turn into live HTML; a `<script>` in a comment is displayed as the text it
is. A link is only made clickable for `http`, `https` and `mailto`.

Comments the editor cannot attach to a specific key, such as a banner at the
top of the file or a note sitting on its own between blank lines, are kept and
shown above whatever follows them rather than dropped.

## Look

The editor wears **Grid**: neon cyan on black, hairline borders that glow, a
perspective grid on the backdrop and translucent panels that read as edge-lit
glass. Everything the OS normally provides still works in the frameless
window: edge-drag resizing, Aero Snap, double-click to maximise and Win+Arrow.

## License

[GPL-3.0](LICENSE). Use it at home or at work, on as many machines as you
like, and modify it freely. If you redistribute it, in original or modified
form, you must pass on the source code and the same freedoms to whoever
receives it.

---

<div align="center">
<sub>Built with Svelte 5, SvelteKit 2 and Electron. Source and issues on <a href="https://github.com/wlwatkins/toml-editor">GitHub</a>.</sub>
</div>
