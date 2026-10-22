/* Planner core. The code the phone page and the desktop page share: reading and
   writing the repository, the offline queue, the chase and day rules, the dictation
   merge, notifications. One copy, so a fix is made once.

   A plain script that both pages load before their own. Its names are global on
   purpose; the page scripts use them directly. The one thing it needs from a page
   is afterWrite and setStage, which each page registers in UI. */
"use strict";

var UI = {};   // what only a page can do; the page fills it in
function afterWrite(msg){ if(UI.afterWrite) UI.afterWrite(msg); }
function setStage(t, ix){ return UI.setStage ? UI.setStage(t, ix) : null; }

var K = { tok:"planner.token", repo:"planner.repo", board:"planner.board", focus:"planner.focus",
         mins:"planner.mins", queue:"planner.queue", lang:"planner.lang", theme:"planner.theme",
         running:"planner.running", sel:"planner.sel" };

/* Which page this is. Both pages share this file, and the commit message of every write names the device. */
var WHERE = /desktop\.html/i.test(location.pathname) ? "desktop" : "phone";

var BUILD = "2026-10-22.2";   // bumped on every publish, checked against version.json
function REPO(){ return getRaw(K.repo) || ""; }
function API(){ return "https://api.github.com/repos/" + REPO(); }

/* ---------- tiny helpers ---------- */
function $(id){ return document.getElementById(id); }

function el(t,c,x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
function getRaw(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } }
function putRaw(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function get(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function put(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function del(k){ try{ localStorage.removeItem(k); }catch(e){} }
function hm(t){ var h=Math.floor(t/60)%24, m=t%60; return (h<10?"0":"")+h+":"+(m<10?"0":"")+m; }
function dur(m){ m=Math.max(0,Math.round(m)); var h=Math.floor(m/60); return h?(h+"h "+(m%60)+"m"):(m+"m"); }
function nowMin(){ var d=new Date(); return d.getHours()*60+d.getMinutes(); }

function b64d(s){
  return decodeURIComponent(Array.prototype.map.call(atob(String(s).replace(/\s/g,"")),function(c){
    return "%"+("00"+c.charCodeAt(0).toString(16)).slice(-2); }).join(""));
}

function b64e(s){ return btoa(unescape(encodeURIComponent(s))); }

function ago(iso){
  var d=(Date.now()-new Date(iso).getTime())/60000;
  if(d<60) return Math.max(1,Math.round(d))+"m ago";
  if(d<1440) return Math.round(d/60)+"h ago";
  return Math.round(d/1440)+"d ago";
}

var DEFAULT = { updated:"", headline:"Not connected yet. Open settings, add the repository and a token, and the board loads.", apex:"", goals:[], events:[], threads:[], domains:[], week:[[],[],[],[],[],[],[]], open:[] };
var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ---------- state ---------- */
var board = get(K.board, null) || DEFAULT;

var token = get(K.tok, "");

var running = get(K.running, null);
(function(){
if(!running){                       // migrate the old single-thread value
  var old = get(K.focus, null);
  running = (old && old.id) ? (function(){ var o={}; o[old.id]=old.at; return o; })() : {};
  put(K.running, running); del(K.focus);
}
})();

function isOn(id){ return Object.prototype.hasOwnProperty.call(running,id); }
var statuses = {};   // thread id -> {stage, at}, what he has confirmed himself
var plan = {};       // "YYYY-MM-DD#blockIndex" -> thread id
var dates = {};      // thread id -> "YYYY-MM-DD", the day he means to touch it
function runningIds(){ return Object.keys(running); }
var mins  = get(K.mins, {});
var queue = get(K.queue, []);

var issues = null,
    issuesErr = "";

function T(id){ for(var i=0;i<board.threads.length;i++) if(board.threads[i].id===id) return board.threads[i]; return null; }

function gh(path, opts){
  opts = opts || {};
  if(!REPO()) return Promise.reject(new Error("No repository set. Open settings and add it."));
  if(!token)  return Promise.reject(new Error("No token yet. Open settings and paste one."));
  var h = { "Accept":"application/vnd.github+json", "Authorization":"Bearer "+token,
            "X-GitHub-Api-Version":"2022-11-28" };
  if(opts.body) h["Content-Type"]="application/json";
  return fetch(API()+path, { method:opts.method||"GET", headers:h,
                             body:opts.body?JSON.stringify(opts.body):undefined })
    .then(function(r){
      if(r.status===404 && opts.soft404) return null;
      return r.text().then(function(t){
        var j=null; try{ j=t?JSON.parse(t):null; }catch(e){}
        if(!r.ok){
          var m = (j&&j.message)?j.message:("HTTP "+r.status);
          if(r.status===401) m="Token rejected. Make a new one and paste it again.";
          if(r.status===403) m="Token lacks permission. It needs Contents and Issues, read and write.";
          if(r.status===409) m="That file changed underneath you. Reopen it and redo the edit.";
          var er=new Error(m); er.status=r.status; throw er;
        }
        return j;
      });
    });
}

function pullBoard(){
  return gh("/contents/data/board.json", {soft404:true}).then(function(r){
    if(!r||!r.content) return null;
    var j = JSON.parse(b64d(r.content));
    if(j && j.threads && j.week){ board=j; put(K.board,j); mergeAdded(); baseWeek=null; applyWeekEdits(); }
    return j;
  });
}

function appendLine(path, line, message){
  return gh("/contents/"+path, {soft404:true}).then(function(r){
    if(r && r.sha && !r.content && r.size>0){
      /* The contents API returns nothing for a file over 1 MB. Appending to that
         "empty" body would replace the whole file with one line. */
      var big=new Error(path+" is over 1 MB and cannot be extended from here. Trim it in the repository.");
      big.status=413; throw big;
    }
    var body = r&&r.content ? b64d(r.content) : "";
    if(body && body.slice(-1)!=="\n") body += "\n";
    return putFile(path, body+line+"\n", r&&r.sha, message);
  });
}

function getFile(path){
  return gh("/contents/"+path, {soft404:true}).then(function(r){
    if(!r||!r.content) return null;
    return { path:path, text:b64d(r.content), sha:r.sha };
  });
}

function putFile(path, text, sha, message){
  var body={ message:message||("Update "+path), content:b64e(text) };
  if(sha) body.sha=sha;
  return gh("/contents/"+path, {method:"PUT", body:body});
}

function pullStatus(){
  return gh("/contents/data/status.jsonl", {soft404:true}).then(function(r){
    statuses={};
    if(!r||!r.content) return;
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(o&&o.thread) statuses[o.thread]=o;
    });
  });
}

function pullPlan(){
  return gh("/contents/data/plan.jsonl", {soft404:true}).then(function(r){
    plan={};
    if(!r||!r.content) return;
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.date||typeof o.block!=="number") return;
      plan[o.date+"#"+(o.key||blockId(o.date,o.block))]=o.thread||"";
    });
  });
}

