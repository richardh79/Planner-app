// Runs the real page in headless Chromium with a fake speech engine that ends its own
// sessions, as Android does, and a fake GitHub API that records every write.
//
//   npm i playwright            (once, anywhere; or set PLAYWRIGHT_PATH to an existing copy)
//   node tests/phone.e2e.js              [folder of the app, default: the repository root]
//
// Set CHROMIUM_PATH to use a browser you already have. Nothing here touches the network.
// End-to-end check of the phone app in real Chromium, with a fake speech engine
// and a fake GitHub API. Run: node e2e.js <app folder>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const APP = path.resolve(process.argv[2] || path.join(__dirname, ".."));

// ---- static server for the app
const MIME = { ".html":"text/html", ".js":"text/javascript", ".json":"application/json", ".webmanifest":"application/json", ".png":"image/png" };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "text/plain" }); s.end(fs.readFileSync(f));
});

// ---- fake GitHub
const b64 = t => Buffer.from(t, "utf8").toString("base64");
function makeGitHub(opts) {
  const files = {};   // path -> {text, sha, size, hidden}
  const puts = [], posts = [];
  let n = 1;
  const board = {
    updated: "2026-10-22", headline: "test", domains: [{ id: "research", n: "Research", c: "--research" }],
    threads: [{ id: "t1", n: "Test thread", dom: "research", st: ["Drafting", "Submitted"], at: 0, c: "--research", goal: "" }],
    week: [[], [], [], [], [], [], []], goals: [], events: [],
    open: [{ id: "q-test", q: "Which day suits you?", opts: [{ a: "Sunday" }, { a: "Say it", say: true }] }]
  };
  files["data/board.json"] = { text: JSON.stringify(board), sha: "s0" };
  return {
    files, puts, posts, board,
    handle(route) {
      const req = route.request(), url = new URL(req.url()), p = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
      const json = (code, o) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(o) });
      if (p.startsWith("/contents/")) {
        const fp = decodeURIComponent(p.slice("/contents/".length));
        if (req.method() === "GET") {
          const f = files[fp]; if (!f) return json(404, { message: "Not Found" });
          if (f.hidden) return json(200, { sha: f.sha, size: f.size, content: "", encoding: "none" });
          return json(200, { sha: f.sha, size: f.text.length, content: b64(f.text), encoding: "base64" });
        }
        const body = JSON.parse(req.postData()); const text = Buffer.from(body.content, "base64").toString("utf8");
        puts.push({ path: fp, text, sha: body.sha }); files[fp] = { text, sha: "s" + (++n) };
        return json(200, { content: { sha: files[fp].sha } });
      }
      if (p === "/issues" && req.method() === "POST") {
        const body = JSON.parse(req.postData()); posts.push(body);
        if (opts.failIssue && body.title.indexOf(opts.failIssue) === 0) return json(422, { message: "Validation Failed" });
        return json(201, { number: 100 + posts.length, title: body.title });
      }
      if (p === "/issues") return json(200, []);
      return json(200, []);
    }
  };
}

