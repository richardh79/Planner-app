# Tests

Six small scripts, no framework. They exist because each one pins a bug that
shipped and was found by a person instead of by a check.

| Script | What it pins |
|---|---|
| `dictation.unit.js` | The dictation merge. Desktop Chrome and Android send different shapes; neither may repeat a phrase or drop words. |
| `logic.unit.js` | A block assignment survives the timetable being edited. A bot's comment is not an answer. |
| `phone.e2e.js` | The phone page in real Chromium: dictation restarts after the browser ends a session and stops when told; a spoken answer is recorded as an answer; a rejected write does not block the queue; a file over 1 MB is never overwritten; the version check does not reload the page. |
| `smoke.e2e.js` | Both pages with a populated repository: every view is opened and the first things on it clicked, failing on any script error or on the "could not draw" message. `BOARD=/path/board.json` runs it on a real board. |
| `names.js` | Every name a page uses is defined by its scripts or the browser. Run it after moving code between files. Needs `npm i acorn eslint-scope`. |
| `desktop.e2e.js` | The same dictation checks on the desktop page, a Delay or Drop writes a day, and leaving the weekly review sends its summary. |

Run all four before publishing:

```
node tests/dictation.unit.js && node tests/logic.unit.js && node tests/names.js
node tests/phone.e2e.js && node tests/desktop.e2e.js && node tests/smoke.e2e.js
```

The two end-to-end scripts need Playwright (`npm i playwright`, or set
`PLAYWRIGHT_PATH`) and a Chromium (`CHROMIUM_PATH` if it is not the one
Playwright installs). They serve the repository from a local port and
intercept `api.github.com`, so nothing leaves the machine.