/* A day's blocks are a list that timetable edits reorder, so a block's position
   is not a safe name for it: adding or cancelling one moved every assignment
   after it onto a different block. Assignments are filed under the block's
   start and title; the position stays in the line for anything that reads it. */
function blockId(dateStr, ix){
  var d=new Date(dateStr+"T12:00:00"), day=(board.week[d.getDay()]||[]), b=day[ix];
  return b ? (b[4]+"|"+b[1]) : ("ix"+ix);
}

function planned(dateStr, blockIx){ return plan[dateStr+"#"+blockId(dateStr,blockIx)]||""; }

function pullDates(){
  return gh("/contents/data/dates.jsonl", {soft404:true}).then(function(r){
    dates={};
    if(!r||!r.content) return;
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.thread) return;
      if(o["do"]) dates[o.thread]=o["do"]; else delete dates[o.thread];
      if(o.drop) dropped[o.thread]=true; else if(o["do"]) delete dropped[o.thread];
    });
  });
}

function doDate(t){ return dates[t.id]||""; }

function dayOffset(n){
  var d=new Date(); d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}

function bucketOf(t){
  var d=doDate(t);
  if(!d) return "";
  var today=dayOffset(0);
  if(d<today) return "overdue";
  if(d===today) return "today";
  if(d<=dayOffset(7)) return "week";
  return "later";
}

function waitingDays(t){
  if(!t.since) return 0;
  var d=new Date(t.since+"T00:00:00");
  if(isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now()-d.getTime())/864e5));
}

function chaseAfter(t){ return typeof t.chaseAfter==="number" ? t.chaseAfter : 7; }
function needsChase(t){ return !!(t.who && t.since && clockDays(t)>=chaseAfter(t)); }

/* Every kind of queued write: the file it appends to and the commit message it carries.
   Anything else in the queue is a message, and becomes an issue. */
var WRITES = {
  log:    ["data/log.jsonl",         "Session log"],
  status: ["data/status.jsonl",      "Stage set from the "+WHERE],
  plan:   ["data/plan.jsonl",        "Day assigned from the "+WHERE],
  date:   ["data/dates.jsonl",       "Do-date set from the "+WHERE],
  tick:   ["data/ticks.jsonl",       "Ticked from the "+WHERE],
  answer: ["data/answers.jsonl",     "Question answered from the "+WHERE],
  added:  ["data/added.jsonl",       "Added from the "+WHERE],
  link:   ["desktop/links.jsonl",    "Folder linked from the "+WHERE],
  push:   ["data/push.jsonl",        "Notifications set on the "+WHERE],
  week:   ["data/week.jsonl",        "Timetable changed from the "+WHERE],
  todo:   ["data/todos.jsonl",       "To-do from the "+WHERE],
  pin:    ["data/pins.jsonl",        "Pinned from the "+WHERE],
  sugg:   ["data/suggestions.jsonl", "Suggestion decided on the "+WHERE]
};
function flushOnce(){
  if(!token || !queue.length) return Promise.resolve();
  var item = queue[0], w = WRITES[item.kind];
  var p = w ? appendLine(w[0], item.line, w[1])
            : gh("/issues", {method:"POST", body:{title:item.title, body:item.body}});
  return p.then(function(){
    queue.shift(); put(K.queue,queue);
    return queue.length ? flushOnce() : null;
  }).catch(function(e){
    if(e && (e.status===422 || e.status===413)){
      /* This write can never succeed (an issue body too long, a file too big).
         Left at the head it would hold back everything behind it, so it is set
         aside in this browser and the queue carries on. */
      var dead=get("planner.dead",[]);
      dead.push({item:item, error:String(e.message).slice(0,200), at:new Date().toISOString()});
      put("planner.dead",dead.slice(-50));
      queue.shift(); put(K.queue,queue);
      deadNote="One write could not be saved ("+String(e.message).slice(0,70)+") and was set aside.";
      return queue.length ? flushOnce() : null;
    }
    /* anything else (no signal, a conflict, a bad token) stays queued and is retried */
  });
}

var deadNote="";

/* One save at a time. Two overlapping flushes both took the first item in the
   queue and wrote it twice; now a flush asked for while one runs waits for it
   and then carries on with whatever is left. */
var flushing=null;

function flushQueue(){
  if(flushing) return flushing.then(function(){ return queue.length ? flushQueue() : null; });
  flushing = flushOnce().then(function(){ flushing=null; }, function(){ flushing=null; });
  return flushing;
}

/* ---------- ticks, answers, goals, chasing: the same in both apps ----------
   data/ticks.jsonl    {thread, kind:"chase"|"step", day, at, via}  a chase restarts the clock
   data/answers.jsonl  {q, a, at, via}                              one line per answered question
   A tick or an answer can come from here or from a box ticked in the morning brief. */
var ticks = [];

var answers = {};
var dropped = {};    // thread id -> true, dropped in a review; kept in data/dates.jsonl
var qSkip = 0;       // "not now" moves to the next question for this session only

function readLines(r){
  var out=[];
  if(!r||!r.content) return out;
  b64d(r.content).split("\n").forEach(function(ln){
    if(!ln.trim()) return;
    try{ var o=JSON.parse(ln); if(o) out.push(o); }catch(e){}
  });
  return out;
}

function pullTicks(){
  return gh("/contents/data/ticks.jsonl",{soft404:true}).then(function(r){ ticks=readLines(r); });
}

function pullAnswers(){
  return gh("/contents/data/answers.jsonl",{soft404:true}).then(function(r){
    answers={}; readLines(r).forEach(function(o){ if(o.q) answers[o.q]=o; });
  });
}

/* Desktop work: one line per local Claude Code session, written by the hook in
   the private repository. Active minutes and tokens only; never content.
   Folder names rarely match project names, so a folder is linked to its
   project once, with one tap, in desktop/links.jsonl; every session from that
   folder, past and future, then counts toward that project. */
var deskMins={}, deskWeek={min:0, n:0, tok:0, proj:{}}, deskRaw=[], links={}, unlinked=[];

function pullDesk(){
  return Promise.all([
    gh("/contents/desktop/sessions.jsonl",{soft404:true}),
    gh("/contents/desktop/links.jsonl",{soft404:true})
  ]).then(function(rs){
    deskRaw=readLines(rs[0]);
    links={}; readLines(rs[1]).forEach(function(l){ if(l.folder) links[String(l.folder).toLowerCase()]={thread:l.thread||null}; });
    deskCompute();
  }).catch(function(){});
}