let fail = 0;
function check(name, ok, detail) { if (!ok) fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "   " + (detail || ""))); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser, port, gh, extraInit) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 420, height: 860 } });
  await ctx.route("https://api.github.com/**", r => gh.handle(r));
  await ctx.addInitScript(() => {
    localStorage.setItem("planner.repo", JSON.stringify("o/r"));
    localStorage.setItem("planner.token", JSON.stringify("tok"));
    // a fake speech engine that behaves like Android: speaks, then the browser ends the session by itself
    window.__sr = { made: 0, stopped: false, script: [] };
    window.SpeechRecognition = window.webkitSpeechRecognition = function () {
      const me = { lang: "", continuous: false, interimResults: false };
      const id = ++window.__sr.made;
      me.start = function () {
        const part = window.__sr.script[id - 1];
        setTimeout(() => { if (part && me.onresult) {
          const res = [{ 0: { transcript: part.text }, isFinal: part.final }]; res.item = i => res[i];
          me.onresult({ results: res, resultIndex: 0 }); } }, 60);
        if (!window.__sr.neverEnd) setTimeout(() => { if (me.onend) me.onend(); }, 220);
      };
      me.stop = function () { window.__sr.stopped = true; setTimeout(() => me.onend && me.onend(), 10); };
      me.abort = me.stop;
      return me;
    };
  });
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; console.log("FAIL page error: " + e.message); });
  return page;
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port, base = "http://127.0.0.1:" + port + "/";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ============ 1. dictation restarts itself and does not repeat
  {
    const gh = makeGitHub({});
    const page = await newPage(browser, port, gh, () => {
      window.__sr.script = [
        { text: "send the draft", final: true },
        { text: "to Dr Ali", final: true },
        { text: "by Thursday", final: false }
      ];
    });
    await page.goto(base + "index.html#say"); await page.waitForSelector("#sayta");
    await page.click("button.rec");
    await sleep(1400);
    const made = await page.evaluate(() => window.__sr.made);
    const text = await page.inputValue("#sayta");
    check("dictation restarts after the browser ends the session on its own", made >= 3, "sessions started: " + made);
    check("text across restarts is joined once, no repeats", text === "send the draft to Dr Ali by Thursday", JSON.stringify(text));
    check("still listening (stop button showing)", (await page.textContent("button.rec")).trim() === "■");
    await page.click("button.rec"); await sleep(600);
    const after = await page.evaluate(() => window.__sr.made);
    await sleep(700);
    check("tapping stop stops it for good", (await page.evaluate(() => window.__sr.made)) === after, "kept restarting");
    check("stop reached the engine", await page.evaluate(() => window.__sr.stopped));
    await page.context().close();
  }

  // ============ 2. a blocked microphone is not retried forever
  {
    const gh = makeGitHub({});
    const page = await newPage(browser, port, gh, () => {
      const Orig = window.SpeechRecognition;
      window.SpeechRecognition = window.webkitSpeechRecognition = function () {
        const me = Orig(); window.__sr.made++;
        me.start = () => setTimeout(() => { me.onerror && me.onerror({ error: "not-allowed" }); me.onend && me.onend(); }, 30);
        return me;
      };
    });
    await page.goto(base + "index.html#say"); await page.waitForSelector("#sayta");
    await page.click("button.rec"); await sleep(1200);
    check("a blocked microphone stops instead of looping", (await page.evaluate(() => window.__sr.made)) <= 3, "made " + await page.evaluate(() => window.__sr.made));
    await page.context().close();
  }

  // ============ 3. a question answered by speaking is recorded as an answer
  {
    const gh = makeGitHub({});
    const page = await newPage(browser, port, gh);
    await page.goto(base + "index.html#now"); await page.waitForSelector(".qcard");
    await page.click(".qcard .opt.say");
    await page.waitForSelector("#sayta");
    check("question text is prefilled for the answer", (await page.inputValue("#sayta")).startsWith("Which day suits you?"));
    await page.fill("#sayta", "Which day suits you?\nSunday after prayer");
    await page.click("button.wide"); await sleep(900);
    const ans = gh.puts.find(x => x.path === "data/answers.jsonl");
    check("answers.jsonl gets the answer", !!ans && /"q":"q-test"/.test(ans.text) && /Sunday after prayer/.test(ans.text) && !/Which day suits you\?\\n/.test(ans.text), ans && ans.text);
    check("the answer text has the question stripped", !!ans && JSON.parse(ans.text.trim().split("\n").pop()).a === "Sunday after prayer", ans && ans.text);
    const iss = gh.posts.find(x => /^Answer: Which day suits you\?/.test(x.title));
    check("an 'Answer:' issue is opened so the steward files it", !!iss, JSON.stringify(gh.posts));
    await page.context().close();
  }

  // ============ 4. an ordinary Say message is still just an issue
  {
    const gh = makeGitHub({});
    const page = await newPage(browser, port, gh);
    await page.goto(base + "index.html#say"); await page.waitForSelector("#sayta");
    await page.fill("#sayta", "plain update"); await page.click("button.wide"); await sleep(800);
    check("a normal update posts one issue and writes no answer", gh.posts.length === 1 && !gh.puts.some(x => x.path === "data/answers.jsonl"), JSON.stringify({ posts: gh.posts.length, puts: gh.puts.map(x => x.path) }));
    await page.context().close();
  }

  // ============ 5. a write that can never succeed does not block the queue
  {
    const gh = makeGitHub({ failIssue: "Update" });
    const page = await newPage(browser, port, gh);
    await page.goto(base + "index.html#say"); await page.waitForSelector("#sayta");
    await page.fill("#sayta", "this one is rejected"); await page.click("button.wide"); await sleep(900);
    const st = await page.evaluate(() => ({ q: JSON.parse(localStorage.getItem("planner.queue") || "[]").length, dead: JSON.parse(localStorage.getItem("planner.dead") || "[]").length }));
    check("a 422 is set aside and the queue empties", st.q === 0 && st.dead === 1, JSON.stringify(st));
    await page.context().close();
  }

  // ============ 6. a file over 1 MB is never overwritten
  {
    const gh = makeGitHub({});
    gh.files["data/answers.jsonl"] = { text: "", sha: "big", size: 2000000, hidden: true };
    const page = await newPage(browser, port, gh);
    await page.goto(base + "index.html#now"); await page.waitForSelector(".qcard");
    await page.click(".qcard .opt:not(.say)"); await sleep(900);
    check("no PUT replaces the large file", !gh.puts.some(x => x.path === "data/answers.jsonl"), JSON.stringify(gh.puts.map(x => x.path)));
    await page.context().close();
  }

  // ============ 7. the version check does not wipe the install
  {
    const gh = makeGitHub({});
    const page = await newPage(browser, port, gh);
    let navs = 0; page.on("framenavigated", f => { if (f === page.mainFrame()) navs++; });
    await page.goto(base + "index.html#now"); await sleep(1500);
    check("no repair loop: the page did not reload itself", navs === 1, "navigations: " + navs);
    const build = await page.evaluate(() => fetch("version.json").then(r => r.json()).then(j => j.build));
    const bundled = fs.readFileSync(path.join(APP, "app.js"), "utf8").match(/var BUILD = "([^"]+)"/)[1];
    check("version.json matches the build inside app.js", build === bundled, build + " vs " + bundled);
    await page.context().close();
  }

  await browser.close(); server.close();
  console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR", e); process.exit(2); });
