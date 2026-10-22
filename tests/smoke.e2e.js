// Opens both pages with a populated repository and pokes every view and the first
// handful of things on each, failing on any script error and on the "could not draw"
// message the pages show instead of crashing.
//
//   node tests/smoke.e2e.js [folder]          BOARD=/path/to/board.json to use a real board
//
// Needs Playwright (npm i playwright, or PLAYWRIGHT_PATH) and a Chromium (CHROMIUM_PATH).
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const APP = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/json", ".png": "image/png" };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(APP, p); if (!f.startsWith(APP) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" }); s.end(fs.readFileSync(f));
});

const day = n => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const sample = {
  updated: day(0), headline: "Sample board", apex: "Sample apex",
  domains: [{ id: "research", n: "Research", c: "--research" }, { id: "teaching", n: "Teaching", c: "--teaching" }],
  threads: [
    { id: "a", n: "Paper A", dom: "research", st: ["Drafting", "Submitted", "Accepted"], at: 1, c: "--research", goal: "papers", who: "Dr X", since: day(-20), chaseAfter: 7, next: "Chase Dr X", files: ["notes/a.md"] },
    { id: "b", n: "Paper B", dom: "research", st: ["Drafting", "Submitted", "Accepted"], at: 0, c: "--research", goal: "papers", next: "Write the methods" },
    { id: "c", n: "Course C", dom: "teaching", st: ["Planned", "Running", "Closed"], at: 1, c: "--teaching", unset: true }
  ],
  goals: [{ id: "papers", n: "Papers", c: "--research", now: 1, target: 3, counts: "Submitted", by: day(60) }],
  events: [{ id: "e1", n: "Seminar", c: "--research", date: day(3), start: 600, end: 660, where: "Hall" }],
  open: [{ id: "q1", q: "Which day?", opts: [{ a: "Sunday" }, { a: "Say it", say: true }] }, "A plain question"],
  week: [0, 1, 2, 3, 4, 5, 6].map(() => [["09:00-11:00", "Teaching", "Sample", "--c1", 540, 660, 0], ["13:00-21:00", "Shipping lane", "Work", "--research", 780, 1260, 1]])
};
const board = process.env.BOARD ? JSON.parse(fs.readFileSync(process.env.BOARD, "utf8")) : sample;
const ids = board.threads.map(t => t.id), t0 = ids[0], t1 = ids[1] || ids[0];
const now = new Date().toISOString();
const J = a => a.map(o => JSON.stringify(o)).join("\n") + "\n";
const files = {
  "data/board.json": JSON.stringify(board),
  "data/dates.jsonl": J([{ thread: t0, do: day(-2), at: now }, { thread: t1, do: day(0), at: now }]),
  "data/status.jsonl": J([{ thread: t1, stage: 0, label: "x", at: now }]),
  "data/ticks.jsonl": J([{ thread: t0, kind: "chase", day: day(-3), at: now }]),
  "data/answers.jsonl": J([]),
  "data/added.jsonl": J([{ id: "new-1", n: "Added thing", dom: board.domains[0].id, st: ["Scoping", "Done"], at: 0, c: board.domains[0].c, added: now }]),
  "data/todos.jsonl": J([{ id: "td-1", thread: t0, text: "Do the thing", due: day(-1), at: now }, { id: "td-2", thread: null, text: "Loose", due: null, at: now }]),
  "data/pins.jsonl": J([{ thread: t0, pinned: true, at: now }]),
  "data/suggestions.jsonl": J([{ id: "sg-1", issue: 1, title: "Update", at: now, thread: t0, summary: "A summary", todos: [{ text: "Follow up", due: day(2) }], stage: null }]),
  "data/week.jsonl": J([]),
  "data/log.jsonl": J([{ thread: t0, start: now, end: now, minutes: 25 }]),
  "desktop/sessions.jsonl": J([{ ts: now, folder: "somefolder", thread: t0, start: now, end: now, active_minutes: 40, tokens: { in: 1, out: 2, cache_read: 3, cache_write: 4 } }, { ts: now, folder: "unlinked", thread: null, how: "ask", candidates: [t0], start: now, end: now, active_minutes: 5 }]),
  "desktop/links.jsonl": J([]),
  "notes/a.md": "# Notes\n\n## Log\n\n- 2026-01-01 start\n"
};
const b64 = t => Buffer.from(t, "utf8").toString("base64");
const issues = [{ number: 7, title: "Update: Paper A", body: "text\n\n---\nThread: `" + t0 + "` x", state: "open", comments: 1, user: { type: "User" }, labels: [], created_at: now, updated_at: now }];

