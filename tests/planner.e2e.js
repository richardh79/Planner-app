// The new app (planner.html) in real Chromium with a fake GitHub API and made-up data.
// Every section draws at phone and PC width with no sideways scroll and no script error, and each kind of write
// lands in the right file: an answer, a date clean-up, a block assignment and a to-do.
//
//   node tests/planner.e2e.js [app folder]        SHOTS=<folder> saves screenshots
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const APP = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".webmanifest":"application/json", ".png":"image/png" };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/planner.html";
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" }); s.end(fs.readFileSync(f));
});
const day = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const wk = [];
for (let d = 0; d < 7; d++) wk.push([["09:00–11:00", "Deep work", "", "--c1", 540, 660, 1], ["13:00–14:00", "Lecture", "Room 2", "--c2", 780, 840, 0]]);
const BOARD = {
  updated: day(0), headline: "x", apex: "", domains: [{ id: "research", n: "Research", c: "--research" }, { id: "teaching", n: "Teaching", c: "--teaching" }],
  goals: [{ id: "papers", n: "Ten papers submitted", c: "--research", now: 6, target: 10, counts: "Submitted", by: day(40) }],
  threads: [
    { id: "p1", n: "Paper one", dom: "research", st: ["Drafting", "Submitted", "Accepted"], at: 0, c: "--research", goal: "papers", next: "Write results" },
    { id: "old", n: "An old idea with a passed date", dom: "research", st: ["Idea", "Done"], at: 0, c: "--research" },
    { id: "wait", n: "Data from a colleague", dom: "research", st: ["Asked", "Received"], at: 0, c: "--research", who: "Dr Someone", since: day(-20) },
    { id: "course", n: "A course file", dom: "teaching", st: ["Draft", "Done"], at: 0, c: "--teaching" }
  ],
  events: [], open: [{ id: "q-one", q: "Small project: what happens next?", why: "Nothing moved for weeks.", opts: [{ a: "Give it a day" }, { a: "Drop it" }] }],
  week: wk
};
const PORT = {
  at: new Date().toISOString(), richard: { at: new Date().toISOString(), kind: "evening", lines: ["Moved today: Paper one 50% to 58%", "Due soon: Paper one"] },
  projects: [{ id: "aaaa1111", name: "Paper one", thread: "p1", type: "paper", health: "red", why: ["EXCEPTION: late"], phase: "1. Analysis", progress: 58,
    next: "Draft the results", p85: day(8), due: day(2), window: { state: "working" },
    rec: { status: "active", passed: 7, total: 12, dates: { started: day(-9), due: day(2), due_confirmed: true, p50: day(3), p85: day(8) },
      phases: [{ title: "0. Design", status: "passed", gate: true, gate_passed: day(-7), done: 4, total: 4 }, { title: "1. Analysis", status: "active", gate: true, done: 3, total: 8 }],
      trend: [0, 5, 10, 20, 30, 35, 40, 45, 50, 55, 58, 58, 58, 58], risk_count: 2, next3: [{ title: "Draft the results", owner: "assistant" }],
      top_risks: [{ score: 12, title: "a risk" }], tasks: [{ id: "read", title: "Final read of the full draft", blocks: 2, critical: true }],
      decisions: [], doc_status: "# Status", doc_plan: "## Plan" } }],
  dormant: [{ name: "Some idea", status: "dormant" }], signoffs: []
};
const BRIEF = { at: new Date().toISOString(),
  needs: [{ q: "ask-1", kind: "ask", project: "Paper one", pid: "aaaa1111", text: "Which interval for the figure?", options: ["keep", "switch"], rec: "keep", detail: { why: "Reviewers asked" } }],
  tiles: [{ id: "aaaa1111", name: "Paper one", pct: 60, flag: "red", state: "working", next: "Running", you: [] }] };
