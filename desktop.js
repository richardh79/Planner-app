/* Planner, desktop cockpit.
   Three panes: choose a category, choose a thread, work on it. Same repository,
   same token, same data files as the phone app. No server.

   Writes it makes, all through the GitHub contents and issues API:
     data/log.jsonl     one line per tracked session
     data/status.jsonl  one line each time he sets a stage himself
     any repo file      opened, edited and committed from the detail pane
     issues             comments and updates, the channel Claude reads
*/
(function(){
"use strict";

var BUILD = "2026-09-27.3";   // bumped on every publish, checked against version.json
var K = { tok:"planner.token", repo:"planner.repo", board:"planner.board",
          mins:"planner.mins", queue:"planner.queue", theme:"planner.theme",
          running:"planner.running", sel:"planner.sel", lang:"planner.lang" };

/* ---------- helpers ---------- */
function $(id){ return document.getElementById(id); }
function el(t,c,x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
function getRaw(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } }
function putRaw(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function get(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function put(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function del(k){ try{ localStorage.removeItem(k); }catch(e){} }
function REPO(){ return getRaw(K.repo) || ""; }
function API(){ return "https://api.github.com/repos/" + REPO(); }
function hm(t){ var h=Math.floor(t/60)%24, m=t%60; return (h<10?"0":"")+h+":"+(m<10?"0":"")+m; }
function dur(m){ m=Math.max(0,Math.round(m)); var h=Math.floor(m/60); return h?(h+"h "+(m%60)+"m"):(m+"m"); }
function nowMin(){ var d=new Date(); return d.getHours()*60+d.getMinutes(); }
function today(){ var d=new Date(); return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
function daysSince(iso){
  var d=new Date(iso);
  if(!iso || isNaN(d.getTime())) return null;
  return Math.max(0,Math.floor((Date.now()-d.getTime())/864e5));
}
function ago(iso){
  var d=(Date.now()-new Date(iso).getTime())/60000;
  if(d<60) return Math.max(1,Math.round(d))+"m ago";
  if(d<1440) return Math.round(d/60)+"h ago";
  return Math.round(d/1440)+"d ago";
}
function b64d(s){
  return decodeURIComponent(Array.prototype.map.call(atob(String(s).replace(/\s/g,"")),function(c){
    return "%"+("00"+c.charCodeAt(0).toString(16)).slice(-2); }).join(""));
}
function b64e(s){ return btoa(unescape(encodeURIComponent(s))); }
var ICONS={
  clock:["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M12 7v5l3.4 2"],
  calendar:["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z","M8 3v4","M16 3v4","M4 10h16"],
  inbox:["M4 13h4l2 3h4l2-3h4","M6.4 5h11.2L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z"],
  target:["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z","M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"],
  help:["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.1.9-1.1 1.6v.4","M12 17.2h.01"],
  folder:["M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"],
  play:["M8.5 5.5 18 12l-9.5 6.5z"],
  stop:["M7 7h10v10H7z"],
  save:["M5 4h9l5 5v11H5z","M8.5 4v5h6"],
  ext:["M14 5h5v5","M19 5l-7.5 7.5","M18 13.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5.5"],
  back:["M14.5 6 9 12l5.5 6"],
  search:["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z","M20 20l-4-4"],
  refresh:["M19.5 12a7.5 7.5 0 1 1-2.2-5.3","M19.5 4v4.5H15"],
  settings:["M4 7h9","M17 7h3","M4 12h3","M11 12h9","M4 17h11","M19 17h1","M15 7a2 2 0 1 0 0-.01","M9 12a2 2 0 1 0 0-.01","M17 17a2 2 0 1 0 0-.01"],
  chat:["M20 12.5a6.5 6.5 0 0 1-6.5 6.5H9l-4 3v-4.3A6.5 6.5 0 0 1 8.5 6h5A6.5 6.5 0 0 1 20 12.5z"],
  doc:["M7 4h7l4 4v12H7z","M14 4v4h4","M10 13h6","M10 16.5h4"],
  layers:["M12 4 4 8.5 12 13l8-4.5z","M4 14.5 12 19l8-4.5"],
  plus:["M12 6v12","M6 12h12"],
  check:["M5 12.5 10 17 19 7"],
  flag:["M6 21V4.5","M6 5.5h11l-2.2 3.4L17 12.5H6z"],
  foot:["M8.5 20c-1.5 0-2.5-1-2.5-2.4 0-1.6 1.2-2.6 1.2-4.6 0-1.3-.7-2-.7-3.6C6.5 6.4 8 4 10.4 4c2 0 3.1 1.6 3.1 4 0 3.6-1.7 5-1.7 8.2 0 2.4-1.4 3.8-3.3 3.8z","M16.5 10.5c1.2 0 2 .9 2 2.2 0 1.6-1 2.8-2.3 2.8"]
};
function icon(name){
  var d=ICONS[name]; if(!d) return null;
  var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("class","ic"); svg.setAttribute("aria-hidden","true");
  d.forEach(function(p){
    var e=document.createElementNS("http://www.w3.org/2000/svg","path");
    e.setAttribute("d",p); svg.appendChild(e);
  });
  return svg;
}
function withIcon(btn,name){ var i=icon(name); if(i) btn.insertBefore(i, btn.firstChild); return btn; }
function emptyState(name,text){
  var w=el("div","empty"); var i=icon(name); if(i) w.appendChild(i);
  w.appendChild(el("span",null,text)); return w;
}

function safe(f){ try{ f(); }catch(e){ note("Render failed: "+(e&&e.message?e.message:e),"bad"); } }

/* ---------- dictation ----------
   The desktop page had no microphone at all, which is why every message this
   month was typed. Same engine as the phone, and it never calls render() while
   it is listening: a repaint would take the textarea away mid sentence. */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var LANGS = [["ar-SA","عربي"],["en-GB","English"]];
var langIx = get(K.lang,0);
var rec=null, recLive=false;

/* Android returns dictation cumulatively: "just", "just 123", "just 123 test",
   each as its own result. Desktop Chrome returns separate phrases. Joining them
   blindly repeated every word on the phone, so a result that restates what came
   before replaces it instead of adding to it. */
function joinResults(results){
  var out="";
  for(var i=0;i<results.length;i++){
    var t=results[i][0].transcript||"";
    var a=out.trim().toLowerCase(), b=t.trim().toLowerCase();
    if(!b) continue;
    if(a && b.indexOf(a)===0){ out=t; continue; }
    if(a && a.length>=b.length && a.slice(-b.length)===b) continue;
    out += (out && !/\s$/.test(out) && !/^\s/.test(t)) ? " "+t : t;
  }
  return out.replace(/\s+/g," ").trim();
}
function micRow(ta){
  var row=el("div","microw");
  var btn=el("button","mic"); btn.type="button";
  btn.setAttribute("aria-label","Dictate");
  var hint=el("span","michint");
  var lang=el("button","miclang", LANGS[langIx][1]); lang.type="button";

  function paint(msg){
    btn.className="mic"+(recLive?" on":"");
    btn.textContent = recLive ? "\u25a0" : "\ud83c\udf99";
    hint.textContent = msg || (SR
      ? (recLive ? "Listening. Speak, then tap to stop." : "Tap and speak, in either language.")
      : "This browser has no dictation. Use the keyboard's own microphone key.");
    lang.textContent = LANGS[langIx][1];
  }
  function stop(){ if(rec){ try{ rec.stop(); }catch(e){} } rec=null; recLive=false; paint(); }
  function start(){
    if(!SR) return;
    var base = ta.value ? ta.value.replace(/\s+$/,"")+" " : "";
    var r; try{ r=new SR(); }catch(e){ paint("Could not start: "+e.message); return; }
    r.lang=LANGS[langIx][0]; r.continuous=true; r.interimResults=true;
    r.onresult=function(ev){
      var all="";
      all = joinResults(ev.results);
      ta.value = base + all;
    };
    r.onerror=function(ev){
      var c=(ev&&ev.error)||"unknown";
      rec=null; recLive=false;
      paint(c==="not-allowed"||c==="service-not-allowed"
        ? "Microphone blocked for this page. Allow it in the address bar, or use the keyboard's microphone key."
        : "Dictation stopped: "+c+". The keyboard's microphone key still works.");
    };
    r.onend=function(){ rec=null; recLive=false; paint("Stopped. Tap to add more."); };
    try{ r.start(); rec=r; recLive=true; paint(); }
    catch(e){ paint("Could not start: "+e.message); }
  }
  btn.addEventListener("click",function(){ recLive?stop():start(); });
  if(!SR){ btn.disabled=true; btn.style.opacity=".45"; }
  lang.addEventListener("click",function(){
    langIx=(langIx+1)%LANGS.length; put(K.lang,langIx);
    if(recLive){ stop(); start(); } else paint();
  });
  row.appendChild(btn); row.appendChild(hint);
  if(SR) row.appendChild(lang);
  paint();
  return row;
}

var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var DEFAULT = { updated:"", headline:"Not connected. Open settings, add the repository and a token.",
                apex:"", goals:[], events:[], threads:[], domains:[], week:[[],[],[],[],[],[],[]], open:[] };

/* ---------- state ---------- */
var board   = get(K.board, null) || DEFAULT;
var token   = get(K.tok, "");
var mins    = get(K.mins, {});
var running = get(K.running, {});
var queue   = get(K.queue, []);
var statuses = {};            // thread id -> {stage, at}
var plan = {};                // "YYYY-MM-DD#blockIndex" -> thread id
var dates = {};               // thread id -> "YYYY-MM-DD", the day he means to touch it
var recent  = [];
var issues  = null, issuesErr = "";
var lastSync = 0, busy = false, stateMsg = "";
var sel     = get(K.sel, null) || {kind:"today", id:""};
(function(){ var h=(location.hash||"").slice(1), m={now:"today",map:"look",say:"inbox",threads:"look"};
  if(m[h]) sel={kind:m[h], id:""}; })();
var selThread = "";
var file    = null;           // {path, text, sha, orig, msg, err}
var palette = null;

function T(id){ for(var i=0;i<board.threads.length;i++) if(board.threads[i].id===id) return board.threads[i]; return null; }
function isOn(id){ return Object.prototype.hasOwnProperty.call(running,id); }
function runIds(){ return Object.keys(running); }
function cvar(x){ return "var(" + (x||"--neutral") + ")"; }
function domains(){ return (board.domains&&board.domains.length) ? board.domains : [{id:"",n:"Threads",c:"--accent"}]; }
function domOf(t){ var d=domains(); for(var i=0;i<d.length;i++) if(d[i].id===(t&&t.dom)) return d[i]; return d[0]; }
function threadsIn(dom){ return board.threads.filter(function(t){ return t.dom===dom; }); }
function stageIx(t){
  var s=statuses[t.id];
  if(s && typeof s.stage==="number") return Math.max(0,Math.min(s.stage,(t.st||[]).length-1));
  return t.at||0;
}
function stagePending(t){ var s=statuses[t.id]; return !!(s && s.stage!==t.at); }
function stageName(t){ return (t.st||[])[stageIx(t)] || ""; }
function isUnset(t){ return !!t.unset && !statuses[t.id]; }
function stageCount(t){ return (t.st||[]).length; }
function finalOf(t){ var st=t.st||[]; return t.final || st[st.length-1] || ""; }
function walked(t){ var last=stageCount(t)-1; if(last<1) return 0; return Math.round(stageIx(t)/last*100); }
function connected(){ return !!(token && REPO()); }
function boardAge(){
  if(!board.updated) return null;
  var n=daysSince(board.updated);
  return (n===null||isNaN(n)) ? null : n;
}
function liveMins(id){ return (mins[id]||0) + (deskMins[id]||0) + (isOn(id) ? (Date.now()-running[id])/60000 : 0); }
function domMins(dom){ var s=0; threadsIn(dom).forEach(function(t){ s+=liveMins(t.id); }); return s; }
function issuesFor(id){
  if(!issues) return [];
  return issues.filter(function(i){ return (i.body||"").indexOf("Thread: `"+id+"`")!==-1; });
}

/* ---------- GitHub ---------- */
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
          var m=(j&&j.message)?j.message:("HTTP "+r.status);
          if(r.status===401) m="Token rejected. Make a new one and paste it again.";
          if(r.status===403) m="Token lacks permission. It needs Contents and Issues, read and write.";
          if(r.status===409) m="That file changed underneath you. Reopen it and redo the edit.";
          throw new Error(m);
        }
        return j;
      });
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
function appendLine(path, line, message){
  return gh("/contents/"+path, {soft404:true}).then(function(r){
    var body = r&&r.content ? b64d(r.content) : "";
    if(body && body.slice(-1)!=="\n") body += "\n";
    return putFile(path, body+line+"\n", r&&r.sha, message);
  });
}

function pullBoard(){
  return gh("/contents/data/board.json", {soft404:true}).then(function(r){
    if(!r||!r.content) return null;
    var j=JSON.parse(b64d(r.content));
    if(j && j.threads && j.week){ board=j; put(K.board,j); mergeAdded(); baseWeek=null; applyWeekEdits(); }
    return j;
  });
}
function pullLog(){
  return gh("/contents/data/log.jsonl", {soft404:true}).then(function(r){
    if(!r||!r.content){ recent=[]; mins={}; return; }
    var cut=Date.now()-7*864e5, acc={}, all=[];
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.thread||!o.start) return;
      if(!(o.minutes>0) || o.minutes>720) return;   // over twelve hours is a timer left running
      all.push(o);
      if(new Date(o.start).getTime()>=cut) acc[o.thread]=(acc[o.thread]||0)+o.minutes;
    });
    all.sort(function(a,b){ return new Date(b.start)-new Date(a.start); });
    recent=all.slice(0,20); mins=acc; put(K.mins,mins);
  });
}
function pullStatus(){
  return gh("/contents/data/status.jsonl", {soft404:true}).then(function(r){
    statuses={};
    if(!r||!r.content) return;
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.thread) return;
      statuses[o.thread]=o;
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
      plan[o.date+"#"+o.block]=o.thread||"";
    });
  });
}
function assign(dateStr, blockIx, threadId){
  plan[dateStr+"#"+blockIx]=threadId;
  queue.push({kind:"plan", line:JSON.stringify({date:dateStr, block:blockIx, thread:threadId,
    at:new Date().toISOString()})});
  put(K.queue,queue); note("Saving the plan…"); render();
  flushQueue().then(function(){ stateMsg="Plan saved."; render(); })
    .catch(function(e){ note(e.message,"bad"); });
}
function planned(dateStr, blockIx){ return plan[dateStr+"#"+blockIx]||""; }

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
function setDoDate(t, iso){
  if(iso) dates[t.id]=iso; else delete dates[t.id];
  queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":iso||null, at:new Date().toISOString()})});
  put(K.queue,queue); note(iso?"Dated…":"Date cleared…"); render();
  flushQueue().then(function(){ stateMsg = iso?("On "+iso):"Undated"; render(); })
    .catch(function(e){ note(e.message,"bad"); });
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
/* waiting on a named person or a journal, and for how long */
function waitingDays(t){
  if(!t.since) return 0;
  var d=new Date(t.since+"T00:00:00");
  if(isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now()-d.getTime())/864e5));
}
function chaseAfter(t){ return typeof t.chaseAfter==="number" ? t.chaseAfter : 7; }
function needsChase(t){ return !!(t.who && t.since && clockDays(t)>=chaseAfter(t)); }