function deskThread(o){
  if(o.thread) return o.thread;
  var l=links[String(o.folder||o.project||"").toLowerCase()];
  return l ? l.thread : undefined;          // undefined: not linked yet; null: not a project
}

function deskCompute(){
  var cut=Date.now()-7*864e5, cut2=Date.now()-21*864e5, dm={}, w={min:0, n:0, tok:0, proj:{}}, un={};
  deskRaw.forEach(function(o){
    if(o.active_minutes==null) return;
    var at=new Date(o.start||o.ts).getTime(), m=Number(o.active_minutes)||0, th=deskThread(o);
    var folder=o.folder||o.project||"unknown";
    if(th===undefined && at>=cut2){
      var u=un[folder]||(un[folder]={folder:folder, min:0, n:0, cand:{}, last:0});
      u.min+=m; u.n++; u.last=Math.max(u.last,at);
      (o.candidates||[]).forEach(function(c){ u.cand[c]=1; });
    }
    if(!(at>=cut)) return;
    var tk=o.tokens||{}, t=0;
    for(var k in tk) if(tk.hasOwnProperty(k)) t+=Number(tk[k])||0;
    w.min+=m; w.n++; w.tok+=t;
    var key=th||("\u00b7 "+folder);
    w.proj[key]=(w.proj[key]||0)+m;
    if(th) dm[th]=(dm[th]||0)+m;
  });
  deskMins=dm; deskWeek=w;
  unlinked=Object.keys(un).map(function(k){ var u=un[k]; u.cand=Object.keys(u.cand); return u; })
    .sort(function(a,b){ return b.last-a.last; });
}

function linkFolder(folder, threadId){
  var o={folder:folder, thread:threadId||null, at:new Date().toISOString(), via:WHERE};
  links[String(folder).toLowerCase()]={thread:o.thread};
  queue.push({kind:"link", line:JSON.stringify(o)});
  put(K.queue,queue); deskCompute();
  var t=threadId?T(threadId):null;
  afterWrite(t ? ("Folder "+folder+" now counts toward "+t.n+".") : ("Folder "+folder+" is not counted as a project."));
}

function fmtTok(n){ return n>=1e6 ? (n/1e6).toFixed(1)+"M" : (n>=1e3 ? Math.round(n/1e3)+"k" : String(n)); }

function deskRows(){
  var out=[];
  for(var k in deskWeek.proj) if(deskWeek.proj.hasOwnProperty(k)){
    var th=T(k); out.push({name: th?th.n:(k.replace(/^\u00b7 /,"")+" (not linked to a thread)"), m:deskWeek.proj[k], t:th});
  }
  return out.sort(function(a,b){ return b.m-a.m; });
}

/* Adding from the app. board.json is generated, so a new item is not written
   into it: it is a line in data/added.jsonl, merged into the board here at
   once, and filed properly by Claude at the next session (project file, goal,
   board). The same line also arrives as an issue so it is not missed. */
var added = get("planner.added", []);

function mergeAdded(){
  (added||[]).forEach(function(a){ if(a && a.id && !T(a.id)) board.threads.push(a); });
}

function pullAdded(){
  return gh("/contents/data/added.jsonl",{soft404:true}).then(function(r){
    var list=readLines(r).filter(function(a){ return a && a.id && a.n; }), have={};
    list.forEach(function(a){ have[a.id]=1; });
    queue.forEach(function(q){        // added offline and not sent yet: keep it
      if(q.kind!=="added") return;
      try{ var a=JSON.parse(q.line); if(a && a.id && !have[a.id]){ list.push(a); have[a.id]=1; } }catch(e){}
    });
    added=list; put("planner.added", added); mergeAdded();
  }).catch(function(){});
}

function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,24)||"item"; }

/* The stages most used in that category, so a new paper walks like the other papers. */
function stagesFor(dom){
  var n={}, best=null, bn=0;
  board.threads.forEach(function(t){
    if(t.dom!==dom || !(t.st||[]).length) return;
    var k=JSON.stringify(t.st); n[k]=(n[k]||0)+1;
    if(n[k]>bn){ bn=n[k]; best=t.st; }
  });
  return best ? best.slice() : ["Not started","Running","Done"];
}

/* Notifications on this device. Standard Web Push: the browser gives a
   subscription, it is saved to data/push.jsonl in the private repository, and
   the workflows there send the morning message, the Saturday review and every
   read receipt to it. The key below is the public half, public by design. */
var VAPID_PUBLIC="BJoOP1dTsBRksud8DfcG0q9Gh8VRfjwhk322ILFJuoNBK0Ey4hLPhQBzXwlGo_p8slDVQTOYYgMh-fqWijMQMiY";

function pushSupported(){ return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window); }

function pushState(){
  if(!pushSupported()) return "unsupported";
  if(Notification.permission==="denied") return "blocked";
  return get("planner.pushon", false) && Notification.permission==="granted" ? "on" : "off";
}

function u8(b64){
  var s=(b64+"===".slice((b64.length+3)%4)).replace(/-/g,"+").replace(/_/g,"/");
  var raw=atob(s), out=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}

function pushId(){
  var id=get("planner.pushid","");
  if(!id){ id=WHERE+"-"+Math.random().toString(36).slice(2,10); put("planner.pushid",id); }
  return id;
}

function enablePush(done){
  if(!pushSupported()){ done(false,"This browser cannot receive notifications. On iPhone, add the app to the Home Screen first and open it from there."); return; }
  Notification.requestPermission().then(function(p){
    if(p!=="granted") throw new Error(p==="denied"
      ? "Notifications are blocked for this app. Allow them in the browser or phone settings, then try again."
      : "Permission was not given.");
    return navigator.serviceWorker.register("sw.js").then(function(){ return navigator.serviceWorker.ready; });
  }).then(function(reg){
    return reg.pushManager.getSubscription().then(function(s){
      return s || reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:u8(VAPID_PUBLIC)});
    });
  }).then(function(sub){
    var j=sub.toJSON(), id=pushId();
    var line={id:id, device:WHERE, endpoint:j.endpoint, keys:j.keys, at:new Date().toISOString(),
              ua:(navigator.userAgent||"").slice(0,90)};
    put("planner.pushon", true);
    queue.push({kind:"push", line:JSON.stringify(line)});
    queue.push({kind:"issue", title:"Notification test", body:"device: "+id+"\n\nSent from the Planner "+WHERE+" when notifications were turned on."});
    put(K.queue,queue);
    afterWrite("Notifications on. A test arrives in about a minute.");
    done(true,"On. A test notification should arrive in about a minute.");
  }).catch(function(e){ done(false, e && e.message ? e.message : String(e)); });
}

