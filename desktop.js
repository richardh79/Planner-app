/* Planner, desktop view.
   Same repository, same token, same board.json as the phone app. No server.
   Everything the phone shows one tap at a time is on one surface here. */
(function(){
"use strict";

var K = { tok:"planner.token", repo:"planner.repo", board:"planner.board",
          mins:"planner.mins", queue:"planner.queue", theme:"planner.theme",
          running:"planner.running" };

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
function days(iso){ return Math.floor((Date.now()-new Date(iso).getTime())/864e5); }
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
function safe(f){ try{ f(); }catch(e){ note("Render failed: "+(e&&e.message?e.message:e), "bad"); } }

var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var DEFAULT = { updated:"", headline:"Not connected. Open settings, add the repository and a token.",
                apex:"", goals:[], events:[], threads:[], week:[[],[],[],[],[],[],[]], open:[] };

/* ---------- state ---------- */
var board   = get(K.board, null) || DEFAULT;
var token   = get(K.tok, "");
var mins    = get(K.mins, {});
var running = get(K.running, {});
var queue   = get(K.queue, []);
var recent  = [];
var issues  = null, issuesErr = "";
var lastSync = 0, busy = false, stateMsg = "";
var openIssue = null;

function T(id){ for(var i=0;i<board.threads.length;i++) if(board.threads[i].id===id) return board.threads[i]; return null; }
function isOn(id){ return Object.prototype.hasOwnProperty.call(running,id); }
function runIds(){ return Object.keys(running); }
function colour(t){ return "var(" + ((t&&t.c)||"--neutral") + ")"; }

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
          throw new Error(m);
        }
        return j;
      });
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
    if(!r||!r.content){ recent=[]; return; }
    var cut=Date.now()-7*864e5, acc={}, all=[];
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.thread||!o.start) return;
      if(!(o.minutes>0) || o.minutes>720) return;   // over twelve hours means the timer was left running
      all.push(o);
      if(new Date(o.start).getTime()>=cut) acc[o.thread]=(acc[o.thread]||0)+o.minutes;
    });
    all.sort(function(a,b){ return new Date(b.start)-new Date(a.start); });
    recent = all.slice(0,14);
    mins = acc; put(K.mins,mins);
  });
}

function appendLog(line){
  return gh("/contents/data/log.jsonl", {soft404:true}).then(function(r){
    var body = r&&r.content ? b64d(r.content) : "";
    if(body && body.slice(-1)!=="\n") body += "\n";
    var payload = { message:"Session log", content:b64e(body + line + "\n") };
    if(r&&r.sha) payload.sha=r.sha;
    return gh("/contents/data/log.jsonl", {method:"PUT", body:payload});
  });
}

function flushQueue(){
  if(!token || !queue.length) return Promise.resolve();
  var item = queue[0];
  var p = item.kind==="log" ? appendLog(item.line)
        : gh("/issues", {method:"POST", body:{title:item.title, body:item.body}});
  return p.then(function(){
    queue.shift(); put(K.queue,queue);
    return queue.length ? flushQueue() : null;
  }).catch(function(){ /* stays queued */ });
}

function loadIssues(){
  return gh("/issues?state=open&per_page=30&sort=created&direction=desc").then(function(r){
    issues=(r||[]).filter(function(x){ return !x.pull_request; }); issuesErr="";
  }).catch(function(e){ issuesErr=e.message; });
}

/* ---------- sync ---------- */
function note(msg,cls){ stateMsg=msg; paintState(cls||""); }

function paintState(cls){
  var d=$("dot"), s=$("stateTxt");
  if(!d||!s) return;
  d.className = "dot" + (cls==="bad"?" bad":(busy?" busy":(token&&REPO()?" ok":"")));
  var bits=[];
  if(REPO()) bits.push(REPO());
  if(!token) bits.push("no token");
  if(stateMsg) bits.push(stateMsg);
  else if(lastSync) bits.push("synced "+hm(new Date(lastSync).getHours()*60+new Date(lastSync).getMinutes()));
  if(queue.length) bits.push(queue.length+" queued");
  s.textContent = bits.join(" · ") || "Not connected";
}