function loadIssues(){
  return gh("/issues?state=open&per_page=60&sort=created&direction=desc").then(function(r){
    issues=(r||[]).filter(function(x){ return !x.pull_request; }); issuesErr="";
  }).catch(function(e){ issuesErr=e.message; });
}

function flushOnce(){
  if(!token || !queue.length) return Promise.resolve();
  var item=queue[0], p;
  if(item.kind==="log")       p=appendLine("data/log.jsonl", item.line, "Session log");
  else if(item.kind==="status") p=appendLine("data/status.jsonl", item.line, "Stage set from the desktop");
  else if(item.kind==="plan")   p=appendLine("data/plan.jsonl", item.line, "Day assigned from the desktop");
  else if(item.kind==="date")   p=appendLine("data/dates.jsonl", item.line, "Do-date set from the desktop");
  else if(item.kind==="tick")   p=appendLine("data/ticks.jsonl", item.line, "Ticked from the desktop");
  else if(item.kind==="answer") p=appendLine("data/answers.jsonl", item.line, "Question answered from the desktop");
  else if(item.kind==="added")  p=appendLine("data/added.jsonl", item.line, "Added from the desktop");
  else if(item.kind==="link")   p=appendLine("desktop/links.jsonl", item.line, "Folder linked from the desktop");
  else if(item.kind==="push")   p=appendLine("data/push.jsonl", item.line, "Notifications set on the desktop");
  else if(item.kind==="week")   p=appendLine("data/week.jsonl", item.line, "Timetable changed from the desktop");
  else if(item.kind==="todo")   p=appendLine("data/todos.jsonl", item.line, "To-do from the desktop");
  else if(item.kind==="pin")    p=appendLine("data/pins.jsonl", item.line, "Pinned from the desktop");
  else if(item.kind==="sugg")   p=appendLine("data/suggestions.jsonl", item.line, "Suggestion decided on the desktop");
  else                        p=gh("/issues", {method:"POST", body:{title:item.title, body:item.body}});
  return p.then(function(){
    queue.shift(); put(K.queue,queue);
    return queue.length ? flushOnce() : null;
  }).catch(function(){ /* stays queued */ });
}
/* One save at a time. Two overlapping flushes both took the first item in the
   queue and wrote it twice; now a flush asked for while one runs waits for it
   and then carries on with whatever is left. */
var flushing=null;
function flushQueue(){
  if(flushing) return flushing.then(function(){ return queue.length ? flushQueue() : null; });
  flushing = flushOnce().then(function(){ flushing=null; }, function(){ flushing=null; });
  return flushing;
}

/* ---------- sync ---------- */
function note(msg,cls){ stateMsg=msg; paintState(cls||""); }
function paintState(cls){
  var d=$("dot"), s=$("stateTxt");
  if(!d||!s) return;
  d.className="dot"+(cls==="bad"?" bad":(busy?" busy":(connected()?" ok":"")));
  var txt = stateMsg ? ((connected()?REPO()+" · ":"")+stateMsg) : headerWalkText();
  if(queue.length) txt += " · "+queue.length+" queued";
  s.textContent=txt; s.title=txt;
}
function sync(){
  if(!connected()){ stateMsg=""; render(); return Promise.resolve(); }
  busy=true; note("Syncing…");
  return flushQueue()
    .then(pullBoard).then(pullStatus).then(pullPlan).then(pullDates).then(pullTicks).then(pullAnswers).then(pullDesk).then(pullAdded).then(pullWeekEdits).then(pullTodos).then(pullPins).then(pullSuggestions).then(pullLog).then(loadIssues)
    .then(function(){ return loadMine(true); })
    .then(function(){ busy=false; lastSync=Date.now(); stateMsg=""; render(); })
    .catch(function(e){ busy=false; note(e.message,"bad"); render(); });
}

var WHERE="desktop";
function afterWrite(msg){
  note("Saving…"); render();
  flushQueue().then(loadIssues).then(function(){ stateMsg = queue.length ? "Queued, no signal." : msg; mine=null; render(); })
    .catch(function(e){ note(e.message,"bad"); });
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
setTimeout(function(){ mergeAdded(); applyWeekEdits(); },0);   // the cached board, before the network answers
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
function addThread(o){
  var dm=null; domains().forEach(function(d){ if(d.id===o.dom) dm=d; });
  var t={ id: slug(o.n)+"-"+Date.now().toString(36).slice(-4), n:o.n.trim(), dom:o.dom||"",
          c:(dm&&dm.c)||"--neutral", st:stagesFor(o.dom), at:0, tag:"New", next:(o.next||"").trim(),
          goal:o.goal||"", added:new Date().toISOString(), via:WHERE };
  if(o.who){ t.who=o.who.trim(); t.since=localDay(); }
  added.push(t); put("planner.added", added); board.threads.push(t);
  queue.push({kind:"added", line:JSON.stringify(t)});
  queue.push({kind:"issue", title:"New thread: "+t.n,
    body:"Added from the app"+(dm?(" under "+dm.n):"")+"."+(t.next?("\n\nNext: "+t.next):"")+(t.who?("\n\nWith "+t.who+" from today."):"")+
         "\n\nFile it: project file, goal, and board.json.\n\n---\nThread: `"+t.id+"` \u2014 "+t.n+"\nSent from the Planner "+WHERE+", "+t.added+"."});
  put(K.queue,queue); afterWrite("Added.");
  return t;
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

/* Search across everything the app holds: threads, to-dos, messages. */
function searchAll(q){
  q=String(q||"").trim().toLowerCase();
  if(q.length<2) return {threads:[], todos:[], msgs:[]};
  function has(s){ return String(s||"").toLowerCase().indexOf(q)>=0; }
  return {
    threads: board.threads.filter(function(t){ return has(t.n)||has(t.next)||has(t.why)||has(t.who)||has(t.tag); }).slice(0,12),
    todos: Object.keys(todos).map(function(k){ return todos[k]; }).filter(function(t){ return t.text && has(t.text); }).slice(0,12),
    msgs: (mine||[]).filter(function(x){ return has(x.title)||has(x.body)||(replies[x.number]&&has(replies[x.number].text)); }).slice(0,12)
  };
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
function qText(q){ return typeof q==="string" ? q : (q&&q.q)||""; }
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
function reviewDecide(t, what){
  var iso = what==="start" ? dayOffset(0) : what==="day" ? nextWorkDay() : what==="delay" ? dayOffset(28) : null;
  if(what==="drop"){
    dropped[t.id]=true; delete dates[t.id];
    queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":null, drop:true, at:new Date().toISOString()})});
  } else {
    dates[t.id]=iso;
    queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":iso, why:what, at:new Date().toISOString()})});
  }
  reviewLog.push({t:t, what:what, iso:iso});
  put(K.queue,queue); flushQueue();
}
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
function msgState(x){ return x.state==="closed" ? "filed" : (x.comments>0 ? "seen" : "sent"); }
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
        replies[x.number]={u:x.updated_at, text:firstLine(last&&last.body)};
      }).catch(function(){});
    }));
  }).catch(function(){});
}

/* ---------- the week ---------- */
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

/* ---------- actions ---------- */
/* A timer left running is the commonest lie in the log: three ran for a week.
   Anything over twelve hours asks what was real, and an empty answer drops it. */