function disablePush(done){
  var id=pushId();
  put("planner.pushon", false);
  queue.push({kind:"push", line:JSON.stringify({id:id, device:WHERE, off:true, at:new Date().toISOString()})});
  put(K.queue,queue); afterWrite("Notifications off on this device.");
  if(pushSupported()) navigator.serviceWorker.ready.then(function(r){ return r.pushManager.getSubscription(); })
    .then(function(s){ if(s) s.unsubscribe(); }).catch(function(){});
  done(true,"Off on this device.");
}

/* A repair or a reinstall removes the worker and its push subscription with
   it, while the on-switch in localStorage stays on. So on every open, if
   notifications are meant to be on and permission still stands, the
   subscription is checked and remade when missing, and the new one is saved
   under the same device id, which replaces the dead one in the repository. */
function pushRepair(){
  if(!pushSupported() || !get("planner.pushon",false) || Notification.permission!=="granted") return;
  navigator.serviceWorker.ready.then(function(reg){
    return reg.pushManager.getSubscription().then(function(s){
      if(s) return null;
      return reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:u8(VAPID_PUBLIC)});
    });
  }).then(function(sub){
    if(!sub) return;
    var j=sub.toJSON(), id=pushId();
    queue.push({kind:"push", line:JSON.stringify({id:id, device:WHERE, endpoint:j.endpoint, keys:j.keys,
      at:new Date().toISOString(), ua:(navigator.userAgent||"").slice(0,90), repaired:true})});
    put(K.queue,queue); afterWrite("Notifications repaired on this device.");
  }).catch(function(){});
}

function pushPanel(wrap, btnCls, noteCls){
  var st=pushState();
  var msg=el("p",noteCls, {on:"On for this device. The morning message, the Saturday review and every reply arrive here.",
    off:"Off. Turn it on and this device gets the morning message, the Saturday review and every reply.",
    blocked:"Blocked in this browser's settings. Allow notifications for this app there, then come back.",
    unsupported:"This browser cannot receive notifications. On iPhone, add the app to the Home Screen and open it from there."}[st]);
  var b=el("button",btnCls, st==="on"?"Turn notifications off":"Turn notifications on");
  if(st==="unsupported"||st==="blocked") b.disabled=true;
  b.addEventListener("click",function(){
    b.disabled=true; b.textContent="Working\u2026";
    (st==="on"?disablePush:enablePush)(function(ok,text){
      msg.textContent=text; msg.className=noteCls+(ok?" ok":" bad");
      st=pushState(); b.disabled=false; b.textContent= st==="on"?"Turn notifications off":"Turn notifications on";
    });
  });
  wrap.appendChild(b); wrap.appendChild(msg);
}

/* The timetable is editable from the app. board.json holds the standing week;
   data/week.jsonl holds his changes on top of it, applied in order:
     {day:0, key, block:{...}}     change a block every week
     {day:0, key, remove:true}     take it off every week
     {date:"2026-09-27", key, ...} the same, for that one date only
     {reset:true}                  everything before this is already folded
                                   into board.json by Claude
   A block's key is its day, name and start time as they stand in board.json,
   so edits survive a reload and never depend on a position in a list. */
var weekEdits = get("planner.weekedits", []), baseWeek = null;

function thisWeekDate(d){
  var x=new Date(); x.setDate(x.getDate()+(d-x.getDay()));
  return x.getFullYear()+"-"+("0"+(x.getMonth()+1)).slice(-2)+"-"+("0"+x.getDate()).slice(-2);
}

function applyWeekEdits(){
  if(!baseWeek) baseWeek=JSON.parse(JSON.stringify(board.week||[]));
  var w=JSON.parse(JSON.stringify(baseWeek)), dates={}, i, k, from=0;
  for(i=0;i<7;i++){ w[i]=w[i]||[]; dates[thisWeekDate(i)]=i; }
  w.forEach(function(arr,d){ arr.forEach(function(x){ if(!x[7]) x[7]=d+"|"+x[1]+"|"+x[4]; }); });
  for(i=0;i<weekEdits.length;i++) if(weekEdits[i] && weekEdits[i].reset) from=i+1;
  weekEdits.slice(from).forEach(function(e){
    var d = e.date!=null ? dates[e.date] : e.day;
    if(d==null || !w[d]) return;                 // a one-off for another week
    var arr=w[d], at=-1;
    for(k=0;k<arr.length;k++) if(arr[k][7]===e.key) at=k;
    if(e.remove){ if(at>=0) arr.splice(at,1); return; }
    var b=e.block; if(!b) return;
    var old=at>=0?arr[at]:null;
    var blk=[hm(b.start)+"\u2013"+hm(b.end), b.n, b.d||"", b.c||(old?old[3]:"--neutral"),
             b.start, b.end, b.work?1:0, old?old[7]:e.key];
    if(e.date!=null) blk[8]={once:true};
    if(old) arr[at]=blk; else arr.push(blk);
  });
  w.forEach(function(arr){ arr.sort(function(a,b){ return a[4]-b[4]; }); });
  board.week=w;
}

function pullWeekEdits(){
  return gh("/contents/data/week.jsonl",{soft404:true}).then(function(r){
    var list=readLines(r), have={};
    list.forEach(function(e){ if(e && e.at) have[e.at+"|"+e.key]=1; });
    queue.forEach(function(q){ if(q.kind!=="week") return; try{ var e=JSON.parse(q.line); if(!have[e.at+"|"+e.key]) list.push(e); }catch(x){} });
    weekEdits=list; put("planner.weekedits", weekEdits); applyWeekEdits();
  }).catch(function(){});
}

function saveWeekEdit(e, issueTitle, issueBody){
  e.at=e.at||new Date().toISOString(); e.via=WHERE;
  weekEdits.push(e); put("planner.weekedits", weekEdits); applyWeekEdits();
  queue.push({kind:"week", line:JSON.stringify(e)});
  if(issueTitle) queue.push({kind:"issue", title:issueTitle, body:issueBody+"\n\n---\nSent from the Planner "+WHERE+", "+e.at+"."});
  put(K.queue,queue);
}

function toMin(v){ var p=String(v||"").split(":"); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }

/* One form for changing a block, adding one, or taking one off, used by both
   apps. cls names the host app's classes for fields, inputs and buttons. */
