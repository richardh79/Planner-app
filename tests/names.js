// Finds names a page uses that nothing defines. This is the check that makes it safe to
// move code between files: a page is its HTML's scripts, in order, and every name they
// use must be defined by one of them or by the browser.
//
//   npm i acorn eslint-scope        (once, anywhere; or set NODE_PATH to a copy)
//   node tests/names.js
//
// Exits 1 and lists each unresolved name with where it is used.
let acorn, eslintScope;
try { acorn = require("acorn"); eslintScope = require("eslint-scope"); }
catch (e) { console.log("names.js needs acorn and eslint-scope: npm i acorn eslint-scope"); process.exit(2); }
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const BROWSER = new Set(("window document navigator localStorage sessionStorage location history console fetch Promise Date Math JSON Object Array String Number Boolean Error Set Map RegExp Uint8Array " +
  "atob btoa unescape escape encodeURIComponent decodeURIComponent encodeURI decodeURI isNaN isFinite parseInt parseFloat setTimeout clearTimeout setInterval clearInterval " +
  "Notification PushManager caches Intl URL Blob Event KeyboardEvent MouseEvent PointerEvent screen performance requestAnimationFrame cancelAnimationFrame getComputedStyle " +
  "matchMedia alert confirm prompt open undefined NaN Infinity arguments TextEncoder TextDecoder Image FileReader FormData Headers Request Response XMLHttpRequest " +
  "HTMLElement Node Element DOMParser MutationObserver IntersectionObserver ResizeObserver AbortController structuredClone crypto self globalThis scrollTo Symbol WeakMap " +
  // service worker scope
  "caches clients registration skipWaiting addEventListener ExtendableEvent").split(/\s+/));

function check(files, label) {
  const defined = new Set(), uses = [];
  for (const f of files) {
    const ast = acorn.parse(fs.readFileSync(path.join(ROOT, f), "utf8"), { ecmaVersion: 2020, sourceType: "script", locations: true, ranges: true });
    const g = eslintScope.analyze(ast, { ecmaVersion: 2020, sourceType: "script" }).globalScope;
    g.variables.forEach(v => { if (v.defs.length) defined.add(v.name); });
    g.through.forEach(r => uses.push({ name: r.identifier.name, at: f + ":" + r.identifier.loc.start.line }));
  }
  const bad = {};
  uses.forEach(u => { if (!defined.has(u.name) && !BROWSER.has(u.name)) (bad[u.name] = bad[u.name] || []).push(u.at); });
  const names = Object.keys(bad);
  if (!names.length) { console.log("PASS " + label + ": every name resolves (" + files.join(" + ") + ")"); return 0; }
  names.forEach(n => console.log("FAIL " + label + ": " + n + " is not defined, used at " + bad[n].slice(0, 4).join(", ")));
  return 1;
}

let fail = 0;
for (const page of ["index.html", "desktop.html"]) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m => m[1]);
  if (!scripts.length) { console.log("FAIL " + page + ": no scripts found"); fail++; continue; }
  fail += check(scripts, page);
}
fail += check(["sw.js"], "sw.js");
process.exit(fail ? 1 : 0);
