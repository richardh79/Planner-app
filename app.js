/* Planner. An installable board over a private GitHub repository.
   No server. The token lives only in this browser and goes only to api.github.com. */
(function(){
"use strict";

var K    = { tok:"planner.token", repo:"planner.repo", board:"planner.board", focus:"planner.focus",
             mins:"planner.mins", queue:"planner.queue", lang:"planner.lang", theme:"planner.theme",
             running:"planner.running" };
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
function M(h,m){ return h*60+(m||0); }
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

/* ---------- the board, bundled so the app is useful before it ever syncs ---------- */
var DEFAULT = {
  updated:"",
  headline:"Not connected yet. Open settings, add the repository and a token, and the board loads.",
  apex:"",
  goals:[],
  events:[],
  threads:[],
  week:[[],[],[],[],[],[],[]],
  open:[]
};

var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ---------- state ---------- */
var board = get(K.board, null) || DEFAULT;
var token = get(K.tok, "");
var running = get(K.running, null);
if(!running){                       // migrate the old single-thread value
  var old = get(K.focus, null);
  running = (old && old.id) ? (function(){ var o={}; o[old.id]=old.at; return o; })() : {};
  put(K.running, running); del(K.focus);
}
function isOn(id){ return Object.prototype.hasOwnProperty.call(running,id); }
function runningIds(){ return Object.keys(running); }
function runCount(){ return runningIds().length; }
var mins  = get(K.mins, {});
var queue = get(K.queue, []);
var view  = "now";
var selDay = new Date().getDay();
var issues = null, issuesAt = 0, issuesErr = "";
var syncMsg = "";

function T(id){ for(var i=0;i<board.threads.length;i++) if(board.threads[i].id===id) return board.threads[i]; return null; }

/* ---------- GitHub ---------- */
function gh(path, opts){
  opts = opts || {};
  if(!REPO()) return Promise.reject(new Error("No repository set. Open settings and add it."));
  if(!token) return Promise.reject(new Error("No token yet. Open settings and paste one."));
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
          if(r.status===403) m="Token lacks permission for that. It needs Contents and Issues, read and write.";
          throw new Error(m);
        }
        return j;
      });
    });
}

function pullBoard(){
  return gh("/contents/data/board.json", {soft404:true}).then(function(r){
    if(!r||!r.content) return null;
    var j = JSON.parse(b64d(r.content));
    if(j && j.threads && j.week){ board=j; put(K.board,j); }
    return j;
  });
}

function appendLog(line){
  return gh("/contents/data/log.jsonl", {soft404:true}).then(function(r){
    var body = r&&r.content ? b64d(r.content) : "";
    if(body && body.slice(-1)!=="\n") body += "\n";
    var next = body + line + "\n";
    var payload = { message:"Session log", content:b64e(next) };
    if(r&&r.sha) payload.sha = r.sha;
    return gh("/contents/data/log.jsonl", {method:"PUT", body:payload});
  });
}

function pullLog(){
  return gh("/contents/data/log.jsonl", {soft404:true}).then(function(r){
    if(!r||!r.content) return;
    var cut=Date.now()-7*864e5, acc={};
    b64d(r.content).split("\n").forEach(function(ln){
      if(!ln.trim()) return;
      var o=null; try{ o=JSON.parse(ln); }catch(e){ return; }
      if(!o||!o.thread||!o.start) return;
      if(new Date(o.start).getTime()<cut) return;
      if(!(o.minutes>0) || o.minutes>720) return;   // a 12h session means he forgot to stop
      acc[o.thread]=(acc[o.thread]||0)+o.minutes;
    });
    mins=acc; put(K.mins,mins);
  });
}

function flushQueue(){
  if(!token || !queue.length) return Promise.resolve();
  var item = queue[0];
  var p = item.kind==="log" ? appendLog(item.line)
        : gh("/issues", {method:"POST", body:{title:item.title, body:item.body}});
  return p.then(function(){
    queue.shift(); put(K.queue,queue);
    return queue.length?flushQueue():null;
  }).catch(function(){ /* stay queued */ });
}

function loadIssues(force){
  if(!token) return Promise.resolve();
  if(!force && issues && Date.now()-issuesAt < 60000) return Promise.resolve();
  return gh("/issues?state=open&per_page=30&sort=created&direction=desc").then(function(r){
    issues = (r||[]).filter(function(x){ return !x.pull_request; });
    issuesAt = Date.now(); issuesErr="";
  }).catch(function(e){ issuesErr = e.message; });
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
  for(var i=0;i<board.threads.length;i++){
    var x=board.threads[i];
    if(x.tag==="Phase 1" && x.at<2) return x;
  }
  return board.threads[0];
}

