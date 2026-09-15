# Planner

A small installable board that runs entirely in the browser and talks to one
GitHub repository of your own. There is no server, no database and no account
to create. The page is static; everything it shows comes from a repository you
name, fetched with a token you make.

This repository holds the code only. It contains no data of any kind.

## What it does

- **Now.** Reads the clock against your week and shows the block you are in,
  how long is left, and what comes next.
- **Work.** Each piece with its stage and progress. One tap starts tracking,
  another stops it, and the session is appended to a log file in your
  repository. **Several threads can run at once**, because real days are not
  single-threaded; each keeps its own clock and logs its own session.
- **Say.** Speak or type an update, tag it to a thread, and it becomes an issue.
- **Inbox.** Open issues with their replies, and a button to close one.

Offline capable. Writes queue locally and send when the signal returns.

## Setup

1. Enable Pages on this repository: Settings, Pages, deploy from a branch,
   `main`, root. Wait a minute, then open the URL it gives you.
2. Make a fine-grained personal access token at github.com, Settings, Developer
   settings, Personal access tokens. Give it access to your data repository
   only, with **Contents** and **Issues** set to read and write. Nothing else.
3. In the app, open settings, enter the repository as `owner/name`, paste the
   token, and save.
4. Chrome menu, Install app.

The token is stored in this browser alone and is sent only to `api.github.com`.
Nothing else ever sees it. Remove it from the same settings screen.

## The phone app

`index.html` is the phone. It reads the same board and now walks the same way
as the desktop view.

- **Work** is categories, collapsed. Tap one to open its paths. Each card shows
  the stage, where the path ends, and the time logged this week.
- **The path** opens from any thread: stones for the stages, the one you stand
  on marked, tap another to move it. The final and the next step sit under it.
  Setting a stage writes `data/status.jsonl` and opens an issue, exactly as the
  desktop does, so the two never disagree.
- **Now** draws the day with the assigned thread on each working block. A
  working block with nothing on it says so. Tap it and pick a thread from any
  category, and the choice is written to `data/plan.jsonl`.
- **Map** adds a lane per category, each path with how far along it is and the
  destination it ends at.
- **Files** linked to a thread open from the path, and a dated line can be added
  under any section from the phone. Patent files carry a warning, the same one
  the repository carries.

## The desktop view

`desktop.html` is the same data on a wide screen, built as three panes rather
than a page of cards: a rail of categories on the left, the threads in the
chosen category in the middle, and one thread open on the right. Nothing is
expanded that was not asked for.

The detail pane is where the work happens. For the open thread it carries the
stage (click a stage to set it), a start and stop timer, the files linked to
it, a box that turns what you type into an issue, and that thread's open
issues with a close button. Files open in the same pane: pick a section, add a
dated line, save, and the commit lands in the repository.

`Today` is the day's plan, drawn as a trail from morning to night. Every
working block takes exactly one thread, and a working block with nothing
assigned is drawn as a hole in the road. The choice is written to
`data/plan.jsonl`. That is the whole point of the view: capacity is rarely the
constraint, assignment is.

`The map` is every path at once, grouped by category, each with how far along
it you are and the final it ends at.

The header carries the walk as one sentence: the day and time, the block you
are in, the thread on it, the stage you stand on and how long the block has
left. Off the clock it names the next block instead. Disconnected it says so
and points at settings.

Keys: `⌘K` or `Ctrl+K` for the palette, `[` and `]` to move a stage back and
forward while a path is open, `/` for search, `r` to sync.

⌘K or Ctrl+K opens a command palette over every thread, category and file.

Open `<your pages url>/desktop.html`. In Chrome or Edge, the install button in
the address bar turns it into a desktop app in its own window. The phone app is
untouched: two manifests, two installs, one set of data.

## Keeping a phone current

A phone can hold an old copy of an installed web app for a very long time: the
shell is cached, the worker that cached it is cached, and nothing in that loop
ever asks whether anything moved. Three things close it.

- `version.json` carries the current build. Neither the service worker nor the
  browser cache is allowed to serve it.
- Both apps read it on open and whenever they come back to the foreground. If
  the build has moved they clear every cache, remove the worker and reload
  once. A guard stops that repeating.
- `update.html` does the same thing by hand, for a copy so stale that it cannot
  run the check. Open `<your pages url>/update.html` once and the install is
  repaired.

Settings in both apps shows the running build and carries a **Force update**
button. **Bump `version.json` on every publish**, alongside the `?v=` query on
the scripts and the service worker cache name.

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
`c` and `colourVar` are CSS custom property names defined in `index.html`.

The app also writes `data/log.jsonl`, one JSON object per tracked session,
`data/status.jsonl` when a stage is set by hand, and `data/plan.jsonl` when a
block is assigned to a thread. All three are append-only: the last line for a
key wins, and nothing is ever rewritten in place.

Threads may also carry `dom` (which category they belong to), `files` (repo
paths the detail pane can open), `next`, `who` and `critical`. `domains[]`
gives each category its name and colour.

**`final`** is optional and names where a path ends: `"Accepted"`, `"Granted"`,
`"Launched"`. Leave it out and the last entry in `st[]` is used, so no board
needs migrating. **`next`** is the step under your feet right now, and the
desktop view shows it directly under the path.

The desktop view reads a thread as a path: `st[]` are the stones, the current
stage is where you stand, and `final` is the flag at the end. `next` is the
one step after this one. Nothing about that is stored differently; it is the
same board read as a walk rather than a table.

## Files

`index.html` shell and styling, `app.js` everything else, `sw.js` the service
worker, `manifest.webmanifest` what makes it installable. `desktop.html`,
`desktop.js` and `desktop.webmanifest` are the wide view and install the same
way.

**One building block: the band.** Every card, row and block is a `.band` whose
accent comes from a single `--a` custom property, and its background is mixed
from that accent with `color-mix`. Colour is applied to the element itself.

Never tint by layering an absolutely positioned pseudo-element over content.
An earlier build did, and it washed the whole page out and swallowed taps on
anything the overlay covered. If `color-mix` is unsupported the band falls back
to a plain surface, which is dull but correct.

Minimum touch target is 44px, base type is 17px, and both themes are real: the
palette is defined for light and dark and a toggle in the header overrides the
system setting.

Check syntax before pushing: `node --check app.js && node --check sw.js`.
A missing bracket ships a blank screen.

**Bump the version on every change to `app.js` or `index.html`.** There are
three places and all three must move together: the `?v=` on the script tag in
`index.html`, the same `?v=` in the `SHELL` list and the `CACHE` name in
`sw.js`, and the `?v=` on the `register()` call in `app.js`.

This is not tidiness. Pages serves assets with browser caching, so a new
`index.html` will happily run an old `app.js`, and a nav button added in one
file calls a function that does not exist in the other. The app is built to
survive that (an unknown view falls back to Now) but the fix is the version.