function sync(){
  if(!token || !REPO()){ note("Open settings and connect"); render(); return Promise.resolve(); }
  busy=true; note("Syncing…");
  return flushQueue()
    .then(pullBoard).then(pullLog).then(loadIssues)
    .then(function(){ busy=false; lastSync=Date.now(); stateMsg=""; render(); })
    .catch(function(e){ busy=false; note(e.message,"bad"); render(); });
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
function suggested(){
  for(var i=0;i<board.threads.length;i++){ var x=board.threads[i]; if(x.tag==="Phase 1" && x.at<2) return x; }
  return board.threads[0]||null;
}
function liveMins(id){ return (mins[id]||0) + (isOn(id) ? (Date.now()-running[id])/60000 : 0); }
function weekMins(){ var s=0; for(var k in mins) if(mins.hasOwnProperty(k)) s+=mins[k];
  runIds().forEach(function(id){ s+=(Date.now()-running[id])/60000; }); return s; }

/* ---------- timers ---------- */
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
    put(K.queue,queue);
    render();
    flushQueue().then(function(){ return pullLog(); }).then(render).catch(function(){ render(); });
    return;
  }
  render();
}

/* ---------- render ---------- */
function render(){
  safe(paintClock); safe(stats); safe(nowCard); safe(threadsCard); safe(weekCard);
  safe(activityCard); safe(inboxCard); safe(sayCard); safe(goalsCard); safe(openCard);
  safe(eventsCard); paintState();
}

function head(node,title,sub){
  node.innerHTML="";
  var h=el("div","ch"); h.appendChild(el("h2",null,title));
  if(sub) h.appendChild(el("span","sub wrapall",sub));
  node.appendChild(h);
  return node;
}

function paintClock(){
  var d=new Date();
  $("clk").textContent = DAYS[d.getDay()]+" "+hm(d.getHours()*60+d.getMinutes());
}

function stats(){
  var h=$("stats"); h.innerHTML="";
  var openN = issues ? issues.length : 0;
  var oldest = 0;
  if(issues) issues.forEach(function(i){ oldest=Math.max(oldest, days(i.created_at)); });
  var papers=null;
  (board.goals||[]).forEach(function(g){ if(g.id==="papers") papers=g; });
  var cards=[
    { n:String(openN), u:"", lb:"Open issues",
      i: openN ? ("Oldest "+oldest+" day"+(oldest===1?"":"s")+" old") : "Nothing owed" },
    { n:dur(weekMins()).replace(/m$/,"m"), u:"", lb:"Logged, 7 days",
      i: runIds().length ? (runIds().length+" running now") : "Nothing running" },
    { n: papers?String(papers.now):"—", u: papers?("/ "+papers.target):"", lb:"Papers submitted",
      i: papers?(papers.why||papers.n):"No goal in the board" },
    { n: board.updated?String(days(board.updated)):"—", u: board.updated?(days(board.updated)===1?"day":"days"):"", lb:"Board age",
      i: board.updated?("Last written "+board.updated):"Never synced" }
  ];
  cards.forEach(function(c){
    var d=el("div","stat");
    var b=el("b"); b.appendChild(document.createTextNode(c.n));
    if(c.u){ var u=el("u",null," "+c.u); b.appendChild(u); }
    d.appendChild(b); d.appendChild(el("span",null,c.lb)); d.appendChild(el("i","wrapall",c.i));
    h.appendChild(d);
  });
}

function nowCard(){
  var c=head($("nowCard"),"Right now", board.headline?"":"No board yet");
  var cur=curBlock(), nx=nextBlock(), t=nowMin();
  var wrap=el("div","hero");
  var title, sub, left, col;
  if(cur){
    col = "var("+(cur.b[3]||"--neutral")+")";
    title=cur.b[1]; sub=cur.b[2]||""; left=dur(cur.b[5]-t)+" left";
    if(cur.b[6] && runIds().length){
      var t0=T(runIds()[0]);
      if(t0){ col=colour(t0); title=t0.n; sub="Running for "+dur((Date.now()-running[t0.id])/60000)+"."; }
    } else if(cur.b[6]){
      var s=suggested();
      if(s) sub="Nothing started. Suggested: "+s.n+".";
    }
  } else {
    col="var(--neutral)"; title="Off the clock"; sub="Nothing is scheduled against this hour.";
    left = nx ? (dur(nx[4]-t)+" until next") : "Nothing else today";
  }
  wrap.style.setProperty("--a", col);
  var lf=el("span","left num",left); wrap.appendChild(lf);
  wrap.appendChild(el("span","lb", runIds().length?"Working on":(cur?"In this block":"Nothing scheduled")));
  wrap.appendChild(el("span","big wrapall",title));
  wrap.appendChild(el("span","sb wrapall",sub));
  c.appendChild(wrap);
  var n=el("div","nxt"); n.appendChild(el("b",null,"Next"));
  n.appendChild(el("span","wrapall", nx ? (hm(nx[4])+"  "+nx[1]) : "Nothing else today."));
  c.appendChild(n);
  if(board.headline){
    var hl=el("p","note wrapall",board.headline); c.appendChild(hl);
  }
}

