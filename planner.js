"use strict";
/* Planner: Today, Projects, Week, For you, More. One page for the phone and the PC.
   Built on core.js: the board, the timetable and its edits, to-dos, dates, answers and the write queue are the
   same as the classic apps, so every write lands in the same file in the same shape.
   PC data: desktop/portfolio.json (project packs, filtered on the PC) and desktop/brief.json (windows, waiting items). */

var PORT = get("pj.port", null), BRIEF = get("pj.brief", null);
var ANS = get("brief.answered", {});          // answered here; hidden until the PC drops them
var cFilter = null;                            // counts row: null | dec | late | work
var pFilter = getRaw("pl.pfilter") || "active";
var weekDay = new Date().getDay();
var H = {red:"--bad", amber:"--warn", green:"--good"};
var HW = {red:"Problem", amber:"Needs attention", green:"On track"};
var LIGHT = {working:"Working", waiting:"Waiting for you", idle:"Idle", silent:"Idle", blocked:"Stopped", off:"Shut", closed:"Closed", path:"Planner path"};
var KIND = {go:"Go decisions", question:"Questions", task:"Your tasks", todo:"Your to-dos", date:"Past dates to clean up", reminder:"Reminders"};
var STOP = {the:1,a:1,an:1,to:1,for:1,of:1,and:1,with:1,on:1,in:1,at:1,by:1,from:1,as:1,via:1,into:1,your:1,his:1,both:1,all:1,is:1,be:1,author:1};

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function plDay(d){ if(!d) return null; var x = new Date(String(d).slice(0,10) + "T12:00:00"); return isNaN(x) ? null : x; }
function fmtS(d){ var x = plDay(d); return x ? x.toLocaleDateString("en-GB", {day:"numeric", month:"short"}) : ""; }
function dd(a, b){ return Math.round((plDay(a) - plDay(b)) / 86400000); }
function plToast(m){ var t = $("toast"); t.textContent = m; t.style.display = "block"; clearTimeout(plToast.t); plToast.t = setTimeout(function(){ t.style.display = "none"; }, 2800); }
function words(t){ return (String(t).toLowerCase().match(/[a-z0-9]{4,}/g) || []); }
function overlap(a, b){ var A = words(a), B = words(b), n = 0; A.forEach(function(w){ if(B.indexOf(w) >= 0) n++; }); return n / Math.max(1, Math.min(A.length, B.length)); }
function dLabel(text, given){
  if(given) return given;
  var w = String(text || "").replace(/[?.!]+$/, "").replace(/\s*\(.*?\)\s*/g, " ").split(/\s+/).filter(function(x){ return x && !STOP[x.toLowerCase()]; });
  var s = w.slice(0, w.length <= 4 ? 4 : 3).join(" ").replace(/[,:;]+$/, "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Decision";
}
function domName(id){ var d = (board.domains || []).filter(function(x){ return x.id === id; })[0]; return d ? d.n : ""; }

/* ---------- data ---------- */
UI.afterWrite = function(msg){
  plDraw();
  flushQueue().then(function(){ plToast(deadNote || (queue.length ? "Saved on this device; it sends when the connection is back." : msg)); deadNote = ""; plDraw(); });
};
UI.setStage = setStageP;

function deskFile(name){
  return gh("/contents/desktop/" + name, {soft404:true}).then(function(r){ return r && r.content ? JSON.parse(b64d(r.content)) : null; }).catch(function(){ return null; });
}
function plLoad(){
  if(!token || !REPO()){ plDraw(); return; }
  var jobs = [pullBoard(), pullStatus(), pullPlan(), pullDates(), pullTodos(), pullAnswers(), pullWeekEdits(), pullAdded(), pullTicks(),
              deskFile("portfolio.json"), deskFile("brief.json")].map(function(p){ return Promise.resolve(p).catch(function(){ return null; }); });
  Promise.all(jobs).then(function(r){
    if(r[9]){ PORT = r[9]; put("pj.port", PORT); }
    if(r[10]){ BRIEF = r[10]; put("pj.brief", BRIEF); }
    plDraw(); flushQueue().then(plDraw);
  });
}

/* Everything as one list of projects and one list of things that wait on him. */
function plModel(){
  var P = ((PORT && PORT.projects) || []).filter(function(p){ return p.health || p.rec; });
  var tiles = (BRIEF && BRIEF.tiles) || [], tmap = {};
  tiles.forEach(function(t){ tmap[t.id] = t; });
  var projects = P.map(function(p){ return {id:p.id, name:p.name, p:p, t:tmap[p.id] || null, th:p.thread ? T(p.thread) : null}; });
  tiles.forEach(function(t){ if(!projects.some(function(x){ return x.id === t.id; })) projects.push({id:t.id, name:t.name, p:null, t:t, th:null}); });
  var used = {};
  projects.forEach(function(x){ if(x.th) used[x.th.id] = 1; });
  board.threads.forEach(function(t){
    if(used[t.id] || dropped[t.id]) return;
    projects.push({id:"t-" + t.id, name:t.n, p:null, t:null, th:t, path:true});
  });
  function byName(n){
    n = String(n || "").toLowerCase();
    var hit = projects.filter(function(x){ var a = x.name.toLowerCase(); return !x.path && (a.indexOf(n) === 0 || n.indexOf(a) === 0 || (x.t && x.t.name.toLowerCase() === n)); });
    return hit.length ? hit[0].id : null;
  }
  function byThread(tid){ var h = projects.filter(function(x){ return x.th && x.th.id === tid; }); return h.length ? h[0] : null; }
  var D = [], seen = {};
  ((BRIEF && BRIEF.needs) || []).forEach(function(n){
    if(ANS[n.q] || answers[n.q] || n.kind === "info") return;
    seen[n.q] = 1;
    D.push({q:n.q, via:"brief", kind:n.kind === "signoff" ? "go" : "question", pid:n.pid || byName(n.project), project:n.project,
            text:n.text, options:n.options || [], rec:n.rec, detail:n.detail || {}});
  });
  qLeft().forEach(function(q){
    if(seen[q.id] || ANS[q.id]) return;
    var x = q.thread ? byThread(q.thread) : null;
    D.push({q:q.id, via:"q", ref:q, kind:String(q.id).indexOf("so-") === 0 ? "go" : "question", pid:x ? x.id : null, project:x ? x.name : "Planner",
            text:q.q, options:(q.opts || []).filter(function(o){ return !o.say; }).map(function(o){ return o.a; }), detail:{why:q.why}});
  });
  tiles.forEach(function(t){
    (t.you || []).forEach(function(y){
      if(ANS[y.q] || answers[y.q]) return;
      D.push({q:y.q, via:"brief", kind:"task", pid:t.id, project:t.name, text:y.text, options:["Done"], detail:{}});
    });
  });
  projects.forEach(function(x){
    var r = x.p && x.p.rec; if(!r || !r.tasks || r.status !== "active") return;
    r.tasks.forEach(function(k){
      var q = "task-" + x.id + "-" + k.id;
      if(ANS[q] || answers[q]) return;
      if(D.some(function(d){ return d.pid === x.id && overlap(d.text, k.title) >= 0.5; })) return;
      var why = k.critical ? "On the critical path: the finish date moves with it." :
                k.blocks ? k.blocks + " step" + (k.blocks > 1 ? "s wait" : " waits") + " on it." : "Nothing waits on it yet.";
      D.push({q:q, via:"brief", kind:(k.critical || k.blocks) ? "task" : "reminder", pid:x.id, project:x.name, text:k.title,
              options:["Done"], detail:{why:why, by:r.dates && r.dates.due}, plan:true});
    });
  });
  openTodos().forEach(function(td){
    var x = td.thread ? byThread(td.thread) : null;
    D.push({q:td.id, via:"todo", ref:td, kind:"todo", pid:x ? x.id : null, project:x ? x.name : "Your list", text:td.text,
            options:["Done"], detail:{by:td.due}});
  });
  board.threads.forEach(function(t){
    if(dropped[t.id] || bucketOf(t) !== "overdue") return;
    var x = byThread(t.id);
    D.push({q:"date-" + t.id, via:"date", ref:t, kind:"date", pid:x ? x.id : null, project:domName(t.dom) || "Planner", text:t.n,
            options:["Next week", "In 4 weeks", "No date", "Drop"],
            detail:{why:"Its day (" + fmtS(doDate(t)) + ") has passed. No date stands unless you set it.", undo:"Yes: set another date any time."}});
  });
  var order = {go:0, question:1, task:2, todo:3, date:4, reminder:5};
  D.sort(function(a, b){ return order[a.kind] - order[b.kind]; });
  projects.forEach(function(x){ x.dec = D.filter(function(d){ return d.pid === x.id && d.kind !== "date"; }); x.light = lightOf(x); x.late = lateOf(x); });
  return {projects:projects, D:D, byThread:byThread};
}
function countFor(D){ return D.filter(function(d){ return d.kind !== "reminder" && d.kind !== "date"; }).length; }
function recOf(x){ return (x.p && x.p.rec) || {}; }
function isClosed(x){ var s = recOf(x).status; return s === "done" || s === "parked" || s === "dropped" || s === "closed"; }
function lightOf(x){
  if(x.path) return "path";
  if(isClosed(x)) return "closed";
  if(x.dec && x.dec.some(function(d){ return d.kind === "question" || d.kind === "go"; })) return "waiting";
  var w = x.p && x.p.window ? x.p.window.state : null;
  var s = w === "working" ? "working" : x.t ? x.t.state : (w || "off");
  return s === "silent" ? "idle" : (LIGHT[s] ? s : "off");
}
function lateOf(x){
  var d = recOf(x).dates || {}, due = d.due || (x.p && x.p.due), p85 = d.p85 || (x.p && x.p.p85);
  return due && p85 && dd(p85, due) > 0 ? dd(p85, due) : 0;
}
function hcol(x){ return x.path ? (x.th.c || "--neutral") : x.p && x.p.health ? H[x.p.health] : "--off"; }
function pctOf(x){
  if(x.path) return isUnset(x.th) ? null : walked(x.th);
  var v = x.p && x.p.progress != null ? x.p.progress : (x.t ? x.t.pct : null); return v == null ? null : Math.round(v);
}
function activePath(t){
  var b = bucketOf(t);                     // a passed date is for the clean-up list, not a sign of activity
  return isPinned(t) || needsChase(t) || b === "today" || b === "week" || runningIds().indexOf(t.id) >= 0;
}

/* ---------- frame ---------- */
function route(){ var h = location.hash.replace(/^#/, ""); return h || "today"; }
function plNav(M){
  var r = route().split("/")[0], n = countFor(M.D);
  var tab = {today:"today", projects:"projects", p:"projects", t:"projects", week:"week", you:"you", decisions:"you", more:"more"}[r] || "today";
  $("nav").innerHTML = [["today","Today"],["projects","Projects"],["week","Week"],["you","For you"],["more","More"]].map(function(x){
    return '<a href="#' + x[0] + '" class="' + (tab === x[0] ? "on" : "") + '">' + x[1] + (x[0] === "you" && n ? '<span class="n">' + n + '</span>' : "") + '</a>';
  }).join("");
  var at = PORT && PORT.at, stale = at && Date.now() - new Date(at).getTime() > 15 * 60000;
  $("asof").className = "asof" + (stale ? " stale" : "");
  $("asof").textContent = (at ? "From the PC, " + ago(at) + (stale ? ": the PC may be off or asleep" : "") : (token ? "Waiting for the PC" : "Not connected: open More")) +
    (queue.length ? " · " + queue.length + " change" + (queue.length > 1 ? "s" : "") + " waiting to send" : "");
}
function plDraw(){
  var M = plModel(), r = route(), main = $("main");
  plNav(M);
  try{
    if(r.indexOf("p/") === 0) vProject(M, r.slice(2));
    else if(r.indexOf("t/") === 0) vPath(M, r.slice(2));
    else if(r === "projects") vProjects(M);
    else if(r === "week") vWeek(M);
    else if(r === "you" || r === "decisions") vYou(M);
    else if(r === "more") vMore();
    else vToday(M);
  }catch(e){ main.innerHTML = '<p class="empty">This view could not be drawn (' + esc(e.message) + ').</p>'; }
  $("fab").style.display = (r === "more") ? "none" : "grid";
}

/* ---------- shared pieces ---------- */
function drow(d, withProject){
  var mk = {go:"!", question:"?", task:"•", todo:"✓", date:"", reminder:""}[d.kind];
  var by = d.detail && d.detail.by ? (d.detail.by < localDay() ? "was " : "by ") + fmtS(d.detail.by) : "";
  return '<button class="drow" data-d="' + esc(d.q) + '"><span class="mark k-' + d.kind + '">' + mk + '</span>' +
    '<span style="min-width:0"><span class="dlab any">' + esc(d.kind === "date" ? d.text : dLabel(d.text, d.detail && d.detail.label)) + '</span>' +
    (withProject ? '<br><span class="dsub any">' + esc(d.project) + '</span>' : "") + '</span>' +
    '<span class="dright">' + esc(by) + ' ›</span></button>';
}
function plCard(x){
  if(x.path) return pathCard(x);
  var r = recOf(x), d = r.dates || {}, v = pctOf(x), due = d.due || (x.p && x.p.due), p85 = d.p85 || (x.p && x.p.p85);
  var dates = [];
  if(isClosed(x)) dates.push('<span class="chip">' + (r.status === "parked" ? "Parked" : "Closed") + (r.closed && r.closed.date ? " " + esc(fmtS(r.closed.date)) : "") + '</span>');
  else {
    if(due) dates.push("Due " + fmtS(due));
    if(p85) dates.push("likely " + fmtS(p85));
    if(x.late) dates.push('<span class="chip bad">' + x.late + ' d late</span>');
    else if(due && p85) dates.push('<span class="chip good">on time</span>');
    if(x.th && needsChase(x.th)) dates.push('<span class="chip warn">waiting on ' + esc(cleanWho(x.th)) + ' · ' + clockDays(x.th) + ' d</span>');
  }
  var nd = x.dec.filter(function(z){ return z.kind !== "reminder"; }).length;
  var next = isClosed(x) ? (r.closed && r.closed.left ? r.closed.left + " step" + (r.closed.left > 1 ? "s" : "") + " left" : "") :
             (x.t && x.t.next) || (x.p && x.p.next) || "";
  return '<a class="card" href="#p/' + esc(x.id) + '" style="--h:var(' + hcol(x) + ')">' +
    '<div class="row"><span class="name any">' + esc(x.name) + '</span><span class="hw">' + esc(x.p && x.p.health ? HW[x.p.health] : "No plan") + '</span></div>' +
    '<div class="row" style="margin-top:4px"><span class="light ' + x.light + '"><i></i>' + LIGHT[x.light] + '</span>' + (nd ? '<span class="flag">⚑ ' + nd + '</span>' : "") + '</div>' +
    '<div class="stage any">' + [esc((x.p && x.p.phase) || ""), v != null ? v + "%" : ""].filter(Boolean).join(" · ") + '</div>' +
    (v != null ? '<div class="bar"><i style="width:' + Math.min(100, v) + '%"></i></div>' : "") +
    (dates.length ? '<div class="dates">' + dates.join(" ") + '</div>' : "") +
    (next ? '<div class="next any">' + (isClosed(x) ? "" : "Next: ") + esc(next) + '</div>' : "") + '</a>';
}
function pathCard(x){
  var t = x.th, v = pctOf(x), chips = [];
  if(needsChase(t)) chips.push('<span class="chip warn">waiting on ' + esc(cleanWho(t)) + ' · ' + clockDays(t) + ' d</span>');
  else if(t.who && t.since) chips.push('<span class="chip">with ' + esc(cleanWho(t)) + '</span>');
  var b = bucketOf(t);
  if(b === "overdue") chips.push('<span class="chip">date passed</span>');
  else if(b === "today") chips.push('<span class="chip good">today</span>');
  else if(b === "week") chips.push('<span class="chip">' + esc(fmtS(doDate(t))) + '</span>');
  if(isPinned(t)) chips.push('<span class="chip">pinned</span>');
  return '<a class="card path" href="#t/' + esc(t.id) + '" style="--h:var(' + (t.c || "--neutral") + ')">' +
    '<div class="row"><span class="name any">' + esc(t.n) + '</span><span class="hw">' + esc(domName(t.dom)) + '</span></div>' +
    '<div class="stage any">' + esc(isUnset(t) ? "Stage not set" : stageName(t)) + ' → ' + esc(finalOf(t)) + '</div>' +
    (v != null ? '<div class="bar"><i style="width:' + v + '%"></i></div>' : "") +
    (chips.length ? '<div class="dates">' + chips.join(" ") + '</div>' : "") +
    (t.next ? '<div class="next any">Next: ' + esc(t.next) + '</div>' : "") + '</a>';
}

/* ---------- Today ---------- */
function vToday(M){
  var now = new Date(), cur = curBlock(), nx = nextBlock(), t = nowMin(), html = "";
  var dayName = now.toLocaleDateString("en-GB", {weekday:"long", day:"numeric", month:"long"});
  if(cur){
    var on = planned(localDay(), cur.i), th = on ? T(on) : null;
    html += '<div class="now" style="--a:var(' + (cur.b[3] || "--accent") + ')"><div class="k">' + esc(dayName) + ' · now</div><div class="t any">' + esc(cur.b[1]) + '</div>' +
      '<div class="s">' + dur(cur.b[5] - t) + ' left' + (th ? ' · on it: ' + esc(th.n) : cur.b[6] ? ' · no project on this block' : (cur.b[2] ? " · " + esc(cur.b[2]) : "")) +
      (nx ? ' · then ' + hm(nx[4]) + ' ' + esc(nx[1]) : "") + '</div></div>';
  } else {
    html += '<div class="now"><div class="k">' + esc(dayName) + '</div><div class="t">Off the clock</div><div class="s">' +
      (nx ? 'Next: ' + hm(nx[4]) + ' ' + esc(nx[1]) : "Nothing else on the timetable today") + '</div></div>';
  }
  var rb = PORT && PORT.richard;
  if(rb && rb.lines && rb.lines.length){
    html += '<div class="rich"><div class="k">Richard · ' + esc(rb.kind === "morning" ? "morning brief" : "evening wrap") + ', ' + esc(ago(rb.at)) + '</div>' +
      rb.lines.slice(0, 3).map(function(l){ return '<p class="any">' + esc(l) + '</p>'; }).join("") + '</div>';
  }
  var top = M.D.filter(function(d){ return d.kind !== "reminder" && d.kind !== "date"; }), n = top.length;
  var left = '<div class="box needs"><h3>For you · ' + n + (n > 3 ? '<a href="#you">all ›</a>' : "") + '</h3>' +
    (n ? top.slice(0, 3).map(function(d){ return drow(d, true); }).join("") : '<p class="empty">Nothing waits on you.</p>') + '</div>';
  var day = board.week[now.getDay()] || [];
  left += '<div class="box" style="margin-top:10px"><h3>Today\'s blocks<a href="#week">week ›</a></h3>' + (day.length ? day.map(function(b, i){
    var who = planned(localDay(), i), th2 = who ? T(who) : null, past = b[5] <= t && b[5] > b[4], isCur = cur && cur.i === i;
    return '<button class="blk' + (past ? " past" : "") + (isCur ? " cur" : "") + '" data-blk="' + now.getDay() + ':' + i + '"><span class="tm">' + esc(b[0]) + '</span>' +
      '<span class="bd" style="--a:var(' + (b[3] || "--neutral") + ')"><span class="bn any">' + esc(b[1]) + '</span><br>' +
      '<span class="bp any' + (b[6] && !th2 ? " empty" : "") + '">' + esc(th2 ? th2.n : b[6] ? "Empty: tap to put a project on it" : (b[2] || "")) + '</span></span></button>';
  }).join("") : '<p class="empty">No blocks today.</p>') + '</div>';
  var work = M.projects.filter(function(x){ return x.light === "working"; });
  var right = '<div class="box"><h3>Moving now</h3>' + (work.length ? '<div class="pchips">' + work.map(function(x){
    return '<a class="pchip" href="#p/' + esc(x.id) + '"><span class="light working"><i></i></span>' + esc(x.name) + '</a>'; }).join("") + '</div>' :
    '<p class="empty">No window is working right now.</p>') + '</div>';
  var late = M.projects.filter(function(x){ return x.late && !isClosed(x); });
  var soon = M.projects.filter(function(x){ var d = recOf(x).dates || {}; return d.due && dd(d.due, localDay()) >= 0 && dd(d.due, localDay()) <= 7 && !isClosed(x); });
  if(late.length || soon.length){
    right += '<div class="box" style="margin-top:10px"><h3>Dates to watch</h3>' + late.map(function(x){
      return '<a class="li" href="#p/' + esc(x.id) + '" style="text-decoration:none;color:inherit"><span class="chip bad">' + x.late + ' d late</span><span class="any">' + esc(x.name) + '</span></a>'; }).join("") +
      soon.filter(function(x){ return late.indexOf(x) < 0; }).map(function(x){
      return '<a class="li" href="#p/' + esc(x.id) + '" style="text-decoration:none;color:inherit"><span class="chip">due ' + esc(fmtS(recOf(x).dates.due)) + '</span><span class="any">' + esc(x.name) + '</span></a>'; }).join("") + '</div>';
  }
  var waits = board.threads.filter(needsChase).sort(function(a, b){ return clockDays(b) - clockDays(a); });
  if(waits.length){
    right += '<div class="box" style="margin-top:10px"><h3>Waiting on others · ' + waits.length + '</h3>' + waits.slice(0, 4).map(function(th3){
      return '<a class="li" href="#t/' + esc(th3.id) + '" style="text-decoration:none;color:inherit"><span class="chip warn">' + clockDays(th3) + ' d</span><span class="any">' + esc(cleanWho(th3)) + ': ' + esc(th3.short || th3.n) + '</span></a>'; }).join("") + '</div>';
  }
  html += '<div class="tgrid"><div>' + left + '</div><div>' + right + '</div></div>';
  $("main").innerHTML = html;
}

/* ---------- Projects ---------- */
function vProjects(M){
  var live = M.projects.filter(function(x){ return !isClosed(x); }), done = M.projects.filter(isClosed);
  var n = countFor(M.D), late = live.filter(function(x){ return x.late; }).length, work = live.filter(function(x){ return x.light === "working"; }).length;
  function rank(x){
    return x.dec.some(function(d){ return d.kind !== "reminder"; }) ? 0 : x.p && x.p.health === "red" ? 1 : x.light === "working" ? 2 :
           x.p && x.p.health === "amber" ? 3 : x.p && x.p.health === "green" ? 4 : !x.path ? 5 : needsChase(x.th) ? 6 : 7;
  }
  live.sort(function(a, b){ return rank(a) - rank(b) || a.name.localeCompare(b.name); });
  var doms = (board.domains || []).map(function(d){ return [d.id, d.n, live.filter(function(x){ return (x.th && x.th.dom === d.id); }).length]; }).filter(function(d){ return d[2]; });
  var waitN = live.filter(function(x){ return x.th && needsChase(x.th); }).length;
  var chips = [["active", "Active"], ["waiting", "Waiting on others " + waitN]].concat(doms.map(function(d){ return [d[0], d[1] + " " + d[2]]; })).concat([["all", "All " + live.length]]);
  if(!chips.some(function(c){ return c[0] === pFilter; })) pFilter = "active";
  var shown = live.filter(function(x){
    if(cFilter === "dec") return x.dec.some(function(d){ return d.kind !== "reminder"; });
    if(cFilter === "late") return x.late;
    if(cFilter === "work") return x.light === "working";
    if(pFilter === "all") return true;
    if(pFilter === "active") return !x.path || activePath(x.th);
    if(pFilter === "waiting") return x.th && needsChase(x.th);
    return x.th && x.th.dom === pFilter;
  });
  var goals = (board.goals || []).map(function(g){
    var s = goalSlots(g);
    return '<div class="goal" style="border-left:3px solid var(' + (g.c || "--accent") + ')"><b class="any">' + esc(g.n) + '</b><span class="gn">' + s.filled + ' <small>of ' + s.target + '</small></span>' +
      (s.pace ? '<div class="dsub any">' + esc(s.pace) + '</div>' : "") + '</div>';
  }).join("");
  var dorm = (PORT && PORT.dormant) || [];
  $("main").innerHTML = (goals ? '<div class="goals">' + goals + '</div>' : "") +
    '<div class="counts">' +
      '<button class="count dec' + (cFilter === "dec" ? " on" : "") + '" data-f="dec"><b>' + n + '</b><span>for you</span></button>' +
      '<button class="count late' + (cFilter === "late" ? " on" : "") + '" data-f="late"><b>' + late + '</b><span>late</span></button>' +
      '<button class="count work' + (cFilter === "work" ? " on" : "") + '" data-f="work"><b>' + work + '</b><span>working now</span></button></div>' +
    (cFilter ? "" : '<div class="chips">' + chips.map(function(c){ return '<button class="fchip' + (pFilter === c[0] ? " on" : "") + '" data-pf="' + esc(c[0]) + '">' + esc(c[1]) + '</button>'; }).join("") + '</div>') +
    (shown.length ? '<div class="grid">' + shown.map(plCard).join("") + '</div>' : '<p class="empty">Nothing in this view.</p>') +
    (done.length ? '<div class="fold" data-fold role="button" tabindex="0"><b>Closed (' + done.length + ')</b><div class="fold-body"><div class="grid">' + done.map(plCard).join("") + '</div></div></div>' : "") +
    (dorm.length ? '<div class="fold" data-fold role="button" tabindex="0"><b>Dormant (' + dorm.length + ')</b> · no project plan yet<div class="fold-body">' +
      dorm.map(function(d){ return '<div class="mini any"><span>' + esc(d.name) + '</span><em>' + esc(d.status) + '</em></div>'; }).join("") + '</div></div>' : "");
}

function schedule(x){
  var r = recOf(x), d = r.dates || {}, ph = r.phases || [];
  var start = d.started || localDay(), due = d.due, p50 = d.p50, p85 = d.p85, td = localDay();
  var pts = [start, td, due, p50, p85].filter(Boolean).sort(), lo = pts[0], hi = pts[pts.length - 1];
  var span = Math.max(1, dd(hi, lo) + 2), W = Math.max(280, Math.min(1240, ($("main").clientWidth || 360) - 30));
  function X(s){ return 10 + (W - 20) * (dd(s, lo) + 1) / span; }
  var s = '<svg viewBox="0 0 ' + W + ' 96" width="' + W + '" height="96" role="img" aria-label="Schedule">';
  s += '<line x1="10" y1="30" x2="' + (W - 10) + '" y2="30" stroke="var(--line)" stroke-width="2"/>';
  if(p50 && p85) s += '<rect x="' + X(p50) + '" y="22" width="' + Math.max(3, X(p85) - X(p50)) + '" height="16" rx="4" fill="' + (x.late ? "#f8717140" : "#34d39940") + '"/>';
  s += '<line x1="' + X(td) + '" y1="12" x2="' + X(td) + '" y2="46" stroke="var(--accent)" stroke-width="2"/><text x="' + X(td) + '" y="9" fill="var(--accent)" font-size="11" text-anchor="middle">today</text>';
  if(due) s += '<path d="M' + X(due) + ' 18 l0 24 M' + X(due) + ' 18 l9 4 l-9 4" stroke="var(--ink)" stroke-width="2" fill="var(--ink)"/>';
  s += '<text x="10" y="58" fill="var(--dim)" font-size="11">' + esc(fmtS(lo)) + '</text>';
  if(due) s += '<text x="' + X(due) + '" y="58" fill="var(--ink)" font-size="11" text-anchor="middle">due ' + esc(fmtS(due)) + '</text>';
  if(p85) s += '<text x="' + Math.min(W - 10, X(p85)) + '" y="' + (due ? 16 : 58) + '" fill="var(--dim)" font-size="11" text-anchor="end">likely</text>';
  var tot = ph.reduce(function(a, p){ return a + Math.max(1, p.total); }, 0) || 1, x0 = 10;
  ph.forEach(function(p){
    var w = (W - 20) * Math.max(1, p.total) / tot;
    var col = p.status === "passed" ? "var(--good)" : p.status === "active" ? "var(--accent)" : "var(--line)";
    s += '<rect x="' + (x0 + 1) + '" y="70" width="' + Math.max(2, w - 2) + '" height="10" rx="3" fill="' + col + '"/>';
    if(p.gate) s += '<rect x="' + (x0 + w - 6) + '" y="69" width="9" height="9" transform="rotate(45 ' + (x0 + w - 1.5) + ' 73.5)" fill="' + (p.gate_passed ? "var(--good)" : "var(--bg)") + '" stroke="var(--ink)" stroke-width="1.2"/>';
    x0 += w;
  });
  s += '</svg>';
  var act = ph.filter(function(p){ return p.status === "active"; })[0], leg = [];
  if(act) leg.push("Now: " + esc(act.title) + " (" + act.done + " of " + act.total + ")");
  if(p50) leg.push("Likely " + esc(fmtS(p50)) + (p85 && p85 !== p50 ? " to " + esc(fmtS(p85)) : ""));
  if(x.late) leg.push('<span class="chip bad">' + x.late + ' d past due at 85%</span>');
  else if(due && p85) leg.push('<span class="chip good">meets the due date</span>');
  if(due && !d.due_confirmed) leg.push('<span class="chip warn">due date not confirmed by you</span>');
  return '<div class="box sched wide"><h3>Schedule</h3>' + s + '<div class="legend">' + leg.join("<span>·</span>") + '</div>' +
    '<div class="legend"><span>◆ gate (filled = passed)</span><span style="color:var(--good)">■ done</span><span style="color:var(--accent)">■ current</span><span>■ planned</span></div></div>';
}
function spark(tr){
  if(!tr || tr.length < 2) return "";
  var W = 300, Hh = 46, mx = Math.max(100, Math.max.apply(null, tr));
  var pts = tr.map(function(v, i){ return (i * W / (tr.length - 1)).toFixed(1) + "," + (Hh - 4 - (Hh - 8) * v / mx).toFixed(1); }).join(" ");
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
    '<div class="dsub">Last 14 days' + (tr[tr.length - 1] === tr[tr.length - 4] ? ' · flat for 3 days' : "") + '</div>';
}

/* the Planner side of a project: its stage path, who it waits on, its day and its to-dos */
function pathBoxes(t){
  var out = [], ix = stageIx(t), unset = isUnset(t);
  out.push('<div class="box"><h3>Stage</h3><div class="steps">' + (t.st || []).map(function(s, i){
    return '<button data-stage="' + esc(t.id) + ':' + i + '" class="' + (!unset && i === ix ? "cur" : !unset && i < ix ? "done" : "") + '">' + esc(s) + '</button>'; }).join("") + '</div>' +
    '<p class="note">' + (unset ? "Stage not set: tap the one it is at." : "Tap a stage when it moves.") + '</p></div>');
  if(t.who && t.since){
    out.push('<div class="box"><h3>Waiting on ' + esc(cleanWho(t)) + '</h3><p>' + clockDays(t) + ' days since ' + esc(fmtS(lastChase(t) || t.since)) +
      (needsChase(t) ? ' <span class="chip warn">time to chase</span>' : "") + '</p><div class="btns" style="margin-top:8px">' +
      '<button class="btn" data-copy="' + esc(t.id) + '">Copy a chase note</button><button class="btn" data-chased="' + esc(t.id) + '">Chased today</button></div></div>');
  }
  var dt = doDate(t);
  out.push('<div class="box"><h3>Its day</h3><p>' + (dt ? esc(fmtS(dt)) + (bucketOf(t) === "overdue" ? ' <span class="chip">passed</span>' : "") : "No day set") + '</p><div class="btns" style="margin-top:8px">' +
    [["0","Today"],["1","Tomorrow"],["7","Next week"],["x","No day"]].map(function(o){ return '<button class="btn" data-date="' + esc(t.id) + ':' + o[0] + '">' + o[1] + '</button>'; }).join("") + '</div></div>');
  var tds = openTodos(t.id);
  out.push('<div class="box"><h3>To-dos · ' + tds.length + '</h3>' + tds.map(function(td){
    return '<div class="li"><span class="any">' + esc(td.text) + (td.due ? ' <span class="dsub">' + esc(fmtS(td.due)) + '</span>' : "") + '</span><button class="btn" style="margin-left:auto" data-todo="' + esc(td.id) + '">Done</button></div>'; }).join("") +
    '<div class="row" style="margin-top:8px"><input id="tdText" placeholder="Add a to-do for this" dir="auto"><button class="btn pri" data-addtodo="' + esc(t.id) + '">Add</button></div></div>');
  if(t.why || t.next){
    out.push('<div class="box"><h3>Notes</h3>' + (t.next ? '<p class="any"><b>Next:</b> ' + esc(t.next) + '</p>' : "") + (t.why ? '<p class="any dsub" style="margin-top:4px">' + esc(t.why) + '</p>' : "") + '</div>');
  }
  return out;
}

function vProject(M, id){
  var x = M.projects.filter(function(z){ return z.id === id; })[0];
  if(!x){ $("main").innerHTML = '<a class="back" href="#projects">‹ Projects</a><p class="empty">This project is not in the latest data.</p>'; return; }
  var r = recOf(x), v = pctOf(x), out = [];
  var win = '<span class="light ' + x.light + '"><i></i>' + LIGHT[x.light] + (x.t && x.t.heard ? " · heard " + ago(x.t.heard) : "") + '</span>';
  if(x.p && x.p.claude) win += '<a class="go" href="' + esc(x.p.claude) + '" target="_blank" rel="noopener">Open in Claude</a>';
  if(x.light === "off") win += '<span>Ask Richard when you want work done here.</span>';
  if(isClosed(x)){
    var c = r.closed || {};
    out.push('<div class="box wide"><h3>' + (r.status === "parked" ? "Parked" : "Closed") + (c.date ? " " + esc(fmtS(c.date)) : "") + '</h3>' +
      (c.outcome ? '<p class="any">' + esc(c.outcome) + '</p>' : "") + '<p class="dsub" style="margin-top:6px">' + (c.left ? c.left + " step" + (c.left > 1 ? "s" : "") + " left" : "Nothing left") + '</p>' +
      (c.left_titles || []).map(function(t){ return '<div class="li any">' + esc(t) + '</div>'; }).join("") +
      (c.restart ? '<p class="note any">Restart when: ' + esc(c.restart) + '</p>' : "") + '</div>');
  } else if(x.dec.length){
    out.push('<div class="box needs wide"><h3>Needs you · ' + x.dec.length + '</h3>' + x.dec.map(function(d){ return drow(d, false); }).join("") + '</div>');
  }
  if(r.phases && r.phases.length) out.push(schedule(x));
  if(v != null) out.push('<div class="box"><h3>Progress</h3><div class="prog"><span class="big">' + v + '%</span><span class="sub">' +
      (r.total ? r.passed + " of " + r.total + " steps done<br>" : "") + esc((x.p && x.p.phase) || "") + '</span></div>' + spark(r.trend) + '</div>');
  var nx = r.next3 || (x.t && x.t.next ? [{title:x.t.next, owner:"assistant"}] : []);
  if(nx.length && !isClosed(x)) out.push('<div class="box"><h3>Next</h3>' + nx.map(function(n, i){
      return '<div class="li"><b>' + (i + 1) + '</b><span class="any">' + esc(n.title) + '</span><span class="who' + (n.owner === "author" ? " you" : "") + '" style="margin-left:auto">' +
        (n.owner === "author" ? "you" : "team") + '</span></div>'; }).join("") + '</div>');
  if(r.top_risks && r.top_risks.length){
    out.push('<div class="box"><h3>Risks · ' + (r.risk_count || r.top_risks.length) + ' open</h3>' + r.top_risks.map(function(k){
      var c2 = k.score >= 15 ? "hi" : k.score >= 9 ? "md" : "lo";
      return '<div class="li"><span class="score ' + c2 + '">' + esc(k.score) + '</span><span class="any">' + esc(k.title) + '</span></div>'; }).join("") +
      (r.risk_count > r.top_risks.length ? '<div class="dsub">+' + (r.risk_count - r.top_risks.length) + ' more in the plan</div>' : "") + '</div>');
  } else if(r.risk_count) out.push('<div class="box"><h3>Risks</h3><p>' + r.risk_count + ' open (detail kept on the PC)</p></div>');
  if(r.decisions && r.decisions.length) out.push('<div class="box"><h3>Recent decisions</h3>' + r.decisions.map(function(k){
      return '<div class="li"><span class="dsub" style="white-space:nowrap">' + esc(fmtS(k.date)) + '</span><span class="any">' + esc(k.call) + (k.answer ? ' <b>' + esc(k.answer) + '</b>' : "") + '</span></div>'; }).join("") + '</div>');
  if(x.p && x.p.why && x.p.why.length && !isClosed(x)) out.push('<div class="box"><h3>Why this health</h3>' + x.p.why.map(function(w){ return '<div class="li any">' + esc(w.replace(/^EXCEPTION:\s*/, "")) + '</div>'; }).join("") + '</div>');
  if(r.doc_status || r.doc_plan) out.push('<div class="box"><h3>Documents</h3><div class="btns">' + (r.doc_status ? '<button class="btn" data-doc="status">Status report</button>' : "") +
      (r.doc_plan ? '<button class="btn" data-doc="plan">Plan</button>' : "") + '</div></div>');
  if(x.th){ out.push('<div class="box wide" style="background:transparent;border:0;padding:6px 0 0"><h3>In the Planner: ' + esc(x.th.n) + '</h3></div>'); out = out.concat(pathBoxes(x.th)); }
  if(!x.p && !x.th) out.push('<div class="box wide"><p class="dsub">No project plan on the PC for this one yet: only what its window reports. Ask Richard to set one up if it should be managed.</p></div>');
  $("main").innerHTML = '<a class="back" href="#projects">‹ Projects</a>' +
    '<div class="phead" style="--h:var(' + hcol(x) + ')"><h1 class="any">' + esc(x.name) + '</h1><span class="pill">' + esc(x.p && x.p.health ? HW[x.p.health] : "No plan") + '</span></div>' +
    '<div class="pwin">' + win + '</div><div class="pgrid">' + out.join("") + '</div>';
  $("main").dataset.pid = id;
}

function vPath(M, tid){
  var t = T(tid);
  if(!t){ $("main").innerHTML = '<a class="back" href="#projects">‹ Projects</a><p class="empty">Not on the board any more.</p>'; return; }
  var x = M.byThread(tid);
  if(x && !x.path){ location.replace("#p/" + x.id); return; }
  var dec = M.D.filter(function(d){ return d.ref === t || (d.via === "todo" && d.ref.thread === t.id) || (d.via === "q" && d.ref.thread === t.id); });
  var out = [];
  if(dec.length) out.push('<div class="box needs wide"><h3>Needs you · ' + dec.length + '</h3>' + dec.map(function(d){ return drow(d, false); }).join("") + '</div>');
  out = out.concat(pathBoxes(t));
  $("main").innerHTML = '<a class="back" href="#projects">‹ Projects</a>' +
    '<div class="phead" style="--h:var(' + (t.c || "--neutral") + ')"><h1 class="any">' + esc(t.n) + '</h1><span class="pill">' + esc(domName(t.dom)) + '</span>' +
    '<button class="btn" data-pin="' + esc(t.id) + '">' + (isPinned(t) ? "Unpin" : "Pin") + '</button></div>' +
    '<div class="pwin"><span class="light path"><i></i>Planner path, no project plan on the PC</span></div><div class="pgrid">' + out.join("") + '</div>';
}

/* ---------- Week ---------- */
function vWeek(){
  var tdy = new Date().getDay(), html = '<div class="days">';
  FULL.forEach(function(n, d){ html += '<button data-wday="' + d + '" class="' + (d === weekDay ? "on " : "") + (d === tdy ? "today" : "") + '">' + n.slice(0, 3) + ' ' + esc(fmtS(thisWeekDate(d)).split(" ")[0]) + '</button>'; });
  html += '</div><div class="week">';
  for(var d = 0; d < 7; d++){
    var ds = thisWeekDate(d), blocks = board.week[d] || [];
    html += '<div class="wd' + (d === weekDay ? " show" : "") + (d === tdy ? " today" : "") + '"><h4>' + esc(FULL[d]) + ' ' + esc(fmtS(ds)) + '</h4>' + blocks.map(function(b, i){
      var who = planned(ds, i), th = who ? T(who) : null;
      return '<button class="wb' + (b[8] && b[8].once ? " once" : "") + '" style="--a:var(' + (b[3] || "--neutral") + ')" data-blk="' + d + ':' + i + '"><div class="tm">' + esc(b[0]) + '</div>' +
        '<div class="bn any">' + esc(b[1]) + '</div><div class="bp any' + (b[6] && !th ? " empty" : "") + '">' + esc(th ? th.n : b[6] ? "Empty" : (b[2] || "")) + '</div></button>';
    }).join("") + '<button class="wadd" data-addblk="' + d + '">+ Add</button></div>';
  }
  html += '</div>';
  var dr = drifting();
  html += '<div class="box" style="margin-top:12px"><h3>Weekly review</h3><p>' + (dr.length ? dr.length + ' path' + (dr.length > 1 ? "s have" : " has") + ' no day, no one holding them and no movement.' : "Nothing is drifting.") + '</p>' +
    (dr.length ? '<div class="btns" style="margin-top:8px"><button class="btn pri" data-review="1">Decide them now</button></div>' : "") + '</div>';
  $("main").innerHTML = html;
}

/* ---------- For you ---------- */
function vYou(M){
  var html = "";
  ["go", "question", "task", "todo", "date", "reminder"].forEach(function(k){
    var list = M.D.filter(function(d){ return d.kind === k; });
    if(!list.length) return;
    html += '<h2>' + KIND[k] + ' · ' + list.length + '</h2><div class="box' + (k === "go" ? " needs" : "") + '">' + list.map(function(d){ return drow(d, true); }).join("") + '</div>';
  });
  $("main").innerHTML = html || '<p class="empty">Nothing waits on you. The projects are moving on their own.</p>';
}

/* ---------- More ---------- */
function vMore(){
  $("main").innerHTML = '<div class="pgrid">' +
    '<div class="box"><h3>Connection</h3><div class="f"><label>Private repository (owner/name)</label><input id="mRepo" value="' + esc(REPO()) + '" autocomplete="off"></div>' +
    '<div class="f"><label>Access token' + (token ? " (one is saved on this device)" : "") + '</label><input id="mTok" type="password" placeholder="' + (token ? "Leave empty to keep it" : "Paste the token") + '" autocomplete="off"></div>' +
    '<button class="btn pri" data-save="1">Save</button><p class="note">The token stays on this device only.</p></div>' +
    '<div class="box"><h3>Notifications</h3><div id="pushWrap"></div></div>' +
    '<div class="box"><h3>Sending</h3><p>' + (queue.length ? queue.length + " change" + (queue.length > 1 ? "s" : "") + " waiting to send." : "Everything is sent.") + '</p>' +
    '<div class="btns" style="margin-top:8px"><button class="btn" data-flush="1">Send now</button><button class="btn" data-repair="1">Repair this app</button></div></div>' +
    '<div class="box"><h3>Old apps (until 20 November)</h3><div class="btns"><a class="btn" href="index.html?classic" style="text-decoration:none;color:inherit">Classic phone app</a>' +
    '<a class="btn" href="desktop.html?classic" style="text-decoration:none;color:inherit">Classic PC app</a></div><p class="note">Files, search and the old views live there until then.</p></div></div>';
  try{ pushPanel($("pushWrap"), "btn", "note"); }catch(e){ $("pushWrap").textContent = "Not available in this browser."; }
}

/* ---------- writes ---------- */
function answerLine(q, a){
  var o = {q:q, a:a, at:new Date().toISOString(), via:"app"};
  queue.push({kind:"answer", line:JSON.stringify(o)}); put(K.queue, queue);
  ANS[q] = Date.now(); put("brief.answered", ANS);
}
function setDateP(t, iso, why){
  if(iso) dates[t.id] = iso; else delete dates[t.id];
  var o = {thread:t.id, "do":iso || null, at:new Date().toISOString()}; if(why) o.why = why;
  queue.push({kind:"date", line:JSON.stringify(o)}); put(K.queue, queue);
}
function dropP(t){
  dropped[t.id] = true; delete dates[t.id];
  queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":null, drop:true, at:new Date().toISOString()})}); put(K.queue, queue);
}
function setStageP(t, ix){
  if(statuses[t.id] && statuses[t.id].stage === ix) return;
  var lab = (t.st || [])[ix] || "";
  statuses[t.id] = {thread:t.id, stage:ix, label:lab, at:new Date().toISOString()};
  queue.push({kind:"status", line:JSON.stringify(statuses[t.id])});
  queue.push({kind:"issue", title:"Update: " + t.n, body:"Stage set to **" + lab + "**.\n\n---\nThread: `" + t.id + "` — " + t.n + "\nSent from the Planner app, " + new Date().toISOString() + "."});
  put(K.queue, queue); UI.afterWrite("Stage saved.");
}
function assignP(ds, ix, tid){
  plan[ds + "#" + blockId(ds, ix)] = tid;
  queue.push({kind:"plan", line:JSON.stringify({date:ds, block:ix, key:blockId(ds, ix), thread:tid, at:new Date().toISOString()})});
  put(K.queue, queue); UI.afterWrite(tid ? "Put on the block." : "Block cleared.");
}
function addThreadP(o){
  var dm = (board.domains || []).filter(function(d){ return d.id === o.dom; })[0];
  var t = {id:slug(o.n) + "-" + Date.now().toString(36).slice(-4), n:o.n.trim(), dom:o.dom || "", c:(dm && dm.c) || "--neutral", st:stagesFor(o.dom), at:0,
           tag:"New", next:(o.next || "").trim(), goal:"", added:new Date().toISOString(), via:"app"};
  if(o.who){ t.who = o.who.trim(); t.since = localDay(); }
  added.push(t); put("planner.added", added); board.threads.push(t);
  queue.push({kind:"added", line:JSON.stringify(t)});
  queue.push({kind:"issue", title:"New thread: " + t.n, body:"Added from the app" + (dm ? " under " + dm.n : "") + "." + (t.next ? "\n\nNext: " + t.next : "") +
    (t.who ? "\n\nWith " + t.who + " from today." : "") + "\n\nFile it: project file, goal, and board.json.\n\n---\nThread: `" + t.id + "` — " + t.n + "\nSent from the Planner app, " + t.added + "."});
  put(K.queue, queue); UI.afterWrite("Added.");
  return t;
}
function noteRichard(text){
  text = String(text || "").trim(); if(!text) return false;
  queue.push({kind:"issue", title:"Richard: " + text.split("\n")[0].slice(0, 70), body:text + "\n\n---\nSent from the Planner app, " + new Date().toISOString() + "."});
  put(K.queue, queue); UI.afterWrite("Sent to Richard. He reads it at his next round.");
  return true;
}
function doAct(d, a){
  if(d.via === "brief") answerLine(d.q, a);
  else if(d.via === "q") answerQ(d.ref, a);
  else if(d.via === "todo"){ doneTodo(d.ref.id); closeSheet(); return; }
  else if(d.via === "date"){
    if(a === "Drop") dropP(d.ref);
    else setDateP(d.ref, a === "Next week" ? dayOffset(7) : a === "In 4 weeks" ? dayOffset(28) : null, "clean-up");
  }
  closeSheet();
  UI.afterWrite(a === "Done" ? "Marked done. The PC records it within a minute." : "Sent: " + a + ".");
}

/* ---------- sheets ---------- */
function openSheet(html){ $("sheet").innerHTML = '<button class="sh-x" data-close aria-label="Close">×</button>' + html; $("sheet").classList.add("on"); $("veil").classList.add("on"); $("sheet").scrollTop = 0; }
function closeSheet(){
  $("sheet").classList.remove("on"); $("veil").classList.remove("on");
  if(reviewLog.length){ reviewFinish(); }
}
function decisionSheet(d){
  var t = d.detail || {}, kv = [];
  function add(k, v){ if(v) kv.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); }
  add("What", esc(d.text) + (t.what && t.what.length ? '<br><span class="dsub">' + t.what.map(esc).join("<br>") + '</span>' : ""));
  add("Project", esc(d.project));
  add("Why", esc(t.why));
  if(d.kind === "question" || d.kind === "go"){
    add("If yes", esc(t.yes)); add("If no", esc(t.no));
    if(!t.yes && d.options.length > 1) add("Options", d.options.map(function(o){ return esc(o) + (o === d.rec ? " (recommended)" : ""); }).join("<br>"));
  }
  add("Undo?", esc(t.undo));
  add("By", t.by ? esc(fmtS(t.by)) + (dd(t.by, localDay()) >= 0 ? " (" + dd(t.by, localDay()) + " d left)" : ' <span class="chip bad">passed</span>') : "");
  if(d.rec) add("Richard", "recommends " + esc(d.rec));
  var btn = d.options.map(function(o){ return '<button data-a="' + esc(o) + '" class="' + (o === d.rec ? "rec" : "") + '">' + esc(o) + '</button>'; }).join("") + '<button data-close>Later</button>';
  var note = d.plan ? "Done tells the project's window; it checks the evidence and records the step." :
             d.kind === "go" ? "A critical step: nothing happens until you answer." :
             d.kind === "question" && !t.why ? "The session gave only the question; ask Richard for more if it is not clear." : "";
  openSheet('<div class="sh-k">' + esc(KIND[d.kind].replace(/s$/, "")) + '</div><div class="sh-t any">' + esc(d.kind === "date" ? d.text : dLabel(d.text, t.label)) + '</div>' +
    '<dl class="kv">' + kv.join("") + '</dl><div class="opts" data-q="' + esc(d.q) + '">' + btn + '</div>' + (note ? '<p class="note">' + note + '</p>' : ""));
}
function pickList(sel){
  var M = plModel(), list = M.projects.filter(function(x){ return x.th && !isClosed(x) && (!x.path || activePath(x.th) || x.th.critical); });
  var rest = board.threads.filter(function(t){ return !dropped[t.id] && !list.some(function(x){ return x.th.id === t.id; }); });
  return list.map(function(x){ return x.th; }).concat(rest).map(function(t){
    return '<button data-pick="' + esc(t.id) + '" class="' + (t.id === sel ? "on" : "") + '" style="--a:var(' + (t.c || "--neutral") + ')"><i></i><span class="any">' + esc(t.n) + '</span></button>'; }).join("");
}
function blockSheet(d, i){
  var b = (board.week[d] || [])[i]; if(!b) return;
  var ds = thisWeekDate(d), who = planned(ds, i), th = who ? T(who) : null;
  openSheet('<div class="sh-k">' + esc(FULL[d]) + ' ' + esc(fmtS(ds)) + ' · ' + esc(b[0]) + '</div><div class="sh-t any">' + esc(b[1]) + '</div>' +
    (b[2] ? '<p class="dsub any" style="margin:-8px 0 10px">' + esc(b[2]) + '</p>' : "") +
    '<p style="margin-bottom:8px">' + (th ? 'On it: <b>' + esc(th.n) + '</b>' : 'Nothing on this block.') + '</p>' +
    '<div class="btns" style="margin-bottom:12px"><button class="btn" data-edit="' + d + ':' + i + '">Change the time, move or cancel</button>' + (th ? '<button class="btn" data-clear="' + d + ':' + i + '">Clear</button>' : "") + '</div>' +
    '<h3 class="dsub" style="margin-bottom:6px">Put a project on it (one block, one project)</h3><div class="pick" data-assign="' + d + ':' + i + '">' + pickList(who) + '</div>');
}
function editSheet(d, i){
  var blk = i == null ? null : (board.week[d] || [])[i];
  openSheet('<div class="sh-k">Timetable</div><div class="sh-t">' + (blk ? esc(blk[1]) : "Add a block") + '</div><div id="edWrap"></div>');
  blockEditor($("edWrap"), d, blk, {fld:"f", label:"", check:"fx", row:"btns", btn:"btn", on:"on", pri:"pri", warn:"warnb", note:"note"}, function(){ closeSheet(); plDraw(); });
}
function reviewSheet(){
  var dr = drifting();
  openSheet('<div class="sh-k">Weekly review</div><div class="sh-t">' + dr.length + ' drifting</div>' + dr.map(function(t){
    return '<div class="li" style="flex-wrap:wrap"><span class="any" style="flex:1 1 200px">' + esc(t.n) + '<br><span class="dsub">' + esc(isUnset(t) ? "stage not set" : stageName(t)) + '</span></span>' +
      '<span class="btns">' + [["start","Today"],["day","Give it a day"],["delay","In 4 weeks"],["drop","Drop"]].map(function(o){
        return '<button class="btn" data-rv="' + esc(t.id) + ':' + o[0] + '">' + o[1] + '</button>'; }).join("") + '</span></div>'; }).join("") +
    '<p class="note">Each answer is saved at once; the summary goes to the Planner when you close this.</p>');
}
function reviewP(t, what){
  var iso = what === "start" ? dayOffset(0) : what === "day" ? nextWorkDay() : what === "delay" ? dayOffset(28) : null;
  if(what === "drop") dropP(t); else setDateP(t, iso, what);
  reviewLog.push({t:t, what:what, iso:iso}); flushQueue();
}
function addSheet(tab){
  tab = tab || "todo";
  var doms = (board.domains || []).map(function(d){ return '<option value="' + esc(d.id) + '">' + esc(d.n) + '</option>'; }).join("");
  var ths = board.threads.filter(function(t){ return !dropped[t.id]; }).map(function(t){ return '<option value="' + esc(t.id) + '">' + esc(t.n) + '</option>'; }).join("");
  var body = tab === "todo" ?
      '<div class="f"><label>To-do</label><input id="aText" dir="auto" placeholder="What to do"></div><div class="f"><label>For (optional)</label><select id="aThr"><option value="">Nothing in particular</option>' + ths + '</select></div>' +
      '<div class="f"><label>By (optional)</label><input id="aDue" type="date"></div><button class="btn pri" data-addgo="todo">Add to-do</button>' :
    tab === "project" ?
      '<div class="f"><label>Project name</label><input id="aName" dir="auto"></div><div class="f"><label>Area</label><select id="aDom">' + doms + '</select></div>' +
      '<div class="f"><label>Next step (optional)</label><input id="aNext" dir="auto"></div><div class="f"><label>Waiting on someone? (optional)</label><input id="aWho" dir="auto" placeholder="Name"></div>' +
      '<button class="btn pri" data-addgo="project">Add project</button><p class="note">It goes on the Planner now; Richard sets up a full plan when you ask him.</p>' :
      '<div class="f"><label>Note to Richard</label><textarea id="aNote" rows="4" dir="auto" placeholder="Anything: a task, a question, a change"></textarea></div><button class="btn pri" data-addgo="note">Send</button>' +
      '<p class="note">For anything urgent, talk to him in the Claude app.</p>';
  openSheet('<div class="sh-k">Add</div><div class="tabs">' + [["todo","To-do"],["project","Project"],["note","Note to Richard"]].map(function(x){
    return '<button class="btn' + (tab === x[0] ? " on" : "") + '" data-addtab="' + x[0] + '">' + x[1] + '</button>'; }).join("") + '</div>' + body);
}

/* ---------- one click handler ---------- */
document.addEventListener("click", function(ev){
  var t = ev.target, x;
  if(t.closest("[data-close]") || t === $("veil")){ closeSheet(); return; }
  if((x = t.closest("[data-f]"))){ cFilter = cFilter === x.dataset.f ? null : x.dataset.f; plDraw(); return; }
  if((x = t.closest("[data-pf]"))){ pFilter = x.dataset.pf; putRaw("pl.pfilter", pFilter); plDraw(); return; }
  if((x = t.closest("[data-fold]")) && !t.closest(".card") && !t.closest(".fold-body")){ x.classList.toggle("open"); return; }
  if((x = t.closest("[data-d]"))){ var d = plModel().D.filter(function(z){ return z.q === x.dataset.d; })[0]; if(d) decisionSheet(d); return; }
  if((x = t.closest(".opts [data-a]"))){ var q = x.parentNode.dataset.q, dd2 = plModel().D.filter(function(z){ return z.q === q; })[0]; if(dd2){ x.disabled = true; doAct(dd2, x.dataset.a); } return; }
  if((x = t.closest("[data-doc]"))){
    var px = plModel().projects.filter(function(z){ return z.id === $("main").dataset.pid; })[0], r = px ? recOf(px) : {};
    openSheet('<div class="sh-k">' + esc(px ? px.name : "") + '</div><div class="sh-t">' + (x.dataset.doc === "plan" ? "Plan" : "Status report") + '</div><pre class="doc">' + esc(x.dataset.doc === "plan" ? r.doc_plan : r.doc_status) + '</pre>');
    return;
  }
  if((x = t.closest("[data-blk]"))){ var bi = x.dataset.blk.split(":"); blockSheet(+bi[0], +bi[1]); return; }
  if((x = t.closest("[data-edit]"))){ var ei = x.dataset.edit.split(":"); editSheet(+ei[0], +ei[1]); return; }
  if((x = t.closest("[data-addblk]"))){ editSheet(+x.dataset.addblk, null); return; }
  if((x = t.closest("[data-clear]"))){ var ci = x.dataset.clear.split(":"); assignP(thisWeekDate(+ci[0]), +ci[1], ""); closeSheet(); return; }
  if((x = t.closest("[data-pick]"))){
    var host = x.closest("[data-assign]");
    if(host){ var ai = host.dataset.assign.split(":"); assignP(thisWeekDate(+ai[0]), +ai[1], x.dataset.pick); closeSheet(); }
    return;
  }
  if((x = t.closest("[data-wday]"))){ weekDay = +x.dataset.wday; plDraw(); return; }
  if((x = t.closest("[data-review]"))){ reviewSheet(); return; }
  if((x = t.closest("[data-rv]"))){ var rv = x.dataset.rv.split(":"), th = T(rv[0]); if(th){ reviewP(th, rv[1]); x.closest(".li").remove(); } return; }
  if((x = t.closest("[data-stage]"))){ var si = x.dataset.stage.split(":"), st = T(si[0]); if(st) setStageP(st, +si[1]); return; }
  if((x = t.closest("[data-date]"))){
    var di = x.dataset.date.split(":"), dt = T(di[0]);
    if(dt){ setDateP(dt, di[1] === "x" ? null : dayOffset(+di[1])); UI.afterWrite(di[1] === "x" ? "Day cleared." : "Day set."); }
    return;
  }
  if((x = t.closest("[data-todo]"))){ doneTodo(x.dataset.todo); return; }
  if((x = t.closest("[data-addtodo]"))){ var v = $("tdText").value; if(v.trim()) addTodo(x.dataset.addtodo, v, null, "app"); return; }
  if((x = t.closest("[data-pin]"))){ var pt = T(x.dataset.pin); if(pt) togglePin(pt); return; }
  if((x = t.closest("[data-copy]"))){ var ct = T(x.dataset.copy); if(ct) copyText(chaseDraft(ct), function(ok){ plToast(ok ? "Chase note copied." : "Could not copy here."); }); return; }
  if((x = t.closest("[data-chased]"))){ var mt = T(x.dataset.chased); if(mt) markChased(mt); return; }
  if((x = t.closest("[data-addtab]"))){ addSheet(x.dataset.addtab); return; }
  if((x = t.closest("[data-addgo]"))){
    var k = x.dataset.addgo;
    if(k === "todo"){ if(!$("aText").value.trim()) return; addTodo($("aThr").value || null, $("aText").value, $("aDue").value || null, "app"); }
    else if(k === "project"){ if(!$("aName").value.trim()) return; addThreadP({n:$("aName").value, dom:$("aDom").value, next:$("aNext").value, who:$("aWho").value}); }
    else if(!noteRichard($("aNote").value)) return;
    closeSheet(); return;
  }
  if(t.closest("#fab")){ addSheet("todo"); return; }
  if((x = t.closest("[data-save]"))){
    var rp = $("mRepo").value.trim(), tk = $("mTok").value.trim();
    if(rp) putRaw(K.repo, rp);
    if(tk){ token = tk; put(K.tok, tk); }
    plToast("Saved."); plLoad(); return;
  }
  if(t.closest("[data-flush]")){ flushQueue().then(function(){ plToast(queue.length ? "Still waiting: no connection." : "Everything is sent."); plDraw(); }); return; }
  if(t.closest("[data-repair]")){ repairInstall(); return; }
});
document.addEventListener("keydown", function(e){ if(e.key === "Escape") closeSheet(); });
var rsz; window.addEventListener("resize", function(){ clearTimeout(rsz); rsz = setTimeout(function(){ if(route().indexOf("p/") === 0) plDraw(); }, 200); });
window.addEventListener("hashchange", function(){ $("sheet").classList.remove("on"); $("veil").classList.remove("on"); plDraw(); window.scrollTo(0, 0); });
document.addEventListener("visibilitychange", function(){ if(!document.hidden) plLoad(); });
window.addEventListener("online", function(){ flushQueue().then(plDraw); });

mergeAdded(); applyWeekEdits();
plDraw();
plLoad();
setInterval(function(){ if(!document.hidden) plLoad(); }, 60000);
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function(){});