function goalOf(t){
  if(!t || !t.goal) return null;
  for(var i=0;i<(board.goals||[]).length;i++) if(board.goals[i].id===t.goal) return board.goals[i];
  return null;
}
function threadsFor(gid){
  return board.threads.filter(function(t){ return (t.goal||"")===gid; });
}
function liveMins(t){
  return (mins[t.id]||0) + (isOn(t.id)?(Date.now()-running[t.id])/60000:0);
}
function alignment(){
  var on=0, off=0;
  board.threads.forEach(function(t){
    var m=liveMins(t);
    if(!m) return;
    if(t.critical) on+=m; else off+=m;
  });
  var tot=on+off;
  return { on:on, off:off, tot:tot, pc: tot?Math.round(on/tot*100):0 };
}

/* ---------- tracking ---------- */
function startFocus(id){
  if(isOn(id)) return;
  running[id]=Date.now(); put(K.running,running); render();
}

function stopFocus(id){
  if(id==null){ runningIds().forEach(function(x){ stopFocus(x); }); return; }
  if(!isOn(id)) return;
  var at=running[id], m=Math.round((Date.now()-at)/60000);
  delete running[id]; put(K.running,running);
  mins[id]=(mins[id]||0)+m; put(K.mins,mins);
  if(m>=1){
    var line=JSON.stringify({thread:id, start:new Date(at).toISOString(),
                             end:new Date().toISOString(), minutes:m});
    queue.push({kind:"log", line:line}); put(K.queue,queue);
    flushQueue().then(function(){ pullLog().then(render).catch(function(){ render(); }); });
  }
  render();
}

/* ---------- speech ---------- */
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var LANGS=[["ar-SA","عربي"],["en-GB","English"]];
var langIx = get(K.lang,0);
var rec=null, live=false, recBase="", recHint="";

function recStart(target){
  if(!SR) return;
  var box=$(target); recBase = box?box.value:sayText;
  var r; try{ r=new SR(); }catch(e){ recHint="Could not start: "+e.message; render(); return; }
  r.lang=LANGS[langIx][0]; r.continuous=true; r.interimResults=true;
  r.onresult=function(ev){
    var all="";
    for(var i=0;i<ev.results.length;i++) all += ev.results[i][0].transcript;
    var out=(recBase?recBase+" ":"")+all;
    sayText=out;
    var b=$(target); if(b) b.value=out;
  };
  r.onerror=function(ev){
    var c=(ev&&ev.error)||"unknown"; live=false; rec=null;
    recHint = (c==="not-allowed"||c==="service-not-allowed")
      ? "Microphone blocked. Use the keyboard's microphone key instead."
      : "Dictation stopped: "+c+". The keyboard's microphone key still works.";
    render();
  };
  r.onend=function(){ live=false; rec=null; recHint="Stopped."; render(); };
  try{ r.start(); rec=r; live=true; recHint="Listening. Speak, then tap to stop."; }
  catch(e){ recHint="Could not start: "+e.message; }
  render();
}
function recStop(){ if(rec){ try{ rec.stop(); }catch(e){} } live=false; rec=null; }

/* ---------- views ---------- */
function band(cls, accent, tag){
  var d=document.createElement(tag||"div");
  d.className="band"+(cls?(" "+cls):"");
  if(accent) d.style.setProperty("--a","var("+accent+")");
  return d;
}
function kicker(parent, text){ var s=el("span","kicker tag",text); parent.appendChild(s); return s; }

function applyTheme(){
  var t=getRaw(K.theme);
  if(t) document.documentElement.setAttribute("data-theme",t);
  else document.documentElement.removeAttribute("data-theme");
}