function threadsCard(){
  var c=head($("threadsCard"),"Threads", board.threads.length?(board.threads.length+" tracked"):"");
  if(!board.threads.length){ c.appendChild(el("p","empty","No board loaded yet.")); return; }
  var rows=el("div","rows");
  board.threads.forEach(function(t){
    var st=t.st||[], pct = st.length>1 ? Math.round(t.at/(st.length-1)*100) : 0;
    var r=el("div","row"); r.style.setProperty("--a",colour(t));
    var bd=el("div","bd");
    var top=el("div"); top.style.cssText="display:flex;gap:10px;justify-content:space-between;align-items:baseline";
    top.appendChild(el("span","nm wrapall",t.n));
    top.appendChild(el("span","tag",t.tag||""));
    bd.appendChild(top);
    bd.appendChild(el("div","mt wrapall", (st[t.at]||"")+(t.why?(" · "+t.why):"")));
    var bar=el("div","bar"); var fill=el("i"); fill.style.width=Math.max(pct,4)+"%"; bar.appendChild(fill);
    bd.appendChild(bar);
    var rt=el("div","rt");
    var m=liveMins(t.id);
    rt.appendChild(el("div","num", m>=1?dur(m):"—"));
    rt.appendChild(el("div",null,"7 days"));
    var btn=el("button","go"+(isOn(t.id)?" on":""), isOn(t.id)?"Stop":"Start");
    btn.addEventListener("click",function(){ isOn(t.id)?stop(t.id):start(t.id); });
    r.appendChild(bd); r.appendChild(rt); r.appendChild(btn);
    rows.appendChild(r);
  });
  c.appendChild(rows);
}

function weekCard(){
  var today=new Date().getDay(), cur=curBlock();
  var c=head($("weekCard"),"The week", FULL[today]+", today");
  var g=el("div","wk");
  for(var d=0; d<7; d++){
    var col=el("div","dcol");
    var hd=el("div","dh"+(d===today?" today":""),DAYS[d]);
    col.appendChild(hd);
    (board.week[d]||[]).forEach(function(b,ix){
      var isMarker = b[5]<=b[4];
      var k=el("div","blk"+((d===today&&cur&&cur.i===ix&&!isMarker)?" now":""));
      k.style.setProperty("--a","var("+(b[3]||"--neutral")+")");
      k.appendChild(el("b","wrapall",b[1]));
      k.appendChild(el("i","wrapall",b[0]));
      col.appendChild(k);
    });
    if(!(board.week[d]||[]).length) col.appendChild(el("div","blk", "—"));
    g.appendChild(col);
  }
  c.appendChild(g);
}

function activityCard(){
  var c=head($("activityCard"),"Recent sessions", recent.length?"":"Nothing logged");
  if(!recent.length){ c.appendChild(el("p","empty","No sessions in the log yet. Start a thread above and the log fills.")); return; }
  var rows=el("div","rows");
  recent.forEach(function(o){
    var t=T(o.thread);
    var r=el("div","row"); r.style.setProperty("--a", t?colour(t):"var(--neutral)");
    var bd=el("div","bd");
    bd.appendChild(el("div","nm wrapall", t?t.n:o.thread));
    bd.appendChild(el("div","mt num", new Date(o.start).toLocaleString(undefined,
      {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})));
    var rt=el("div","rt num",dur(o.minutes));
    r.appendChild(bd); r.appendChild(rt);
    rows.appendChild(r);
  });
  c.appendChild(rows);
}

function inboxCard(){
  var c=head($("inboxCard"),"Inbox", issues?(issues.length+" open"):"");
  if(issuesErr){ c.appendChild(el("p","note bad wrapall",issuesErr)); return; }
  if(!issues){ c.appendChild(el("p","empty","Not loaded yet.")); return; }
  if(!issues.length){ c.appendChild(el("p","empty","Nothing open. Everything you sent has been acted on and closed.")); return; }
  issues.forEach(function(is){
    var d=el("div","issue");
    var hd=el("div","hd");
    hd.appendChild(el("b","wrapall",is.title));
    hd.appendChild(el("span",null,"#"+is.number+" · "+ago(is.created_at)));
    d.appendChild(hd);
    var p=el("p","wrapall"+(openIssue===is.number?" open":""), is.body||"");
    d.appendChild(p);
    var acts=el("div","acts");
    if((is.body||"").length>240){
      var more=el("button","mini", openIssue===is.number?"Less":"Read all");
      more.addEventListener("click",function(){ openIssue = openIssue===is.number?null:is.number; safe(inboxCard); });
      acts.appendChild(more);
    }
    if(is.comments){ acts.appendChild(el("span","mini", is.comments+" repl"+(is.comments===1?"y":"ies"))); }
    var opn=el("button","mini","Open on GitHub");
    opn.addEventListener("click",function(){ window.open(is.html_url,"_blank","noopener"); });
    acts.appendChild(opn);
    var cl=el("button","mini warn","Close");
    cl.addEventListener("click",function(){
      cl.textContent="Closing…";
      gh("/issues/"+is.number,{method:"PATCH",body:{state:"closed"}})
        .then(function(){ return loadIssues(); })
        .then(function(){ render(); })
        .catch(function(e){ note(e.message,"bad"); cl.textContent="Close"; });
    });
    acts.appendChild(cl);
    d.appendChild(acts);
    c.appendChild(d);
  });
}

