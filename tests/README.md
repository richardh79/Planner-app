# Tests

Three small scripts, no framework. They exist because each one pins a bug that
shipped and was found by a person instead of by a check.

| Script | What it pins |
|---|---|
| `logic.unit.js` | A block assignment survives the timetable being edited. |
| `names.js` | Every name a page uses is defined by its scripts or the browser. Run it after moving code between files. Needs `npm i acorn eslint-scope`. |
| `planner.e2e.js` | The app (planner.html) at phone and PC width: every section draws with no sideways scroll, the PC project and its Planner path are one card, and an answer, a date clean-up, a block assignment and a to-do each land in the right file; the old addresses (index, desktop, brief, projects) hold no screen of their own and open the app. |

Run them before publishing:

```
node tests/logic.unit.js && node tests/names.js
node tests/planner.e2e.js
```

The end-to-end script needs Playwright (`npm i playwright`, or set
`PLAYWRIGHT_PATH`) and a Chromium (`CHROMIUM_PATH` if it is not the one
Playwright installs). It serves the repository from a local port and
intercepts `api.github.com`, so nothing leaves the machine.