function render(){
  var m=$("main"); if(!m) return;
  try{
    m.innerHTML="";
    $("clk").textContent = DAYS[new Date().getDay()].toUpperCase()+" "+hm(nowMin());
    $("ttl").textContent = ({now:"Now",map:"Map",threads:"Work",say:"Say",inbox:"Inbox"}[view])||"Now";
    var VIEWS={now:vNow, map:vMap, threads:vThreads, say:vSay, inbox:vInbox};
    var fn=VIEWS[view];
    if(typeof fn!=="function"){ view="now"; fn=vNow; }
    fn(m);
    Array.prototype.forEach.call(document.querySelectorAll("nav button"),function(b){
      if(b.dataset.v===view) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
  }catch(e){
    m.innerHTML="";
    var b=band("flat"); b.appendChild(el("p","note bad","Could not draw this screen: "+e.message));
    m.appendChild(b);
  }
}

/* ---------- now ---------- */
function vNow(m){
  var cur=curBlock(), nx=nextBlock(), t=nowMin();
  var acc, title, sub, lv, lc;
  if(cur){
    acc=cur.b[3]; title=cur.b[1]; sub=cur.b[2];
    lv=dur(cur.b[5]-t); lc="left";
    if(cur.b[6]){
      var rc=runCount();
      if(rc===1){ var f=T(runningIds()[0]); if(f){ acc=f.c; title=f.n; sub="Running now."; } }
      else if(rc>1){
        acc="--hot"; title=rc+" threads running";
        sub=runningIds().map(function(id){ var x=T(id); return x?x.n:id; }).join(" · ");
      }
      else { var sg=suggested(); if(sg) sub="Nothing started. Suggested: "+sg.n+"."; }
    }
  } else {
    acc="--neutral"; title="Off the clock"; sub="Nothing is scheduled against this hour.";
    lv = nx?dur(nx[4]-t):"—"; lc = nx?"until next":"done today";
  }

  var h=band("hero", acc);
  kicker(h, runCount()?"Working on":"Right now");
  h.appendChild(el("span","big any",title));
  h.appendChild(el("span","say any",sub));
  var cr=el("div","clockrow");
  var L=el("div","lft");
  L.appendChild(el("span","lv num",lv));
  L.appendChild(el("span","lc",lc));
  var R=el("div","nxt any");
  R.appendChild(el("b",null,"Next"));
  R.appendChild(document.createTextNode(nx?(hm(nx[4])+"  "+nx[1]):"Nothing else today."));
  cr.appendChild(L); cr.appendChild(R); h.appendChild(cr);
  m.appendChild(h);

  var ids=runningIds();
  if(ids.length){
    ids.forEach(function(id){
      var t=T(id);
      var r=band("run live", t?t.c:"--hot");
      r.appendChild(el("span","pulse"));
      var tx=el("span","txt");
      tx.appendChild(el("b","any", t?t.n:id));
      tx.appendChild(el("span",null, dur((Date.now()-running[id])/60000)+" so far"));
      r.appendChild(tx);
      var st=el("button","pill","Stop");
      st.addEventListener("click",function(){ stopFocus(id); });
      r.appendChild(st);
      m.appendChild(r);
    });
    var add=band("run","--neutral","button");
    add.appendChild(el("span","pulse"));
    var at=el("span","txt");
    at.appendChild(el("b",null,"Start another"));
    at.appendChild(el("span",null, ids.length+" running. Nothing stops when you add one."));
    add.appendChild(at);
    add.appendChild(el("span","pill","Add"));
    add.addEventListener("click",function(){ view="threads"; render(); });
    m.appendChild(add);
    if(ids.length>1){
      var all=el("button","wide ghost","Stop all "+ids.length);
      all.style.marginTop="0"; all.style.marginBottom="10px";
      all.addEventListener("click",function(){ stopFocus(); });
      m.appendChild(all);
    }
  } else {
    var r2=band("run","--neutral","button");
    r2.appendChild(el("span","pulse"));
    var tx2=el("span","txt");
    tx2.appendChild(el("b",null,"Nothing running"));
    tx2.appendChild(el("span",null,"Pick something to work on"));
    r2.appendChild(tx2);
    r2.appendChild(el("span","pill","Start"));
    r2.addEventListener("click",function(){ view="threads"; render(); });
    m.appendChild(r2);
  }

  if(board.headline){
    var s1=el("div","sec");
    s1.appendChild(sech("The one line"));
    var q=band("flat");
    q.appendChild(el("p","quote any",board.headline));
    s1.appendChild(q); m.appendChild(s1);
  }

  var anyWeek=false;
  for(var wi=0;wi<board.week.length;wi++) if((board.week[wi]||[]).length) anyWeek=true;
  if(anyWeek){
    var td=new Date().getDay();
    var s2=el("div","sec");
    s2.appendChild(sech("The week", FULL[selDay]+(selDay===td?" · today":"")));
    var dd=el("div","days");
    DAYS.forEach(function(d,i){
      var b=el("button",(i===td?"today":""),d.toUpperCase());
      b.setAttribute("aria-pressed", i===selDay?"true":"false");
      b.addEventListener("click",function(){ selDay=i; render(); });
      dd.appendChild(b);
    });
    s2.appendChild(dd);
    (board.week[selDay]||[]).forEach(function(x,ix){
      var b=band("blk"+((selDay===td&&cur&&cur.i===ix)?" on":""), x[3]);
      b.appendChild(el("span","t",x[0]));
      var d=el("span","d");
      d.appendChild(el("b","any",x[1]));
      d.appendChild(el("span","any",x[2]));
      b.appendChild(d);
      s2.appendChild(b);
    });
    m.appendChild(s2);
  }

  var evs=(board.events||[]).slice().sort(function(a,b){ return (a.date||"")<(b.date||"")?-1:1; });
  if(evs.length){
    var today=new Date(); today.setHours(0,0,0,0);
    var soon=evs.filter(function(e){ return e.date && new Date(e.date+"T00:00:00")>=today && e.status!=="unconfirmed"; });
    var unsure=evs.filter(function(e){ return e.status==="unconfirmed"; });
    if(soon.length || unsure.length){
      var se=el("div","sec");
      se.appendChild(sech("Coming up", soon.length?(soon.length+" booked"):""));
      soon.slice(0,6).forEach(function(e){ se.appendChild(eventBand(e,false)); });
      unsure.forEach(function(e){ se.appendChild(eventBand(e,true)); });
      m.appendChild(se);
    }
  }

  if(board.open && board.open.length){
    var s3=el("div","sec");
    s3.appendChild(sech("Waiting on you", board.open.length+" open"));
    var c=band("flat");
    var rows=el("div","rows"); rows.style.marginTop="0";
    board.open.forEach(function(q,i){
      var r=el("div","row");
      r.style.setProperty("--a","var(--hot)");
      r.appendChild(el("span","dot"));
      var nm=el("span","nm any"); nm.textContent=q;
      r.appendChild(nm);
      r.appendChild(el("span","val num",String(i+1)));
      rows.appendChild(r);
    });
    c.appendChild(rows); s3.appendChild(c); m.appendChild(s3);
  }

  m.appendChild(el("p","note","Board updated "+(board.updated||"—")+(syncMsg?(" · "+syncMsg):"")));
}

function eventBand(e, unsure){
  var b=band("blk", unsure?"--hot":(e.c||"--conf"));
  var when=e.date||"date unknown";
  if(e.date){
    var d=new Date(e.date+"T00:00:00");
    var days=Math.round((d-new Date().setHours(0,0,0,0))/864e5);
    when = FULL[d.getDay()].slice(0,3)+" "+e.date.slice(8)+" "+
           ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    if(days===0) when="Today";
    else if(days===1) when="Tomorrow";
    else if(days>1) when=when+" · "+days+"d";
    else when=when+" · passed";
  }
  b.appendChild(el("span","t",when));
  var d2=el("span","d");
  d2.appendChild(el("b","any",e.n));
  var sub=[];
  if(e.start) sub.push(e.start+(e.end?("–"+e.end):""));
  if(e.where) sub.push(e.where);
  if(unsure) sub.push("date needs confirming");
  d2.appendChild(el("span","any",sub.join(" · ")));
  b.appendChild(d2);
  return b;
}

function sech(title, right){
  var h=el("div","sech");
  h.appendChild(el("h2",null,title));
  if(right) h.appendChild(el("span",null,right));
  return h;
}

/* ---------- map ---------- */
function vMap(m){
  var a=alignment();
  var st=band("stat", a.tot?(a.pc>=60?"--good":(a.pc>=35?"--hot":"--bad")):"--neutral");
  st.appendChild(el("span","v num", a.tot?(a.pc+"%"):"—"));
  st.appendChild(el("span","c", a.tot
    ? "of this week's tracked hours went to the critical path. "+dur(a.on)+" on it, "+dur(a.off)+" elsewhere."
    : "Nothing tracked in the last seven days. Start a thread and this becomes the honest number."));
  if(a.tot){
    var sb=el("div","splitbar");
    var i1=el("i"); i1.style.cssText="background:var(--hot);width:"+a.pc+"%";
    var i2=el("i"); i2.style.cssText="background:var(--neutral);width:"+(100-a.pc)+"%";
    sb.appendChild(i1); sb.appendChild(i2); st.appendChild(sb);
    var k=el("div","keys");
    [["--hot","Critical path"],["--neutral","Everything else"]].forEach(function(x){
      var sp=el("span"); var bb=el("b"); bb.style.background="var("+x[0]+")";
      sp.appendChild(bb); sp.appendChild(document.createTextNode(x[1])); k.appendChild(sp);
    });
    st.appendChild(k);
  }
  m.appendChild(st);

  if(board.apex){
    var ap=band("flat");
    kicker(ap,"Everything points here").style.color="var(--dim)";
    ap.appendChild(el("p","quote any",board.apex));
    m.appendChild(ap);
  }

  var s=el("div","sec");
  s.appendChild(sech("What it is all for","tap a thread"));
  (board.goals||[]).forEach(function(g){
    var c=band("", g.c);
    var hd=el("div","thh");
    hd.appendChild(el("b","any",g.n));
    if(g.target!=null) hd.appendChild(el("span","chip num", g.now+"/"+g.target));
    c.appendChild(hd);
    if(g.why) c.appendChild(el("p","note any",g.why));
    if(g.target && g.target<=24){
      var p=el("div","pips");
      for(var i=0;i<g.target;i++){ var d=el("i"); if(i>=g.now) d.className="off"; p.appendChild(d); }
      c.appendChild(p);
    }
    var list=threadsFor(g.id), rows=el("div","rows");
    if(!list.length) rows.appendChild(el("p","note","Nothing is feeding this."));
    list.forEach(function(t){ rows.appendChild(threadRow(t)); });
    c.appendChild(rows);
    s.appendChild(c);
  });

  var orphan=board.threads.filter(function(t){ return !goalOf(t); });
  if(orphan.length){
    var oc=band("", "--neutral");
    var oh=el("div","thh");
    oh.appendChild(el("b",null,"Serving no goal"));
    oh.appendChild(el("span","chip quiet num",String(orphan.length)));
    oc.appendChild(oh);
    oc.appendChild(el("p","note","Work that feeds nothing you said you want. Either it earns a goal or it stops."));
    var orows=el("div","rows");
    orphan.forEach(function(t){ orows.appendChild(threadRow(t)); });
    oc.appendChild(orows); s.appendChild(oc);
  }
  m.appendChild(s);
}

function threadRow(t){
  var mm=liveMins(t), on=isOn(t.id);
  var b=el("button","row");
  b.style.setProperty("--a","var("+t.c+")");
  var d=el("span","dot"+(mm?"":" cold")); b.appendChild(d);
  var nm=el("span","nm any"); nm.textContent=t.n;
  nm.appendChild(el("u",null, t.st[t.at]+(t.critical?" · critical path":"")));
  b.appendChild(nm);
  b.appendChild(el("span","val num"+(on?" live":""), on?"live":(mm?dur(mm):"0m")));
  b.addEventListener("click",function(){ openThread(t); });
  return b;
}

/* ---------- work ---------- */
function vThreads(m){
  if(!board.threads.length){
    var e=band("flat");
    e.appendChild(el("p","empty","No threads yet. Connect the app in settings and the board loads."));
    m.appendChild(e); return;
  }
  var wrapS=el("div"); wrapS.style.marginTop="2px";
  board.threads.forEach(function(t){
    var on=isOn(t.id), mm=liveMins(t), g=goalOf(t);
    var c=band("", t.c);
    var hd=el("div","thh");
    hd.appendChild(el("b","any",t.n));
    hd.appendChild(el("span","chip"+(on?"":" quiet"), on?"Running":t.tag));
    c.appendChild(hd);
    var sg=el("div","stage");
    t.st.forEach(function(_,ix){ var i=el("i"); if(ix<=t.at) i.className="done"; sg.appendChild(i); });
    c.appendChild(sg);
    var f=el("div","thf");
    f.appendChild(el("span","any", t.st[t.at]+" · "+(g?g.n:"no goal")));
    f.appendChild(el("em","num", mm?dur(mm):"0m"));
    c.appendChild(f);
    var bts=el("div","thb");
    var go=el("button", on?"go":"", on?"Stop":"Start");
    go.addEventListener("click",function(e){ e.stopPropagation(); on?stopFocus(t.id):startFocus(t.id); });
    var sp=el("button",null,"🎙 Say");
    sp.addEventListener("click",function(e){ e.stopPropagation(); sayThread=t.id; view="say"; render(); });
    var mo=el("button",null,"Details");
    mo.addEventListener("click",function(e){ e.stopPropagation(); openThread(t); });
    bts.appendChild(go); bts.appendChild(sp); bts.appendChild(mo);
    c.appendChild(bts);
    wrapS.appendChild(c);
  });
  m.appendChild(wrapS);
}

/* ---------- say ---------- */
var sayThread="", sayKind="Update", sayText="";
function vSay(m){
  var c=band("flat"); c.style.marginTop="2px";

  var f1=el("div","fld"); f1.appendChild(el("label","tag","Kind"));
  var s1=el("select");
  ["Update","Decision","New thread","Ask"].forEach(function(k){
    var o=el("option",null,k); o.value=k; if(k===sayKind) o.selected=true; s1.appendChild(o);
  });
  s1.addEventListener("change",function(){ sayKind=s1.value; });
  f1.appendChild(s1); c.appendChild(f1);

  var f2=el("div","fld"); f2.appendChild(el("label","tag","About"));
  var s2=el("select");
  var o0=el("option",null,"Not a specific thread"); o0.value=""; s2.appendChild(o0);
  board.threads.forEach(function(t){
    var o=el("option",null,t.n); o.value=t.id; if(t.id===sayThread) o.selected=true; s2.appendChild(o);
  });
  s2.addEventListener("change",function(){ sayThread=s2.value; });
  f2.appendChild(s2); c.appendChild(f2);

  var f3=el("div","fld"); f3.appendChild(el("label","tag","What happened"));
  var ta=el("textarea"); ta.id="sayta"; ta.setAttribute("dir","auto");
  ta.placeholder="Speak or type."; ta.value=sayText;
  ta.addEventListener("input",function(){ sayText=ta.value; });
  f3.appendChild(ta); c.appendChild(f3);

  var mr=el("div","microw");
  var rb=el("button","rec"+(live?" on":""), live?"■":"🎙");
  rb.setAttribute("aria-label", live?"Stop dictation":"Start dictation");
  if(!SR){ rb.disabled=true; rb.style.opacity=".4"; }
  rb.addEventListener("click",function(){ if(live){ recStop(); render(); } else { recStart("sayta"); } });
  mr.appendChild(rb);
  mr.appendChild(el("span","hint", recHint || (SR
    ? "Tap and speak. Or use the keyboard's own microphone key."
    : "Dictation is not available in this browser. Use the keyboard's microphone key.")));
  if(SR){
    var lg=el("button","lang",LANGS[langIx][1]);
    lg.addEventListener("click",function(){ langIx=(langIx+1)%LANGS.length; put(K.lang,langIx); recStop(); render(); });
    mr.appendChild(lg);
  }
  c.appendChild(mr);

  var send=el("button","wide","Send to Claude");
  send.addEventListener("click",function(){
    var box=$("sayta"), v=box?box.value.trim():"";
    if(!v) return;
    recStop();
    var th=sayThread?T(sayThread):null;
    var title=sayKind+(th?(": "+th.n):"");
    var body=v+"\n\n---\n"+(th?("Thread: `"+th.id+"` — "+th.n+"\n"):"")+
             "Sent from the Planner app, "+new Date().toISOString()+".";
    queue.push({kind:"issue", title:title, body:body}); put(K.queue,queue);
    box.value=""; sayText=""; sayThread=""; recHint="";
    syncMsg=queue.length+" queued"; render();
    flushQueue().then(function(){
      syncMsg = queue.length ? (queue.length+" still queued, no signal") : "Sent.";
      issues=null; loadIssues(true).then(function(){ view="inbox"; render(); });
    });
  });
  c.appendChild(send);
  c.appendChild(el("p","note","It becomes an issue in your repository. Claude reads it, does the work, replies here, and closes it."));
  m.appendChild(c);

  if(queue.length) m.appendChild(el("p","note bad", queue.length+" waiting to send. They go as soon as there is signal."));
}

/* ---------- inbox ---------- */
function vInbox(m){
  if(!token || !REPO()){ m.appendChild(needToken()); return; }
  var s=el("div"); s.style.marginTop="2px";
  var h=sech("Open");
  var rf=el("button","chip quiet","Refresh");
  rf.addEventListener("click",function(){ issues=null; loadIssues(true).then(render); });
  h.appendChild(rf); s.appendChild(h);

  if(issuesErr) s.appendChild(el("p","note bad",issuesErr));
  if(!issues){ s.appendChild(el("p","note","Loading…")); loadIssues(true).then(render); m.appendChild(s); return; }
  if(!issues.length){
    var e=band("flat");
    e.appendChild(el("p","empty","Nothing open. Everything you sent has been dealt with."));
    s.appendChild(e); m.appendChild(s); return;
  }
  issues.forEach(function(is){
    var c=band("iss","--hot","button");
    var hd=el("div","issh");
    hd.appendChild(el("span",null,"#"+is.number));
    hd.appendChild(el("span",null,ago(is.created_at)));
    c.appendChild(hd);
    c.appendChild(el("b","any",is.title));
    var body=(is.body||"").split("\n---\n")[0].trim();
    if(body) c.appendChild(el("p","any", body.length>170?body.slice(0,170)+"…":body));
    if(is.comments) c.appendChild(el("div","rep any", is.comments+" repl"+(is.comments===1?"y":"ies")+" · tap to read"));
    c.addEventListener("click",function(){ openIssue(is); });
    s.appendChild(c);
  });
  m.appendChild(s);
}

function needToken(){
  var c=band("flat");
  c.appendChild(el("h2",null,"Connect it once")).style.cssText="margin:0 0 10px;font-size:1.3rem;font-weight:800";
  c.appendChild(el("p","note","The app talks straight to your own repository. It needs the repository name and a token you make, both kept only on this phone."));
  var b=el("button","wide","Open settings");
  b.addEventListener("click",settings);
  c.appendChild(b);
  return c;
}

/* ---------- sheets ---------- */
function sheet(build){
  var h=$("sheet"); h.innerHTML="";
  var ov=el("div","ov");
  ov.addEventListener("click",function(e){ if(e.target===ov) closeSheet(); });
  var sh=el("div","sh");
  build(sh);
  ov.appendChild(sh); h.appendChild(ov);
}
function closeSheet(){ var h=$("sheet"); if(h) h.innerHTML=""; }
function shHead(sh, kickerText, title){
  var hd=el("div","shh");
  var L=el("div"); L.style.minWidth="0";
  var k=el("span","kicker tag",kickerText); k.style.color="var(--dim)";
  L.appendChild(k); L.appendChild(el("b","any",title));
  var x=el("button","shx","✕"); x.addEventListener("click",closeSheet);
  hd.appendChild(L); hd.appendChild(x); sh.appendChild(hd);
}

function openThread(t){
  sheet(function(sh){
    var g=goalOf(t), on=isOn(t.id);
    shHead(sh, g?("For: "+g.n):"Serving no goal", t.n);
    if(t.why) sh.appendChild(el("p","note any",t.why)).style.color="var(--ink2)";

    var c=band("", t.c);
    var f=el("div","thf"); f.style.marginTop="0";
    f.appendChild(el("span",null, on?"Running now":"Not running"));
    f.appendChild(el("em","num", dur(liveMins(t))+" this week"));
    c.appendChild(f);
    var bts=el("div","thb");
    var go=el("button","go", on?"Stop":"Start working");
    go.addEventListener("click",function(){ on?stopFocus(t.id):startFocus(t.id); closeSheet(); });
    var sp=el("button",null,"🎙 Say");
    sp.addEventListener("click",function(){ closeSheet(); sayThread=t.id; view="say"; render(); });
    bts.appendChild(go); bts.appendChild(sp); c.appendChild(bts);
    sh.appendChild(c);

    var s=el("div","sec"); s.appendChild(sech("Stage","tap to move it"));
    var box=band("flat");
    var rows=el("div","rows"); rows.style.marginTop="0";
    t.st.forEach(function(name,ix){
      var b=el("button","row"); b.style.setProperty("--a","var("+t.c+")");
      b.appendChild(el("span","dot"+(ix<=t.at?"":" cold")));
      var nm=el("span","nm any"); nm.textContent=name;
      if(ix===t.at) nm.style.fontWeight="800";
      b.appendChild(nm);
      b.appendChild(el("span","val", ix===t.at?"now":(ix<t.at?"done":"")));
      b.addEventListener("click",function(){ if(ix!==t.at) propose(t,name); });
      rows.appendChild(b);
    });
    box.appendChild(rows); s.appendChild(box);
    s.appendChild(el("p","note","The board is rewritten from the repository, never from the phone, so tapping a stage sends Claude the change and the reason travels with it."));
    sh.appendChild(s);
  });
}

function propose(t, stage){
  var title="Update: "+t.n;
  var body="Moved to **"+stage+"**.\n\n---\nThread: `"+t.id+"`\nSent from the Planner app, "+new Date().toISOString()+".";
  queue.push({kind:"issue", title:title, body:body}); put(K.queue,queue);
  closeSheet(); syncMsg="sending"; render();
  flushQueue().then(function(){
    syncMsg = queue.length ? "queued, no signal" : "sent";
    issues=null; loadIssues(true).then(render);
  });
}

function openIssue(is){
  sheet(function(sh){
    shHead(sh, "#"+is.number+" · "+ago(is.created_at), is.title);
    var b=el("p","any",(is.body||"").trim());
    b.style.cssText="white-space:pre-wrap;font-size:.95rem;line-height:1.55;margin:12px 0 0;color:var(--ink2)";
    sh.appendChild(b);

    var box=el("div"); box.style.marginTop="8px"; sh.appendChild(box);
    box.appendChild(el("p","note", is.comments?"Loading replies…":"No reply yet."));
    if(is.comments){
      gh("/issues/"+is.number+"/comments?per_page=30").then(function(cs){
        box.innerHTML="";
        (cs||[]).forEach(function(c){
          var d=band("flat");
          var k=el("span","kicker tag",(c.user&&c.user.login?c.user.login:"reply")+" · "+ago(c.created_at));
          k.style.color="var(--hot)"; d.appendChild(k);
          var p=el("p","any",(c.body||"").trim());
          p.style.cssText="white-space:pre-wrap;margin:0;font-size:.95rem;line-height:1.55";
          d.appendChild(p); box.appendChild(d);
        });
        if(!box.children.length) box.appendChild(el("p","note","No reply yet."));
      }).catch(function(e){ box.innerHTML=""; box.appendChild(el("p","note bad",e.message)); });
    }

    var duo=el("div","duo");
    var a=el("a","wide ghost","Open on GitHub");
    a.href="https://github.com/"+REPO()+"/issues/"+is.number; a.target="_blank"; a.rel="noopener";
    a.style.textDecoration="none";
    var cl=el("button","wide","Done, close it");
    cl.addEventListener("click",function(){
      cl.textContent="Closing…";
      gh("/issues/"+is.number, {method:"PATCH", body:{state:"closed"}}).then(function(){
        closeSheet(); issues=null; loadIssues(true).then(render);
      }).catch(function(e){ cl.textContent=e.message; });
    });
    duo.appendChild(a); duo.appendChild(cl); sh.appendChild(duo);
  });
}

function settings(){
  sheet(function(sh){
    shHead(sh,"Settings","Connection");

    var f0=el("div","fld"); f0.appendChild(el("label","tag","Repository"));
    var rin=el("input"); rin.type="text"; rin.id="repoin"; rin.value=REPO();
    rin.placeholder="owner/name"; rin.autocomplete="off"; rin.spellcheck=false;
    f0.appendChild(rin); sh.appendChild(f0);

    var f=el("div","fld"); f.appendChild(el("label","tag","GitHub token"));
    var inp=el("input"); inp.type="password"; inp.id="tokin";
    inp.placeholder = token?"Saved. Paste a new one to replace it.":"github_pat_…";
    inp.autocomplete="off"; inp.spellcheck=false;
    f.appendChild(inp); sh.appendChild(f);

    var st=el("p","note", (token&&REPO())?("Connected to "+REPO()+"."):"Not connected.");
    st.id="setst"; sh.appendChild(st);

    var duo=el("div","duo");
    var save=el("button","wide","Save and test");
    save.addEventListener("click",function(){
      var rv=$("repoin").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
      if(rv) putRaw(K.repo, rv);
      var v=inp.value.trim();
      if(v){ token=v; put(K.tok,v); inp.value=""; }
      $("setst").textContent="Testing…"; $("setst").className="note";
      gh("/issues?per_page=1").then(function(){ return pullBoard(); })
        .then(function(){ return pullLog(); })
        .then(function(){
          $("setst").textContent="Connected. Board synced."; $("setst").className="note ok";
          issues=null; flushQueue(); loadIssues(true).then(render);
        }).catch(function(e){
          $("setst").textContent=e.message; $("setst").className="note bad";
        });
    });
    var out=el("button","wide ghost","Forget token");
    out.addEventListener("click",function(){
      token=""; del(K.tok);
      $("setst").textContent="Token removed from this phone."; $("setst").className="note";
      issues=null; render();
    });
    duo.appendChild(save); duo.appendChild(out); sh.appendChild(duo);

    sh.appendChild(el("p","note","Make the token at github.com, Settings, Developer settings, Personal access tokens, Fine-grained. Give it access to that one repository, with Contents and Issues set to read and write. Nothing else."));
    sh.appendChild(el("p","note","It is stored in this browser alone and sent only to api.github.com. Forget it here and it is gone."));
  });
}

/* ---------- boot ---------- */
Array.prototype.forEach.call(document.querySelectorAll("nav button"),function(b){
  b.addEventListener("click",function(){ view=b.dataset.v; recHint=""; render(); });
});
$("gear").addEventListener("click",settings);
$("theme").addEventListener("click",function(){
  var now=getRaw(K.theme);
  var dark=(now==="dark")||(!now && matchMedia("(prefers-color-scheme: dark)").matches);
  putRaw(K.theme, dark?"light":"dark");
  applyTheme();
});
document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeSheet(); });

/* ---------- boot ---------- */
applyTheme();
render();
setInterval(function(){ if(view==="now"||view==="threads") render(); }, 30000);

if(token){
  flushQueue();
  pullBoard().then(function(j){ if(j){ syncMsg="synced"; render(); } })
             .catch(function(e){ syncMsg=e.message; });
  pullLog().then(render).catch(function(){});
}

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("sw.js?v=7",{updateViaCache:"none"}).then(function(reg){
      try{ reg.update(); }catch(e){}
    }).catch(function(){});
  });
}
})();
