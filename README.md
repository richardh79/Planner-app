# Planner

A small installable board that runs entirely in the browser and talks to one
GitHub repository of your own. There is no server, no database and no account
to create. The page is static; everything it shows comes from a repository you
name, fetched with a token you make.

This repository holds the code only. It contains no data of any kind.

## What it does

- **Now.** Reads the clock against your week and shows the block you are in,
  how long is left, and what comes next.
- **Threads.** Each piece of work with its stage and progress. One tap starts
  tracking, another stops it, and the session is appended to a log file in your
  repository.
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

The app also writes `data/log.jsonl`, one JSON object per tracked session.

## Files

`index.html` shell and styling, `app.js` everything else, `sw.js` the service
worker, `manifest.webmanifest` what makes it installable.

Check syntax before pushing: `node --check app.js && node --check sw.js`.
A missing bracket ships a blank screen. Bump `CACHE` in `sw.js` whenever
`app.js` or `index.html` changes, or browsers keep serving the old copy.