function blockEditor(wrap, d, blk, cls, done){
  var isNew=!blk, key=blk?blk[7]:("add|"+Date.now().toString(36));
  function fld(label,node){ var f=el("div",cls.fld); f.appendChild(el("label",cls.label,label)); f.appendChild(node); wrap.appendChild(f); return node; }
  function inp(type,val){ var i=document.createElement("input"); i.type=type; i.value=val||""; i.setAttribute("dir","auto"); return i; }
  var nm=fld("What", inp("text", blk?blk[1]:"")); nm.placeholder="Lecture, meeting, a working block";
  var dt=fld("Detail", inp("text", blk?blk[2]:"")); dt.placeholder="Section, room, anything short";
  var ds=document.createElement("select");
  FULL.forEach(function(n,i){ var o=el("option",null,n); o.value=String(i); if(i===d) o.selected=true; ds.appendChild(o); });
  fld("Day", ds);
  var st=fld("Starts", inp("time", blk&&blk[5]>blk[4]?hm(blk[4]):"13:00"));
  var en=fld("Ends", inp("time", blk&&blk[5]>blk[4]?hm(blk[5]):"14:00"));
  var wk=document.createElement("input"); wk.type="checkbox"; wk.checked=!!(blk&&blk[6]);
  var wl=el("label",cls.check); wl.appendChild(wk); wl.appendChild(document.createTextNode(" A working block, for a thread"));
  wrap.appendChild(wl);
  var scope="once";
  var sc=el("div",cls.row);
  var b1=el("button",cls.btn,"Only "+FULL[d]+" "+fmtDay(thisWeekDate(d))), b2=el("button",cls.btn,"Every "+FULL[d]);
  function paintScope(){ b1.className=cls.btn+(scope==="once"?" "+cls.on:""); b2.className=cls.btn+(scope==="every"?" "+cls.on:""); }
  b1.addEventListener("click",function(){ scope="once"; paintScope(); });
  b2.addEventListener("click",function(){ scope="every"; paintScope(); });
  sc.appendChild(b1); sc.appendChild(b2); paintScope();
  var sl=el("label",cls.label,"This change is for"); wrap.appendChild(sl); wrap.appendChild(sc);
  var msg=el("p",cls.note);
  var acts=el("div",cls.row);
  var save=el("button",cls.btn+" "+cls.pri, isNew?"Add it":"Save");
  save.addEventListener("click",function(){
    var n=nm.value.trim(), s=toMin(st.value), e=toMin(en.value), nd=parseInt(ds.value,10);
    if(!n){ msg.textContent="Give it a name."; return; }
    if(e<=s){ msg.textContent="It has to end after it starts."; return; }
    var block={n:n, d:dt.value.trim(), start:s, end:e, work:wk.checked, c:blk?blk[3]:"--neutral"};
    var once=scope==="once", moved=!isNew && nd!==d;
    function where(day){ return once ? {date:thisWeekDate(day)} : {day:day}; }
    var label=(once?("Only "+FULL[nd]+" "+fmtDay(thisWeekDate(nd))):("Every "+FULL[nd]))+", "+hm(s)+"\u2013"+hm(e);
    if(moved){
      if(once && !block.d) block.d="Moved from "+FULL[d];
      saveWeekEdit(Object.assign(where(d),{key:key, remove:true}));
      saveWeekEdit(Object.assign(where(nd),{key:"add|"+Date.now().toString(36), block:block}),
        "Timetable: "+n+" moved", n+" moved from "+FULL[d]+" "+(blk?blk[0]:"")+" to "+label+".");
    } else {
      saveWeekEdit(Object.assign(where(nd),{key:key, block:block}),
        "Timetable: "+n+(isNew?" added":" changed"), n+(isNew?" added: ":" is now: ")+label+(block.d?(". "+block.d):"")+".");
    }
    afterWrite("Timetable saved."); done();
  });
  acts.appendChild(save);
  if(!isNew){
    var cx=el("button",cls.btn,"Cancel it this "+FULL[d]);
    cx.addEventListener("click",function(){
      saveWeekEdit({date:thisWeekDate(d), key:key, remove:true}, "Timetable: "+blk[1]+" cancelled",
        blk[1]+" "+blk[0]+" does not happen on "+FULL[d]+" "+fmtDay(thisWeekDate(d))+".");
      afterWrite("Cancelled for this "+FULL[d]+"."); done();
    });
    var rm=el("button",cls.btn+" "+cls.warn,"Remove from every week");
    rm.addEventListener("click",function(){
      saveWeekEdit({day:d, key:key, remove:true}, "Timetable: "+blk[1]+" removed", blk[1]+" "+blk[0]+" removed from every "+FULL[d]+".");
      afterWrite("Removed from every "+FULL[d]+"."); done();
    });
    acts.appendChild(cx); acts.appendChild(rm);
  }
  wrap.appendChild(acts); wrap.appendChild(msg);
}

/* To-dos. data/todos.jsonl, one line per change: {id, thread, text, due, from}
   to add, {id, done:true} to tick off; the lines for an id are merged in order.
   They come from the organizer's suggestions, from the thread itself, or from a
   box ticked in the morning message. */
var todos = get("planner.todos", {});

function pullTodos(){
  return gh("/contents/data/todos.jsonl",{soft404:true}).then(function(r){
    var m={};
    readLines(r).forEach(function(o){ if(o.id) m[o.id]=Object.assign(m[o.id]||{}, o); });
    queue.forEach(function(q){ if(q.kind!=="todo") return; try{ var o=JSON.parse(q.line); m[o.id]=Object.assign(m[o.id]||{}, o); }catch(e){} });
    todos=m; put("planner.todos", todos);
  }).catch(function(){});
}

function openTodos(tid){
  return Object.keys(todos).map(function(k){ return todos[k]; })
    .filter(function(t){ return t.text && !t.done && (!tid || t.thread===tid); })
    .sort(function(a,b){ return (a.due||"9999")<(b.due||"9999")?-1:((a.due||"9999")>(b.due||"9999")?1:((a.at||"")<(b.at||"")?-1:1)); });
}

function todoWhen(t){
  if(!t.due) return "";
  var d=t.due, td=localDay();
  if(d<td) return "late, "+fmtDay(d);
  if(d===td) return "today";
  return fmtDay(d);
}

function addTodo(tid, text, due, from, quiet){
  var o={id:"td-"+Date.now().toString(36)+Math.random().toString(36).slice(2,5), thread:tid||null,
         text:String(text).trim().slice(0,160), due:due||null, from:from||WHERE, at:new Date().toISOString()};
  if(!o.text) return null;
  todos[o.id]=o; put("planner.todos", todos);
  queue.push({kind:"todo", line:JSON.stringify(o)}); put(K.queue,queue);
  if(!quiet) afterWrite("Added to your list.");
  return o;
}