function realMinutes(m){
  if(m<=720) return m;
  var a=null;
  try{ a=window.prompt("This timer ran "+Math.round(m/60)+" hours. How many minutes did you actually work? Leave it empty to drop it.",""); }catch(e){}
  var n=parseInt(a,10);
  return (n>0 && n<=720) ? n : 0;
}
function start(id){
  if(isOn(id)) return;
  runIds().forEach(function(x){ stop(x); });   // one block, one thread: starting one ends the other
  running[id]=Date.now(); put(K.running,running); render();
}
function stop(id){
  if(!isOn(id)) return;
  var at=running[id], m=realMinutes(Math.round((Date.now()-at)/60000));
  delete running[id]; put(K.running,running);
  if(m>=1){
    mins[id]=(mins[id]||0)+m; put(K.mins,mins);
    queue.push({kind:"log", line:JSON.stringify({thread:id, start:new Date(at).toISOString(),
      end:new Date().toISOString(), minutes:m})});
    put(K.queue,queue); render();
    flushQueue().then(pullLog).then(render).catch(function(){ render(); });
    return;
  }
  render();
}
function setStage(t, ix){
  if(statuses[t.id] && statuses[t.id].stage===ix) return;   // a second tap is not a second update
  var line=JSON.stringify({thread:t.id, stage:ix, label:(t.st||[])[ix]||"", at:new Date().toISOString()});
  statuses[t.id]={thread:t.id, stage:ix, label:(t.st||[])[ix]||"", at:new Date().toISOString()};
  queue.push({kind:"status", line:line});
  queue.push({kind:"issue", title:"Update: "+t.n,
    body:"Stage set to **"+((t.st||[])[ix]||ix)+"**.\n\n---\nThread: `"+t.id+"` — "+t.n+
         "\nSent from the Planner desktop, "+new Date().toISOString()+"."});
  put(K.queue,queue); note("Saving stage…"); render();
  flushQueue().then(loadIssues).then(function(){ stateMsg="Stage saved."; render(); })
    .catch(function(e){ note(e.message,"bad"); });
}
function comment(t, kind, text){
  var body=text+"\n\n---\nThread: `"+t.id+"` — "+t.n+
           "\nSent from the Planner desktop, "+new Date().toISOString()+".";
  queue.push({kind:"issue", title:kind+": "+t.n, body:body});
  put(K.queue,queue); note("Sending…"); render();
  return flushQueue().then(loadIssues).then(function(){ stateMsg="Sent."; render(); })
    .catch(function(e){ note(e.message,"bad"); });
}
function closeIssue(n){
  return gh("/issues/"+n, {method:"PATCH", body:{state:"closed"}}).then(loadIssues).then(render);
}
function openFile(path){
  file={path:path, text:"", sha:"", orig:"", msg:"Loading…", err:""};
  selThread=selThread; document.body.classList.add("detail-open"); render();
  getFile(path).then(function(r){
    file={path:path, text:r?r.text:"", sha:r?r.sha:"", orig:r?r.text:"",
          msg:r?"":"New file. It will be created when you save.", err:""};
    render();
  }).catch(function(e){ file.msg=""; file.err=e.message; render(); });
}
function saveFile(){
  if(!file) return;
  var f=file; f.msg="Saving…"; f.err=""; render();
  putFile(f.path, f.text, f.sha, "Update "+f.path+" from the desktop")
    .then(function(r){
      f.sha=(r&&r.content&&r.content.sha)||f.sha; f.orig=f.text; f.msg="Saved."; render();
    })
    .catch(function(e){ f.msg=""; f.err=e.message; render(); });
}
function headingsOf(text){
  var out=[], re=/^##\s+(.+)$/gm, m;
  while((m=re.exec(text))) out.push(m[1].trim());
  return out;
}
function appendUnder(text, heading, line){
  var lines=text.split("\n"), at=-1, i;
  for(i=0;i<lines.length;i++) if(/^##\s+/.test(lines[i]) && lines[i].replace(/^##\s+/,"").trim()===heading){ at=i; break; }
  if(at===-1) return text.replace(/\s*$/,"")+"\n\n## "+heading+"\n\n"+line+"\n";
  var end=lines.length;
  for(i=at+1;i<lines.length;i++) if(/^##\s+/.test(lines[i])){ end=i; break; }
  var body=lines.slice(at+1,end);
  while(body.length && !body[body.length-1].trim()) body.pop();
  body.push(line);
  return lines.slice(0,at+1).concat(body, [""], lines.slice(end)).join("\n");
}

/* ---------- the walk ----------
   pathHtml, dayPathHtml and headerWalkText build elements rather than markup
   strings: nothing user-written is ever concatenated into HTML. */
function pathHtml(t){
  var wrap=el("div","path"), cur=stageIx(t), unset=isUnset(t);
  wrap.style.setProperty("--a",cvar(t.c||domOf(t).c));
  (t.st||[]).forEach(function(name,ix){
    var cls = unset ? "ahead" : (ix<cur ? "done" : (ix===cur ? "here" : "ahead"));
    var b=el("button","stone "+cls); b.type="button";
    b.setAttribute("aria-current",(!unset&&ix===cur)?"step":"false");
    b.title="Set the stage to "+name;
    b.appendChild(el("span","bead"));
    b.appendChild(el("span","st wrapall",name));
    if(!unset && ix===cur) b.appendChild(el("span","mk","you are here"));
    if(unset && ix===0) b.appendChild(el("span","mk","not set"));
    b.addEventListener("click",function(){ setStage(t,ix); });
    wrap.appendChild(b);
  });
  return wrap;
}
function finalFlag(t){
  var w=el("div","final-flag");
  w.style.setProperty("--a",cvar(t.c||domOf(t).c));
  var i=icon("flag"); if(i){ i.style.color=cvar(t.c||domOf(t).c); w.appendChild(i); }
  var fl=el("div","fl");
  fl.appendChild(el("b","wrapall", finalOf(t) || "No final named"));
  fl.appendChild(el("span","lab","the final"));
  w.appendChild(fl);
  w.appendChild(el("span","go num", isUnset(t) ? "not started"
    : ((stageIx(t)+1)+" of "+stageCount(t)+" · "+walked(t)+"%")));
  return w;
}
function dayPathHtml(dayIx, dateStr){
  var blocks=board.week[dayIx]||[];
  if(!blocks.length) return emptyState("calendar","No blocks on this day. The week file decides them.");
  var wrap=el("div","daypath"), cur=curBlock(), now=nowMin(), isToday=(dayIx===new Date().getDay());
  blocks.forEach(function(b,ix){
    var marker=b[5]<=b[4], work=!!b[6];
    var who=planned(dateStr,ix), th=who?T(who):null;
    var isNow=!!(isToday && cur && cur.i===ix && !marker);
    var past=isToday && !marker && b[5]<=now && !isNow;
    var cls="dstep"+(marker?" marker":"")+(isNow?" now":"")+(past?" past":"")+
            ((work&&!th&&!marker)?" hole":"");
    var s=el("button",cls); s.type="button";
    s.style.setProperty("--a",cvar(b[3]));
    s.appendChild(el("span","tm",b[0]));
    s.appendChild(el("span","ti wrapall",b[1]));
    if(th) s.appendChild(el("span","th wrapall",(isOn(th.id)?"running · ":"")+th.n));
    else if(work && !marker) s.appendChild(el("span","th","Unassigned"));
    else if(b[2]) s.appendChild(el("span","th wrapall",b[2]));
    s.addEventListener("click",function(){
      if(th){ sel={kind:"domain",id:th.dom}; put(K.sel,sel); openThread(th.id); return; }
      sel={kind:"today",id:""}; put(K.sel,sel); selThread=""; file=null;
      document.body.classList.add("detail-open"); render();
    });
    wrap.appendChild(s);
  });
  return wrap;
}
function headerWalkText(){
  if(!connected()) return "Not connected · Open settings to start the walk";
  var d=new Date(), t=nowMin(), cur=curBlock();
  if(cur){
    var bits=[FULL[d.getDay()]+" "+hm(t), cur.b[1]];
    var who=planned(today(),cur.i), th=who?T(who):null;
    if(th){
      bits.push(th.n);
      bits.push(isUnset(th) ? "stage not set"
        : (stageName(th)+" "+(stageIx(th)+1)+"/"+stageCount(th)));
    } else if(cur.b[6]) bits.push("no thread on this block");
    bits.push(dur(Math.max(0,cur.b[5]-t))+" left");
    return bits.join(" · ");
  }
  var nx=nextBlock();
  return nx ? ("Off the clock · next block "+nx[1]+" at "+hm(nx[4]))
            : ("Off the clock · nothing else today");
}
function startPath(node, leadText){
  var w=el("div","startpath");
  w.appendChild(el("p","lead wrapall", leadText));
  var path=el("div","path");
  var a=el("div","stone here");
  a.appendChild(el("span","bead")); a.appendChild(el("span","st","Connect the repository"));
  a.appendChild(el("span","mk","you are here"));
  var b=el("div","stone ahead");
  b.appendChild(el("span","bead")); b.appendChild(el("span","st","Assign this morning's block"));
  var c=el("div","stone ahead");
  c.appendChild(el("span","bead")); c.appendChild(el("span","st","Start the timer and walk"));
  path.appendChild(a); path.appendChild(b); path.appendChild(c);
  w.appendChild(path);
  var row=el("div","btnrow");
  var go=withIcon(el("button","btn pri","Open settings"),"settings");
  go.addEventListener("click",function(){ settings(); });
  row.appendChild(go);
  w.appendChild(row);
  node.appendChild(w);
}

/* ---------- render ---------- */
function render(){
  document.body.classList.toggle("look", sel.kind==="look" || sel.kind==="week");
  safe(paintRail); safe(paintList); safe(paintDetail); paintState();
}

function pick(kind,id){
  sel={kind:kind,id:id||""}; put(K.sel,sel);
  if(kind==="domain"){ var ts=threadsIn(id); selThread = ts.length?ts[0].id:""; }
  else selThread="";
  file=null; document.body.classList.remove("detail-open");
  render();
}
function openThread(id){
  selThread=id; file=null; document.body.classList.add("detail-open"); render();
}

/* ---- rail ---- */
function paintRail(){
  var r=$("rail"); r.innerHTML="";
  function item(kind,id,label,colour,count,live,ico){
    var b=el("button","ri"); b.type="button";
    b.setAttribute("aria-current", (sel.kind===kind && sel.id===(id||""))?"true":"false");
    if(colour) b.style.setProperty("--a",cvar(colour));
    if(colour){ b.appendChild(el("span","sw")); }
    else { var ic=icon(ico||"doc"); if(ic){ ic.style.color="var(--faint)"; b.appendChild(ic); } }
    b.appendChild(el("span","nm",label));
    if(count!=null) b.appendChild(el("span","ct"+(live?" live":""),String(count)));
    b.addEventListener("click",function(){ pick(kind,id); });
    r.appendChild(b);
  }
  r.appendChild(el("div","railh lab","Day"));
  var chases=board.threads.filter(needsChase).length;
  item("look","","One look",null,null,false,"layers");
  item("today","","Today",null, runIds().length||null, runIds().length>0, "clock");
  item("week","","The week",null,null,false,"calendar");
  item("review","","Weekly review",null, chases||null, chases>0, "check");

  r.appendChild(el("div","railh lab","Categories"));
  var add=el("button","ri"); add.type="button";
  var pic=icon("plus"); if(pic){ pic.style.color="var(--accent)"; add.appendChild(pic); }
  add.appendChild(el("span","nm","Add something new"));
  add.addEventListener("click",function(){ addModal(sel.kind==="domain"?sel.id:""); });
  r.appendChild(add);
  domains().forEach(function(d){
    var ts=threadsIn(d.id);
    var liveN=ts.filter(function(t){ return isOn(t.id); }).length;
    item("domain",d.id,d.n,d.c,ts.length,liveN>0);
  });

  r.appendChild(el("div","railh lab","Everything else"));
  item("inbox","","Messages",null, issues?issues.length:null, issues&&issues.length>0, "inbox");
  item("goals","","The map",null,board.threads.length||null,false,"target");
  item("open","","Questions",null,qLeft().length||null,false,"help");
  item("files","","Files",null,null,false,"folder");
}

/* ---- list ---- */
function listHead(node,title,sub){
  var h=el("div","lh"); h.appendChild(el("h2",null,title));
  if(sub) h.appendChild(el("span",null,sub));
  node.appendChild(h);
}
function threadRow(node,t){
  var b=el("button","li"+(isOn(t.id)?" on":"")); b.type="button";
  b.setAttribute("aria-current", selThread===t.id?"true":"false");
  b.style.setProperty("--a",cvar(t.c||domOf(t).c));
  var r1=el("div","t1");
  r1.appendChild(el("span","sw"));
  r1.appendChild(el("b","wrapall",t.n));
  var m=liveMins(t.id);
  r1.appendChild(el("span","rt", isOn(t.id)?dur(m):(m>=1?dur(m):"")));
  b.appendChild(r1);
  var bits=[], stage=isUnset(t)?"Stage not set":(stageName(t)+(stagePending(t)?" (pending)":""));
  bits.push(stage);
  if(t.tag && t.tag!==stageName(t)) bits.push(t.tag);
  if(t.why && t.why.indexOf(stageName(t))!==0) bits.push(t.why);
  b.appendChild(el("div","t2",bits.join(" · ")));
  b.addEventListener("click",function(){ openThread(t.id); });
  node.appendChild(b);
}

function paintList(){
  var n=$("list"); n.innerHTML="";
  if(sel.kind==="domain"){
    var d=null; domains().forEach(function(x){ if(x.id===sel.id) d=x; });
    var ts=threadsIn(sel.id);
    listHead(n, d?d.n:"Threads", ts.length+(domMins(sel.id)>=1?(" · "+dur(domMins(sel.id))+" this week"):""));
    var ab=withIcon(el("button","btn sm addbtn","Add to "+(d?d.n:"this category")),"plus");
    ab.addEventListener("click",function(){ addModal(sel.id); });
    n.appendChild(ab);
    if(!ts.length){ n.appendChild(emptyState("layers","No path in this category yet.")); return; }
    ts.forEach(function(t){ threadRow(n,t); });
    return;
  }
  if(sel.kind==="look")   return;
  if(sel.kind==="chase")  return listToday(n);
  if(sel.kind==="today")  return listToday(n);
  if(sel.kind==="review") return listReview(n);
  if(sel.kind==="week")   return;
  if(sel.kind==="inbox")  return listInbox(n);
  if(sel.kind==="goals")  return listGoals(n);
  if(sel.kind==="open")   return listOpen(n);
  if(sel.kind==="files")  return listFiles(n);
}

function listToday(n){
  var dayIx=new Date().getDay();
  listHead(n, FULL[dayIx], hm(nowMin()));
  if(!connected()){
    startPath(n, "The walk starts when the repository is connected. Three stones from here to working.");
    return;
  }

  var sgs=openSuggestions();
  if(sgs.length){
    n.appendChild(el("div","railh lab","From your messages, "+sgs.length));
    sgs.slice(0,3).forEach(function(sg){ n.appendChild(suggestionCard(sg, DSCLS)); });
  }
  var pn=pinnedThreads();
  if(pn.length){
    n.appendChild(el("div","railh lab","Pinned"));
    pn.forEach(function(t){ threadRow(n,t); });
  }
  var tds=openTodos();
  if(tds.length){
    n.appendChild(el("div","railh lab","To do, "+tds.length));
    tds.slice(0,10).forEach(function(td){ n.appendChild(todoRowD(td)); });
  }
  if(unlinked.length){
    n.appendChild(el("div","railh lab","Desktop folders to link, "+unlinked.length));
    unlinked.slice(0,4).forEach(function(u){ n.appendChild(linkBox(u)); });
  }
  var tq=todaysQuestion();
  if(tq){
    n.appendChild(el("div","railh lab","One question, "+qNumber(tq)+" of "+qList().length));
    n.appendChild(questionBox(tq, true));
  }

  var chase = board.threads.filter(needsChase).sort(function(a,b){ return clockDays(b)-clockDays(a); });
  if(chase.length){
    n.appendChild(el("div","railh lab","Chase, "+chase.length));
    chase.forEach(function(t){ n.appendChild(chaseRow(t)); });
  }

  var buckets={overdue:[],today:[],week:[]};
  board.threads.forEach(function(t){
    var bk=bucketOf(t);
    if(buckets[bk]) buckets[bk].push(t);
  });
  [["overdue","Late"],["today","On today"],["week","This week"]].forEach(function(pair){
    var list=buckets[pair[0]];
    if(!list.length) return;
    n.appendChild(el("div","railh lab",pair[1]+", "+list.length));
    list.forEach(function(t){ threadRow(n,t); });
  });
  if(!chase.length && !buckets.overdue.length && !buckets.today.length){
    n.appendChild(el("div","railh lab","On today"));
    n.appendChild(emptyState("clock","Nothing is dated for today. Open a path and give it a day, or let the review below choose."));
  }

  n.appendChild(el("div","railh lab","The day, morning to night"));
  n.appendChild(dayPathHtml(dayIx, today()));

  var wk=0; for(var k in mins) if(mins.hasOwnProperty(k)) wk+=mins[k];
  runIds().forEach(function(id){ wk+=(Date.now()-running[id])/60000; });
  var holes=0;
  (board.week[dayIx]||[]).forEach(function(b,ix){
    if(b[6] && b[5]>b[4] && !planned(today(),ix)) holes++;
  });
  var age=boardAge();
  var mini=el("div","mini");
  function mc(v,l){ var c=el("div","mc"); c.appendChild(el("b","num",v)); c.appendChild(el("span","lab",l)); mini.appendChild(c); }
  mc(String(runIds().length),"running now");
  mc(dur(wk),"logged, 7 days");
  mc(String(holes),holes===1?"hole today":"holes today");
  mc(age===null?"—":String(age),"days since board");
  n.appendChild(mini);

  if(runIds().length){
    n.appendChild(el("div","railh lab","Walking now"));
    runIds().forEach(function(id){ var x=T(id); if(x) threadRow(n,x); });
  }

  var crit=board.threads.filter(function(x){ return x.critical; });
  if(crit.length){
    n.appendChild(el("div","railh lab","Closest to their final"));
    crit.forEach(function(x){ threadRow(n,x); });
  }
}

function movedThisWeek(){
  var cut=Date.now()-7*864e5, out=[];
  board.threads.forEach(function(t){
    var st=statuses[t.id];
    if(st && st.at && new Date(st.at).getTime()>=cut) out.push({t:t, what:"moved to "+(st.label||"a new stage"), at:st.at});
  });
  recent.forEach(function(o){
    if(new Date(o.start).getTime()<cut) return;
    var t=T(o.thread); if(!t) return;
    out.push({t:t, what:dur(o.minutes)+" tracked", at:o.start});
  });
  out.sort(function(a,b){ return new Date(b.at)-new Date(a.at); });
  return out;
}
function weekHours(){
  var s=deskWeek.min; for(var k in mins) if(mins.hasOwnProperty(k)) s+=mins[k];
  runIds().forEach(function(id){ s+=(Date.now()-running[id])/60000; });
  return s/60;
}
function driftingThreads(){ return drifting(); }

function listReview(n){
  listHead(n,"Weekly review", "Saturday");
  if(!connected()){
    startPath(n, "The review reads the week from the repository. Connect it and it fills.");
    return;
  }
  var chase=board.threads.filter(needsChase);
  var moved=movedThisWeek();
  var hrs=weekHours();
  var mini=el("div","mini");
  function mc(v,l){ var c=el("div","mc"); c.appendChild(el("b","num",v)); c.appendChild(el("span","lab",l)); mini.appendChild(c); }
  mc(String(moved.length),"moves this week");
  mc(String(chase.length),"need chasing");
  mc(hrs>=1?dur(hrs*60):"0m","tracked of 40h");
  mc(String(driftingThreads().length),"drifting");
  n.appendChild(mini);

  if(moved.length){
    n.appendChild(el("div","railh lab","What moved"));
    moved.slice(0,12).forEach(function(m){
      var b=el("div","li"); b.style.setProperty("--a",cvar(m.t.c||domOf(m.t).c));
      var r1=el("div","t1"); r1.appendChild(el("span","sw"));
      r1.appendChild(el("b","wrapall",m.t.n));
      r1.appendChild(el("span","rt",ago(m.at)));
      b.appendChild(r1);
      b.appendChild(el("div","t2",m.what));
      n.appendChild(b);
    });
  } else {
    n.appendChild(el("div","railh lab","What moved"));
    n.appendChild(emptyState("layers","Nothing recorded this week. Either it was a quiet week or nothing reached the record."));
  }

  if(chase.length){
    n.appendChild(el("div","railh lab","Stuck with someone"));
    chase.forEach(function(t){
      var b=el("button","li"); b.type="button";
      b.style.setProperty("--a",cvar(t.c||domOf(t).c));
      var r1=el("div","t1"); r1.appendChild(el("span","sw"));
      r1.appendChild(el("b","wrapall",t.n));
      r1.appendChild(el("span","rt num",waitingDays(t)+"d"));
      b.appendChild(r1);
      b.appendChild(el("div","t2","With "+t.who));
      b.addEventListener("click",function(){ sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); });
      n.appendChild(b);
    });
  }
}

function detailReview(d){
  backBtn(d);
  if(!connected()){
    d.appendChild(el("h2",null,"The review is empty"));
    var s0=el("div","sec");
    startPath(s0, "Connect the repository and this fills with the week you actually had.");
    d.appendChild(s0);
    return;
  }
  d.appendChild(el("h2",null,"What gives"));
  d.appendChild(el("p","lead wrapall","Thirty minutes, once a week. Everything below is a decision you have not made yet. Each answer goes in as a decision and gets filed."));

  var drift=driftingThreads();
  if(drift.length){
    var t0=drift[0], dm0=domOf(t0);
    var s0=el("div","sec");
    var hh=el("div","lh"); hh.appendChild(el("h3","lab","One at a time, "+drift.length+" left"));
    hh.appendChild(el("span",null,"← drop   ↑ a day   ↓ delay   → start"));
    s0.appendChild(hh);
    var card=el("div","rvcard"); card.style.setProperty("--a",cvar(t0.c||dm0.c));
    card.appendChild(el("div","lab",dm0?dm0.n:""));
    card.appendChild(el("b","wrapall",t0.n));
    card.appendChild(el("p","wrapall",(isUnset(t0)?"Stage not set":stageName(t0))+" → "+finalOf(t0)+(t0.tag?(" · "+t0.tag):"")));
    if(t0.next) card.appendChild(el("p","wrapall","Next: "+t0.next));
    s0.appendChild(card);
    var rr=el("div","btnrow");
    [["drop","← Drop","warn"],["day","↑ A day",""],["delay","↓ Delay four weeks",""],["start","Start →","pri"]].forEach(function(x){
      var b=el("button","btn "+x[2],x[1]);
      b.addEventListener("click",function(){ reviewDecide(t0,x[0]); render(); });
      rr.appendChild(b);
    });
    s0.appendChild(rr);
    d.appendChild(s0);
  }
  if(reviewLog.length){
    var sr=el("div","btnrow");
    var sd=el("button","btn pri","Send the review to Claude, "+reviewLog.length+" decided");
    sd.addEventListener("click",function(){ reviewFinish(); });
    sr.appendChild(sd); d.appendChild(sr);
  }
  if(drift.length){
    var s1=el("div","sec");

    var h1=el("div","lh");
    h1.appendChild(el("h3","lab","Drifting, "+drift.length));
    h1.appendChild(el("span",null,"no day, no hours, nobody holding it"));
    s1.appendChild(h1);
    drift.slice(0,10).forEach(function(t){
      var r=el("div","file");
      var sw=el("span"); sw.style.cssText="width:7px;height:7px;border-radius:50%;flex:none;background:"+cvar(t.c||domOf(t).c);
      r.appendChild(sw);
      r.appendChild(el("span","p wrapall",t.n));
      var go=el("button","btn sm","Give it a day");
      go.addEventListener("click",function(){ sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); });
      var park=el("button","btn sm warn","Delay or drop");
      park.addEventListener("click",function(){ decide(d, t); });
      r.appendChild(go); r.appendChild(park);
      s1.appendChild(r);
    });
    d.appendChild(s1);
  }

  var hrs=weekHours();
  var s2=el("div","sec"); s2.appendChild(el("h3","lab","Capacity"));
  s2.appendChild(el("p","kv wrapall", hrs>=1
    ? (dur(hrs*60)+" tracked against forty. "+(hrs>40?"Over.":"Under, or the timer was not running."))
    : "Nothing tracked this week. Either nothing was worked on, which is not true, or the timer is not being used."));
  d.appendChild(s2);

  var q=qLeft();
  if(q.length){
    var s3=el("div","sec"); s3.appendChild(el("h3","lab","Questions waiting on you, "+q.length));
    q.forEach(function(x,i){
      var r=el("div","file");
      var nb=el("span","num",String(i+1));
      nb.style.cssText="flex:none;width:18px;color:var(--faint);font-size:12px";
      r.appendChild(nb);
      r.appendChild(el("span","p wrapall",x.q));
      var b=el("button","btn sm","Answer");
      b.addEventListener("click",function(){ sel={kind:"open",id:x.id}; put(K.sel,sel);
        document.body.classList.add("detail-open"); render(); });
      r.appendChild(b);
      s3.appendChild(r);
    });
    d.appendChild(s3);
  }
}