const b64 = t => Buffer.from(t, "utf8").toString("base64");
let files, puts, posts;
function reset() {
  files = { "data/board.json": JSON.stringify(BOARD), "desktop/portfolio.json": JSON.stringify(PORT), "desktop/brief.json": JSON.stringify(BRIEF),
            "data/dates.jsonl": JSON.stringify({ thread: "old", do: day(-10), at: "x" }) + "\n" };
  puts = []; posts = [];
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/planner.html";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const vp of [{ name: "phone", width: 390, height: 844 }, { name: "pc", width: 1366, height: 900 }]) {
    reset();
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "en-GB" });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.route("https://api.github.com/**", route => {
      const req = route.request(), p = new URL(req.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
      const json = (code, o) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(o) });
      if (p === "/issues" && req.method() === "POST") { posts.push(JSON.parse(req.postData())); return json(201, { number: 1 }); }
      if (!p.startsWith("/contents/")) return json(200, []);
      const fp = decodeURIComponent(p.slice(10));
      if (req.method() === "GET") return files[fp] != null ? json(200, { sha: "s1", size: files[fp].length, content: b64(files[fp]), encoding: "base64" }) : json(404, { message: "Not Found" });
      const body = JSON.parse(req.postData()), text = Buffer.from(body.content, "base64").toString("utf8");
      puts.push({ path: fp, text }); files[fp] = text; return json(200, { content: { sha: "s2" } });
    });
    await page.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.addInitScript(() => { if (!sessionStorage.getItem("set")) { localStorage.clear(); localStorage.setItem("planner.token", JSON.stringify("t")); localStorage.setItem("planner.repo", "me/p"); sessionStorage.setItem("set", "1"); } });
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const broken = () => page.evaluate(() => /could not be drawn/.test(document.body.innerText));
    const shot = n => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, vp.name + "-" + n + ".png"), fullPage: true }) : null;
    const wrote = (file, re) => puts.some(x => x.path === file && re.test(x.text));
    const settle = () => page.waitForTimeout(500);

    await page.goto(base); await page.waitForSelector(".now"); await settle();
    ok(!(await broken()) && (await wide()) <= 0, vp.name + ": Today draws, no sideways scroll");
    ok(/Richard/.test(await page.textContent("main")), vp.name + ": Today shows Richard's brief");
    await shot("today");
    for (const r of ["projects", "week", "you", "more"]) {
      await page.goto(base + "#" + r); await settle();
      ok(!(await broken()) && (await wide()) <= 0, vp.name + ": " + r + " draws, no sideways scroll");
      await shot(r);
    }
    await page.goto(base + "#projects"); await settle();
    ok(await page.$('.card[href="#p/aaaa1111"]') !== null, vp.name + ": the PC project and its Planner path are one card");
    ok((await page.$$('.card[href="#t/p1"]')).length === 0, vp.name + ": no second card for the same project");
    await page.click('[data-pf="all"]'); await settle();
    ok(await page.$('.card[href="#t/course"]') !== null, vp.name + ": paths without a PC plan are listed");
    await page.goto(base + "#p/aaaa1111"); await settle();
    ok(!(await broken()) && (await wide()) <= 0 && (await page.$(".sched svg")) !== null, vp.name + ": project page with schedule and Planner path");
    await shot("project");
    await page.goto(base + "#t/wait"); await settle();
    ok(/Waiting on Dr Someone/.test(await page.textContent("main")), vp.name + ": path page shows who it waits on");

    await page.goto(base + "#you"); await settle();
    await page.click('.drow[data-d="ask-1"]'); await page.click('.sheet.on .opts button[data-a="keep"]'); await page.waitForTimeout(800);
    ok(wrote("data/answers.jsonl", /"q":"ask-1","a":"keep"/), vp.name + ": an answer goes to answers.jsonl");
    ok(await page.locator('.drow[data-d="date-old"]').isHidden(), vp.name + ": past dates are folded away under Not for today");
    await page.click('.fold[data-fold] > b');
    await page.click('.drow[data-d="date-old"]'); await page.click('.sheet.on .opts button[data-a="In 4 weeks"]'); await page.waitForTimeout(800);
    ok(wrote("data/dates.jsonl", /"thread":"old","do":"\d{4}-\d\d-\d\d"/), vp.name + ": a past date is re-dated in dates.jsonl");
    await page.goto(base + "#week"); await settle();
    await page.click('.wd.show [data-blk], .wd.today [data-blk]'); await page.click('.sheet.on [data-pick="course"]'); await page.waitForTimeout(800);
    ok(wrote("data/plan.jsonl", /"thread":"course"/), vp.name + ": a project goes on a block in plan.jsonl");
    await page.click("#fab"); await page.fill("#aText", "Buy printer ink"); await page.click('[data-addgo="todo"]'); await page.waitForTimeout(800);
    ok(wrote("data/todos.jsonl", /Buy printer ink/), vp.name + ": a to-do goes to todos.jsonl");
    ok(errors.length === 0, vp.name + ": no script errors" + (errors.length ? " (" + errors.slice(0, 3).join("; ") + ")" : ""));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
