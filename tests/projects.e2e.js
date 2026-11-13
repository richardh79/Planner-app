// The Projects page in real Chromium with a fake GitHub API: every view draws, nothing scrolls sideways at
// phone width, a decision opens its sheet and its answer is written to data/answers.jsonl.
//
//   node tests/projects.e2e.js [app folder]
// PORT_JSON / BRIEF_JSON: run on real files from the PC instead of the made-up ones (never commit those).
// SHOTS=<folder>: save screenshots there.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const APP = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const MIME = { ".html":"text/html", ".js":"text/javascript", ".json":"application/json", ".webmanifest":"application/json", ".png":"image/png" };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/projects.html";
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" }); s.end(fs.readFileSync(f));
});

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const PORT = {
  at: new Date().toISOString(),
  projects: [
    { id: "aaaa1111", name: "Paper one", type: "paper", health: "red", why: ["EXCEPTION: P85 finish is 6 d past the due date"], phase: "4. Analysis",
      progress: 58, next: "Draft the results", p85: day(8), due: day(2), window: { state: "idle" },
      rec: { status: "active", passed: 27, total: 36, dates: { started: day(-9), due: day(2), due_confirmed: true, p50: day(2), p85: day(8) },
        phases: [{ title: "0. Design", status: "passed", gate: true, gate_passed: day(-7), done: 7, total: 7 },
                 { title: "1. Analysis", status: "active", gate: true, done: 3, total: 9 },
                 { title: "2. Writing", status: "planned", gate: true, done: 0, total: 5 }],
        trend: [0, 0, 5, 10, 20, 30, 35, 40, 45, 50, 55, 58, 58, 58], risk_count: 5,
        next3: [{ title: "Draft the results", owner: "assistant" }, { title: "Final read", owner: "author" }],
        top_risks: [{ score: 16, title: "a long risk title that must wrap on a narrow phone screen without scrolling" }, { score: 9, title: "scanner variation" }],
        tasks: [{ id: "read", title: "Final read of the full draft", blocks: 2, critical: true }, { id: "auth", title: "Confirm the author list", blocks: 0, critical: false }],
        decisions: [{ date: day(-1), call: "Free memory or change the code?", answer: "free memory", by: "author" }],
        doc_status: "# Status\n\nProblem. Why: late.", doc_plan: "## 0. Design (passed)\n- [x] Design (assistant)" } },
    { id: "bbbb2222", name: "Chapter two", type: "chapter", health: "green", phase: "1. Writing", progress: 80, next: "Send the editor email",
      p85: day(5), due: day(9), window: { state: "off" },
      rec: { status: "active", passed: 8, total: 10, dates: { started: day(-20), due: day(9), p50: day(4), p85: day(5) }, phases: [], trend: [], tasks: [] } },
    { id: "cccc3333", name: "Old bank", type: "teaching", health: "green", progress: 100, phase: "all phases passed", window: { state: "off" },
      rec: { status: "done", passed: 4, total: 4, dates: {}, phases: [], tasks: [], closed: { date: day(-3), outcome: "Released", left: 0 } } }
  ],
  dormant: [{ name: "Some idea", status: "dormant" }],
  signoffs: []
};
const BRIEF = {
  at: new Date().toISOString(),
  needs: [{ q: "so-1", kind: "signoff", project: "Chapter two", text: "Submit the chapter", options: ["Approve", "Reject"], rec: null,
            detail: { what: ["Call: submit to the editor"], undo: "No: a critical step" } },
          { q: "ask-1", kind: "ask", project: "Paper one", pid: "aaaa1111", text: "Figure interval for the small group?", options: ["keep bootstrap", "switch to Wilson"],
            rec: "keep bootstrap", detail: { label: "Choose interval", why: "Reviewers asked", yes: "No change", no: "Figure redrawn", undo: "Yes", by: day(1) } }],
  tiles: [{ id: "aaaa1111", name: "Paper one", pct: 88, flag: "red", state: "working", next: "Running the model", heard: new Date().toISOString(), you: [] },
          { id: "dddd4444", name: "Side study", pct: 40, flag: "grey", state: "idle", next: "Write the appendix", you: [{ q: "you-1", text: "Send the agreement email" }] }],
  sessions: { idle: 1 }
};
const portData = process.env.PORT_JSON ? JSON.parse(fs.readFileSync(process.env.PORT_JSON, "utf8")) : PORT;
const briefData = process.env.BRIEF_JSON ? JSON.parse(fs.readFileSync(process.env.BRIEF_JSON, "utf8")) : BRIEF;
const b64 = t => Buffer.from(t, "utf8").toString("base64");
const files = { "desktop/portfolio.json": JSON.stringify(portData), "desktop/brief.json": JSON.stringify(briefData) };
const puts = [];

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/projects.html";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const vp of [{ name: "phone", width: 390, height: 844 }, { name: "pc", width: 1366, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "en-GB" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.route("https://api.github.com/**", route => {
      const req = route.request(), p = new URL(req.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
      const json = (code, o) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(o) });
      const fp = decodeURIComponent(p.replace(/^\/contents\//, ""));
      if (req.method() === "GET") return files[fp] ? json(200, { sha: "s1", content: b64(files[fp]), encoding: "base64" }) : json(404, { message: "Not Found" });
      const body = JSON.parse(req.postData()); puts.push({ path: fp, text: Buffer.from(body.content, "base64").toString("utf8") });
      files[fp] = puts[puts.length - 1].text; return json(200, { content: { sha: "s2" } });
    });
    await page.route("https://fonts.googleapis.com/**", r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.addInitScript(() => { localStorage.setItem("planner.token", JSON.stringify("t")); localStorage.setItem("planner.repo", "me/planner"); });
    await page.goto(base);
    await page.waitForSelector(".card");
    const wide = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const drawnFail = async () => page.evaluate(() => /could not be drawn/.test(document.body.innerText));
    ok((await page.$$(".card")).length >= 2, vp.name + ": project cards drawn");
    ok(await wide() <= 0, vp.name + ": no sideways scroll on the list");
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, vp.name + "-list.png"), fullPage: true });
    await page.click(".card");
    await page.waitForSelector(".pgrid");
    ok(!(await drawnFail()), vp.name + ": project page drawn");
    ok(await wide() <= 0, vp.name + ": no sideways scroll on the project page");
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, vp.name + "-project.png"), fullPage: true });
    const docs = await page.$("[data-doc]");
    if (docs) { await docs.click(); ok(await page.isVisible(".sheet.on pre.doc"), vp.name + ": document opens"); await page.click("[data-close]"); }
    await page.goto(base + "#decisions");
    await page.waitForSelector(".drow, .empty");
    ok(!(await drawnFail()), vp.name + ": decisions drawn");
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, vp.name + "-decisions.png"), fullPage: true });
    if (!process.env.PORT_JSON) {
      await page.click(".drow");
      ok(await page.isVisible(".sheet.on .kv"), vp.name + ": decision sheet opens with its detail");
      if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, vp.name + "-sheet.png") });
      const n = puts.length;
      await page.click(".sheet.on .opts button[data-a]");
      await page.waitForTimeout(300);
      ok(puts.length === n + 1 && puts[n].path === "data/answers.jsonl" && /"q":"so-1"/.test(puts[n].text), vp.name + ": answer written to answers.jsonl");
      ok(!(await page.$('.drow[data-d="so-1"]')), vp.name + ": answered decision leaves the list");
    }
    ok(errors.length === 0, vp.name + ": no script errors" + (errors.length ? " (" + errors.join("; ") + ")" : ""));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