function decide(d, t){
  var h=$("modal"); h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov) h.innerHTML=""; });
  var cd=el("div","cd");
  cd.appendChild(el("h3","lab","Delay, drop or start"));
  cd.appendChild(el("p","lead wrapall",t.n));
  var ta=document.createElement("textarea");
  ta.placeholder="Say what happens to it and why. One line is enough.";
  cd.appendChild(ta);
  cd.appendChild(micRow(ta));
  var row=el("div","btnrow");
  ["Delay it","Drop it","Start it"].forEach(function(label){
    var b=el("button","btn"+(label==="Start it"?" pri":""), label);
    b.addEventListener("click",function(){
      var v=ta.value.trim();
      var body=label+". "+(v||"No reason given.")+
        "\n\n---\nThread: `"+t.id+"` \u2014 "+t.n+
        "\nSent from the weekly review, "+new Date().toISOString()+".";
      queue.push({kind:"issue", title:"Decision: "+t.n, body:body});
      put(K.queue,queue); h.innerHTML=""; note("Sending the decision…");
      flushQueue().then(loadIssues).then(function(){ stateMsg="Decision sent."; render(); })
        .catch(function(e){ note(e.message,"bad"); });
    });
    row.appendChild(b);
  });
  cd.appendChild(row);
  ov.appendChild(cd); h.appendChild(ov);
}

function addModal(dom){
  var h=$("modal"); h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov) h.innerHTML=""; });
  var cd=el("div","cd");
  cd.appendChild(el("h3","lab","Add something new"));
  function fld(label,node){ var w=el("div","afld"); w.appendChild(el("label","lab",label)); w.appendChild(node); cd.appendChild(w); return node; }
  var nm=document.createElement("input"); nm.type="text"; nm.setAttribute("dir","auto");
  nm.placeholder="What is it? A paper, a patent, a course, anything";
  fld("What",nm);
  var sd=document.createElement("select");
  domains().forEach(function(x){ var o=el("option",null,x.n); o.value=x.id; if(x.id===dom) o.selected=true; sd.appendChild(o); });
  fld("Category",sd);
  var sg=document.createElement("select");
  var o0=el("option",null,"No goal"); o0.value=""; sg.appendChild(o0);
  (board.goals||[]).forEach(function(g){ var o=el("option",null,g.n); o.value=g.id; sg.appendChild(o); });
  function guess(){ var hit=""; board.threads.forEach(function(t){ if(!hit && t.dom===sd.value && t.goal) hit=t.goal; }); sg.value=hit; }
  sd.addEventListener("change",guess); guess();
  fld("Counts toward",sg);
  var nx=document.createElement("input"); nx.type="text"; nx.setAttribute("dir","auto"); nx.placeholder="The next physical step (optional)";
  fld("Next step",nx);
  var wh=document.createElement("input"); wh.type="text"; wh.setAttribute("dir","auto"); wh.placeholder="Only if someone else is holding it now";
  fld("With whom",wh);
  cd.appendChild(micRow(nm));
  var msg=el("p","note");
  var row=el("div","btnrow");
  var go=el("button","btn pri","Add it");
  go.addEventListener("click",function(){
    var v=nm.value.trim();
    if(!v){ msg.className="note bad"; msg.textContent="Give it a name first."; nm.focus(); return; }
    var t=addThread({n:v, dom:sd.value, goal:sg.value, next:nx.value, who:wh.value});
    h.innerHTML=""; sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id);
  });
  var cx=el("button","btn","Cancel"); cx.addEventListener("click",function(){ h.innerHTML=""; });
  row.appendChild(go); row.appendChild(cx); cd.appendChild(row); cd.appendChild(msg);
  cd.appendChild(el("p","note","It appears straight away and can be started, dated and chased. Claude files it properly at the next session."));
  ov.appendChild(cd); h.appendChild(ov);
  setTimeout(function(){ try{ nm.focus(); }catch(e){} },40);
}

var DCLS={fld:"afld", label:"lab", check:"achk", row:"btnrow", btn:"btn", on:"pri", pri:"pri", warn:"warn", note:"note bad"};
function blockModal(d, ix, blk){
  var h=$("modal"); h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov) h.innerHTML=""; });
  var cd=el("div","cd");
  cd.appendChild(el("h3","lab", blk ? (FULL[d]+" \u00b7 "+blk[0]) : ("Add to "+FULL[d])));
  if(blk) cd.appendChild(el("p","lead wrapall",blk[1]+(blk[2]?(" \u00b7 "+blk[2]):"")));
  if(blk && blk[6]){
    var ds=weekDate(d), who=planned(ds,ix);
    var w=el("div","afld"); w.appendChild(el("label","lab","Thread on this block, "+fmtDay(ds)));
    var sl=document.createElement("select");
    var o0=el("option",null,"Nothing on it"); o0.value=""; sl.appendChild(o0);
    domains().forEach(function(dm){
      var ts=threadsIn(dm.id); if(!ts.length) return;
      var gp=document.createElement("optgroup"); gp.label=dm.n;
      ts.forEach(function(t){ var o=el("option",null,t.n); o.value=t.id; if(t.id===who) o.selected=true; gp.appendChild(o); });
      sl.appendChild(gp);
    });
    sl.addEventListener("change",function(){ assign(ds, ix, sl.value); h.innerHTML=""; render(); });
    w.appendChild(sl); cd.appendChild(w);
    cd.appendChild(el("h3","lab","Or change the block itself"));
  }
  blockEditor(cd, d, blk, DCLS, function(){ h.innerHTML=""; render(); });
  var cx=el("button","btn","Close"); cx.addEventListener("click",function(){ h.innerHTML=""; });
  cd.appendChild(cx);
  ov.appendChild(cd); h.appendChild(ov);
}
function detailWeek(d){
  var hd=el("div","lookh");
  hd.appendChild(el("h2",null,"The week"));
  hd.appendChild(el("span","meta","Click any block to put a thread on it, move it, or cancel it for one day"));
  d.appendChild(hd);
  var td=new Date().getDay(), cur=curBlock();
  var g=el("div","wkbig");
  for(var di=0;di<7;di++){
    var col=el("div","wcolbig"+(di===td?" today":""));
    var ds=weekDate(di);
    col.appendChild(el("div","wdh",FULL[di]+" "+fmtDay(ds)));
    (board.week[di]||[]).forEach(function(b,ix){
      var marker=b[5]<=b[4], work=!!b[6];
      var who=work?planned(ds,ix):"", th=who?T(who):null;
      var k=el("button","wb"+((di===td&&cur&&cur.i===ix&&!marker)?" now":"")+(work&&!th&&!marker?" hole":"")+(marker?" marker":""));
      k.type="button";
      k.style.setProperty("--a",cvar(th?th.c:b[3]));
      k.appendChild(el("span","wt",b[0]));
      k.appendChild(el("b","wrapall",b[1]));
      var sub = th ? th.n : (work&&!marker ? "Empty" : (b[2]||""));
      if(b[8]&&b[8].once) sub=(sub?sub+" \u00b7 ":"")+"this week only";
      if(sub) k.appendChild(el("span","ws wrapall",sub));
      (function(dd,ii,bb){ k.addEventListener("click",function(){ blockModal(dd,ii,bb); }); })(di,ix,b);
      col.appendChild(k);
    });
    var add=el("button","wadd","+ Add"); add.type="button";
    (function(dd){ add.addEventListener("click",function(){ blockModal(dd,-1,null); }); })(di);
    col.appendChild(add);
    g.appendChild(col);
  }
  d.appendChild(g);
}
function listWeek(n){
  listHead(n,"The week", FULL[new Date().getDay()]+", today");
  var td=new Date().getDay(), cur=curBlock();
  var g=el("div","wkgrid");
  for(var d=0;d<7;d++){
    var col=el("div","dcol");
    col.appendChild(el("div","dhh lab"+(d===td?" today":""),DAYS[d]));
    (board.week[d]||[]).forEach(function(b,ix){
      var marker=b[5]<=b[4];
      var k=el("div","tb"+((d===td&&cur&&cur.i===ix&&!marker)?" now":""));
      k.style.setProperty("--a",cvar(b[3]));
      var bb=el("span","bb"); bb.appendChild(el("b","wrapall",b[1]));
      bb.appendChild(el("i","wrapall",b[0]));
      k.appendChild(bb); col.appendChild(k);
    });
    g.appendChild(col);
  }
  n.appendChild(g);
}

