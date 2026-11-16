# Planner

A small installable app that runs entirely in the browser and talks to one
GitHub repository of your own. There is no server, no database and no account
to create. The page is static; everything it shows comes from a repository you
name, fetched with a token you make.

This repository holds the code only. It contains no data of any kind.

## One app

`planner.html` is the app, on a phone and on a wide screen alike. It has five
sections:

- **Today.** The block of the timetable you are in, what waits on you, what is
  moving, the dates to watch and who you are waiting on.
- **Projects.** Every project as one card, and one page per project.
- **Week.** The timetable, with a project assigned to a block by one tap.
- **For you.** Decisions, your own tasks and your to-dos for the projects in
  work. Past dates, reminders and items from parked work sit folded under
  "Not for today".
- **More.** The connection, notifications, the send queue and Repair.

Offline capable. Writes queue locally and send when the signal returns.

`index.html`, `desktop.html`, `brief.html` and `projects.html` are not screens.
Each is a few lines that open `planner.html`, kept only so old links and icons
installed earlier still work. Nothing else may be added to them.

## Setup

1. Enable Pages on this repository: Settings, Pages, deploy from a branch,
   `main`, root. Wait a minute, then open `<your pages url>/planner.html`.
2. Make a fine-grained personal access token at github.com, Settings, Developer
   settings, Personal access tokens. Give it access to your data repository
   only, with **Contents** and **Issues** set to read and write. Nothing else.
3. In the app, open More, enter the repository as `owner/name`, paste the
   token and save. The token stays on that device.
4. Install it: in Chrome or Edge use the install button in the address bar; on
   a phone use Add to Home Screen.

## What it expects in your repository

`data/board.json`:

```
updated   "YYYY-MM-DD"
headline  one sentence
threads[] {id, n, c, st[], at, tag, why}
week[7][] [label, title, sub, colourVar, startMin, endMin, isWorkBlock]
open[]    questions waiting on you
```

`startMin` and `endMin` are minutes past midnight. A block whose start equals
its end is a marker rather than a block and never counts as the current one.
`c` and `colourVar` are CSS custom property names defined in `planner.css`.

The app also writes `data/log.jsonl`, one JSON object per tracked session,
`data/status.jsonl` when a stage is set by hand, and `data/plan.jsonl` when a
block is assigned to a thread. All three are append-only: the last line for a
key wins, and nothing is ever rewritten in place.

Threads may also carry `dom` (which category they belong to), `files` (repo
paths), `next`, `who` and `critical`. `domains[]`
gives each category its name and colour.

**`final`** is optional and names where a path ends: `"Accepted"`, `"Granted"`,
`"Launched"`. Leave it out and the last entry in `st[]` is used, so no board
needs migrating. **`next`** is the step under your feet right now.

The app reads a thread as a path: `st[]` are the stones, the current
stage is where you stand, and `final` is the flag at the end. `next` is the
one step after this one. Nothing about that is stored differently; it is the
same board read as a walk rather than a table.

## Files

| File | What it is |
|---|---|
| `planner.html` | The page: the frame, the navigation and the two scripts. |
| `planner.js`, `planner.css` | The five sections and how they look. |
| `core.js` | Shared logic: reading the repository, the write queue, the timetable, dates, to-dos, notifications, the version check. |
| `sw.js` | The service worker: keeps the app's own files for offline use and shows notifications. It never caches data. |
| `update.html` | The repair page: clears a stale install and reopens the app. |
| `version.json` | The published build. The app compares it with its own and repairs itself when it moves. |
| `manifest.webmanifest`, `desktop.webmanifest` | The install manifests (phone and wide screen). |
| `index.html`, `desktop.html`, `brief.html`, `projects.html` | Redirects to `planner.html`, nothing more. |
| `tests/` | See `tests/README.md`. |

## Changing it

1. Edit `planner.js`, `planner.css` or `core.js`.
2. Run the tests: `node tests/logic.unit.js`, `node tests/names.js`,
   `node tests/planner.e2e.js` (see `tests/README.md` for what they need).
3. Bump the version in every place together: `build` in `version.json`,
   `BUILD` in `core.js`, the `?v=` numbers in `planner.html` and in the `SHELL`
   list of `sw.js`, and `CACHE` in `sw.js`.
4. Push. Pages publishes in about a minute; check `version.json` on the site.
   A device that still shows an older build: More, then Repair this app.

One rule keeps it from growing sideways: a new screen replaces the old one in
the same commit. No second page, no "classic" copy and no switch between two
versions.