function doneTodo(id){
  var o={id:id, done:true, at:new Date().toISOString(), via:WHERE};
  todos[id]=Object.assign(todos[id]||{}, o); put("planner.todos", todos);
  queue.push({kind:"todo", line:JSON.stringify(o)}); put(K.queue,queue);
  afterWrite("Done.");
}

/* Pins: a starred thread stays at the top. data/pins.jsonl, last line wins. */
var pins = get("planner.pins", {});

function pullPins(){
  return gh("/contents/data/pins.jsonl",{soft404:true}).then(function(r){
    var m={}; readLines(r).forEach(function(o){ if(o.thread) m[o.thread]=!!o.pin; });
    pins=m; put("planner.pins", pins);
  }).catch(function(){});
}

function isPinned(t){ return !!pins[t.id]; }

function togglePin(t){
  pins[t.id]=!pins[t.id]; put("planner.pins", pins);
  queue.push({kind:"pin", line:JSON.stringify({thread:t.id, pin:pins[t.id], at:new Date().toISOString(), via:WHERE})});
  put(K.queue,queue); afterWrite(pins[t.id]?"Pinned to the top.":"Unpinned.");
}

function pinnedThreads(){ return board.threads.filter(isPinned); }

/* The organizer. A small open model reads each message on GitHub's servers
   and proposes: which thread, a one-line summary, to-dos with any day he gave,
   and a stage if the message says one was reached. Nothing becomes a fact
   until he taps Apply. data/suggestions.jsonl holds the proposals and his
   decisions ({id, applied:true} or {id, ignored:true}). */
var suggestions = {};

function pullSuggestions(){
  return gh("/contents/data/suggestions.jsonl",{soft404:true}).then(function(r){
    var m={};
    readLines(r).forEach(function(o){ if(o.id) m[o.id]=Object.assign(m[o.id]||{}, o); });
    queue.forEach(function(q){ if(q.kind!=="sugg") return; try{ var o=JSON.parse(q.line); m[o.id]=Object.assign(m[o.id]||{}, o); }catch(e){} });
    suggestions=m;
  }).catch(function(){});
}

function openSuggestions(){
  return Object.keys(suggestions).map(function(k){ return suggestions[k]; })
    .filter(function(s){ return !s.applied && !s.ignored && (s.summary || (s.todos||[]).length || s.stage); })
    .sort(function(a,b){ return (b.at||"")<(a.at||"")?-1:1; });
}

function decideSuggestion(sg, apply, pickTodos, pickStage){
  var t=sg.thread?T(sg.thread):null, n=0;
  if(apply){
    (sg.todos||[]).forEach(function(x,i){ if(pickTodos[i]){ addTodo(sg.thread, x.text, x.due, "#"+sg.issue, true); n++; } });
    if(pickStage && t && sg.stage){ var ix=(t.st||[]).indexOf(sg.stage); if(ix>=0) setStage(t, ix); }
  }
  var o={id:sg.id}; o[apply?"applied":"ignored"]=true; o.at=new Date().toISOString(); o.via=WHERE;
  suggestions[sg.id]=Object.assign(sg, o);
  queue.push({kind:"sugg", line:JSON.stringify(o)}); put(K.queue,queue);
  afterWrite(apply ? (n+" added"+(pickStage&&sg.stage?(", stage set to "+sg.stage):"")+".") : "Ignored.");
}

/* One card, both apps: the summary, a checkbox per suggested to-do and for the
   stage, then Apply and Ignore. cls names the host app's classes. */
function suggestionCard(sg, cls){
  var t=sg.thread?T(sg.thread):null;
  var box=el("div",cls.box);
  box.appendChild(el("span",cls.kicker,"From your message"+(t?(" · "+t.n):"")));
  if(sg.summary) box.appendChild(el("p",cls.text,sg.summary));
  var picks=[], stagePick={v:!!sg.stage};
  function check(label, on, set){
    var l=el("label",cls.check); var c=document.createElement("input"); c.type="checkbox"; c.checked=on;
    c.addEventListener("change",function(){ set(c.checked); });
    l.appendChild(c); l.appendChild(el("span",null,label)); box.appendChild(l);
  }
  (sg.todos||[]).forEach(function(x,i){ picks[i]=true; check(x.text+(x.due?(" · "+fmtDay(x.due)):""), true, function(v){ picks[i]=v; }); });
  if(sg.stage && t) check("Move "+t.n+" to "+sg.stage, true, function(v){ stagePick.v=v; });
  var row=el("div",cls.row);
  var a=el("button",cls.pri,"Apply"); a.addEventListener("click",function(){ decideSuggestion(sg,true,picks,stagePick.v); });
  var ig=el("button",cls.btn,"Ignore"); ig.addEventListener("click",function(){ decideSuggestion(sg,false,picks,false); });
  row.appendChild(a); row.appendChild(ig); box.appendChild(row);
  return box;
}

/* A meeting note: who, what was decided, what each person does next. The
   organizer reads the actions as to-dos. */
function meetingBody(who, decided, actions, notes){
  var out=[];
  if(who) out.push("**With:** "+who);
  if(decided) out.push("**Decided:**\n"+decided.split("\n").filter(Boolean).map(function(l){ return "- "+l.replace(/^[-*•]\s*/,""); }).join("\n"));
  if(actions) out.push("**Actions:**\n"+actions.split("\n").filter(Boolean).map(function(l){ return "- "+l.replace(/^[-*•]\s*/,""); }).join("\n"));
  if(notes) out.push(notes);
  return out.join("\n\n");
}

function localDay(){
  var d=new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}

function lastChase(t){
  var best="";
  ticks.forEach(function(k){
    var d=k.day||(k.at||"").slice(0,10);
    if(k.thread===t.id && k.kind==="chase" && d>best) best=d;
  });
  return best;
}

function clockDays(t){
  var s=t.since||"", c=lastChase(t), from=c>s?c:s;
  if(!from) return 0;
  var d=new Date(from+"T00:00:00");
  return isNaN(d.getTime()) ? 0 : Math.max(0, Math.floor((Date.now()-d.getTime())/864e5));
}

function waitList(){ return board.threads.filter(function(t){ return t.who && t.since; }); }
function cleanWho(t){ return String(t.who||"").replace(/\s*\[[^\]]*\]/g,"").trim(); }
function whoUnsure(t){ return /\[[^\]]*\]/.test(String(t.who||"")); }
var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDay(iso){
  var d=new Date(String(iso).slice(0,10)+"T00:00:00");
  return isNaN(d.getTime()) ? String(iso) : (d.getDate()+" "+MONTHS[d.getMonth()]);
}