function listInbox(n){
  listHead(n,"Messages", issues?(issues.length+" open"):"");
  if(issuesErr){ n.appendChild(el("p","note bad wrapall",issuesErr)); return; }
  if(!connected()){ n.appendChild(emptyState("inbox","Connect the repository and your messages appear.")); return; }
  var key=el("p","tickkey");
  key.appendChild(el("span","tk sent","✓")); key.appendChild(document.createTextNode(" sent  "));
  key.appendChild(el("span","tk seen","✓✓")); key.appendChild(document.createTextNode(" read  "));
  key.appendChild(el("span","tk filed","✓✓")); key.appendChild(document.createTextNode(" filed"));
  n.appendChild(key);
  queue.filter(function(q){ return q.kind==="issue"; }).forEach(function(q){
    var b=el("div","li msg"); var r1=el("div","t1"); r1.appendChild(el("b","wrapall",q.title)); r1.appendChild(el("span","tk","⏱"));
    b.appendChild(r1); b.appendChild(el("div","t2","Waiting for a connection")); n.appendChild(b);
  });
  (issues||[]).filter(isBrief).forEach(function(is){
    var b=el("button","li"); b.type="button"; b.style.setProperty("--a","var(--accent)");
    b.setAttribute("aria-current", (sel.kind==="inbox"&&sel.id===String(is.number))?"true":"false");
    var r1=el("div","t1"); r1.appendChild(el("span","sw")); r1.appendChild(el("b","wrapall",is.title)); r1.appendChild(el("span","rt","brief"));
    b.appendChild(r1); b.appendChild(el("div","t2","The morning brief. Tick its boxes on GitHub"));
    b.addEventListener("click",function(){ sel={kind:"inbox",id:String(is.number)}; put(K.sel,sel); document.body.classList.add("detail-open"); render(); });
    n.appendChild(b);
  });
  if(!mine){ n.appendChild(emptyState("inbox","Loading.")); if(!loadingMine){ loadingMine=true; loadMine(true).then(function(){ loadingMine=false; render(); }); } return; }
  if(!mine.length){ n.appendChild(emptyState("check","Nothing sent yet.")); return; }
  mine.forEach(function(x){ n.appendChild(msgRow(x)); });
}

function listGoals(n){
  listHead(n,"The map", board.threads.length+" paths");
  if(!connected()){
    startPath(n, "The map draws itself once the board is connected. Every path, where you stand on it, and where it ends.");
    return;
  }
  if(board.apex) n.appendChild(el("p","lead wrapall",board.apex));

  n.appendChild(el("div","railh lab","The year in numbers"));
  (board.goals||[]).forEach(function(g){
    var b=el("div","track"); b.style.setProperty("--a",cvar(g.c));
    b.appendChild(el("span","nm wrapall",g.n));
    var rail=el("span","railpath"); var fill=el("i");
    var pct=g.target?Math.min(100,Math.round((g.now||0)/g.target*100)):0;
    fill.style.width=Math.max(pct,2)+"%"; rail.appendChild(fill);
    b.appendChild(rail);
    b.appendChild(el("span","dest num",(g.now||0)+" / "+(g.target||0)));
    n.appendChild(b);
  });

  var row=el("div","btnrow"); row.style.margin="14px 2px 0";
  var go=withIcon(el("button","btn","Open the whole map"),"layers");
  go.addEventListener("click",function(){ selThread=""; file=null;
    document.body.classList.add("detail-open"); render(); });
  row.appendChild(go);
  n.appendChild(row);

  if((board.events||[]).length){
    n.appendChild(el("div","railh lab","Coming up"));
    (board.events||[]).forEach(function(e){
      var b=el("div","li"); b.style.setProperty("--a",cvar(e.c));
      var r1=el("div","t1"); r1.appendChild(el("span","sw"));
      r1.appendChild(el("b","wrapall",e.n)); r1.appendChild(el("span","rt",e.date||""));
      b.appendChild(r1);
      b.appendChild(el("div","t2",[e.start&&(e.start+(e.end?("\u2013"+e.end):"")),e.where,e.note].filter(Boolean).join(" \u00b7 ")));
      n.appendChild(b);
    });
  }
}

function detailMap(d){
  backBtn(d);
  if(!connected()){
    d.appendChild(el("h2",null,"The map is empty"));
    var s0=el("div","sec");
    startPath(s0, "Connect the repository and every path appears here, with where you stand on it.");
    d.appendChild(s0);
    return;
  }
  d.appendChild(el("h2",null,"The map"));
  d.appendChild(el("p","lead wrapall","Every path, how far along it you are, and the final it ends at."));
  var map=el("div","map"); map.style.marginTop="22px";
  domains().forEach(function(dm){
    var ts=threadsIn(dm.id);
    if(!ts.length) return;
    var lane=el("div","lane"); lane.style.setProperty("--a",cvar(dm.c));
    lane.appendChild(el("div","lab",dm.n+" \u00b7 "+ts.length));
    ts.forEach(function(t){
      var b=el("button","track"); b.type="button";
      b.style.setProperty("--a",cvar(t.c||dm.c));
      b.appendChild(el("span","nm wrapall",t.n));
      var rail=el("span","railpath"); var fill=el("i");
      fill.style.width=Math.max(isUnset(t)?0:walked(t),2)+"%";
      rail.appendChild(fill); b.appendChild(rail);
      var atEnd=!isUnset(t) && stageIx(t)===stageCount(t)-1;
      b.appendChild(el("span","dest"+(atEnd?" at":""),
        atEnd ? finalOf(t) : ((isUnset(t)?"not started ":"")+"\u2192 "+finalOf(t))));
      b.addEventListener("click",function(){ openThread(t.id); });
      lane.appendChild(b);
    });
    map.appendChild(lane);
  });
  d.appendChild(map);
}

function listOpen(n){
  var q=qList(), left=qLeft();
  listHead(n,"Questions", left.length?(left.length+" waiting, one a day"):"all answered");
  if(!q.length){ n.appendChild(emptyState("check","Nothing is waiting on a decision. The road ahead is yours.")); return; }
  q.forEach(function(x,i){
    var done=answers[x.id];
    var b=el("button","li"+(done?" done":"")); b.type="button";
    b.setAttribute("aria-current", sel.id===x.id?"true":"false");
    b.style.setProperty("--a", done?"var(--good)":"var(--hot)");
    var r1=el("div","t1"); r1.appendChild(el("span","sw"));
    r1.appendChild(el("b","wrapall",x.q)); r1.appendChild(el("span","rt",String(i+1)));
    b.appendChild(r1);
    b.appendChild(el("div","t2 wrapall", done?("Answered: "+done.a):((x.opts||[]).map(function(o){ return o.a; }).join(" · ")||"Answer in words")));
    b.addEventListener("click",function(){ sel={kind:"open",id:x.id}; put(K.sel,sel);
      document.body.classList.add("detail-open"); render(); });
    n.appendChild(b);
  });
}

function listFiles(n){
  listHead(n,"Files","open anything in the repository");
  var seen={}, groups=[];
  board.threads.forEach(function(t){
    (t.files||[]).forEach(function(p){
      if(seen[p]) return; seen[p]=1;
      groups.push({p:p, t:t});
    });
  });
  ["NOW.md","data/board.json","docs/plan.md","docs/week.md","docs/decisions.md","patents/README.md"].forEach(function(p){
    if(!seen[p]){ seen[p]=1; groups.push({p:p, t:null}); }
  });
  groups.forEach(function(g){
    var b=el("button","li"); b.type="button";
    if(g.t) b.style.setProperty("--a",cvar(g.t.c));
    var r1=el("div","t1"); r1.appendChild(el("span","sw"));
    r1.appendChild(el("b","wrapall",g.p.split("/").pop()));
    b.appendChild(r1);
    b.appendChild(el("div","t2",g.p));
    b.addEventListener("click",function(){ if(g.t) selThread=g.t.id; openFile(g.p); });
    n.appendChild(b);
  });
  var add=el("div"); add.style.marginTop="12px";
  var inp=document.createElement("input"); inp.type="text"; inp.placeholder="any path, for example teaching/ct-techniques.md";
  add.appendChild(inp);
  var go=el("button","btn","Open path"); go.style.marginTop="8px";
  go.addEventListener("click",function(){ var v=inp.value.trim(); if(v) openFile(v); });
  add.appendChild(go);
  n.appendChild(add);
}

/* ---- detail ---- */
function backBtn(d){
  var b=withIcon(el("button","back","Back"),"back");
  b.addEventListener("click",function(){ file=null; document.body.classList.remove("detail-open"); render(); });
  d.appendChild(b);
}

function paintDetail(){
  var d=$("detail"); d.innerHTML="";
  if(file) return detailFile(d);
  if(sel.kind==="look") return detailLook(d);
  if(sel.kind==="week") return detailWeek(d);
  if(sel.kind==="inbox" && sel.id) return detailIssue(d, Number(sel.id));
  if(sel.kind==="open" && sel.id!=="") return detailQuestion(d, sel.id);
  if(sel.kind==="chase" && sel.id) return detailChase(d, T(sel.id));
  var t=selThread?T(selThread):null;
  if(!t){
    if(sel.kind==="today") return detailToday(d);
    if(sel.kind==="review") return detailReview(d);
    if(sel.kind==="goals") return detailMap(d);
    backBtn(d);
    d.appendChild(el("h2",null,"Pick a path"));
    d.appendChild(el("p","lead wrapall","A category on the left, then a thread. Its stones, its final and its next step all open here."));
    d.appendChild(emptyState("layers","\u2318K jumps straight to a path, a file or a category."));
    return;
  }
  detailThread(d,t);
}

function detailToday(d){
  var dt=today(), dayIx=new Date().getDay(), blocks=board.week[dayIx]||[], cur=curBlock();
  if(!connected()){
    d.appendChild(el("h2",null,"The walk has not started"));
    var s0=el("div","sec");
    startPath(s0, "Nothing is wrong. This browser simply holds no token yet, so there is no board to walk and no day to assign.");
    d.appendChild(s0);
    return;
  }
  d.appendChild(el("h2",null,"The plan for "+FULL[dayIx]));
  if(board.headline) d.appendChild(el("p","lead wrapall",board.headline));

  var s0=el("div","sec"); s0.appendChild(el("h3","lab","The day, morning to night"));
  s0.appendChild(dayPathHtml(dayIx, dt));
  d.appendChild(s0);

  var s1=el("div","sec"); s1.appendChild(el("h3","lab","One thread per block"));
  var any=false;
  blocks.forEach(function(b,ix){
    if(b[5]<=b[4] || !b[6]) return;   // markers and non-working blocks are not assignable
    any=true;
    var row=el("div","tb"+((cur&&cur.i===ix)?" now":""));
    row.style.setProperty("--a",cvar(b[3]));
    row.style.alignItems="center";
    row.appendChild(el("span","tm",b[0]));
    var bb=el("span","bb");
    bb.appendChild(el("b","wrapall",b[1]));
    var who=planned(dt,ix);
    var selx=document.createElement("select");
    var o0=document.createElement("option"); o0.value=""; o0.textContent="Not assigned"; selx.appendChild(o0);
    domains().forEach(function(dm){
      var g=document.createElement("optgroup"); g.label=dm.n;
      threadsIn(dm.id).forEach(function(th){
        var o=document.createElement("option"); o.value=th.id; o.textContent=th.n;
        if(th.id===who) o.selected=true;
        g.appendChild(o);
      });
      if(g.childNodes.length) selx.appendChild(g);
    });
    selx.style.marginTop="6px";
    selx.addEventListener("change",function(){ assign(dt,ix,selx.value); });
    bb.appendChild(selx);
    row.appendChild(bb);
    if(who){
      var th=T(who);
      var go=el("button","btn "+(isOn(who)?"stop":"pri"), isOn(who)?"Stop":"Start");
      go.style.flex="none";
      withIcon(go, isOn(who)?"stop":"play");
      go.addEventListener("click",function(){ isOn(who)?stop(who):start(who); });
      row.appendChild(go);
      var opn=el("button","btn sm","Open");
      opn.style.flex="none";
      opn.addEventListener("click",function(){ if(th){ sel={kind:"domain",id:th.dom}; put(K.sel,sel); openThread(th.id); } });
      row.appendChild(opn);
      var clr=el("button","btn sm warn","Clear");
      clr.style.flex="none";
      clr.addEventListener("click",function(){ assign(dt,ix,""); });
      row.appendChild(clr);
    } else if(cur && cur.i===ix){
      row.appendChild(el("span","pill unset","hole in the road"));
    }
    s1.appendChild(row);
  });
  if(!any) s1.appendChild(emptyState("calendar","No working block today. Nothing to assign."));
  d.appendChild(s1);

  var unplanned=board.threads.filter(function(t){ return t.critical; }).filter(function(t){
    var got=false; blocks.forEach(function(b,ix){ if(planned(dt,ix)===t.id) got=true; });
    return !got;
  });
  if(unplanned.length){
    var s2=el("div","sec"); s2.appendChild(el("h3","lab","Phase 1, not on today"));
    unplanned.forEach(function(t){
      var r=el("div","file");
      var sw=el("span","sw"); sw.style.cssText="width:7px;height:7px;border-radius:50%;flex:none;background:"+cvar(t.c||domOf(t).c);
      r.appendChild(sw);
      r.appendChild(el("span","p wrapall",t.n));
      var b=el("button","btn sm","Open");
      b.addEventListener("click",function(){ sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); });
      r.appendChild(b);
      s2.appendChild(r);
    });
    d.appendChild(s2);
  }

  var q=qLeft();
  if(q.length){
    var s3=el("div","sec"); s3.appendChild(el("h3","lab","Waiting on you, "+q.length));
    q.slice(0,3).forEach(function(x,i){
      var r=el("div","file");
      var nb=el("span","num",String(qNumber(x)));
      nb.style.cssText="flex:none;width:18px;color:var(--faint);font-size:12px";
      r.appendChild(nb);
      r.appendChild(el("span","p wrapall",x.q));
      var b=el("button","btn sm","Answer");
      b.addEventListener("click",function(){ sel={kind:"open",id:x.id}; put(K.sel,sel);
        document.body.classList.add("detail-open"); render(); });
      r.appendChild(b);
      s3.appendChild(r);
    });
    d.appendChild(s3);
  }
}

