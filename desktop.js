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

var BUILD = "2026-09-15.1";   // bumped on every publish, checked against version.json
var K = { tok:"planner.token", repo:"planner.repo", board:"planner.board",
          mins:"planner.mins", queue:"planner.queue", theme:"planner.theme",
          running:"planner.running", sel:"planner.sel" };

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
var recent  = [];
var issues  = null, issuesErr = "";
var lastSync = 0, busy = false, stateMsg = "";
var sel     = get(K.sel, null) || {kind:"today", id:""};
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
function liveMins(id){ return (mins[id]||0) + (isOn(id) ? (Date.now()-running[id])/60000 : 0); }
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
    if(j && j.threads && j.week){ board=j; put(K.board,j); }
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

function loadIssues(){
  return gh("/issues?state=open&per_page=60&sort=created&direction=desc").then(function(r){
    issues=(r||[]).filter(function(x){ return !x.pull_request; }); issuesErr="";
  }).catch(function(e){ issuesErr=e.message; });
}

function flushQueue(){
  if(!token || !queue.length) return Promise.resolve();
  var item=queue[0], p;
  if(item.kind==="log")       p=appendLine("data/log.jsonl", item.line, "Session log");
  else if(item.kind==="status") p=appendLine("data/status.jsonl", item.line, "Stage set from the desktop");
  else if(item.kind==="plan")   p=appendLine("data/plan.jsonl", item.line, "Day assigned from the desktop");
  else                        p=gh("/issues", {method:"POST", body:{title:item.title, body:item.body}});
  return p.then(function(){
    queue.shift(); put(K.queue,queue);
    return queue.length ? flushQueue() : null;
  }).catch(function(){ /* stays queued */ });
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
    .then(pullBoard).then(pullStatus).then(pullPlan).then(pullLog).then(loadIssues)
    .then(function(){ busy=false; lastSync=Date.now(); stateMsg=""; render(); })
    .catch(function(e){ busy=false; note(e.message,"bad"); render(); });
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
function start(id){
  if(isOn(id)) return;
  running[id]=Date.now(); put(K.running,running); render();
}
function stop(id){
  if(!isOn(id)) return;
  var at=running[id], m=Math.round((Date.now()-at)/60000);
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
  item("today","","Today",null, runIds().length||null, runIds().length>0, "clock");
  item("week","","The week",null,null,false,"calendar");

  r.appendChild(el("div","railh lab","Categories"));
  domains().forEach(function(d){
    var ts=threadsIn(d.id);
    var liveN=ts.filter(function(t){ return isOn(t.id); }).length;
    item("domain",d.id,d.n,d.c,ts.length,liveN>0);
  });

  r.appendChild(el("div","railh lab","Everything else"));
  item("inbox","","Inbox",null, issues?issues.length:null, issues&&issues.length>0, "inbox");
  item("goals","","The map",null,board.threads.length||null,false,"target");
  item("open","","Waiting on you",null,(board.open||[]).length,false,"help");
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
    if(!ts.length){ n.appendChild(emptyState("layers","No path in this category yet.")); return; }
    ts.forEach(function(t){ threadRow(n,t); });
    return;
  }
  if(sel.kind==="today")  return listToday(n);
  if(sel.kind==="week")   return listWeek(n);
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
  listHead(n,"Inbox", issues?(issues.length+" open"):"");
  if(issuesErr){ n.appendChild(el("p","note bad wrapall",issuesErr)); return; }
  if(!issues){ n.appendChild(emptyState("inbox", connected()?"Loading.":"Connect the repository and the inbox fills.")); return; }
  if(!issues.length){ n.appendChild(emptyState("check","Nothing open. Everything you sent has been acted on and closed.")); return; }
  issues.forEach(function(is){
    var b=el("button","li"); b.type="button";
    var r1=el("div","t1");
    r1.appendChild(el("span","sw"));
    r1.appendChild(el("b","wrapall",is.title));
    r1.appendChild(el("span","rt","#"+is.number));
    b.appendChild(r1);
    b.appendChild(el("div","t2", ago(is.created_at)+" · "+(is.body||"").replace(/\s+/g," ").slice(0,90)));
    b.addEventListener("click",function(){ sel={kind:"inbox",id:String(is.number)}; put(K.sel,sel);
      document.body.classList.add("detail-open"); render(); });
    n.appendChild(b);
  });
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
  var q=board.open||[];
  listHead(n,"Waiting on you", q.length?(q.length+" questions"):"nothing");
  if(!q.length){ n.appendChild(emptyState("check","Nothing is waiting on a decision. The road ahead is yours.")); return; }
  q.forEach(function(x,i){
    var b=el("button","li"); b.type="button";
    var r1=el("div","t1"); r1.appendChild(el("span","sw"));
    r1.appendChild(el("b","wrapall",x)); r1.appendChild(el("span","rt",String(i+1)));
    b.appendChild(r1);
    b.appendChild(el("div","t2","Answer it and it becomes a decision"));
    b.addEventListener("click",function(){ sel={kind:"open",id:String(i)}; put(K.sel,sel);
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
  if(sel.kind==="inbox" && sel.id) return detailIssue(d, Number(sel.id));
  if(sel.kind==="open" && sel.id!=="") return detailQuestion(d, Number(sel.id));
  var t=selThread?T(selThread):null;
  if(!t){
    if(sel.kind==="today") return detailToday(d);
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

  var q=board.open||[];
  if(q.length){
    var s3=el("div","sec"); s3.appendChild(el("h3","lab","Waiting on you, "+q.length));
    q.slice(0,3).forEach(function(x,i){
      var r=el("div","file");
      var nb=el("span","num",String(i+1));
      nb.style.cssText="flex:none;width:18px;color:var(--faint);font-size:12px";
      r.appendChild(nb);
      r.appendChild(el("span","p wrapall",x));
      var b=el("button","btn sm","Answer");
      b.addEventListener("click",function(){ sel={kind:"open",id:String(i)}; put(K.sel,sel);
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

  // comment
  var s4=el("div","sec"); s4.appendChild(el("h3","lab","Say something about this"));
  var kind=document.createElement("select");
  ["Update","Decision","Ask","New thread"].forEach(function(k){
    var o=document.createElement("option"); o.value=k; o.textContent=k; kind.appendChild(o);
  });
  kind.style.marginBottom="8px"; s4.appendChild(kind);
  var ta=document.createElement("textarea");
  ta.placeholder="What happened, what changed, what you decided. Dictation key works here.";
  s4.appendChild(ta);
  var br=el("div","btnrow");
  var send=withIcon(el("button","btn pri","Send"),"chat");
  send.addEventListener("click",function(){
    var v=ta.value.trim(); if(!v) return;
    ta.value=""; comment(t,kind.value,v);
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
  var is=null; (issues||[]).forEach(function(x){ if(x.number===num) is=x; });
  if(!is){ d.appendChild(el("p","empty","That issue is not in the open list any more.")); return; }
  d.appendChild(el("h2","wrapall",is.title));
  d.appendChild(el("p","meta","#"+is.number+" · opened "+ago(is.created_at)+(is.comments?(" · "+is.comments+" repl"+(is.comments===1?"y":"ies")):"")));
  var p=el("p","kv wrapall"); p.style.whiteSpace="pre-wrap"; p.textContent=is.body||"";
  d.appendChild(p);
  var row=el("div","btnrow");
  var op=el("button","btn","Open on GitHub");
  op.addEventListener("click",function(){ window.open(is.html_url,"_blank","noopener"); });
  var cl=el("button","btn warn","Close it");
  cl.addEventListener("click",function(){ cl.textContent="Closing…";
    closeIssue(is.number).then(function(){ sel={kind:"inbox",id:""}; put(K.sel,sel); render(); })
      .catch(function(e){ note(e.message,"bad"); }); });
  row.appendChild(op); row.appendChild(cl);
  d.appendChild(row);
}

function detailQuestion(d,ix){
  backBtn(d);
  var q=(board.open||[])[ix];
  if(!q){ d.appendChild(el("p","empty","No question there.")); return; }
  d.appendChild(el("h2","wrapall",q));
  d.appendChild(el("p","meta","Waiting on you"));
  var s=el("div","sec"); s.appendChild(el("h3","lab","Answer it"));
  var ta=document.createElement("textarea");
  ta.placeholder="Your answer. It goes in as a decision and Claude files it.";
  s.appendChild(ta);
  var row=el("div","btnrow");
  var go=el("button","btn pri","Send the decision");
  go.addEventListener("click",function(){
    var v=ta.value.trim(); if(!v) return;
    queue.push({kind:"issue", title:"Decision",
      body:v+"\n\n---\nAnswering: "+q+"\nSent from the Planner desktop, "+new Date().toISOString()+"."});
    put(K.queue,queue); ta.value=""; note("Sending…");
    flushQueue().then(loadIssues).then(function(){ stateMsg="Sent."; render(); })
      .catch(function(e){ note(e.message,"bad"); });
  });
  row.appendChild(go); s.appendChild(row);
  d.appendChild(s);
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
  [["Today","today"],["The week","week"],["Inbox","inbox"],["The map","goals"],
   ["Waiting on you","open"],["Files","files"]].forEach(function(p){
    out.push({label:p[0], hint:"view", c:"", run:function(){ pick(p[1],""); }});
  });
  out.push({label:"Settings", hint:"connection", c:"", run:function(){ settings(); }});
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