function chaseDraft(t){
  var when=t.since?fmtDay(t.since):"";
  if(t.whoType==="journal")
    return "Dear Editor,\n\nMay I ask for an update on the status of our manuscript"+(t.re?(", "+t.re):"")+
           (when?(", submitted on "+when):"")+"?\n\nWith thanks,";
  return "Dear "+cleanWho(t)+",\n\nA short note on "+(t.re||("“"+t.n+"”"))+
         (when?(", which I sent on "+when):"")+". Is there anything you need from me to move it forward?\n\nWith thanks,";
}

function waitTone(t){
  var d=clockDays(t), a=chaseAfter(t);
  return d>=2*a ? "--bad" : (d>=a ? "--hot" : "--good");
}

function markChased(t){
  var o={thread:t.id, kind:"chase", day:localDay(), at:new Date().toISOString(), via:WHERE};
  ticks.push(o);
  queue.push({kind:"tick", line:JSON.stringify(o)});
  put(K.queue,queue); afterWrite("Chase recorded. The clock restarts today.");
}

function copyText(s, done){
  try{
    navigator.clipboard.writeText(s).then(function(){ done(true); }, function(){ done(false); });
  }catch(e){ done(false); }
}

function qList(){
  return (board.open||[]).map(function(q,i){
    return typeof q==="string" ? {id:"q"+(i+1), q:q, opts:[]} : q;
  });
}

function qLeft(){ return qList().filter(function(q){ return !answers[q.id]; }); }
function epochDay(){ var d=new Date(); return Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5); }

/* The same pick as the morning brief: the day number modulo what is left. */
function todaysQuestion(){
  var l=qLeft();
  return l.length ? l[(epochDay()+qSkip)%l.length] : null;
}

function qNumber(q){ var all=qList(); for(var i=0;i<all.length;i++) if(all[i].id===q.id) return i+1; return 0; }

function answerQ(q, a){
  var o={q:q.id, a:a, at:new Date().toISOString(), via:WHERE};
  answers[q.id]=o; qSkip=0;
  queue.push({kind:"answer", line:JSON.stringify(o)});
  queue.push({kind:"issue", title:"Answer: "+q.q.slice(0,200),
    body:a+"\n\n---\nAnswered in the Planner "+WHERE+", "+o.at+"."});
  put(K.queue,queue); afterWrite("Answer filed.");
}

