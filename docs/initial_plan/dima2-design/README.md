# dima2 UI design reference (v1)

Visual reference for the dima2 frontend: these are mockups, not production code. They are based on
the brainstorm doc (sections 4–14) and should be read together with it. When the doc and a mockup
disagree, the doc wins on behaviour; the mockups win on layout and visual details.

## What's here

| Path | Use it for |
|---|---|
| `screenshots/*.png` | The quickest way to see each screen. Look at these first. |
| `html/*.html` | Static HTML/CSS for each screen; open it in a browser. Take exact colours, sizes and spacing from here. Screens link to each other. |
| `source/*.dc.html`, `source/canvas.json` | The original design-canvas files, kept so the designs can be re-imported and edited later. Ignore them when writing code. |

## Screens

| Screen | Files | Brainstorm sections |
|---|---|---|
| Worktrees (home) | `Main` | §4, §14 "Worktrees page" |
| New worktree dialog | `NewWorktree` | §5 |
| Workspace: markdown review | `Workspace`, `Workspace-top-max.png`, `Workspace-bottom-max.png` | §6, §7, §14 "Worktree workspace", §14.1 |
| Workspace: code diff | `WorkspaceDiff` | §6 (non-md file selected) |
| Views | `Views` | §9 |

Not designed yet: the Projects page, the empty "select a file" state in the centre panel, and the "block not found" comment state.

## Design tokens

Dark only for v1.

| Token | Value | Used for |
|---|---|---|
| bg | `#121417` | app background |
| bg-chrome | `#0E1013` | top bar, panel divider |
| bg-panel | `#14171A` | file tree, comment rail, table body |
| bg-raised | `#1A1D21` | cards, inputs, buttons, dialogs |
| bg-terminal | `#0B0C0E` | xterm background |
| border | `#262A30` (strong `#343941`, subtle `#22262B`) | |
| text | `#E7E4DD` | primary |
| text-muted | `#A0A4AB` | secondary |
| text-faint | `#7C8188` | captions, table headers |
| accent | `#E8A33D` (hover `#F0B354`, text on it `#1A1205`) | primary buttons, active nav/tab underline, unsent comments, markdown counts |
| info | `#8DBBEE` / `#6CA6E8` | links, "running", M status |
| success | `#7FD1A6` | A status, diff additions, prompt cwd |
| danger | `#E89A8C` | D status, "exited", diff deletions |

Project colours: assign from a fixed palette by `djb2(name) % N`. The mockups use `#6CA6E8`, `#B38BE0` and `#5FBF8F`.

Type: IBM Plex Sans for the UI, IBM Plex Mono for branches, paths, counts, tabs and the terminal, and
IBM Plex Serif for rendered markdown, so the documents being reviewed look different from the app
around them. Base size is 14px; table and secondary text is 13px.

## Components and behaviour

- **Status pill** (worktrees table): `running` = info, `needs input` = accent, `idle` = muted, `exited` = danger. Each has a tinted background, a 1px border and a dot. An amber attention badge next to the branch ("review", "done") feeds the tab-title count.
- **Changes column**: show `N files`, plus ` · M md` in accent when M > 0.
- **File tree**: indented by folder. The status letter (A/M/D) sits right-aligned in mono, and `.md` names are tinted `#F0C27A`. Selecting a `.md` file opens the rendered preview with the comment rail. Selecting any other file opens the unified diff.
- **Markdown preview**: each block gets a numbered comment marker in a 40px gutter. A commented passage gets an accent underline and a light tint; once its comment is sent, the underline turns grey and dashed. A text selection shows an inline popover with a textarea and Cancel / Add comment buttons, not a modal.
- **Comment rail** (340px): comment cards show the number, a quoted snippet, the body and the state ("Not sent" or "Sent to session N · HH:MM"). Sent cards are dimmed and have a dashed border. At the bottom are the "Additional context" textarea and the primary button "Send N comments to session X", which targets the active terminal tab.
- **Terminal**: the tab bar is 40px, with tabs ordered oldest to newest and `+` at the end. The active tab has a 2px accent line on top. The right side holds the layout controls with Ctrl ↑ / Ctrl ↓ hints.
- **Layout states** (§14.1): the space below the two headers is split into top region, 6px divider and bottom region. *balanced* is the user's drag ratio (default about 57/43); *top-max* collapses the terminal to its 40px tab bar; *bottom-max* collapses the top to its 40px panel-header strip. Each Ctrl ↑ / Ctrl ↓ press moves one step.
- Panel widths: file tree 280px, comment rail 340px, centre panel flexible.

## Sample data

Project names, branches, counts, comments and terminal output are invented to fill the mockups.
The Views screen uses `[BRACKETED]` placeholders where real agent definitions would go.