function detailThread(d,t){
  backBtn(d);
  var dom=domOf(t);
  var h=el("div","dh");
  h.appendChild(el("h2","wrapall",t.n));
  d.appendChild(h);

  var meta=el("div","meta");
  var p1=el("span","pill",dom.n); p1.style.background="transparent";
  p1.style.boxShadow="inset 0 0 0 1px "+cvar(t.c||dom.c); p1.style.color=cvar(t.c||dom.c);
  meta.appendChild(p1);
  if(t.tag) meta.appendChild(el("span","pill",t.tag));
  if(isUnset(t)) meta.appendChild(el("span","pill unset","stage not set"));
  else if(stagePending(t)) meta.appendChild(el("span","pill","pending on the board"));
  if(isOn(t.id)) meta.appendChild(el("span","pill live","running "+dur((Date.now()-running[t.id])/60000)));
  var m=liveMins(t.id);
  if(m>=1) meta.appendChild(el("span",null,dur(m)+" in seven days"));
  if(t.who) meta.appendChild(el("span",null,"with "+t.who));
  var pinb=el("button","pill pinp"+(isPinned(t)?" on":""), isPinned(t)?"\u2605 pinned":"\u2606 pin");
  pinb.type="button"; pinb.addEventListener("click",function(){ togglePin(t); });
  meta.appendChild(pinb);
  d.appendChild(meta);

  if(t.why) d.appendChild(el("p","lead wrapall",t.why));

  // the path: stones are the stage setter
  var s1=el("div","sec");
  var h1=el("div","lh");
  h1.appendChild(el("h3","lab","The path"));
  h1.appendChild(el("span",null,"click a stone, or [ and ]"));
  s1.appendChild(h1);
  s1.appendChild(pathHtml(t));
  s1.appendChild(finalFlag(t));
  var ns=el("p","nextstep wrapall");
  ns.appendChild(el("b","lab","next step"));
  ns.appendChild(document.createTextNode(t.next || "Not named yet. Say what the next step is and it gets filed."));
  s1.appendChild(ns);
  d.appendChild(s1);

  // when: the day he means to touch it. Not a deadline, and his to move.
  var sw=el("div","sec");
  var wh=el("div","lh");
  wh.appendChild(el("h3","lab","The day you touch it"));
  var cur=doDate(t);
  wh.appendChild(el("span",null, cur ? (cur+(bucketOf(t)==="overdue"?" · late":"")) : "no day yet"));
  sw.appendChild(wh);
  var row=el("div","btnrow");
  [["Today",0],["Tomorrow",1],["In two days",2],["Next week",7]].forEach(function(o){
    var iso=dayOffset(o[1]);
    var b=el("button","btn sm"+(cur===iso?" pri":""), o[0]);
    b.addEventListener("click",function(){ setDoDate(t, iso); });
    row.appendChild(b);
  });
  var pick=document.createElement("input"); pick.type="date"; pick.value=cur||"";
  pick.style.cssText="width:auto;flex:none";
  pick.addEventListener("change",function(){ setDoDate(t, pick.value); });
  row.appendChild(pick);
  if(cur){
    var clr=el("button","btn sm warn","Clear");
    clr.addEventListener("click",function(){ setDoDate(t, ""); });
    row.appendChild(clr);
  }
  sw.appendChild(row);
  if(t.who && t.since){
    sw.appendChild(el("p","note","With "+t.who+" since "+t.since+", "+waitingDays(t)+" days. "+
      (needsChase(t) ? "Past the "+chaseAfter(t)+" day mark, so it is on today's chase list."
                     : "It becomes a chase after "+chaseAfter(t)+" days.")));
  }
  d.appendChild(sw);

  // timer
  var s2=el("div","sec"); s2.appendChild(el("h3","lab","Time"));
  var row=el("div","btnrow");
  var go=el("button","btn "+(isOn(t.id)?"stop":"pri"), isOn(t.id)?"Stop":"Start working");
  withIcon(go, isOn(t.id)?"stop":"play");
  go.addEventListener("click",function(){ isOn(t.id)?stop(t.id):start(t.id); });
  row.appendChild(go);
  if(runIds().length>1){
    row.appendChild(el("span","note","Two or more threads are running. Each hour is only attributable to one."));
  }
  s2.appendChild(row);
  var rec=recent.filter(function(o){ return o.thread===t.id; }).slice(0,5);
  if(rec.length){
    var ul=el("div"); ul.style.marginTop="10px";
    rec.forEach(function(o){
      ul.appendChild(el("div","note", new Date(o.start).toLocaleString(undefined,
        {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})+" · "+dur(o.minutes)));
    });
    s2.appendChild(ul);
  }
  d.appendChild(s2);

  // files
  var s3=el("div","sec"); s3.appendChild(el("h3","lab","Files"));
  if(!(t.files||[]).length){
    s3.appendChild(emptyState("folder","No file is linked to this thread yet. Open any path from the Files list on the left."));
  } else {
    var fl=el("div","filelist");
    (t.files||[]).forEach(function(p){
      var b=el("button","file"); b.type="button";
      var fi=icon("doc"); if(fi){ fi.style.color="var(--faint)"; b.appendChild(fi); }
      b.appendChild(el("span","p mono",p));
      b.appendChild(el("span","pill ghost","open"));
      b.addEventListener("click",function(){ openFile(p); });
      fl.appendChild(b);
    });
    s3.appendChild(fl);
  }
  d.appendChild(s3);

  // to-dos
  var stt=el("div","sec"); var tl=openTodos(t.id);
  var hT=el("div","lh"); hT.appendChild(el("h3","lab","To do")); hT.appendChild(el("span",null,tl.length?(tl.length+" open"):"nothing yet")); stt.appendChild(hT);
  tl.forEach(function(td){ stt.appendChild(todoRowD(td,true)); });
  var ar=el("div","addtodo");
  var ai=document.createElement("input"); ai.type="text"; ai.placeholder="Add a to-do for this"; ai.setAttribute("dir","auto");
  var adt=document.createElement("input"); adt.type="date"; adt.title="Its day, if it has one";
  var abt=el("button","btn pri","Add");
  function addIt(){ if(ai.value.trim()){ addTodo(t.id, ai.value, adt.value||null, WHERE); ai.value=""; } }
  abt.addEventListener("click",addIt); ai.addEventListener("keydown",function(e){ if(e.key==="Enter") addIt(); });
  ar.appendChild(ai); ar.appendChild(adt); ar.appendChild(abt); stt.appendChild(ar);
  d.appendChild(stt);

  // comment
  var s4=el("div","sec"); s4.appendChild(el("h3","lab","Say something about this"));
  var kind=document.createElement("select");
  ["Update","Meeting","Decision","Ask","New thread"].forEach(function(k){
    var o=document.createElement("option"); o.value=k; o.textContent=k; kind.appendChild(o);
  });
  kind.style.marginBottom="8px"; s4.appendChild(kind);
  var mt=el("div","meetf"); mt.hidden=true;
  var mWho=document.createElement("input"); mWho.type="text"; mWho.placeholder="With whom"; mWho.setAttribute("dir","auto");
  var mDec=document.createElement("textarea"); mDec.placeholder="Decided, one per line"; mDec.setAttribute("dir","auto");
  var mAct=document.createElement("textarea"); mAct.placeholder="Actions, one per line: who does what, by when"; mAct.setAttribute("dir","auto");
  [mWho,mDec,mAct].forEach(function(x){ x.style.marginBottom="8px"; mt.appendChild(x); });
  s4.appendChild(mt);
  kind.addEventListener("change",function(){ mt.hidden = kind.value!=="Meeting"; ta.placeholder = kind.value==="Meeting" ? "Notes" : "What happened, what changed, what you decided. Speak it or type it."; });
  var ta=document.createElement("textarea");
  ta.placeholder="What happened, what changed, what you decided. Speak it or type it.";
  s4.appendChild(ta);
  s4.appendChild(micRow(ta));
  var br=el("div","btnrow");
  var send=withIcon(el("button","btn pri","Send"),"chat");
  send.addEventListener("click",function(){
    var v=ta.value.trim();
    if(kind.value==="Meeting") v=meetingBody(mWho.value.trim(), mDec.value.trim(), mAct.value.trim(), v);
    if(!v) return;
    ta.value=""; mWho.value=""; mDec.value=""; mAct.value=""; comment(t,kind.value,v);
  });
  br.appendChild(send);
  s4.appendChild(br);
  d.appendChild(s4);

  // this thread's open issues
  var mine=issuesFor(t.id);
  if(mine.length){
    var s5=el("div","sec"); s5.appendChild(el("h3","lab","Open on this thread"));
    mine.forEach(function(is){
      var c=el("div","cmt");
      var hh=el("div","h");
      hh.appendChild(el("b","wrapall",is.title));
      hh.appendChild(el("span",null,"#"+is.number+" · "+ago(is.created_at)));
      c.appendChild(hh);
      c.appendChild(el("p","wrapall",(is.body||"").split("\n---\n")[0]));
      var row2=el("div","btnrow");
      var op=withIcon(el("button","btn sm","Open on GitHub"),"ext");
      op.addEventListener("click",function(){ window.open(is.html_url,"_blank","noopener"); });
      var cl=el("button","btn sm warn","Close");
      cl.addEventListener("click",function(){ cl.textContent="Closing…"; closeIssue(is.number).catch(function(e){ note(e.message,"bad"); }); });
      row2.appendChild(op); row2.appendChild(cl);
      c.appendChild(row2);
      s5.appendChild(c);
    });
    d.appendChild(s5);
  }
}

function detailFile(d){
  backBtn(d);
  var f=file;
  var h=el("div","dh"); h.appendChild(el("h2","wrapall",f.path.split("/").pop()));
  d.appendChild(h);
  d.appendChild(el("p","meta mono",f.path));

  if(f.path.indexOf("patents/")===0){
    d.appendChild(el("p","warnbar","Patent files carry title, status and dates only. The invention itself never goes in here: git history is permanent, and outside the United States novelty is absolute with no grace period."));
  }
  if(f.err) d.appendChild(el("p","note bad wrapall",f.err));
  if(f.msg) d.appendChild(el("p","note",f.msg));

  var hs=headingsOf(f.text||"");
  if(hs.length){
    var qa=el("div","sec"); qa.appendChild(el("h3","lab","Add a line"));
    var selh=document.createElement("select");
    hs.forEach(function(x){ var o=document.createElement("option"); o.value=x; o.textContent=x; selh.appendChild(o); });
    selh.style.marginBottom="8px"; qa.appendChild(selh);
    var qt=document.createElement("textarea");
    qt.placeholder="One line. It is added under the section you picked, dated today.";
    qt.style.minHeight="70px";
    qa.appendChild(qt);
    qa.appendChild(micRow(qt));
    var qb=el("div","btnrow");
    var qgo=el("button","btn","Add and save");
    qgo.addEventListener("click",function(){
      var v=qt.value.trim(); if(!v) return;
      f.text=appendUnder(f.text, selh.value, "- "+today()+" — "+v);
      qt.value=""; saveFile();
    });
    qb.appendChild(qgo); qa.appendChild(qb);
    d.appendChild(qa);
  }

  var s=el("div","sec"); s.appendChild(el("h3","lab","The whole file"));
  var ta=document.createElement("textarea"); ta.className="code"; ta.value=f.text||"";
  ta.addEventListener("input",function(){ f.text=ta.value; });
  s.appendChild(ta);
  var row=el("div","btnrow");
  var sv=withIcon(el("button","btn pri","Save to the repository"),"save");
  sv.addEventListener("click",function(){ saveFile(); });
  var rv=el("button","btn","Revert");
  rv.addEventListener("click",function(){ f.text=f.orig; render(); });
  row.appendChild(sv); row.appendChild(rv);
  s.appendChild(row);
  d.appendChild(s);
}

function detailIssue(d,num){
  backBtn(d);
  var is=null; (issues||[]).concat(mine||[]).forEach(function(x){ if(x.number===num && !is) is=x; });
  if(!is){ d.appendChild(el("p","empty","That message is not in the recent list any more.")); return; }
  var stx=msgState(is);
  d.appendChild(el("p","meta",{sent:"\u2713 Sent, not read yet",seen:"\u2713\u2713 Read and answered",filed:"\u2713\u2713 Filed"}[stx]));
  if(replies[is.number] && replies[is.number].text) d.appendChild(el("p","reply wrapall",replies[is.number].text));
  d.appendChild(el("h2","wrapall",is.title));
  d.appendChild(el("p","meta","#"+is.number+" · opened "+ago(is.created_at)+(is.comments?(" · "+is.comments+" repl"+(is.comments===1?"y":"ies")):"")));
  var p=el("p","kv wrapall"); p.style.whiteSpace="pre-wrap"; p.textContent=(is.body||"").replace(/<!--[\s\S]*?-->/g,"").replace(/\*\*/g,"").replace(/^- \[ \] /gm,"\u2610 ").replace(/^- \[[xX]\] /gm,"\u2611 ");
  d.appendChild(p);
  var row=el("div","btnrow");
  var op=el("button","btn","Open on GitHub");
  op.addEventListener("click",function(){ window.open(is.html_url,"_blank","noopener"); });
  var cl=el("button","btn warn","Close it");
  if(is.state==="closed") cl.style.display="none";
  cl.addEventListener("click",function(){ cl.textContent="Closing…";
    closeIssue(is.number).then(function(){ sel={kind:"inbox",id:""}; put(K.sel,sel); render(); })
      .catch(function(e){ note(e.message,"bad"); }); });
  row.appendChild(op); row.appendChild(cl);
  d.appendChild(row);
}