let fail = 0;
const check = (n, ok, d) => { if (!ok) fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "   " + (d || ""))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function walk(browser, base, page_, errorProbe, clickables, label) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: page_ === "desktop.html" ? { width: 1500, height: 900 } : { width: 420, height: 860 } });
  await ctx.route("https://api.github.com/**", r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
    const json = (c, o) => r.fulfill({ status: c, contentType: "application/json", body: JSON.stringify(o) });
    if (p.startsWith("/contents/")) {
      const fp = decodeURIComponent(p.slice(10));
      if (req.method() === "GET") return files[fp] === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: "s", size: files[fp].length, content: b64(files[fp]), encoding: "base64" });
      return json(200, { content: { sha: "s2" } });
    }
    if (p.startsWith("/issues/7/comments")) return json(200, [{ id: 1, body: "Filed.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_", user: { type: "User", login: "me" }, created_at: now }]);
    if (p.startsWith("/issues")) return req.method() === "POST" ? json(201, { number: 8 }) : json(200, issues);
    return json(200, []);
  });
  await ctx.addInitScript(() => { localStorage.setItem("planner.repo", JSON.stringify("o/r")); localStorage.setItem("planner.token", JSON.stringify("tok")); });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("script error: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(base + page_); await sleep(1500);
  let steps = 0;
  for (const view of clickables.views) {
    await page.click(view.sel, { timeout: 3000 }).catch(() => {}); await sleep(250);
    const n = await page.evaluate(sel => document.querySelectorAll(sel).length, clickables.poke);
    for (let i = 0; i < Math.min(n, clickables.limit); i++) {
      await page.evaluate(([sel, i]) => { const e = document.querySelectorAll(sel)[i]; if (e) e.click(); }, [clickables.poke, i]).catch(() => {});
      await sleep(80); steps++;
      const bad = await page.evaluate(errorProbe);
      if (bad) errs.push(view.name + " item " + i + ": " + bad);
      await page.keyboard.press("Escape"); await sleep(40);
      await page.click(view.sel, { timeout: 1500 }).catch(() => {});
    }
    const bad = await page.evaluate(errorProbe); if (bad) errs.push(view.name + ": " + bad);
  }
  check(label + ": " + steps + " things poked across " + clickables.views.length + " views, no error", errs.length === 0, errs.slice(0, 4).join(" | "));
  await ctx.close();
}

(async () => {
  await new Promise(r => server.listen(0, r)); const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const phoneProbe = () => { const e = document.querySelector("main .note.bad"); return e && /Could not draw/.test(e.textContent) ? e.textContent : ""; };
  await walk(browser, base, "index.html", phoneProbe, {
    views: ["now", "map", "threads", "say", "inbox"].map(v => ({ name: v, sel: 'nav button[data-v="' + v + '"]' })),
    poke: "main .band, main button, main .todo, main .row", limit: 14
  }, "phone");
  const deskProbe = () => { const e = document.getElementById("stateTxt"); return e && /Render failed/.test(e.textContent) ? e.textContent : ""; };
  const rail = ["One look", "Today", "The week", "Weekly review", "Messages", "The map", "Questions", "Files"];
  await walk(browser, base, "desktop.html", deskProbe, {
    views: rail.map(t => ({ name: t, sel: "text=" + t })),
    poke: "#list button, #list .item, #list .row, #detail button", limit: 12
  }, "desktop");
  await browser.close(); server.close();
  console.log(fail ? "\n" + fail + " FAILED" : "\nall passed"); process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR", e.message.split("\n")[0]); process.exit(2); });
