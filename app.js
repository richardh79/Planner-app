/* Planner. An installable board over a private GitHub repository.
   No server. The token lives only in this browser and goes only to api.github.com. */
(function(){
"use strict";

var K    = { tok:"planner.token", repo:"planner.repo", board:"planner.board", focus:"planner.focus",
             mins:"planner.mins", queue:"planner.queue", lang:"planner.lang" };
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
  threads:[],
  week:[[],[],[],[],[],[],[]],
  open:[]
};

var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ---------- state ---------- */
var board = get(K.board, null) || DEFAULT;
var token = get(K.tok, "");
var focus = get(K.focus, null);
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

/* ---------- tracking ---------- */
function startFocus(id){
  if(focus && focus.id!==id) stopFocus(true);
  focus={ id:id, at:Date.now() };
  put(K.focus,focus); render();
}
function stopFocus(chain){
  if(!focus) return;
  var f=focus, m=Math.round((Date.now()-f.at)/60000);
  mins[f.id]=(mins[f.id]||0)+m; put(K.mins,mins);
  focus=null; del(K.focus);
  if(m>=1){
    var line = JSON.stringify({thread:f.id, start:new Date(f.at).toISOString(),
                               end:new Date().toISOString(), minutes:m});
    queue.push({kind:"log", line:line}); put(K.queue,queue);
    flushQueue().then(function(){ if(view==="threads"||view==="now") render(); });
  }
  if(!chain) render();
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
  var fin="";
  r.onresult=function(ev){
    var it="";
    for(var i=ev.resultIndex;i<ev.results.length;i++){
      var tx=ev.results[i][0].transcript;
      if(ev.results[i].isFinal) fin+=tx; else it+=tx;
    }
    var out=(recBase?recBase+" ":"")+fin+it;
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
function render(){
  var m=$("main"); if(!m) return;
  try{
    m.innerHTML="";
    $("clk").textContent = DAYS[new Date().getDay()]+" "+hm(nowMin());
    $("ttl").textContent = {now:"Now",threads:"Threads",say:"Say",inbox:"Inbox"}[view];
    ({now:vNow, threads:vThreads, say:vSay, inbox:vInbox}[view])(m);
    Array.prototype.forEach.call(document.querySelectorAll("nav button"),function(b){
      if(b.dataset.v===view) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
  }catch(e){
    m.innerHTML="";
    var p=el("p","note bad","Something failed to draw: "+e.message);
    m.appendChild(p);
  }
}

function heroCard(){
  var cur=curBlock(), nx=nextBlock(), t=nowMin();
  var col, title, sub, left, lu;
  if(cur){
    col=cur.b[3]; title=cur.b[1]; sub=cur.b[2];
    left=dur(cur.b[5]-t); lu="left";
    if(cur.b[6]){
      if(focus){ var f=T(focus.id); if(f){ col=f.c; title=f.n; sub="Working now, "+dur((Date.now()-focus.at)/60000)+" so far."; } }
      else { var s=suggested(); if(s) sub="Nothing started. Suggested: "+s.n+"."; }
    }
  } else {
    col="--neutral"; title="Off the clock"; sub="Nothing is scheduled against this hour.";
    left = nx?dur(nx[4]-t):"—"; lu = nx?"until next":"done today";
  }
  var c=el("div","card tint hero"); c.style.color="var("+col+")";
  var rw=el("div","rw"), L=el("div"); L.style.minWidth="0";
  L.appendChild(el("span","lb", focus?"Working on":"Right now"));
  L.appendChild(el("span","ttl any",title));
  L.appendChild(el("span","sub any",sub));
  var R=el("span","left",left); R.appendChild(el("u",null,lu));
  rw.appendChild(L); rw.appendChild(R); c.appendChild(rw);
  var nxr=el("div","nx"); nxr.appendChild(el("b",null,"Next"));
  nxr.appendChild(el("span","any", nx?(hm(nx[4])+"  "+nx[1]):"Nothing else today."));
  c.appendChild(nxr);
  return c;
}

function focusCard(){
  var c=el("div","card fb"+(focus?" on":""));
  c.appendChild(el("span","dot"));
  var t=el("span","t");
  if(focus){ var f=T(focus.id);
    t.appendChild(el("b",null,f?f.n:focus.id));
    t.appendChild(el("i",null,dur((Date.now()-focus.at)/60000)+" this session"));
  } else {
    t.appendChild(el("b",null,"Nothing running"));
    t.appendChild(el("i",null,"Start a thread to track it"));
  }
  c.appendChild(t);
  if(focus){ var b=el("button","btn","Stop"); b.addEventListener("click",function(){ stopFocus(); }); c.appendChild(b); }
  return c;
}

function vNow(m){
  m.appendChild(heroCard());
  m.appendChild(focusCard());

  var s1=el("div","sec"), h1=el("div","sech");
  h1.appendChild(el("h2",null,"The one line")); s1.appendChild(h1);
  var hc=el("div","card"); hc.style.padding="14px 15px";
  hc.appendChild(el("p","any",board.headline)).style.cssText="margin:0;font-size:.88rem;line-height:1.5";
  s1.appendChild(hc); m.appendChild(s1);

  var anyWeek=false;
  for(var wi=0;wi<board.week.length;wi++) if((board.week[wi]||[]).length) anyWeek=true;
  if(anyWeek){
  var s2=el("div","sec"), h2=el("div","sech");
  h2.appendChild(el("h2",null,"The week"));
  h2.appendChild(el("span",null, FULL[selDay]+(selDay===new Date().getDay()?" · today":"")));
  s2.appendChild(h2);
  var strip=el("div","strip");
  DAYS.forEach(function(d,i){
    var b=el("button","dbt",d); b.setAttribute("aria-pressed", i===selDay?"true":"false");
    b.addEventListener("click",function(){ selDay=i; render(); });
    strip.appendChild(b);
  });
  s2.appendChild(strip);
  var wk=el("div","wk"), cur=curBlock(), td=new Date().getDay();
  (board.week[selDay]||[]).forEach(function(x,ix){
    var b=el("div","blk tint"+((selDay===td&&cur&&cur.i===ix)?" now":"")); b.style.color="var("+x[3]+")";
    b.appendChild(el("span","tm",x[0]));
    var bd=el("span"); bd.style.minWidth="0";
    bd.appendChild(el("b","any",x[1])); bd.appendChild(el("i","any",x[2]));
    b.appendChild(bd); wk.appendChild(b);
  });
  s2.appendChild(wk); m.appendChild(s2);
  }

  if(board.open && board.open.length){
    var s3=el("div","sec"), h3=el("div","sech");
    h3.appendChild(el("h2",null,"Waiting on you"));
    h3.appendChild(el("span",null,board.open.length+" open"));
    s3.appendChild(h3);
    var c3=el("div","card"); c3.style.padding="14px 15px";
    var ol=el("ol","ol");
    board.open.forEach(function(q){ ol.appendChild(el("li","any",q)); });
    c3.appendChild(ol); s3.appendChild(c3); m.appendChild(s3);
  }

  var f=el("p","note","Board updated "+(board.updated||"—")+(syncMsg?(" · "+syncMsg):""));
  m.appendChild(f);
}

function vThreads(m){
  m.appendChild(focusCard());
  var s=el("div","sec"), h=el("div","sech");
  h.appendChild(el("h2",null,"Threads"));
  h.appendChild(el("span",null,"tap to start · 🎙 to speak"));
  s.appendChild(h);
  if(!board.threads.length){
    s.appendChild(el("p","empty","No threads yet. Connect the app in settings and the board loads from your repository."));
  }
  board.threads.forEach(function(t){
    var on = !!(focus && focus.id===t.id);
    var pct = t.st.length>1 ? Math.round(t.at/(t.st.length-1)*100) : 0;
    var row=el("div","card tint tr"+(on?" on":"")); row.style.color="var("+t.c+")";
    var b=el("button","trm");
    var hd=el("div","trh"); hd.appendChild(el("b","any",t.n)); hd.appendChild(el("i",null,on?"Running":t.tag));
    var bar=el("div","pbar"); var f2=el("i"); f2.style.width=Math.max(pct,5)+"%"; bar.appendChild(f2);
    var ft=el("div","trf");
    ft.appendChild(el("span","any",t.st[t.at]+" · "+t.why));
    var mm=(mins[t.id]||0)+(on?(Date.now()-focus.at)/60000:0);
    ft.appendChild(el("em",null, mm?dur(mm):"—"));
    b.appendChild(hd); b.appendChild(bar); b.appendChild(ft);
    b.addEventListener("click",function(){ on?stopFocus():startFocus(t.id); });
    var v=el("button","trv"); v.setAttribute("aria-label","Speak an update on "+t.n);
    v.appendChild(el("span",null,"🎙"));
    v.addEventListener("click",function(e){ e.stopPropagation(); view="say"; sayThread=t.id; render(); });
    row.appendChild(b); row.appendChild(v);
    s.appendChild(row);
  });
  m.appendChild(s);
}

var sayThread="", sayKind="Update", sayText="";
function vSay(m){
  var c=el("div","card"); c.style.cssText="padding:15px;margin-top:12px";

  var f1=el("div","fld"); f1.appendChild(el("label","lb","Kind"));
  var sel1=el("select");
  ["Update","Decision","New thread","Ask"].forEach(function(k){
    var o=el("option",null,k); o.value=k; if(k===sayKind) o.selected=true; sel1.appendChild(o);
  });
  sel1.addEventListener("change",function(){ sayKind=sel1.value; });
  f1.appendChild(sel1); c.appendChild(f1);

  var f2=el("div","fld"); f2.appendChild(el("label","lb","About"));
  var sel2=el("select");
  var o0=el("option",null,"Not a specific thread"); o0.value=""; sel2.appendChild(o0);
  board.threads.forEach(function(t){
    var o=el("option",null,t.n); o.value=t.id; if(t.id===sayThread) o.selected=true; sel2.appendChild(o);
  });
  sel2.addEventListener("change",function(){ sayThread=sel2.value; });
  f2.appendChild(sel2); c.appendChild(f2);

  var f3=el("div","fld"); f3.appendChild(el("label","lb","What happened"));
  var ta=el("textarea"); ta.id="sayta"; ta.setAttribute("dir","auto");
  ta.placeholder="Speak or type.";
  ta.value=sayText;
  ta.addEventListener("input",function(){ sayText=ta.value; });
  f3.appendChild(ta); c.appendChild(f3);

  var mic=el("div","mic");
  var rb=el("button","rec"+(live?" on":""), live?"■":"🎙");
  rb.setAttribute("aria-label", live?"Stop dictation":"Start dictation");
  if(!SR){ rb.disabled=true; rb.style.opacity=".4"; }
  rb.addEventListener("click",function(){ if(live){ recStop(); render(); } else { recStart("sayta"); } });
  mic.appendChild(rb);
  mic.appendChild(el("span","hint", recHint || (SR
    ? "Tap and speak. Or use the keyboard's microphone key."
    : "Dictation not available in this browser. Use the keyboard's microphone key.")));
  if(SR){
    var lg=el("button","lang",LANGS[langIx][1]);
    lg.addEventListener("click",function(){ langIx=(langIx+1)%LANGS.length; put(K.lang,langIx); recStop(); render(); });
    mic.appendChild(lg);
  }
  c.appendChild(mic);

  var send=el("button","btn wide","Send to Claude"); send.style.marginTop="14px";
  send.addEventListener("click",function(){
    var box=$("sayta"), v=box?box.value.trim():"";
    if(!v) return;
    recStop();
    var th = sayThread?T(sayThread):null;
    var title = sayKind + (th?(": "+th.n):"");
    var body = v + "\n\n---\n" + (th?("Thread: `"+th.id+"` — "+th.n+"\n"):"") +
               "Sent from the Planner app, " + new Date().toISOString() + ".";
    queue.push({kind:"issue", title:title, body:body}); put(K.queue,queue);
    box.value=""; sayText=""; sayThread=""; recHint="";
    syncMsg = queue.length + " queued";
    render();
    flushQueue().then(function(){
      syncMsg = queue.length ? (queue.length+" still queued, no signal") : "Sent.";
      issues=null; loadIssues(true).then(function(){ view="inbox"; render(); });
    });
  });
  c.appendChild(send);

  c.appendChild(el("p","note","It becomes an issue in the repository. Claude reads it, does the work, replies here, and closes it."));
  m.appendChild(c);

  if(queue.length){
    var q=el("p","note bad", queue.length+" item(s) waiting to send. They go as soon as there is signal.");
    m.appendChild(q);
  }
}

function vInbox(m){
  if(!token){ m.appendChild(needToken()); return; }
  var s=el("div","sec"); s.style.marginTop="12px";
  var h=el("div","sech");
  h.appendChild(el("h2",null,"Open"));
  var rf=el("button","btn gh","Refresh");
  rf.addEventListener("click",function(){ issues=null; loadIssues(true).then(render); });
  h.appendChild(rf); s.appendChild(h);

  if(issuesErr){ s.appendChild(el("p","note bad",issuesErr)); }
  if(!issues){ s.appendChild(el("p","note","Loading…")); loadIssues(true).then(render); m.appendChild(s); return; }
  if(!issues.length){ s.appendChild(el("p","empty","Nothing open. Everything you sent has been dealt with.")); m.appendChild(s); return; }

  issues.forEach(function(is){
    var c=el("button","card iss");
    var top=el("div","top");
    top.appendChild(el("span",null,"#"+is.number));
    top.appendChild(el("span",null,ago(is.created_at)));
    c.appendChild(top);
    c.appendChild(el("b","any",is.title));
    var body=(is.body||"").split("\n---\n")[0].trim();
    if(body) c.appendChild(el("p","any", body.length>160?body.slice(0,160)+"…":body));
    if(is.comments) c.appendChild(el("div","rep any", is.comments+" repl"+(is.comments===1?"y":"ies")+" · tap to read"));
    c.addEventListener("click",function(){ openIssue(is); });
    s.appendChild(c);
  });
  m.appendChild(s);
}

function needToken(){
  var c=el("div","card"); c.style.cssText="padding:16px;margin-top:12px";
  c.appendChild(el("h2",null,"Connect it once"));
  c.appendChild(el("p","note","The app talks straight to your private repository. It needs a token, made by you, kept only on this phone."));
  var b=el("button","btn wide","Open settings"); b.style.marginTop="12px";
  b.addEventListener("click",settings); c.appendChild(b);
  return c;
}

/* ---------- sheets ---------- */
function sheet(build){
  var h=$("sheet"); h.innerHTML="";
  var ov=el("div","ov");
  ov.addEventListener("click",function(e){ if(e.target===ov) closeSheet(); });
  var sh=el("div","sh");
  build(sh, closeSheet);
  ov.appendChild(sh); h.appendChild(ov);
}
function closeSheet(){ $("sheet").innerHTML=""; }

function openIssue(is){
  sheet(function(sh){
    var hd=el("div","hd");
    var L=el("div"); L.style.minWidth="0";
    L.appendChild(el("span","lb","#"+is.number+" · "+ago(is.created_at)));
    L.appendChild(el("b","any",is.title));
    var x=el("button",null,"✕"); x.style.cssText="flex:none;color:var(--dim);padding:2px 4px";
    x.addEventListener("click",closeSheet);
    hd.appendChild(L); hd.appendChild(x); sh.appendChild(hd);

    var b=el("p","any",(is.body||"").trim());
    b.style.cssText="white-space:pre-wrap;font-size:.85rem;line-height:1.5;margin:10px 0 0;color:var(--ink2)";
    sh.appendChild(b);

    var box=el("div"); box.id="cmts"; sh.appendChild(box);
    box.appendChild(el("p","note", is.comments?"Loading replies…":"No reply yet."));
    if(is.comments){
      gh("/issues/"+is.number+"/comments?per_page=30").then(function(cs){
        box.innerHTML="";
        (cs||[]).forEach(function(c){
          var d=el("div","rep any"); d.style.marginTop="9px";
          d.appendChild(el("div","lb", (c.user&&c.user.login?c.user.login:"reply")+" · "+ago(c.created_at)));
          var p=el("p","any",(c.body||"").trim());
          p.style.cssText="white-space:pre-wrap;margin:5px 0 0;font-size:.82rem;line-height:1.5";
          d.appendChild(p); box.appendChild(d);
        });
        if(!box.children.length) box.appendChild(el("p","note","No reply yet."));
      }).catch(function(e){ box.innerHTML=""; box.appendChild(el("p","note bad",e.message)); });
    }

    var row=el("div","row");
    var a=el("a","btn gh","Open on GitHub");
    a.href="https://github.com/"+REPO()+"/issues/"+is.number; a.target="_blank"; a.rel="noopener";
    a.style.cssText+=";flex:1;text-align:center;text-decoration:none";
    var cl=el("button","btn","Done, close it");
    cl.addEventListener("click",function(){
      cl.textContent="Closing…";
      gh("/issues/"+is.number, {method:"PATCH", body:{state:"closed"}}).then(function(){
        closeSheet(); issues=null; loadIssues(true).then(render);
      }).catch(function(e){ cl.textContent=e.message; });
    });
    row.appendChild(a); row.appendChild(cl); sh.appendChild(row);
  });
}

function settings(){
  sheet(function(sh){
    var hd=el("div","hd");
    var L=el("div"); L.appendChild(el("span","lb","Settings")); L.appendChild(el("b",null,"Connection"));
    var x=el("button",null,"✕"); x.style.cssText="flex:none;color:var(--dim);padding:2px 4px";
    x.addEventListener("click",closeSheet);
    hd.appendChild(L); hd.appendChild(x); sh.appendChild(hd);

    var f0=el("div","fld"); f0.appendChild(el("label","lb","Repository"));
    var rin=el("input"); rin.type="text"; rin.id="repoin"; rin.value=REPO();
    rin.placeholder="owner/name"; rin.autocomplete="off"; rin.spellcheck=false;
    f0.appendChild(rin); sh.appendChild(f0);

    var f=el("div","fld"); f.appendChild(el("label","lb","GitHub token"));
    var inp=el("input"); inp.type="password"; inp.id="tokin"; inp.placeholder=token?"Saved. Paste a new one to replace it.":"github_pat_…";
    inp.autocomplete="off"; inp.spellcheck=false;
    f.appendChild(inp); sh.appendChild(f);

    var st=el("p","note", (token&&REPO())?("Connected to "+REPO()+"."):"Not connected.");
    st.id="setst"; sh.appendChild(st);

    var row=el("div","row");
    var save=el("button","btn","Save and test");
    save.addEventListener("click",function(){
      var rv=$("repoin").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
      if(rv) putRaw(K.repo, rv);
      var v=inp.value.trim();
      if(v){ token=v; put(K.tok,v); inp.value=""; }
      $("setst").textContent="Testing…"; $("setst").className="note";
      gh("/issues?per_page=1").then(function(){
        return pullBoard();
      }).then(function(){
        $("setst").textContent="Connected. Board synced.";
        $("setst").className="note ok";
        issues=null; flushQueue(); loadIssues(true).then(render);
      }).catch(function(e){
        $("setst").textContent=e.message; $("setst").className="note bad";
      });
    });
    var out=el("button","btn gh","Forget token");
    out.addEventListener("click",function(){
      token=""; del(K.tok); $("setst").textContent="Token removed from this phone."; $("setst").className="note";
      issues=null; render();
    });
    row.appendChild(save); row.appendChild(out); sh.appendChild(row);

    sh.appendChild(el("p","note","Make the token at github.com, Settings, Developer settings, Personal access tokens, Fine-grained. Give it access to the Planner repository only, with Contents and Issues set to read and write. Nothing else."));
    sh.appendChild(el("p","note","The token is stored in this browser alone. It is sent to api.github.com and nowhere else. Forget it here and it is gone."));
  });
}

/* ---------- boot ---------- */
Array.prototype.forEach.call(document.querySelectorAll("nav button"),function(b){
  b.addEventListener("click",function(){ view=b.dataset.v; recHint=""; render(); });
});
$("gear").addEventListener("click",settings);
document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeSheet(); });

render();
setInterval(function(){ if(view==="now"||view==="threads") render(); }, 30000);

if(token){
  flushQueue();
  pullBoard().then(function(j){ if(j){ syncMsg="synced"; render(); } })
             .catch(function(e){ syncMsg=e.message; });
}

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("sw.js").catch(function(){});
  });
}
})();