function detailQuestion(d,id){
  backBtn(d);
  var q=null; qList().forEach(function(x,i){ if(x.id===id || String(i)===String(id)) q=x; });
  if(!q){ d.appendChild(el("p","empty","No question there.")); return; }
  d.appendChild(el("p","meta","Question "+qNumber(q)+" of "+qList().length));
  d.appendChild(el("h2","wrapall",q.q));
  if(q.why) d.appendChild(el("p","lead wrapall",q.why));
  if(answers[q.id]) d.appendChild(el("p","kv wrapall","Answered: "+answers[q.id].a+", "+ago(answers[q.id].at)+"."));
  d.appendChild(questionBox(q, false));
  var s=el("div","sec"); s.appendChild(el("h3","lab","Or answer in your own words"));
  var ta=document.createElement("textarea");
  ta.placeholder="Your answer. It is filed as the decision.";
  s.appendChild(ta);
  s.appendChild(micRow(ta));
  var row=el("div","btnrow");
  var go=el("button","btn pri","Send the answer");
  go.addEventListener("click",function(){ var v=ta.value.trim(); if(!v) return; ta.value=""; answerQ(q, v); });
  row.appendChild(go); s.appendChild(row);
  d.appendChild(s);
}
function questionBox(q, compact){
  var box=el("div","qbox"+(compact?" compact":""));
  if(compact) box.appendChild(el("b","wrapall",q.q));
  var row=el("div","qopts");
  (q.opts||[]).forEach(function(op){
    var b=el("button","btn "+(op.say?"":"pri"), op.a);
    b.addEventListener("click",function(){
      if(op.say){ sel={kind:"open",id:q.id}; put(K.sel,sel); document.body.classList.add("detail-open"); render(); return; }
      answerQ(q, op.a);
    });
    row.appendChild(b);
  });
  if(!(q.opts||[]).length){
    var w=el("button","btn pri","Answer in words");
    w.addEventListener("click",function(){ sel={kind:"open",id:q.id}; put(K.sel,sel); document.body.classList.add("detail-open"); render(); });
    row.appendChild(w);
  }
  if(compact && qLeft().length>1){
    var nx=el("button","btn","Not now");
    nx.addEventListener("click",function(){ qSkip++; render(); });
    row.appendChild(nx);
  }
  box.appendChild(row);
  return box;
}

/* ---------- chasing ---------- */
function waitBarEl(t){
  var bar=el("div","wbar");
  bar.style.setProperty("--w", Math.min(100, Math.round(clockDays(t)/(2*chaseAfter(t))*100))+"%");
  bar.style.setProperty("--a",cvar(waitTone(t)));
  bar.appendChild(el("b")); bar.appendChild(el("i"));
  return bar;
}
function chaseRow(t){
  var b=el("button","li"); b.type="button";
  b.setAttribute("aria-current", (sel.kind==="chase"&&sel.id===t.id)?"true":"false");
  b.style.setProperty("--a",cvar(waitTone(t)));
  var r1=el("div","t1");
  r1.appendChild(el("span","sw"));
  r1.appendChild(el("b","wrapall",t.n));
  r1.appendChild(el("span","rt num",clockDays(t)+"/"+chaseAfter(t)+"d"));
  b.appendChild(r1);
  b.appendChild(el("div","t2","With "+cleanWho(t)+(lastChase(t)?(", chased "+fmtDay(lastChase(t))):"")));
  var w=waitBarEl(t); w.style.margin="7px 0 2px 15px"; b.appendChild(w);
  b.addEventListener("click",function(){ sel={kind:"chase",id:t.id}; put(K.sel,sel); selThread=""; document.body.classList.add("detail-open"); render(); });
  return b;
}
function detailChase(d,t){
  backBtn(d);
  if(!t){ d.appendChild(el("p","empty","Nothing to chase there.")); return; }
  d.appendChild(el("p","meta","With "+cleanWho(t)+" since "+fmtDay(t.since)+" · "+waitingDays(t)+" days"+(lastChase(t)?(" · last chased "+fmtDay(lastChase(t))):"")));
  d.appendChild(el("h2","wrapall",t.n));
  var w=waitBarEl(t); w.style.maxWidth="36rem"; w.style.marginTop="14px"; d.appendChild(w);
  d.appendChild(el("p","kv",clockDays(t)+" days on the clock. Chase at "+chaseAfter(t)+", red at "+(2*chaseAfter(t))+"."));
  var s=el("div","sec"); s.appendChild(el("h3","lab","The message, ready to send"));
  var ta=document.createElement("textarea"); ta.className="draft"; ta.value=chaseDraft(t); ta.rows=8; ta.setAttribute("dir","auto");
  s.appendChild(ta);
  if(whoUnsure(t)) s.appendChild(el("p","note bad","The name was heard by voice. Check the spelling before you send."));
  var row=el("div","btnrow");
  var cp=el("button","btn pri","Copy message");
  cp.addEventListener("click",function(){
    copyText(ta.value,function(ok){
      if(ok){ cp.textContent="Copied"; setTimeout(function(){ cp.textContent="Copy message"; },1600); }
      else { ta.focus(); ta.select(); cp.textContent="Selected, press Ctrl+C"; }
    });
  });
  var dn=withIcon(el("button","btn","I have chased"),"check");
  dn.addEventListener("click",function(){ markChased(t); });
  var op=el("button","btn","Open the path");
  op.addEventListener("click",function(){ sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); });
  row.appendChild(cp); row.appendChild(dn); row.appendChild(op);
  s.appendChild(row);
  d.appendChild(s);
}

/* ---------- one look: everything on one screen ----------
   Goals as tiles you can count, today and its one question, what is out of
   your hands, the week as a strip, the review, and your last messages. Every
   card opens the screen that owns it. */
function lookCard(grid, title, sub, go, span){
  var c=el("section","lcard"+(span?" span"+span:""));
  var h=el("div","lch");
  h.appendChild(el("h3","lab",title));
  if(sub) h.appendChild(el("span","lcs",sub));
  if(go){ var a=el("button","lgo","Open →"); a.addEventListener("click",go); h.appendChild(a); }
  c.appendChild(h); grid.appendChild(c);
  return c;
}
function goTo(kind,id){ return function(){ sel={kind:kind,id:id||""}; put(K.sel,sel); selThread=""; file=null; render(); }; }
function weekDate(n){ var x=new Date(); x.setDate(x.getDate()+(n-x.getDay())); return x.getFullYear()+"-"+("0"+(x.getMonth()+1)).slice(-2)+"-"+("0"+x.getDate()).slice(-2); }
var DSCLS={box:"qbox compact sugg", kicker:"lab", text:"wrapall sgt", check:"achk", row:"qopts", pri:"btn pri", btn:"btn"};
function todoRowD(td, hideThread){
  var t=td.thread?T(td.thread):null;
  var r=el("div","todo"); r.style.setProperty("--a",cvar(t?t.c:"--neutral"));
  var c=el("button","tick"); c.type="button"; c.title="Mark done";
  c.addEventListener("click",function(){ c.classList.add("on"); setTimeout(function(){ doneTodo(td.id); },200); });
  r.appendChild(c);
  var tx=el("span","tt"); tx.appendChild(el("b","wrapall",td.text));
  var sub=[hideThread?"":(t?t.n:""), todoWhen(td)].filter(Boolean).join(" \u00b7 ");
  if(sub) tx.appendChild(el("span","wrapall"+(td.due&&td.due<localDay()?" late":""),sub));
  r.appendChild(tx);
  return r;
}
function linkBox(u){
  var box=el("div","qbox compact");
  box.appendChild(el("b","wrapall","Folder \u201C"+u.folder+"\u201D, "+dur(u.min)+" in "+u.n+" session"+(u.n===1?"":"s")+". Which project?"));
  var row=el("div","qopts");
  u.cand.slice(0,3).forEach(function(id){
    var t=T(id); if(!t) return;
    var b=el("button","btn pri",t.n); b.addEventListener("click",function(){ linkFolder(u.folder,id); }); row.appendChild(b);
  });
  var sel2=document.createElement("select");
  var o0=el("option",null,"Another project\u2026"); o0.value=""; sel2.appendChild(o0);
  domains().forEach(function(d){
    var ts=threadsIn(d.id); if(!ts.length) return;
    var gpp=document.createElement("optgroup"); gpp.label=d.n;
    ts.forEach(function(t){ var o=el("option",null,t.n); o.value=t.id; gpp.appendChild(o); });
    sel2.appendChild(gpp);
  });
  sel2.addEventListener("change",function(){ if(sel2.value) linkFolder(u.folder, sel2.value); });
  sel2.style.maxWidth="15rem";
  row.appendChild(sel2);
  var no=el("button","btn","Not a project"); no.addEventListener("click",function(){ linkFolder(u.folder,null); }); row.appendChild(no);
  box.appendChild(row);
  return box;
}
function detailLook(d){
  if(!connected()){
    d.appendChild(el("h2",null,"One look"));
    var s0=el("div","sec"); startPath(s0,"Connect the repository and everything appears here on one screen."); d.appendChild(s0);
    return;
  }
  var hd=el("div","lookh");
  hd.appendChild(el("h2",null,"One look"));
  hd.appendChild(el("span","meta",FULL[new Date().getDay()]+" "+fmtDay(today())+" · board "+(board.updated||"")));
  d.appendChild(hd);
  if(board.headline) d.appendChild(el("p","lead wrapall",board.headline));
  var g=el("div","lookgrid"); d.appendChild(g);

  var gl=(board.goals||[]).filter(function(x){ return x.target; });
  if(gl.length){
    var c1=lookCard(g,"Goals","tap a tile",goTo("goals"),2);
    var gg=el("div","ggrid"); c1.appendChild(gg);
    gl.forEach(function(goal){
      var gs=goalSlots(goal);
      var row=el("div","grow2"); row.style.setProperty("--a",cvar(goal.c));
      if(gs.target>5) row.style.gridColumn="1 / -1";
      var top=el("div","gtop");
      top.appendChild(el("b","wrapall",goal.n));
      top.appendChild(el("span","gnum num",gs.filled+"/"+gs.target));
      row.appendChild(top);
      var tiles=el("div","slots"); tiles.style.gridTemplateColumns="repeat("+Math.min(gs.target,10)+",minmax(0,1fr))";
      gs.tiles.forEach(function(tl){
        var b=el(tl.t?"button":"div","slot "+tl.s); b.title=tl.t?tl.t.n:tl.label;
        b.appendChild(el("span",null,tl.label));
        if(tl.t) b.addEventListener("click",function(){ sel={kind:"domain",id:tl.t.dom}; put(K.sel,sel); openThread(tl.t.id); });
        tiles.appendChild(b);
      });
      row.appendChild(tiles);
      if(gs.pace) row.appendChild(el("p","pace",gs.pace));
      gg.appendChild(row);
    });
  }

  var c2=lookCard(g,"Today", FULL[new Date().getDay()], goTo("today"));
  var cur=curBlock(), nx=nextBlock();
  c2.appendChild(el("p","big wrapall", runIds().length ? ("Running: "+runIds().map(function(id){ var x=T(id); return x?x.n:id; }).join(", "))
    : cur ? (cur.b[1]+", until "+hm(cur.b[5])) : (nx ? ("Next: "+nx[1]+" at "+hm(nx[4])) : "Nothing else scheduled today.")));
  var bk={overdue:0,today:0}; board.threads.forEach(function(t){ var b=bucketOf(t); if(bk[b]!=null) bk[b]++; });
  var mini=el("div","mini");
  function mc(v,l,tone){ var x=el("div","mc"); var bb=el("b","num",v); if(tone) bb.style.color=cvar(tone); x.appendChild(bb); x.appendChild(el("span","lab",l)); mini.appendChild(x); }
  var ch=board.threads.filter(needsChase).length;
  mc(String(ch),"to chase", ch?"--hot":null); mc(String(bk.overdue),"late", bk.overdue?"--bad":null);
  mc(String(bk.today),"on today"); mc(String(qLeft().length),"questions left");
  c2.appendChild(mini);
  var tq=todaysQuestion();
  if(tq){ c2.appendChild(el("div","lab","One question, "+qNumber(tq)+" of "+qList().length)); c2.appendChild(questionBox(tq,true)); }

  var ws=waitList().sort(function(a,b){ return clockDays(b)/chaseAfter(b)-clockDays(a)/chaseAfter(a); });
  if(ws.length){
    var c3=lookCard(g,"Out of your hands", ws.filter(needsChase).length+" to chase");
    ws.forEach(function(t){ c3.appendChild(chaseRow(t)); });
  }

  var c4=lookCard(g,"The week", null, goTo("week"));
  var strip=el("div","wstrip"), td=new Date().getDay(), holes=0, given=0;
  for(var di=0;di<7;di++){
    var col=el("div","wcol"+(di===td?" today":""));
    col.appendChild(el("span","wd",DAYS[di]));
    var dsx=weekDate(di);
    (board.week[di]||[]).forEach(function(b,ix){
      if(b[5]<=b[4]) return;
      var who=b[6]?planned(dsx,ix):"", th=who?T(who):null;
      var cell=el("button", b[6]?(th?"on":"hole"):"fixed"); cell.type="button";
      var hrs=Math.max(1,Math.round((b[5]-b[4])/60));
      cell.style.flexGrow=String(hrs);
      cell.title=b[0]+" "+b[1]+(th?(": "+th.n):(b[6]?": nothing on it":""));
      if(hrs>=2) cell.appendChild(el("span",null,th?th.n:b[1]));
      (function(dd,ii,bb){ cell.addEventListener("click",function(){ blockModal(dd,ii,bb); }); })(di,ix,b);
      if(th){ cell.style.background=cvar(th.c); given++; } else if(b[6]) holes++;
      else cell.style.setProperty("--a",cvar(b[3]));
      col.appendChild(cell);
    });
    strip.appendChild(col);
  }
  c4.appendChild(strip);
  c4.appendChild(el("p","note",given+" working blocks have a thread, "+holes+" are empty. Striped means empty; faint is teaching and fixed time."));

  var dr=drifting(), a=weekHours();
  var c5=lookCard(g,"Saturday review", dr.length+" drifting", goTo("review"));
  c5.appendChild(el("p","kv wrapall", dr.length ? (dr.length+" threads have no day, no hours and nobody holding them. Four keys settle each one.") : "Nothing is drifting."));
  if(dr.length){ var rb=el("button","btn pri","Start the review"); rb.addEventListener("click",goTo("review")); c5.appendChild(rb); }
  var hrs=el("div","mini"); hrs.style.marginTop="14px";
  var h1=el("div","mc"); h1.appendChild(el("b","num",a>=1?dur(a*60):"0m")); h1.appendChild(el("span","lab","tracked of 40h")); hrs.appendChild(h1);
  var mv=el("div","mc"); mv.appendChild(el("b","num",String(movedThisWeek().length))); mv.appendChild(el("span","lab","moves this week")); hrs.appendChild(mv);
  c5.appendChild(hrs);

  var c7=lookCard(g,"Desktop work", "Claude Code, 7 days");
  unlinked.slice(0,4).forEach(function(u){ c7.appendChild(linkBox(u)); });
  if(!deskWeek.n) c7.appendChild(el("p","note","No desktop sessions recorded yet. The hook records one line each time a Claude Code session on the PC ends."));
  else {
    c7.appendChild(el("p","big",dur(deskWeek.min)+" worked"));
    var dm2=el("div","mini");
    [[String(deskWeek.n),"sessions"],[fmtTok(deskWeek.tok),"tokens"]].forEach(function(x){ var c=el("div","mc"); c.appendChild(el("b","num",x[0])); c.appendChild(el("span","lab",x[1])); dm2.appendChild(c); });
    c7.appendChild(dm2);
    deskRows().slice(0,5).forEach(function(x){
      var b=el(x.t?"button":"div","li"); if(x.t) b.type="button";
      b.style.setProperty("--a",cvar(x.t?x.t.c:"--neutral"));
      var r1=el("div","t1"); r1.appendChild(el("span","sw")); r1.appendChild(el("b","wrapall",x.name)); r1.appendChild(el("span","rt num",dur(x.m)));
      b.appendChild(r1);
      if(x.t) b.addEventListener("click",function(){ sel={kind:"domain",id:x.t.dom}; put(K.sel,sel); openThread(x.t.id); });
      c7.appendChild(b);
    });
  }

  var tdl=openTodos();
  var c8=lookCard(g,"To do", tdl.length?(tdl.length+" open"):"nothing open", goTo("today"));
  openSuggestions().slice(0,2).forEach(function(sg){ c8.appendChild(suggestionCard(sg, DSCLS)); });
  if(!tdl.length) c8.appendChild(el("p","note","Nothing on the list. To-dos come from your messages, or add one on any path."));
  tdl.slice(0,7).forEach(function(td){ c8.appendChild(todoRowD(td)); });

  var c6=lookCard(g,"Your messages", null, goTo("inbox"));
  if(!mine){ c6.appendChild(el("p","note","Loading.")); if(!loadingMine){ loadingMine=true; loadMine(true).then(function(){ loadingMine=false; render(); }); } }
  else if(!mine.length) c6.appendChild(el("p","note","Nothing sent yet."));
  else mine.slice(0,6).forEach(function(x){ c6.appendChild(msgRow(x)); });
}
var loadingMine=false;
function msgRow(x){
  var st=msgState(x);
  var b=el("button","li msg"); b.type="button";
  b.setAttribute("aria-current", (sel.kind==="inbox"&&sel.id===String(x.number))?"true":"false");
  var r1=el("div","t1");
  r1.appendChild(el("b","wrapall",x.title));
  var tk=el("span","tk "+st, st==="sent"?"✓":"✓✓");
  tk.title={sent:"Sent",seen:"Read and answered",filed:"Filed"}[st];
  r1.appendChild(tk);
  b.appendChild(r1);
  var rp=replies[x.number];
  b.appendChild(el("div","t2 wrapall", ago(x.created_at)+" · "+((rp&&rp.text)?((st==="filed"?"Filed: ":"Reply: ")+rp.text):({sent:"Sent, not read yet",seen:"Read",filed:"Filed"}[st]))));
  b.addEventListener("click",function(){ sel={kind:"inbox",id:String(x.number)}; put(K.sel,sel);
    document.body.classList.add("detail-open"); render(); });
  return b;
}