function sayCard(){
  var c=head($("sayCard"),"Say","becomes an issue");
  var f0=el("div","fld");
  f0.appendChild(el("label",null,"Thread"));
  var sel=document.createElement("select"); sel.id="sayth";
  var o0=document.createElement("option"); o0.value=""; o0.textContent="No thread"; sel.appendChild(o0);
  board.threads.forEach(function(t){
    var o=document.createElement("option"); o.value=t.id; o.textContent=t.n; sel.appendChild(o);
  });
  f0.appendChild(sel); c.appendChild(f0);

  var f1=el("div","fld");
  f1.appendChild(el("label",null,"Kind"));
  var kind=document.createElement("select"); kind.id="saykind";
  ["Update","Decision","New thread","Ask"].forEach(function(k){
    var o=document.createElement("option"); o.value=k; o.textContent=k; kind.appendChild(o);
  });
  f1.appendChild(kind); c.appendChild(f1);

  var f2=el("div","fld");
  f2.appendChild(el("label",null,"What happened"));
  var ta=document.createElement("textarea"); ta.id="sayta"; ta.placeholder="Type it, or use the keyboard's dictation key.";
  f2.appendChild(ta); c.appendChild(f2);

  var send=el("button","wide","Send");
  send.addEventListener("click",function(){
    var v=$("sayta").value.trim(); if(!v) return;
    var th=$("sayth").value?T($("sayth").value):null;
    var title=$("saykind").value+(th?(": "+th.n):"");
    var body=v+"\n\n---\n"+(th?("Thread: `"+th.id+"` — "+th.n+"\n"):"")+
             "Sent from the Planner desktop, "+new Date().toISOString()+".";
    queue.push({kind:"issue", title:title, body:body}); put(K.queue,queue);
    $("sayta").value=""; note("Sending…");
    flushQueue().then(function(){ return loadIssues(); })
      .then(function(){ stateMsg = queue.length ? (queue.length+" still queued") : "Sent."; render(); })
      .catch(function(e){ note(e.message,"bad"); });
  });
  c.appendChild(send);
}

function goalsCard(){
  var c=head($("goalsCard"),"The year", board.apex?"":"");
  var gs=board.goals||[];
  if(!gs.length){ c.appendChild(el("p","empty","No goals in the board.")); return; }
  var rows=el("div","rows");
  gs.forEach(function(g){
    var r=el("div","row"); r.style.setProperty("--a","var("+(g.c||"--accent")+")");
    var bd=el("div","bd");
    bd.appendChild(el("div","nm wrapall",g.n));
    var bar=el("div","bar"); var fill=el("i");
    var pct = g.target ? Math.min(100,Math.round((g.now||0)/g.target*100)) : 0;
    fill.style.width=Math.max(pct,3)+"%"; bar.appendChild(fill); bd.appendChild(bar);
    if(g.why) bd.appendChild(el("div","mt wrapall",g.why));
    var rt=el("div","rt num",(g.now||0)+" / "+(g.target||0));
    r.appendChild(bd); r.appendChild(rt);
    rows.appendChild(r);
  });
  c.appendChild(rows);
  if(board.apex) c.appendChild(el("p","note wrapall",board.apex));
}

function openCard(){
  var q=board.open||[];
  var c=head($("openCard"),"Waiting on you", q.length?(q.length+""):"nothing");
  if(!q.length){ c.appendChild(el("p","empty","Nothing is waiting on a decision.")); return; }
  var ol=el("ol","q");
  q.forEach(function(x){ ol.appendChild(el("li","wrapall",x)); });
  c.appendChild(ol);
}