function shortName(t){ return t.short || String(t.n).split(/[,:(]/)[0].split(" ").slice(0,3).join(" "); }

function goalSlots(g){
  var feeding=board.threads.filter(function(t){ return t.goal===g.id; });
  var reached=[], walking=[];
  feeding.forEach(function(t){
    var st=t.st||[], ci=g.counts?st.indexOf(g.counts):-1;
    if(ci>=0 && !isUnset(t) && stageIx(t)>=ci) reached.push(t); else walking.push(t);
  });
  walking.sort(function(a,b){ return stageIx(b)-stageIx(a); });
  var target=g.target||0, filled=Math.max(g.now||0, reached.length), earlier=filled-reached.length, tiles=[];
  for(var i=0;i<target;i++){
    if(i<earlier) tiles.push({s:"done", label:"Earlier"});
    else if(i<filled){
      var t=reached[i-earlier];
      tiles.push({s: stageIx(t)<stageCount(t)-1 ? "review" : "done", label:shortName(t), t:t});
    } else {
      var w=walking[i-filled];
      tiles.push({s: w?"walk":"empty", label: w?shortName(w):"", t:w});
    }
  }
  var pace="";
  if(g.by && filled<target){
    var days=Math.round((new Date(g.by+"T00:00:00").getTime()-new Date(localDay()+"T00:00:00").getTime())/864e5);
    if(days>0) pace=(target-filled)+" to go in "+days+" days. One every "+Math.max(1,Math.floor(days/(target-filled)))+" days.";
  }
  return {tiles:tiles, filled:filled, target:target, pace:pace};
}

function drifting(){
  return board.threads.filter(function(t){
    if(dropped[t.id]) return false;
    if(t.dom==="teaching" || t.dom==="finance") return false;
    if(/parked/i.test(t.tag||"")) return false;
    if(t.who && t.since) return false;
    if(doDate(t)) return false;
    if(((mins[t.id]||0)+(deskMins[t.id]||0))>0) return false;
    if(isUnset(t)) return true;
    return stageIx(t) < stageCount(t)-1;
  });
}

/* The next day that has a working block on it, from tomorrow. */
function nextWorkDay(){
  for(var n=1;n<=7;n++){
    var d=new Date(); d.setDate(d.getDate()+n);
    var r=board.week[d.getDay()]||[];
    for(var i=0;i<r.length;i++) if(r[i][6]) return dayOffset(n);
  }
  return dayOffset(1);
}

/* A review decision executes itself: a day, a delay or a drop is a line in
   data/dates.jsonl. The summary goes to Claude as one issue when the review ends. */
var reviewLog=[];

function reviewFinish(){
  if(!reviewLog.length) return;
  var words={start:"Start it today", day:"Give it a day", delay:"Delay four weeks", drop:"Drop it"};
  var body=reviewLog.map(function(r){ return "- "+r.t.n+": "+words[r.what]+(r.iso?(", "+r.iso):"")+"  `"+r.t.id+"`"; }).join("\n");
  var n={}; reviewLog.forEach(function(r){ n[r.what]=(n[r.what]||0)+1; });
  queue.push({kind:"issue", title:"Saturday review: "+reviewLog.length+" decided",
    body:body+"\n\nThe days are already in data/dates.jsonl. A drop needs its project file moved, with the reason asked for if none was given."+
         "\n\n---\nSent from the Planner "+WHERE+", "+new Date().toISOString()+"."});
  reviewLog=[]; put(K.queue,queue); afterWrite("Review sent.");
}

/* Every message he sent, with the state he can read at a glance:
   one tick sent, two blue ticks read and answered, two green ticks filed. */
var mine=null, mineAt=0, replies={};

function isBrief(x){ return (x.labels||[]).some(function(l){ return l && l.name==="brief"; }); }

function firstLine(s){
  s=String(s||"").split("\n---\n")[0];
  var ls=s.split("\n").map(function(x){ return x.replace(/^[#>*\-\s]+/,"").trim(); }).filter(Boolean);
  var t=ls[0]||"";
  return t.length>160 ? t.slice(0,160)+"…" : t;
}

/* The organizer and the read receipts are bots. Their comments say a machine has
   looked, not that he has an answer, so only a reply from a person's account
   (which is where Claude's replies are posted) turns the ticks blue. */
function msgState(x){
  if(x.state==="closed") return "filed";
  var r=replies[x.number];
  return (x.comments>0 && r && r.answered) ? "seen" : "sent";
}

function loadMine(force){
  if(!token) return Promise.resolve();
  if(!force && mine && Date.now()-mineAt<60000) return Promise.resolve();
  return gh("/issues?state=all&per_page=25&sort=created&direction=desc").then(function(r){
    mine=(r||[]).filter(function(x){ return !x.pull_request && !isBrief(x) && !(x.user && x.user.type==="Bot"); });
    mineAt=Date.now();
    var need=mine.filter(function(x){ return x.comments>0 && !(replies[x.number] && replies[x.number].u===x.updated_at); }).slice(0,10);
    return Promise.all(need.map(function(x){
      return gh("/issues/"+x.number+"/comments?per_page=100").then(function(cs){
        cs=cs||[];
        var mine2=cs.filter(function(c){ return !(c.user && c.user.type==="Bot") && !/^@\S+ \u2713\u2713 Read\./.test(c.body||""); });
        var last=mine2[mine2.length-1]||cs[cs.length-1];
        replies[x.number]={u:x.updated_at, text:firstLine(last&&last.body), answered:mine2.length>0};
      }).catch(function(){});
    }));
  }).catch(function(){});
}

/* ---------- time ---------- */
function curBlock(){
  var t=nowMin(), r=board.week[new Date().getDay()]||[];
  for(var i=0;i<r.length;i++) if(r[i][5]>r[i][4] && t>=r[i][4] && t<r[i][5]) return {b:r[i],i:i};
  return null;
}

function nextBlock(){
  var t=nowMin(), r=board.week[new Date().getDay()]||[];
  for(var i=0;i<r.length;i++) if(r[i][5]>r[i][4] && r[i][4]>t) return r[i];
  return null;
}

function threadsIn(dom){ return board.threads.filter(function(t){ return t.dom===dom; }); }
function stageCount(t){ return (t.st||[]).length; }

function stageIx(t){
  var s=statuses[t.id];
  if(s && typeof s.stage==="number") return Math.max(0,Math.min(s.stage,stageCount(t)-1));
  return t.at||0;
}

function stageName(t){ return (t.st||[])[stageIx(t)] || ""; }
function isUnset(t){ return !!t.unset && !statuses[t.id]; }
function finalOf(t){ var st=t.st||[]; return t.final || st[st.length-1] || ""; }
function walked(t){ var last=stageCount(t)-1; if(last<1) return 0; return Math.round(stageIx(t)/last*100); }

/* ---------- tracking ---------- */
/* A timer left running is the commonest lie in the log: three ran for a week.
   Anything over twelve hours asks what was real, and an empty answer drops it. */
function realMinutes(m){
  if(m<=720) return m;
  var a=null;
  try{ a=window.prompt("This timer ran "+Math.round(m/60)+" hours. How many minutes did you actually work? Leave it empty to drop it.",""); }catch(e){}
  var n=parseInt(a,10);
  return (n>0 && n<=720) ? n : 0;
}

/* ---------- speech ---------- */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

var langIx = get(K.lang,0);
var rec=null;
var CUMULATIVE = /Android/i.test(navigator.userAgent||"");

/* Dictation arrives in two shapes. Desktop Chrome sends separate phrases.
   Android sends the whole transcript again with every result ("send the",
   "send the draft", "send the draft today"), and sometimes revises the
   last word or drops it before putting it back. Comparing whole strings broke
   on the first revision and every word after it repeated. Results are now
   compared word by word against the phrase they restate, and the newest
   version of a phrase replaces the older one. */
function dictWords(s){
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).filter(Boolean);
}

function restates(a,b){
  var n=Math.min(a.length,b.length), p=0;
  if(!n) return false;
  while(p<n && a[p]===b[p]) p++;
  if(p===n) return true;
  if(!CUMULATIVE || a[0]!==b[0]) return false;
  /* same opening word, and most of the shorter version appears in order in the
     longer: a revised, dropped or inserted word, not a new phrase */
  var s=a.length<=b.length?a:b, l=s===a?b:a, j=0, kept=0;
  for(var i=0;i<s.length;i++){
    var k=l.indexOf(s[i],j);
    if(k>=0){ kept++; j=k+1; }
  }
  return kept>=2 && kept>=s.length*0.7;
}

function endsWithWords(a,b){
  if(b.length>a.length) return false;
  for(var i=1;i<=b.length;i++) if(a[a.length-i]!==b[b.length-i]) return false;
  return true;
}

function joinResults(results){
  /* Final results are merged phrase by phrase. Of the interim results only the
     newest counts, because each interim restates the phrase being spoken; the
     older ones are stale. The newest interim is then merged exactly like a
     final: if it restates the last phrase it replaces it (that is how Android
     extends a sentence), otherwise it follows it. */
  var segs=[], interim="";
  function add(t){
    var w=dictWords(t);
    if(!w.length) return;
    var all=[]; segs.forEach(function(s){ all=all.concat(s.w); });
    if(segs.length>1 && restates(all,w)){ segs=[{t:t,w:w}]; return; }
    var last=segs[segs.length-1];
    if(last && restates(last.w,w)){ segs[segs.length-1]={t:t,w:w}; return; }
    if(last && endsWithWords(all,w)) return;
    segs.push({t:t,w:w});
  }
  for(var i=0;i<results.length;i++){
    var t=((results[i][0]&&results[i][0].transcript)||"").replace(/\s+/g," ").trim();
    if(!t) continue;
    if(results[i].isFinal===false){ interim=t; continue; }
    add(t);
  }
  if(interim) add(interim);
  return segs.map(function(s){ return s.t; }).join(" ");
}

var loadingMine=false;

/* ---------- keeping itself current ----------
   A phone can hold an old copy of this app for a very long time: the shell is
   cached, the worker that cached it is cached, and nothing in the loop asks
   whether anything moved. So the app asks, every time it opens. */
function repairInstall(){
  var jobs=[];
  if(window.caches && caches.keys){
    jobs.push(caches.keys().then(function(ks){
      return Promise.all(ks.map(function(k){ return caches.delete(k); }));
    }));
  }
  if(navigator.serviceWorker && navigator.serviceWorker.getRegistrations){
    jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){
      return Promise.all(rs.map(function(r){ return r.unregister(); }));
    }));
  }
  return Promise.all(jobs).catch(function(){}).then(function(){
    location.replace(location.pathname+"?fresh="+Date.now());
  });
}