/* ---------- command palette ---------- */
function openPalette(){
  palette={q:"", ix:0};
  drawPalette();
}
function paletteItems(){
  var out=[], cur=curBlock(), openT=selThread?T(selThread):null;
  board.threads.forEach(function(t){
    out.push({label:"The path: "+t.n, hint:domOf(t).n, c:t.c||domOf(t).c, run:function(){
      sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); }});
  });
  if(openT && !isUnset(openT) && stageIx(openT)<stageCount(openT)-1){
    out.push({label:"Advance stage of "+openT.n, hint:"stage", c:openT.c||domOf(openT).c,
      run:function(){ setStage(openT, Math.min(stageCount(openT)-1, stageIx(openT)+1)); }});
  }
  if(cur && cur.b[6] && cur.b[5]>cur.b[4]){
    board.threads.forEach(function(t){
      out.push({label:"Assign current block to "+t.n, hint:"assign", c:t.c||domOf(t).c,
        run:function(){ assign(today(), cur.i, t.id); }});
    });
  }
  domains().forEach(function(d){
    out.push({label:d.n, hint:"category", c:d.c, run:function(){ pick("domain",d.id); }});
  });
  [["Today","today"],["Weekly review","review"],["The week","week"],["Inbox","inbox"],["The map","goals"],
   ["Waiting on you","open"],["Files","files"]].forEach(function(p){
    out.push({label:p[0], hint:"view", c:"", run:function(){ pick(p[1],""); }});
  });
  out.push({label:"Settings", hint:"connection", c:"", run:function(){ settings(); }});
  openTodos().forEach(function(td){
    var t=td.thread?T(td.thread):null;
    out.push({label:"To do: "+td.text, hint:t?t.n:"to-do", c:t?t.c:"", run:function(){ if(t){ sel={kind:"domain",id:t.dom}; put(K.sel,sel); openThread(t.id); } else pick("today",""); }});
  });
  (mine||[]).forEach(function(x){
    out.push({label:"Message: "+x.title+" "+firstLine(x.body), hint:msgState(x), c:"", run:function(){ sel={kind:"inbox",id:String(x.number)}; put(K.sel,sel); document.body.classList.add("detail-open"); render(); }});
  });
  board.threads.forEach(function(t){
    (t.files||[]).forEach(function(p){
      out.push({label:p, hint:"file", c:t.c, run:function(){ selThread=t.id; openFile(p); }});
    });
  });
  return out;
}
function drawPalette(){
  var h=$("modal");
  if(!palette){ h.innerHTML=""; return; }
  var q=palette.q.toLowerCase();
  var items=paletteItems().filter(function(x){ return !q || x.label.toLowerCase().indexOf(q)!==-1
    || (x.hint||"").toLowerCase().indexOf(q)!==-1; }).slice(0,40);
  if(palette.ix>=items.length) palette.ix=Math.max(0,items.length-1);
  h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov){ palette=null; drawPalette(); } });
  var cd=el("div","cd");
  var inp=document.createElement("input"); inp.type="text"; inp.id="pq";
  inp.placeholder="Jump to a thread, a category, a file";
  inp.value=palette.q; inp.autocomplete="off";
  inp.addEventListener("input",function(){ palette.q=inp.value; palette.ix=0; drawPalette(); });
  inp.addEventListener("keydown",function(e){
    if(e.key==="ArrowDown"){ e.preventDefault(); palette.ix++; drawPalette(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); palette.ix=Math.max(0,palette.ix-1); drawPalette(); }
    else if(e.key==="Enter"){ e.preventDefault(); var it=items[palette.ix]; if(it){ palette=null; h.innerHTML=""; it.run(); } }
    else if(e.key==="Escape"){ palette=null; drawPalette(); }
  });
  cd.appendChild(inp);
  var box=el("div"); box.style.marginTop="10px";
  items.forEach(function(it,i){
    var b=el("button","pl"+(i===palette.ix?" sel":"")); b.type="button";
    if(it.c) b.style.setProperty("--a",cvar(it.c));
    var sw=el("span","sw"); if(!it.c) sw.style.background="transparent";
    b.appendChild(sw);
    b.appendChild(el("span","nm",it.label));
    b.appendChild(el("span","hint",it.hint||""));
    b.addEventListener("click",function(){ palette=null; h.innerHTML=""; it.run(); });
    box.appendChild(b);
  });
  if(!items.length) box.appendChild(el("p","empty","Nothing matches."));
  cd.appendChild(box);
  ov.appendChild(cd); h.appendChild(ov);
  setTimeout(function(){ var e=$("pq"); if(e) e.focus(); },0);
}

/* ---------- settings ---------- */
function settings(){
  var h=$("modal"); h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov) h.innerHTML=""; });
  var cd=el("div","cd");
  cd.appendChild(el("h3","lab","Settings"));

  cd.appendChild(el("h3","lab","Repository"));
  var rin=document.createElement("input"); rin.type="text"; rin.value=REPO();
  rin.placeholder="owner/name"; rin.autocomplete="off"; rin.spellcheck=false;
  cd.appendChild(rin);
  cd.appendChild(el("h3","lab","GitHub token"));
  var tin=document.createElement("input"); tin.type="password";
  tin.placeholder=token?"Saved. Paste a new one to replace it.":"github_pat_…";
  tin.autocomplete="off"; tin.spellcheck=false;
  cd.appendChild(tin);
  var st=el("p","note",(token&&REPO())?("Connected to "+REPO()+"."):"Not connected.");
  cd.appendChild(st);

  var row=el("div","btnrow");
  var save=el("button","btn pri","Save and test");
  save.addEventListener("click",function(){
    var rv=rin.value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
    if(rv) putRaw(K.repo,rv);
    var v=tin.value.trim();
    if(v){ token=v; put(K.tok,v); tin.value=""; }
    st.textContent="Testing…"; st.className="note";
    gh("/issues?per_page=1").then(function(){ return sync(); }).then(function(){
      st.textContent="Connected. Everything synced."; st.className="note ok";
    }).catch(function(e){ st.textContent=e.message; st.className="note bad"; });
  });
  var out=el("button","btn warn","Forget token");
  out.addEventListener("click",function(){
    token=""; del(K.tok); issues=null;
    st.textContent="Token removed from this browser."; st.className="note"; render();
  });
  var done=el("button","btn","Done");
  done.addEventListener("click",function(){ h.innerHTML=""; });
  row.appendChild(save); row.appendChild(out); row.appendChild(done);
  cd.appendChild(row);
  cd.appendChild(el("p","note","Make the token at github.com, Settings, Developer settings, Personal access tokens, Fine-grained. Give it that one repository, with Contents and Issues set to read and write. Nothing else. It is stored in this browser alone and sent only to api.github.com."));

  cd.appendChild(el("h3","lab","Notifications"));
  var pn=el("div"); pushPanel(pn,"btn pri","note"); cd.appendChild(pn);

  cd.appendChild(el("h3","lab","This copy"));
  cd.appendChild(el("p","note","Version "+BUILD+". It checks for a newer one each time it opens."));
  var fu=el("button","btn","Force update");
  fu.addEventListener("click",function(){
    fu.textContent="Clearing…";
    try{ sessionStorage.removeItem("planner.repair"); }catch(e){}
    repairInstall();
  });
  cd.appendChild(fu);
  ov.appendChild(cd); h.appendChild(ov);
}

/* ---------- keeping itself current ---------- */
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
function checkForUpdate(){
  if(!window.fetch) return;
  fetch("version.json?t="+Date.now(), {cache:"no-store"})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(j){
      if(!j || !j.build || j.build===BUILD) return;
      var tries=0;
      try{ tries=parseInt(sessionStorage.getItem("planner.repair")||"0",10)||0; }catch(e){}
      if(tries>=2){ note("update waiting, settings has Force update"); return; }
      try{ sessionStorage.setItem("planner.repair",String(tries+1)); }catch(e){}
      note("updating to "+j.build);
      repairInstall();
    })
    .catch(function(){});
}

/* ---------- boot ---------- */
(function(){ var t=getRaw(K.theme); if(t) document.documentElement.setAttribute("data-theme",t); })();

withIcon($("palette"),"search"); withIcon($("refresh"),"refresh"); withIcon($("gear"),"settings");
$("gear").addEventListener("click",settings);
$("refresh").addEventListener("click",function(){ sync(); });
$("palette").addEventListener("click",openPalette);
$("theme").addEventListener("click",function(){
  // with no attribute set the page follows the system, so read what is actually on screen
  var cur=document.documentElement.getAttribute("data-theme");
  if(!cur){
    var dark=false;
    try{ dark=window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }catch(e){}
    cur = dark ? "dark" : "light";
  }
  var next=cur==="dark"?"light":"dark";
  document.documentElement.setAttribute("data-theme",next); putRaw(K.theme,next);
});
document.addEventListener("keydown",function(e){
  var typing = e.target && (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT");
  if((e.metaKey||e.ctrlKey) && (e.key==="k"||e.key==="K")){ e.preventDefault(); openPalette(); return; }
  if(e.key==="Escape"){ palette=null; $("modal").innerHTML=""; return; }
  if(typing) return;
  if(e.key==="/"){ e.preventDefault(); openPalette(); }
  if(e.key==="r") sync();
  if(sel.kind==="review" && !selThread && !file){
    var dir={ArrowLeft:"drop",ArrowRight:"start",ArrowUp:"day",ArrowDown:"delay"}[e.key];
    var dl=dir?drifting():[];
    if(dir && dl.length){ e.preventDefault(); reviewDecide(dl[0],dir); render(); return; }
  }
  if((e.key==="[" || e.key==="]") && !file && selThread){
    var t=T(selThread);
    if(t && stageCount(t)){
      var ix=stageIx(t);
      var nx=e.key==="]" ? Math.min(stageCount(t)-1, ix+1) : Math.max(0, ix-1);
      if(nx!==ix || isUnset(t)){ e.preventDefault(); setStage(t,nx); }
    }
  }
});

render();
if(connected()) sync(); else paintState();
checkForUpdate();
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible") checkForUpdate();
});

setInterval(function(){
  paintState();
  safe(paintRail);
  if(sel.kind==="today") safe(paintList);
}, 20000);
setInterval(function(){ if(token&&REPO()&&!busy&&!file) sync(); }, 300000);
window.addEventListener("focus",function(){ if(token&&REPO()&&!busy&&!file&&Date.now()-lastSync>60000) sync(); });

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
}
})();