function eventsCard(){
  var ev=(board.events||[]).slice().sort(function(a,b){ return (a.date||"")<(b.date||"")?-1:1; });
  var c=head($("eventsCard"),"Coming up", ev.length?"":"nothing booked");
  if(!ev.length){ c.appendChild(el("p","empty","No events in the board.")); return; }
  var rows=el("div","rows");
  ev.forEach(function(e){
    var r=el("div","row"); r.style.setProperty("--a","var("+(e.c||"--accent")+")");
    var bd=el("div","bd");
    bd.appendChild(el("div","nm wrapall",e.n));
    var when=[e.date, (e.start?(e.start+(e.end?("–"+e.end):"")):""), e.where].filter(Boolean).join(" · ");
    bd.appendChild(el("div","mt wrapall",when));
    if(e.note) bd.appendChild(el("div","mt wrapall",e.note));
    r.appendChild(bd);
    rows.appendChild(r);
  });
  c.appendChild(rows);
}

/* ---------- settings ---------- */
function modal(build){
  var h=$("modal"); h.innerHTML="";
  var ov=el("div","modal");
  ov.addEventListener("click",function(e){ if(e.target===ov) h.innerHTML=""; });
  var cd=el("div","cd");
  build(cd,function(){ h.innerHTML=""; });
  ov.appendChild(cd); h.appendChild(ov);
}

function settings(){
  modal(function(cd,close){
    cd.appendChild(el("h3",null,"Settings"));

    var f0=el("div","fld"); f0.appendChild(el("label",null,"Repository"));
    var rin=document.createElement("input"); rin.type="text"; rin.id="repoin";
    rin.value=REPO(); rin.placeholder="owner/name"; rin.autocomplete="off"; rin.spellcheck=false;
    f0.appendChild(rin); cd.appendChild(f0);

    var f=el("div","fld"); f.appendChild(el("label",null,"GitHub token"));
    var inp=document.createElement("input"); inp.type="password"; inp.id="tokin";
    inp.placeholder = token?"Saved. Paste a new one to replace it.":"github_pat_…";
    inp.autocomplete="off"; inp.spellcheck=false;
    f.appendChild(inp); cd.appendChild(f);

    var st=el("p","note", (token&&REPO())?("Connected to "+REPO()+"."):"Not connected.");
    st.id="setst"; cd.appendChild(st);

    var duo=el("div","duo");
    var save=el("button","wide","Save and test");
    save.addEventListener("click",function(){
      var rv=$("repoin").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
      if(rv) putRaw(K.repo,rv);
      var v=inp.value.trim();
      if(v){ token=v; put(K.tok,v); inp.value=""; }
      $("setst").textContent="Testing…"; $("setst").className="note";
      gh("/issues?per_page=1").then(function(){ return sync(); }).then(function(){
        $("setst").textContent="Connected. Board synced."; $("setst").className="note ok";
      }).catch(function(e){
        $("setst").textContent=e.message; $("setst").className="note bad";
      });
    });
    var out=el("button","wide ghost","Forget token");
    out.addEventListener("click",function(){
      token=""; del(K.tok); issues=null;
      $("setst").textContent="Token removed from this browser."; $("setst").className="note";
      render();
    });
    duo.appendChild(save); duo.appendChild(out); cd.appendChild(duo);

    cd.appendChild(el("p","note","Make the token at github.com, Settings, Developer settings, Personal access tokens, Fine-grained. Give it that one repository, with Contents and Issues set to read and write. Nothing else."));
    cd.appendChild(el("p","note","It is stored in this browser alone and sent only to api.github.com. A second machine needs its own token, so losing one costs one revoke."));

    var dn=el("button","wide ghost","Done");
    dn.style.marginTop="10px";
    dn.addEventListener("click",close);
    cd.appendChild(dn);
  });
}

/* ---------- boot ---------- */
(function theme(){
  var t=getRaw(K.theme);
  if(t) document.documentElement.setAttribute("data-theme",t);
})();

$("gear").addEventListener("click",settings);
$("refresh").addEventListener("click",function(){ sync(); });
$("theme").addEventListener("click",function(){
  var cur=document.documentElement.getAttribute("data-theme");
  var next = cur==="dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme",next); putRaw(K.theme,next);
});
document.addEventListener("keydown",function(e){
  if(e.key==="Escape") $("modal").innerHTML="";
  if(e.key==="r" && (e.metaKey||e.ctrlKey)===false && e.target===document.body) sync();
});

render();
if(token && REPO()) sync(); else note("Open settings and connect");

setInterval(function(){ safe(paintClock); safe(stats); safe(nowCard); safe(threadsCard); }, 20000);
setInterval(function(){ if(token&&REPO()&&!busy) sync(); }, 300000);
window.addEventListener("focus",function(){ if(token&&REPO()&&!busy&&Date.now()-lastSync>60000) sync(); });

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("sw.js").catch(function(){});
  });
}
})();
