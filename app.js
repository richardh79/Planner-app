/* Planner. An installable board over a private GitHub repository.
   No server. The token lives only in this browser and goes only to api.github.com. */
(function(){
"use strict";
UI.afterWrite = afterWrite;   // core.js calls these two; each page answers them its own way
UI.setStage = setStage;

function M(h,m){ return h*60+(m||0); }

var openDom = "";    // which category is expanded in Work
function runCount(){ return runningIds().length; }
var view  = "now";
(function(){ var h=(location.hash||"").slice(1); if(/^(now|map|threads|say|inbox)$/.test(h)) view=h; })();
var selDay = new Date().getDay();
var mapDay = new Date().getDay();
var issuesAt = 0;
var syncMsg = "";

function appendLog(line){ return appendLine("data/log.jsonl", line, "Session log"); }

function setDoDate(t, iso){
  if(iso) dates[t.id]=iso; else delete dates[t.id];
  queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":iso||null, at:new Date().toISOString()})});
  put(K.queue,queue); syncMsg = iso?("on "+iso):"undated"; render();
  flushQueue().then(function(){ syncMsg = queue.length?"queued, no signal":(iso?("on "+iso):"undated"); render(); });
}
function dayStr(dayIx){
  var d=new Date();
  d.setDate(d.getDate() + (dayIx - d.getDay()));
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
function todayStr(){
  var d=new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
function assign(dateStr, blockIx, threadId){
  plan[dateStr+"#"+blockId(dateStr,blockIx)]=threadId;
  queue.push({kind:"plan", line:JSON.stringify({date:dateStr, block:blockIx, key:blockId(dateStr,blockIx), thread:threadId,
    at:new Date().toISOString()})});
  put(K.queue,queue); syncMsg="saving the plan"; render();
  flushQueue().then(function(){ syncMsg = queue.length?"queued, no signal":"plan saved"; render(); });
}

function pullLog(){
  return gh("/contents/data/log.jsonl", {soft404:true}).then(function(r){
    if(!r){ mins={}; put(K.mins,mins); return; }
    if(!r.content) return;
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

function loadIssues(force){
  if(!token) return Promise.resolve();
  if(!force && issues && Date.now()-issuesAt < 60000) return Promise.resolve();
  return gh("/issues?state=open&per_page=30&sort=created&direction=desc").then(function(r){
    issues = (r||[]).filter(function(x){ return !x.pull_request; });
    issuesAt = Date.now(); issuesErr="";
  }).catch(function(e){ issuesErr = e.message; });
}

function afterWrite(msg){
  syncMsg="saving"; render();
  flushQueue().then(function(){
    syncMsg = deadNote || (queue.length ? "queued, no signal" : msg);
    deadNote="";
    render(); mine=null;
  });
}

setTimeout(function(){ mergeAdded(); applyWeekEdits(); },0);   // the cached board, before the network answers
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

function suggested(){
  for(var i=0;i<board.threads.length;i++){
    var x=board.threads[i];
    if(x.tag==="Phase 1" && x.at<2) return x;
  }
  return board.threads[0];
}

function domains(){ return (board.domains&&board.domains.length) ? board.domains : []; }
function domOf(t){
  var d=domains();
  for(var i=0;i<d.length;i++) if(d[i].id===(t&&t.dom)) return d[i];
  return null;
}
function setStage(t, ix){
  if(statuses[t.id] && statuses[t.id].stage===ix) return;   // a second tap is not a second update
  var label=(t.st||[])[ix]||"";
  statuses[t.id]={thread:t.id, stage:ix, label:label, at:new Date().toISOString()};
  queue.push({kind:"status", line:JSON.stringify(statuses[t.id])});
  queue.push({kind:"issue", title:"Update: "+t.n,
    body:"Stage set to **"+label+"**.\n\n---\nThread: `"+t.id+"` — "+t.n+
         "\nSent from the Planner app, "+new Date().toISOString()+"."});
  put(K.queue,queue); syncMsg="saving the stage"; render();
  flushQueue().then(function(){
    syncMsg = queue.length ? "queued, no signal" : "stage saved";
    issues=null; loadIssues(true).then(render);
  });
}

function goalOf(t){
  if(!t || !t.goal) return null;
  for(var i=0;i<(board.goals||[]).length;i++) if(board.goals[i].id===t.goal) return board.goals[i];
  return null;
}
function liveMins(t){
  return (mins[t.id]||0) + (deskMins[t.id]||0) + (isOn(t.id)?(Date.now()-running[t.id])/60000:0);
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

function startFocus(id){
  if(isOn(id)) return;
  runningIds().forEach(function(x){ stopFocus(x); });   // one block, one thread: starting one ends the other
  running[id]=Date.now(); put(K.running,running); render();
}

function stopFocus(id){
  if(id==null){ runningIds().forEach(function(x){ stopFocus(x); }); return; }
  if(!isOn(id)) return;
  var at=running[id], m=realMinutes(Math.round((Date.now()-at)/60000));
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

var LANGS=[["ar-SA","عربي"],["en-GB","English"]];
var live=false,
    recBase="",
    recHint="";

var recWant=false, recRestarts=0, recLastResult=0;
/* The browser ends a session on its own: after a few seconds of silence on
   Android, after about a minute on iPhone, on a network hiccup, when the
   screen dims. None of those is him tapping stop. So the session is restarted
   until he does tap stop, and what was heard so far is folded into the base
   text first, so nothing is lost and nothing repeats. */
function recStart(target){
  if(!SR) return;
  recWant=true; recRestarts=0;
  recRun(target);
}
function recRun(target){
  var box=$(target); recBase = (box?box.value:sayText).replace(/\s+$/,"");
  var r; try{ r=new SR(); }catch(e){ recWant=false; recHint="Could not start: "+e.message; render(); return; }
  r.lang=LANGS[langIx][0]; r.continuous=true; r.interimResults=true;
  r.onresult=function(ev){
    recLastResult=Date.now(); recRestarts=0;
    var all = joinResults(ev.results);
    var out=(recBase?recBase+" ":"")+all;
    sayText=out;
    var b=$(target); if(b) b.value=out;
  };
  r.onerror=function(ev){
    var c=(ev&&ev.error)||"unknown";
    if(c==="not-allowed"||c==="service-not-allowed"){
      recWant=false; live=false; rec=null;
      recHint="Microphone blocked. Use the keyboard's microphone key instead."; render(); return;
    }
    if(c==="no-speech"||c==="aborted"||c==="network"||c==="audio-capture") return; /* onend follows and restarts */
    recWant=false; live=false; rec=null;
    recHint="Dictation stopped: "+c+". The keyboard's microphone key still works."; render();
  };
  r.onend=function(){
    rec=null;
    if(!recWant){ live=false; recHint="Stopped."; render(); return; }
    recRestarts++;
    if(recRestarts>8 && Date.now()-recLastResult>60000){
      recWant=false; live=false; recHint="Stopped: nothing heard for a minute. Tap to start again."; render(); return;
    }
    setTimeout(function(){ if(recWant && !rec) recRun(target); }, 250);
  };
  try{ r.start(); rec=r; live=true; if(recRestarts===0){ recHint="Listening. Speak, then tap to stop."; render(); } }
  catch(e){ recWant=false; live=false; recHint="Could not start: "+e.message; render(); }
}
function recStop(){ recWant=false; if(rec){ try{ rec.stop(); }catch(e){} } live=false; rec=null; }

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

  var qq=todaysQuestion();
  if(qq) m.appendChild(questionCard(qq));
  unlinked.slice(0,3).forEach(function(u){ m.appendChild(linkCard(u)); });
  openSuggestions().slice(0,3).forEach(function(sg){ m.appendChild(suggestionCard(sg, SCLS)); });

  var pinned=pinnedThreads();
  if(pinned.length){
    var sp=el("div","sec"); sp.appendChild(sech("Pinned", String(pinned.length)));
    pinned.forEach(function(t){ sp.appendChild(threadRow(t)); });
    m.appendChild(sp);
  }
  var tds=openTodos();
  if(tds.length){
    var st=el("div","sec"); st.appendChild(sech("To do", tds.length+" open"));
    tds.slice(0,8).forEach(function(td){ st.appendChild(todoRow(td)); });
    if(tds.length>8) st.appendChild(el("p","note","and "+(tds.length-8)+" more, on each path"));
    m.appendChild(st);
  }

  var chase=board.threads.filter(needsChase);
  if(chase.length){
    var sc=el("div","sec");
    sc.appendChild(sech("Chase", chase.length+" waiting too long"));
    chase.sort(function(a,b){ return clockDays(b)-clockDays(a); }).forEach(function(t){ sc.appendChild(chaseCard(t)); });
    m.appendChild(sc);
  }

  var buckets={overdue:[],today:[],week:[]};
  board.threads.forEach(function(t){ var bk=bucketOf(t); if(buckets[bk]) buckets[bk].push(t); });
  [["overdue","Late"],["today","On today"],["week","This week"]].forEach(function(pair){
    var list=buckets[pair[0]];
    if(!list.length) return;
    var sd=el("div","sec");
    sd.appendChild(sech(pair[1], String(list.length)));
    list.forEach(function(t){ sd.appendChild(threadRow(t)); });
    m.appendChild(sd);
  });
  if(!chase.length && !buckets.overdue.length && !buckets.today.length && board.threads.length){
    var se0=el("div","sec");
    se0.appendChild(sech("On today"));
    var e0=band("flat");
    e0.appendChild(el("p","empty","Nothing is dated for today. Open a path and give it a day."));
    se0.appendChild(e0); m.appendChild(se0);
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
    var dstr = dayStr(selDay), isToday = (selDay===td);
    (board.week[selDay]||[]).forEach(function(x,ix){
      var marker=x[5]<=x[4], work=!!x[6];
      var who=planned(dstr,ix), th=who?T(who):null;
      var isNow=isToday&&cur&&cur.i===ix&&!marker;
      var tappable = !marker;
      var b=band("blk"+(tappable?" walkblk":"")+(isNow?" on":"")+((work&&!marker&&!th)?" hole":""),
                 th?th.c:x[3], tappable?"button":"div");
      b.appendChild(el("span","t",x[0]));
      var d=el("span","d");
      d.appendChild(el("b","any",x[1]));
      if(th) d.appendChild(el("span","any"+(isOn(th.id)?" livetxt":""), (isOn(th.id)?"running · ":"")+th.n));
      else if(work && !marker) d.appendChild(el("span","any holetxt","Unassigned. Tap to put a thread on it."));
      else d.appendChild(el("span","any",(x[2]||"")+(x[8]&&x[8].once?" \u00b7 this week only":"")));
      b.appendChild(d);
      if(tappable){
        b.appendChild(el("span","chip"+(th?"":" quiet"), work?(th?"change":"assign"):"edit"));
        b.addEventListener("click",function(){ if(work) assignSheet(dstr, ix, x, selDay); else blockSheet(selDay, x); });
      }
      s2.appendChild(b);
    });
    var addb=el("button","addhere","+ Add to "+FULL[selDay]);
    addb.addEventListener("click",function(){ blockSheet(selDay, null); });
    s2.appendChild(addb);
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

  var ql=qLeft();
  if(ql.length>1){
    var s3=el("div","sec");
    s3.appendChild(sech("Also waiting on you", (ql.length-1)+" more, one a day"));
    var c=band("flat");
    var rows=el("div","rows"); rows.style.marginTop="0";
    ql.filter(function(q){ return !qq || q.id!==qq.id; }).forEach(function(q){
      var r=el("button","row");
      r.style.setProperty("--a","var(--hot)");
      r.appendChild(el("span","dot"));
      var nm=el("span","nm any"); nm.textContent=q.q;
      r.appendChild(nm);
      r.appendChild(el("span","val num",String(qNumber(q))));
      r.addEventListener("click",function(){ questionSheet(q); });
      rows.appendChild(r);
    });
    c.appendChild(rows); s3.appendChild(c); m.appendChild(s3);
  }

  m.appendChild(el("p","note","Board updated "+(board.updated||"—")+(syncMsg?(" · "+syncMsg):"")));
}

function questionCard(q){
  var c=band("qcard","--accent");
  kicker(c,"One question · "+qNumber(q)+" of "+qList().length);
  c.appendChild(el("p","qq any",q.q));
  if(q.why) c.appendChild(el("p","note any",q.why)).style.marginTop="6px";
  var o=el("div","opts");
  (q.opts||[]).forEach(function(op){
    var b=el("button","opt"+(op.say?" say":""), op.a);
    b.addEventListener("click",function(){
      if(op.say){ sayKind="Answer"; sayQ=q.id; sayText=q.q+"\n"; view="say"; render(); window.scrollTo(0,0); return; }
      answerQ(q, op.a);
    });
    o.appendChild(b);
  });
  if(!(q.opts||[]).length){
    var sb=el("button","opt say","Answer by speaking");
    sb.addEventListener("click",function(){ sayKind="Answer"; sayQ=q.id; sayText=q.q+"\n"; view="say"; render(); });
    o.appendChild(sb);
  }
  c.appendChild(o);
  if(qLeft().length>1){
    var nx=el("button","qnext","Not now, show the next one");
    nx.addEventListener("click",function(){ qSkip++; render(); });
    c.appendChild(nx);
  }
  return c;
}
var SCLS={box:"band qcard sugg", kicker:"kicker tag", text:"qq sm any", check:"chk", row:"scoperow", pri:"sbtn pri", btn:"sbtn"};
function todoRow(td){
  var t=td.thread?T(td.thread):null;
  var r=el("div","todo"); r.style.setProperty("--a","var("+(t?t.c:"--neutral")+")");
  var c=el("button","tick"); c.setAttribute("aria-label","Mark done");
  c.addEventListener("click",function(){ c.classList.add("on"); setTimeout(function(){ doneTodo(td.id); },220); });
  r.appendChild(c);
  var tx=el("span","tt"); tx.appendChild(el("b","any",td.text));
  var sub=[t?t.n:"", todoWhen(td)].filter(Boolean).join(" \u00b7 ");
  if(sub) tx.appendChild(el("span","any"+(td.due&&td.due<localDay()?" late":""),sub));
  r.appendChild(tx);
  return r;
}
function linkCard(u){
  var c=band("qcard","--accent");
  kicker(c,"Desktop work \u00b7 which project?");
  c.appendChild(el("p","qq any","Folder \u201C"+u.folder+"\u201D"));
  var n=el("p","note any",dur(u.min)+" worked in "+u.n+" session"+(u.n===1?"":"s")+". Tap its project once; every session in this folder counts toward it from then on, the past ones too.");
  n.style.marginTop="6px"; c.appendChild(n);
  var o=el("div","opts");
  u.cand.slice(0,3).forEach(function(id){
    var t=T(id); if(!t) return;
    var b=el("button","opt",t.n); b.addEventListener("click",function(){ linkFolder(u.folder,id); }); o.appendChild(b);
  });
  var other=el("button","opt say","Another project"); other.addEventListener("click",function(){ linkSheet(u); }); o.appendChild(other);
  var no=el("button","opt say","Not a project"); no.addEventListener("click",function(){ linkFolder(u.folder,null); }); o.appendChild(no);
  c.appendChild(o);
  return c;
}
function linkSheet(u){
  sheet(function(sh){
    shHead(sh,"Folder "+u.folder,"Which project is it?");
    domains().forEach(function(d){
      var ts=threadsIn(d.id); if(!ts.length) return;
      sh.appendChild(sech(d.n));
      ts.forEach(function(t){
        var b=el("button","row"); b.style.setProperty("--a","var("+(t.c||d.c)+")");
        b.appendChild(el("span","dot")); b.appendChild(el("span","nm any",t.n));
        b.addEventListener("click",function(){ closeSheet(); linkFolder(u.folder,t.id); });
        sh.appendChild(b);
      });
    });
  });
}
var PCLS={fld:"fld", label:"tag", check:"chk", row:"scoperow", btn:"sbtn", on:"on", pri:"pri", warn:"warn", note:"note bad"};
function blockSheet(d, blk){
  sheet(function(sh){
    shHead(sh, blk ? (FULL[d]+" \u00b7 "+blk[0]) : ("Add to "+FULL[d]), blk ? blk[1] : "A new block");
    blockEditor(sh, d, blk, PCLS, function(){ closeSheet(); render(); });
  });
}
function questionSheet(q){
  sheet(function(sh){
    shHead(sh, "Question "+qNumber(q)+" of "+qList().length, q.q);
    if(q.why) sh.appendChild(el("p","note any",q.why));
    var o=el("div","opts");
    (q.opts||[]).concat(q.opts&&q.opts.length?[]:[{a:"Answer by speaking",say:true}]).forEach(function(op){
      var b=el("button","opt"+(op.say?" say":""), op.a);
      b.addEventListener("click",function(){
        closeSheet();
        if(op.say){ sayKind="Answer"; sayQ=q.id; sayText=q.q+"\n"; view="say"; render(); return; }
        answerQ(q, op.a);
      });
      o.appendChild(b);
    });
    sh.appendChild(o);
  });
}
function waitBar(t){
  var a=chaseAfter(t), d=clockDays(t);
  var bar=el("div","wbar"); bar.style.setProperty("--w", Math.min(100, Math.round(d/(2*a)*100))+"%");
  bar.style.setProperty("--a","var("+waitTone(t)+")");
  var mark=el("b"); mark.style.left="50%"; bar.appendChild(mark);
  bar.appendChild(el("i"));
  return bar;
}
function chaseCard(t){
  var c=band("chase", waitTone(t));
  var hd=el("div","thh");
  var L=el("div"); L.style.minWidth="0";
  L.appendChild(el("b","any",t.n));
  L.appendChild(el("span","sub any","With "+cleanWho(t)+" · "+waitingDays(t)+" days"+(lastChase(t)?(" · chased "+fmtDay(lastChase(t))):"")));
  hd.appendChild(L);
  hd.appendChild(el("span","chip num",clockDays(t)+"d"));
  c.appendChild(hd);
  c.appendChild(waitBar(t));
  var dr=el("textarea","draft any"); dr.value=chaseDraft(t); dr.setAttribute("dir","auto"); dr.rows=7;
  c.appendChild(dr);
  if(whoUnsure(t)) c.appendChild(el("p","note bad","The name was heard by voice. Check the spelling before you send."));
  var bts=el("div","thb");
  var cp=el("button","go","Copy message");
  cp.addEventListener("click",function(){
    copyText(dr.value,function(ok){
      if(ok){ cp.textContent="Copied"; setTimeout(function(){ cp.textContent="Copy message"; },1600); }
      else { dr.focus(); dr.select(); cp.textContent="Selected, copy it"; }
    });
  });
  var dn=el("button",null,"Chased");
  dn.addEventListener("click",function(){ markChased(t); });
  bts.appendChild(cp); bts.appendChild(dn);
  c.appendChild(bts);
  return c;
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

/* ---------- map: everything in one look ----------
   Goals as tiles you can count, what is out of your hands as bars that
   change colour, the week as one strip, then the review and the paths. */
function vMap(m){
  var s=el("div","sec"); s.style.marginTop="6px";
  s.appendChild(sech("Goals","tap a tile"));
  (board.goals||[]).forEach(function(g){
    if(!g.target) return;
    var gs=goalSlots(g);
    var c=band("goal", g.c);
    var hd=el("div","thh");
    hd.appendChild(el("b","any",g.n));
    hd.appendChild(el("span","gnum num", gs.filled+"/"+gs.target));
    c.appendChild(hd);
    var grid=el("div","slots");
    grid.style.gridTemplateColumns="repeat("+Math.min(gs.target,5)+",minmax(0,1fr))";
    gs.tiles.forEach(function(tl){
      var b=el(tl.t?"button":"div","slot "+tl.s);
      b.appendChild(el("span",null,tl.label));
      if(tl.t) b.addEventListener("click",function(){ openThread(tl.t); });
      grid.appendChild(b);
    });
    c.appendChild(grid);
    if(gs.pace) c.appendChild(el("p","pace any",gs.pace));
    s.appendChild(c);
  });
  if(s.childNodes.length>1) m.appendChild(s);

  var waits=waitList().sort(function(a,b){ return clockDays(b)/chaseAfter(b)-clockDays(a)/chaseAfter(a); });
  if(waits.length){
    var sw=el("div","sec");
    sw.appendChild(sech("Out of your hands", waits.filter(needsChase).length+" to chase"));
    waits.forEach(function(t){
      var b=el("button","wrow");
      b.style.setProperty("--a","var("+waitTone(t)+")");
      var top=el("span","wtop");
      top.appendChild(el("span","nm any",t.n));
      top.appendChild(el("span","val num",clockDays(t)+"/"+chaseAfter(t)+"d"));
      b.appendChild(top);
      b.appendChild(el("span","wsub any",cleanWho(t)));
      b.appendChild(waitBar(t));
      b.addEventListener("click",function(){ openThread(t); });
      sw.appendChild(b);
    });
    m.appendChild(sw);
  }

  var anyWork=false;
  for(var wi=0;wi<7;wi++) (board.week[wi]||[]).forEach(function(x){ if(x[6]) anyWork=true; });
  if(anyWork){
    var sk=el("div","sec");
    var holes=0, filled=0;
    var strip=el("div","wstrip");
    var td=new Date().getDay();
    for(var d=0;d<7;d++){
      var col=el("button","wcol"+(d===td?" today":""));
      col.appendChild(el("span","wd",DAYS[d].slice(0,1)));
      var ds=dayStr(d);
      (board.week[d]||[]).forEach(function(x,ix){
        if(x[5]<=x[4]) return;
        var who=x[6]?planned(ds,ix):"", th=who?T(who):null;
        var cell=el("i", x[6]?(th?"on":"hole"):"fixed");
        cell.style.flexGrow=String(Math.max(1,Math.round((x[5]-x[4])/60)));
        if(th){ cell.style.background="var("+th.c+")"; filled++; }
        else if(x[6]) holes++;
        else cell.style.setProperty("--a","var("+x[3]+")");
        col.appendChild(cell);
      });
      if(d===mapDay) col.className+=" pick";
      (function(dd){ col.addEventListener("click",function(){ mapDay=dd; render(); }); })(d);
      strip.appendChild(col);
    }
    sk.appendChild(sech("The week", filled+" given · "+holes+" empty · tap a day"));
    sk.appendChild(strip);
    var mds=dayStr(mapDay);
    sk.appendChild(el("p","daycap",FULL[mapDay]+" "+fmtDay(mds)));
    (board.week[mapDay]||[]).forEach(function(x,ix){
      if(x[5]<=x[4]) return;
      var who=x[6]?planned(mds,ix):"", th=who?T(who):null;
      var r=el("button","mrow"); r.style.setProperty("--a","var("+(th?th.c:x[3])+")");
      r.appendChild(el("span","t num",x[0]));
      var tx=el("span","d");
      tx.appendChild(el("b","any",x[1]));
      tx.appendChild(el("span","any", th ? th.n : (x[6] ? "Empty. Tap to put a thread on it." : ((x[2]||"")+(x[8]&&x[8].once?" \u00b7 this week only":"")))));
      r.appendChild(tx);
      r.addEventListener("click",function(){ if(x[6]) assignSheet(mds, ix, x, mapDay); else blockSheet(mapDay, x); });
      sk.appendChild(r);
    });
    var ab=el("button","addhere","+ Add to "+FULL[mapDay]);
    ab.addEventListener("click",function(){ blockSheet(mapDay, null); });
    sk.appendChild(ab);
    m.appendChild(sk);
  }

  var drift=drifting();
  if(board.threads.length){
    var rv=band("review","--accent");
    kicker(rv,"Saturday review");
    rv.appendChild(el("p","quote any", drift.length
      ? (drift.length+" threads have no day, no hours and nobody holding them. Swipe each one: start, a day, delay or drop.")
      : "Nothing is drifting. Every thread has a day, hours, or someone holding it."));
    if(drift.length){
      var go=el("button","wide","Start the review · "+drift.length);
      go.style.marginTop="14px";
      go.addEventListener("click",reviewSheet);
      rv.appendChild(go);
    }
    m.appendChild(rv);
  }

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
  }
  m.appendChild(st);

  if(deskWeek.n){
    var dk=band("flat");
    kicker(dk,"Desktop, Claude Code, this week");
    dk.appendChild(el("p","quote num",dur(deskWeek.min)+" worked · "+deskWeek.n+" sessions · "+fmtTok(deskWeek.tok)+" tokens"));
    var dr=el("div","rows");
    deskRows().slice(0,5).forEach(function(x){
      var r=el(x.t?"button":"div","row"); r.style.setProperty("--a","var("+(x.t?x.t.c:"--neutral")+")");
      r.appendChild(el("span","dot")); r.appendChild(el("span","nm any",x.name)); r.appendChild(el("span","val num",dur(x.m)));
      if(x.t) r.addEventListener("click",function(){ openThread(x.t); });
      dr.appendChild(r);
    });
    dk.appendChild(dr); m.appendChild(dk);
  }

  var doms=domains();
  if(doms.length){
    var s2=el("div","sec");
    s2.appendChild(sech("Every path","where it ends"));
    doms.forEach(function(dm){
      var ts=threadsIn(dm.id);
      if(!ts.length) return;
      var c=band("", dm.c);
      var hd=el("div","thh");
      hd.appendChild(el("b",null,dm.n));
      hd.appendChild(el("span","chip quiet num",String(ts.length)));
      c.appendChild(hd);
      ts.forEach(function(t){
        var b=el("button","track");
        b.style.setProperty("--a","var("+(t.c||dm.c)+")");
        b.appendChild(el("span","nm any",t.n));
        var rail=el("span","railpath"); var fill=el("i");
        fill.style.width=Math.max(isUnset(t)?0:walked(t),3)+"%";
        rail.appendChild(fill); b.appendChild(rail);
        var atEnd=!isUnset(t) && stageIx(t)===stageCount(t)-1;
        b.appendChild(el("span","dest"+(atEnd?" at":""), atEnd?finalOf(t):("→ "+finalOf(t))));
        b.addEventListener("click",function(){ openThread(t); });
        c.appendChild(b);
      });
      s2.appendChild(c);
    });
    m.appendChild(s2);
  }

  if(board.apex){
    var ap=band("flat");
    kicker(ap,"Everything points here").style.color="var(--dim)";
    ap.appendChild(el("p","quote any",board.apex));
    m.appendChild(ap);
  }
}

/* The Saturday review, one card at a time. Swipe left to drop, right to
   start, up to give it the next working day, down to delay four weeks.
   The buttons do the same for anyone who would rather tap. */
function reviewSheet(){
  var list=drifting(), ix=0, prev={};
  reviewLog=[];
  onSheetClose=function(){ reviewFinish(); render(); };
  sheet(function(sh){
    sh.classList.add("rvsh");
    function decide(what, card){
      var t=list[ix]; if(!t) return;
      prev[t.id]=doDate(t)||null;
      if(card){
        var fly={drop:"translate(-140%,0) rotate(-18deg)",start:"translate(140%,0) rotate(18deg)",
                 day:"translate(0,-130%)",delay:"translate(0,130%)"}[what];
        card.style.transition="transform .22s ease-in, opacity .22s"; card.style.transform=fly; card.style.opacity="0";
      }
      reviewDecide(t, what); ix++;
      setTimeout(draw, card?200:0);
    }
    function undo(){
      if(!reviewLog.length) return;
      var r=reviewLog.pop(), t=r.t, back=prev[t.id]||null;
      delete dropped[t.id];
      if(back) dates[t.id]=back; else delete dates[t.id];
      queue.push({kind:"date", line:JSON.stringify({thread:t.id, "do":back, at:new Date().toISOString()})});
      put(K.queue,queue); flushQueue();
      ix=Math.max(0,ix-1); draw();
    }
    function draw(){
      sh.innerHTML="";
      shHead(sh,"Saturday review", ix<list.length ? ((ix+1)+" of "+list.length) : "All "+list.length+" decided");
      if(ix>=list.length){
        var n={}; reviewLog.forEach(function(r){ n[r.what]=(n[r.what]||0)+1; });
        var sum=[["start","started"],["day","given a day"],["delay","delayed"],["drop","dropped"]]
          .filter(function(x){ return n[x[0]]; }).map(function(x){ return n[x[0]]+" "+x[1]; }).join(", ");
        sh.appendChild(el("p","quote any", sum ? (sum+".") : "Nothing decided."));
        sh.appendChild(el("p","note","The days are saved. Closing sends Claude one message with the lot."));
        var dn=el("button","wide","Send and close"); dn.style.marginTop="18px";
        dn.addEventListener("click",closeSheet); sh.appendChild(dn);
        if(reviewLog.length){ var u0=el("button","wide ghost","Undo the last one"); u0.style.marginTop="10px"; u0.addEventListener("click",undo); sh.appendChild(u0); }
        return;
      }
      var t=list[ix], dm=domOf(t);
      var hint=el("div","rvdirs");
      hint.appendChild(el("span",null,"← Drop")); hint.appendChild(el("span",null,"↑ A day")); hint.appendChild(el("span",null,"Start →"));
      sh.appendChild(hint);
      var stack=el("div","rvstack");
      if(list[ix+1]) stack.appendChild(el("div","rvcard behind"));
      var card=band("rvcard", t.c||(dm&&dm.c)||"--neutral");
      kicker(card, dm?dm.n:"A path");
      card.appendChild(el("b","rvt any",t.n));
      card.appendChild(el("p","note any",(isUnset(t)?"Stage not set":stageName(t))+" → "+finalOf(t)+(t.tag?(" · "+t.tag):"")));
      if(t.next) card.appendChild(el("p","rvn any","Next: "+t.next));
      var stamp=el("span","stamp"); card.appendChild(stamp);
      var sx=0, sy=0, dx=0, dy=0, drag=false;
      function dirOf(){
        if(Math.abs(dx)>Math.abs(dy) && Math.abs(dx)>80) return dx<0?"drop":"start";
        if(Math.abs(dy)>80) return dy<0?"day":"delay";
        return "";
      }
      var WORD={drop:"DROP",start:"START",day:"A DAY",delay:"DELAY"};
      card.addEventListener("pointerdown",function(e){ drag=true; sx=e.clientX; sy=e.clientY; dx=dy=0; card.style.transition="none"; try{ card.setPointerCapture(e.pointerId); }catch(_){} });
      card.addEventListener("pointermove",function(e){
        if(!drag) return;
        dx=e.clientX-sx; dy=e.clientY-sy;
        card.style.transform="translate("+dx+"px,"+dy+"px) rotate("+(dx/20)+"deg)";
        var d=dirOf(); stamp.textContent=d?WORD[d]:""; stamp.className="stamp "+d;
      });
      function end(){
        if(!drag) return; drag=false;
        var d=dirOf();
        if(d) decide(d, card);
        else { card.style.transition="transform .18s"; card.style.transform=""; stamp.textContent=""; }
      }
      card.addEventListener("pointerup",end); card.addEventListener("pointercancel",end);
      stack.appendChild(card);
      sh.appendChild(stack);
      sh.appendChild(el("div","rvdirs one","↓ Delay four weeks"));
      var g=el("div","rvbtns");
      [["drop","Drop"],["day","A day"],["delay","Delay"],["start","Start"]].forEach(function(x){
        var b=el("button","rvb "+x[0],x[1]);
        b.addEventListener("click",function(){ decide(x[0], card); });
        g.appendChild(b);
      });
      sh.appendChild(g);
      var foot=el("div","thb");
      var sk=el("button",null,"Skip");
      sk.addEventListener("click",function(){ ix++; draw(); });
      foot.appendChild(sk);
      if(reviewLog.length){ var u=el("button",null,"Undo"); u.addEventListener("click",undo); foot.appendChild(u); }
      sh.appendChild(foot);
    }
    draw();
  });
}

function threadRow(t){
  var mm=liveMins(t), on=isOn(t.id);
  var b=el("button","row");
  b.style.setProperty("--a","var("+t.c+")");
  var d=el("span","dot"+(mm?"":" cold")); b.appendChild(d);
  var nm=el("span","nm any"); nm.textContent=t.n;
  nm.appendChild(el("u",null, (isUnset(t)?"stage not set":stageName(t))+(t.critical?" · critical path":"")));
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
  var doms=domains();
  if(!doms.length){
    var w0=el("div"); w0.style.marginTop="2px";
    board.threads.forEach(function(t){ w0.appendChild(threadCard(t)); });
    m.appendChild(w0); return;
  }
  var sq=document.createElement("input"); sq.type="search"; sq.className="searchin"; sq.id="searchin";
  sq.placeholder="Search projects, to-dos and messages"; sq.setAttribute("dir","auto"); sq.value=searchQ;
  var res=el("div","searchres");
  function paintResults(){
    res.innerHTML=""; searchQ=sq.value;
    if(searchQ.trim().length<2) return;
    if(mine===null && !loadingMine){ loadingMine=true; loadMine(true).then(function(){ loadingMine=false; paintResults(); }); }
    var r=searchAll(searchQ), any=false;
    if(r.threads.length){ any=true; res.appendChild(sech("Projects")); r.threads.forEach(function(t){ res.appendChild(threadRow(t)); }); }
    if(r.todos.length){ any=true; res.appendChild(sech("To-dos")); r.todos.forEach(function(td){ res.appendChild(td.done?el("p","note any","\u2713 "+td.text):todoRow(td)); }); }
    if(r.msgs.length){ any=true; res.appendChild(sech("Messages"));
      r.msgs.forEach(function(x){ var b=el("button","bub "+msgState(x)); b.appendChild(el("b","any",x.title)); var ft=firstLine(x.body); if(ft) b.appendChild(el("span","bt any",ft));
        b.addEventListener("click",function(){ openIssue(x); }); res.appendChild(b); }); }
    if(!any) res.appendChild(el("p","note","Nothing matches."));
  }
  sq.addEventListener("input",paintResults);
  m.appendChild(sq); m.appendChild(res); paintResults();
  var addB=el("button","wide ghost","+ Add something new");
  addB.style.marginTop="4px";
  addB.addEventListener("click",function(){ addSheet(openDom||""); });
  m.appendChild(addB);
  var wrapS=el("div"); wrapS.style.marginTop="2px";
  doms.forEach(function(dm){
    var ts=threadsIn(dm.id);
    if(!ts.length) return;
    var open = openDom===dm.id;
    var live = ts.filter(function(t){ return isOn(t.id); }).length;
    var head=band("cat"+(open?" open":""), dm.c, "button");
    var hl=el("span","catl");
    hl.appendChild(el("b",null,dm.n));
    var doneN=ts.filter(function(t){ return !isUnset(t) && stageIx(t)===stageCount(t)-1; }).length;
    hl.appendChild(el("span",null, ts.length+" path"+(ts.length===1?"":"s")+
      (doneN?(" · "+doneN+" at the final"):"")+(live?(" · "+live+" running"):"")));
    head.appendChild(hl);
    head.appendChild(el("span","chip"+(live?"":" quiet"), open?"hide":"open"));
    head.addEventListener("click",function(){ openDom = open?"":dm.id; render(); });
    wrapS.appendChild(head);
    if(open){
      ts.forEach(function(t){ wrapS.appendChild(threadCard(t)); });
      var ah=el("button","addhere","+ Add to "+dm.n);
      ah.addEventListener("click",function(){ addSheet(dm.id); });
      wrapS.appendChild(ah);
    }
  });
  m.appendChild(wrapS);
}

function threadCard(t){
  var on=isOn(t.id), mm=liveMins(t);
  var c=band("", t.c);
  var hd=el("div","thh");
  hd.appendChild(el("b","any",t.n));
  hd.appendChild(el("span","chip"+(on?"":" quiet"), on?"Running":(t.tag||"")));
  c.appendChild(hd);
  var sg=el("div","stage");
  (t.st||[]).forEach(function(_,ix){ var i=el("i"); if(!isUnset(t) && ix<=stageIx(t)) i.className="done"; sg.appendChild(i); });
  c.appendChild(sg);
  var f=el("div","thf");
  f.appendChild(el("span","any", (isUnset(t)?"stage not set":stageName(t))+" \u2192 "+finalOf(t)));
  f.appendChild(el("em","num", mm?dur(mm):"0m"));
  c.appendChild(f);
  var bts=el("div","thb");
  var go=el("button", on?"go":"", on?"Stop":"Start");
  go.addEventListener("click",function(e){ e.stopPropagation(); on?stopFocus(t.id):startFocus(t.id); });
  var sp=el("button",null,"\ud83c\udf99 Say");
  sp.addEventListener("click",function(e){ e.stopPropagation(); sayThread=t.id; view="say"; render(); });
  var mo=el("button",null,"The path");
  mo.addEventListener("click",function(e){ e.stopPropagation(); openThread(t); });
  bts.appendChild(go); bts.appendChild(sp); bts.appendChild(mo);
  c.appendChild(bts);
  return c;
}

/* ---------- add ---------- */
function addSheet(dom){
  sheet(function(sh){
    shHead(sh,"Add","Something new");
    function fld(label, node){ var f=el("div","fld"); f.appendChild(el("label","tag",label)); f.appendChild(node); sh.appendChild(f); return node; }
    var nm=document.createElement("input"); nm.type="text"; nm.id="addname"; nm.setAttribute("dir","auto");
    nm.placeholder="What is it? A paper, a patent, a course, anything";
    fld("What", nm);
    var sd=el("select"); sd.id="adddom";
    domains().forEach(function(d){ var o=el("option",null,d.n); o.value=d.id; if(d.id===dom) o.selected=true; sd.appendChild(o); });
    fld("Category", sd);
    var sg=el("select"); sg.id="addgoal";
    var o0=el("option",null,"No goal"); o0.value=""; sg.appendChild(o0);
    (board.goals||[]).forEach(function(g){ var o=el("option",null,g.n); o.value=g.id; sg.appendChild(o); });
    function guessGoal(){ var hit=""; board.threads.forEach(function(t){ if(!hit && t.dom===sd.value && t.goal) hit=t.goal; }); sg.value=hit; }
    sd.addEventListener("change",guessGoal); guessGoal();
    fld("Counts toward", sg);
    var nx=document.createElement("input"); nx.type="text"; nx.id="addnext"; nx.setAttribute("dir","auto");
    nx.placeholder="The next physical step (optional)";
    fld("Next step", nx);
    var wh=document.createElement("input"); wh.type="text"; wh.id="addwho"; wh.setAttribute("dir","auto");
    wh.placeholder="Only if someone else is holding it now";
    fld("With whom", wh);
    var go=el("button","wide","Add it"); go.style.marginTop="22px";
    var msg=el("p","note");
    go.addEventListener("click",function(){
      var n=nm.value.trim();
      if(!n){ msg.className="note bad"; msg.textContent="Give it a name first."; nm.focus(); return; }
      var t=addThread({n:n, dom:sd.value, goal:sg.value, next:nx.value, who:wh.value});
      openDom=t.dom; closeSheet(); view="threads"; render();
    });
    sh.appendChild(go); sh.appendChild(msg);
    sh.appendChild(el("p","note","It appears straight away and can be started, dated and chased. Claude files it properly at the next session."));
    setTimeout(function(){ try{ nm.focus(); }catch(e){} }, 60);
  });
}

/* ---------- say ---------- */
var sayQ="", sayThread="", sayKind="Update", sayText="", sayWho="", sayDecided="", sayActions="", searchQ="";
function vSay(m){
  var c=band("flat"); c.style.marginTop="2px";

  var f1=el("div","fld"); f1.appendChild(el("label","tag","Kind"));
  var s1=el("select");
  ["Update","Meeting","Answer","Decision","New thread","Ask"].forEach(function(k){
    var o=el("option",null,k); o.value=k; if(k===sayKind) o.selected=true; s1.appendChild(o);
  });
  s1.addEventListener("change",function(){ sayKind=s1.value; if(sayKind!=="Answer") sayQ=""; var box=$("sayta"); if(box) sayText=box.value; render(); });
  f1.appendChild(s1); c.appendChild(f1);

  var f2=el("div","fld"); f2.appendChild(el("label","tag","About"));
  var s2=el("select");
  var o0=el("option",null,"Not a specific thread"); o0.value=""; s2.appendChild(o0);
  board.threads.forEach(function(t){
    var o=el("option",null,t.n); o.value=t.id; if(t.id===sayThread) o.selected=true; s2.appendChild(o);
  });
  s2.addEventListener("change",function(){ sayThread=s2.value; });
  f2.appendChild(s2); c.appendChild(f2);

  if(sayKind==="Meeting"){
    [["With whom","sayWho",1,"Names, as you want them written"],["Decided","sayDecided",3,"One decision per line"],
     ["Actions","sayActions",3,"One per line: who does what, by when"]].forEach(function(x){
      var f=el("div","fld"); f.appendChild(el("label","tag",x[0]));
      var ta0=el(x[2]>1?"textarea":"input"); if(x[2]===1) ta0.type="text"; else ta0.rows=x[2];
      ta0.id=x[1]; ta0.setAttribute("dir","auto"); ta0.placeholder=x[3];
      ta0.value={sayWho:sayWho,sayDecided:sayDecided,sayActions:sayActions}[x[1]];
      ta0.addEventListener("input",function(){ if(x[1]==="sayWho") sayWho=ta0.value; else if(x[1]==="sayDecided") sayDecided=ta0.value; else sayActions=ta0.value; });
      if(x[2]>1) ta0.style.minHeight="6.5rem";
      f.appendChild(ta0); c.appendChild(f);
    });
  }
  var f3=el("div","fld"); f3.appendChild(el("label","tag", sayKind==="Meeting"?"Notes":"What happened"));
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
    if(sayKind==="Meeting") v=meetingBody(sayWho.trim(), sayDecided.trim(), sayActions.trim(), v);
    if(!v) return;
    if(sayKind==="Answer" && sayQ){
      /* The question card sent him here. Record it as the answer to that question, so
         it stops coming back, exactly as tapping an answer button does. */
      var qq=qList().filter(function(x){ return x.id===sayQ; })[0];
      if(qq){
        var ans=v; if(ans.indexOf(qq.q)===0) ans=ans.slice(qq.q.length);
        ans=ans.trim(); if(!ans) return;
        recStop(); box.value=""; sayText=""; sayKind="Update"; sayQ=""; sayThread=""; recHint="";
        view="now"; answerQ(qq, ans); return;
      }
    }
    recStop();
    var th=sayThread?T(sayThread):null;
    var title=sayKind+(th?(": "+th.n):"");
    var body=v+"\n\n---\n"+(th?("Thread: `"+th.id+"` — "+th.n+"\n"):"")+
             "Sent from the Planner app, "+new Date().toISOString()+".";
    queue.push({kind:"issue", title:title, body:body}); put(K.queue,queue);
    box.value=""; sayText=""; sayThread=""; recHint=""; sayWho=""; sayDecided=""; sayActions="";
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

  if(!token || !REPO()) return;
  var ms=el("div","sec");
  var hh=sech("Your messages");
  var rf=el("button","chip quiet","Refresh");
  rf.addEventListener("click",function(){ mine=null; render(); });
  hh.appendChild(rf); ms.appendChild(hh);
  var key=el("p","note tickkey");
  key.appendChild(el("span","tk sent","\u2713")); key.appendChild(document.createTextNode(" sent   "));
  key.appendChild(el("span","tk seen","\u2713\u2713")); key.appendChild(document.createTextNode(" read and answered   "));
  key.appendChild(el("span","tk filed","\u2713\u2713")); key.appendChild(document.createTextNode(" filed"));
  ms.appendChild(key);
  queue.filter(function(q){ return q.kind==="issue"; }).forEach(function(q){
    var b=el("div","bub");
    b.appendChild(el("b","any",q.title));
    var meta=el("span","meta"); meta.appendChild(el("span","tk","\u23F1")); meta.appendChild(document.createTextNode(" waiting for signal"));
    b.appendChild(meta); ms.appendChild(b);
  });
  if(mine===null){
    ms.appendChild(el("p","note","Loading…"));
    if(!loadingMine){ loadingMine=true; loadMine(true).then(function(){ loadingMine=false; if(view==="say") render(); }); }
  } else if(!mine.length){
    ms.appendChild(el("p","note","Nothing sent yet."));
  } else {
    mine.slice(0,15).forEach(function(x){
      var st=msgState(x);
      var b=el("button","bub "+st);
      b.appendChild(el("b","any",x.title));
      var body=firstLine(x.body);
      if(body) b.appendChild(el("span","bt any",body));
      var meta=el("span","meta");
      meta.appendChild(document.createTextNode(ago(x.created_at)+" "));
      var tk=el("span","tk "+st, st==="sent"?"\u2713":"\u2713\u2713");
      tk.title={sent:"Sent",seen:"Read and answered",filed:"Filed"}[st];
      meta.appendChild(tk);
      b.appendChild(meta);
      b.addEventListener("click",function(){ openIssue(x); });
      ms.appendChild(b);
      var rp=replies[x.number];
      if(rp && rp.text){
        var r=el("div","rep2");
        r.appendChild(el("b",null, st==="filed"?"Filed":"Reply"));
        r.appendChild(el("span","any",rp.text));
        ms.appendChild(r);
      }
    });
  }
  m.appendChild(ms);
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
var onSheetClose=null;
function closeSheet(){
  var h=$("sheet"); if(h) h.innerHTML="";
  if(onSheetClose){ var f=onSheetClose; onSheetClose=null; f(); }
}
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
    var on=isOn(t.id), dm=domOf(t);
    shHead(sh, dm?dm.n:(goalOf(t)?("For: "+goalOf(t).n):"A path"), t.n);
    var pb=el("button","pinb"+(isPinned(t)?" on":""), isPinned(t)?"\u2605 Pinned to the top":"\u2606 Pin to the top");
    pb.addEventListener("click",function(){ togglePin(t); closeSheet(); });
    sh.appendChild(pb);
    if(t.why) sh.appendChild(el("p","note any",t.why)).style.color="var(--ink2)";

    var c=band("", t.c);
    var f=el("div","thf"); f.style.marginTop="0";
    f.appendChild(el("span",null, on?"Running now":"Not running"));
    f.appendChild(el("em","num", dur(liveMins(t))+" this week"));
    c.appendChild(f);
    var bts=el("div","thb");
    var go=el("button","go", on?"Stop":"Start working");
    go.addEventListener("click",function(){ on?stopFocus(t.id):startFocus(t.id); closeSheet(); });
    var sp=el("button",null,"\ud83c\udf99 Say");
    sp.addEventListener("click",function(){ closeSheet(); sayThread=t.id; view="say"; render(); });
    bts.appendChild(go); bts.appendChild(sp); c.appendChild(bts);
    sh.appendChild(c);

    var s=el("div","sec"); s.appendChild(sech("The path","tap a stone"));
    var box=band("flat");
    var path=el("div","path");
    (t.st||[]).forEach(function(name,ix){
      var cur=stageIx(t), unset=isUnset(t);
      var cls = unset ? "ahead" : (ix<cur?"done":(ix===cur?"here":"ahead"));
      var b=el("button","stone "+cls);
      b.style.setProperty("--a","var("+t.c+")");
      b.appendChild(el("span","bead"));
      b.appendChild(el("span","st any",name));
      if(!unset && ix===cur) b.appendChild(el("span","mk","here"));
      if(unset && ix===0) b.appendChild(el("span","mk","not set"));
      b.addEventListener("click",function(){ setStage(t,ix); closeSheet(); });
      path.appendChild(b);
    });
    box.appendChild(path);
    var flag=el("div","final");
    flag.style.setProperty("--a","var("+t.c+")");
    var fl=el("span","fl");
    fl.appendChild(el("b","any", finalOf(t)||"No final named"));
    fl.appendChild(el("span","tag","the final"));
    flag.appendChild(fl);
    flag.appendChild(el("span","num", isUnset(t)?"not started":((stageIx(t)+1)+" of "+stageCount(t))));
    box.appendChild(flag);
    var ns=el("p","nextstep any");
    ns.appendChild(el("b","tag","next step "));
    ns.appendChild(document.createTextNode(t.next || "Not named yet. Say what it is and Claude files it."));
    box.appendChild(ns);
    s.appendChild(box);
    sh.appendChild(s);

    var tdl=openTodos(t.id);
    var stt=el("div","sec"); stt.appendChild(sech("To do", tdl.length?(tdl.length+" open"):"nothing yet"));
    tdl.forEach(function(td){ stt.appendChild(todoRow(td)); });
    var ar=el("div","addtodo");
    var ai=document.createElement("input"); ai.type="text"; ai.placeholder="Add a to-do for this"; ai.setAttribute("dir","auto");
    var ad=document.createElement("input"); ad.type="date"; ad.title="Its day, if it has one";
    var ab=el("button","sbtn pri","Add");
    ab.addEventListener("click",function(){ if(ai.value.trim()){ addTodo(t.id, ai.value, ad.value||null, WHERE); closeSheet(); openThread(t); } });
    ar.appendChild(ai); ar.appendChild(ad); ar.appendChild(ab); stt.appendChild(ar);
    sh.appendChild(stt);

    var cur=doDate(t);
    var sd=el("div","sec");
    sd.appendChild(sech("The day you touch it", cur||"no day yet"));
    var dbox=band("flat");
    var drow=el("div","thb");
    [["Today",0],["Tomorrow",1],["Next week",7]].forEach(function(o){
      var iso=dayOffset(o[1]);
      var b=el("button", cur===iso?"go":"", o[0]);
      b.addEventListener("click",function(){ setDoDate(t, iso); closeSheet(); });
      drow.appendChild(b);
    });
    if(cur){
      var cl=el("button",null,"Clear");
      cl.addEventListener("click",function(){ setDoDate(t, ""); closeSheet(); });
      drow.appendChild(cl);
    }
    dbox.appendChild(drow);
    if(t.who && t.since){
      dbox.appendChild(el("p","note","With "+t.who+" since "+t.since+", "+waitingDays(t)+" days. "+
        (needsChase(t)?"On the chase list.":"Becomes a chase after "+chaseAfter(t)+" days.")));
    }
    sd.appendChild(dbox);
    sh.appendChild(sd);

    if((t.files||[]).length){
      var sf=el("div","sec"); sf.appendChild(sech("Files","open and add a line"));
      (t.files||[]).forEach(function(pth){
        var b=el("button","row");
        b.style.setProperty("--a","var("+t.c+")");
        b.appendChild(el("span","dot"));
        var nm=el("span","nm any"); nm.textContent=pth.split("/").pop();
        nm.appendChild(el("u",null,pth));
        b.appendChild(nm);
        b.appendChild(el("span","val","open"));
        b.addEventListener("click",function(){ openFileSheet(pth, t); });
        sf.appendChild(b);
      });
      sh.appendChild(sf);
    }
  });
}

function openFileSheet(path, t){
  sheet(function(sh){
    shHead(sh, path, path.split("/").pop());
    var state=el("p","note","Loading…"); sh.appendChild(state);
    if(path.indexOf("patents/")===0){
      var w=el("p","note bad");
      w.textContent="Patent files carry title, status and dates only. The invention never goes in here.";
      sh.appendChild(w);
    }
    var body=el("div"); sh.appendChild(body);
    getFile(path).then(function(r){
      var text = r?r.text:"", sha = r?r.sha:"";
      state.textContent = r?"":"New file. It will be created when you save.";
      var heads=[], re=/^##\s+(.+)$/gm, mm2;
      while((mm2=re.exec(text))) heads.push(mm2[1].trim());
      body.innerHTML="";
      if(!heads.length){
        body.appendChild(el("p","note","No sections in this file yet. Open it on the desktop to edit the whole thing."));
        return;
      }
      var f1=el("div","fld"); f1.appendChild(el("label","tag","Section"));
      var sel1=el("select");
      heads.forEach(function(h){ var o=el("option",null,h); o.value=h; sel1.appendChild(o); });
      f1.appendChild(sel1); body.appendChild(f1);
      var f2=el("div","fld"); f2.appendChild(el("label","tag","One line"));
      var ta=el("textarea"); ta.id="filta"; ta.setAttribute("dir","auto");
      ta.placeholder="What was delivered, what is still missing. Dictation key works here.";
      f2.appendChild(ta); body.appendChild(f2);
      var save=el("button","wide","Add and save");
      save.addEventListener("click",function(){
        var v=ta.value.trim(); if(!v) return;
        save.textContent="Saving…";
        var line="- "+todayStr()+" \u2014 "+v;
        var lines=text.split("\n"), at=-1, i;
        for(i=0;i<lines.length;i++) if(/^##\s+/.test(lines[i]) && lines[i].replace(/^##\s+/,"").trim()===sel1.value){ at=i; break; }
        var next;
        if(at===-1) next = text.replace(/\s*$/,"")+"\n\n## "+sel1.value+"\n\n"+line+"\n";
        else {
          var end=lines.length;
          for(i=at+1;i<lines.length;i++) if(/^##\s+/.test(lines[i])){ end=i; break; }
          var seg=lines.slice(at+1,end);
          while(seg.length && !seg[seg.length-1].trim()) seg.pop();
          seg.push(line);
          next = lines.slice(0,at+1).concat(seg,[""],lines.slice(end)).join("\n");
        }
        putFile(path, next, sha, "Update "+path+" from the phone")
          .then(function(){ closeSheet(); syncMsg="file saved"; render(); })
          .catch(function(e){ save.textContent=e.message; });
      });
      body.appendChild(save);
    }).catch(function(e){ state.className="note bad"; state.textContent=e.message; });
  });
}

function assignSheet(dateStr, blockIx, blk, dayIx){
  sheet(function(sh){
    var who=planned(dateStr,blockIx), th=who?T(who):null;
    shHead(sh, blk[0]+" \u00b7 "+blk[1], th?th.n:"Nothing on this block");
    sh.appendChild(el("p","note","One block holds one thread. That is the whole rule."));
    var ed=el("button","wide ghost","Change the time, move it or cancel it");
    ed.style.margin="6px 0 4px";
    ed.addEventListener("click",function(){ blockSheet(dayIx==null?new Date(dateStr+"T00:00:00").getDay():dayIx, blk); });
    sh.appendChild(ed);
    if(th){
      var c=band("", th.c);
      var bts=el("div","thb");
      var on=isOn(th.id);
      var go=el("button","go", on?"Stop":"Start working");
      go.addEventListener("click",function(){ on?stopFocus(th.id):startFocus(th.id); closeSheet(); });
      var opn=el("button",null,"The path");
      opn.addEventListener("click",function(){ closeSheet(); openThread(th); });
      var clr=el("button",null,"Clear");
      clr.addEventListener("click",function(){ assign(dateStr,blockIx,""); closeSheet(); });
      bts.appendChild(go); bts.appendChild(opn); bts.appendChild(clr);
      c.appendChild(bts); sh.appendChild(c);
    }
    var doms=domains();
    var s=el("div","sec"); s.appendChild(sech("Put a thread on it"));
    function row(t){
      var b=el("button","row");
      b.style.setProperty("--a","var("+t.c+")");
      b.appendChild(el("span","dot"+(who===t.id?"":" cold")));
      var nm=el("span","nm any"); nm.textContent=t.n;
      nm.appendChild(el("u",null,(isUnset(t)?"stage not set":stageName(t))+" \u2192 "+finalOf(t)));
      b.appendChild(nm);
      b.appendChild(el("span","val", who===t.id?"on it":""));
      b.addEventListener("click",function(){ assign(dateStr,blockIx,t.id); closeSheet(); });
      return b;
    }
    if(doms.length){
      doms.forEach(function(dm){
        var ts=threadsIn(dm.id);
        if(!ts.length) return;
        var c=band("", dm.c);
        var hd=el("div","thh");
        hd.appendChild(el("b",null,dm.n));
        hd.appendChild(el("span","chip quiet num",String(ts.length)));
        c.appendChild(hd);
        ts.forEach(function(t){ c.appendChild(row(t)); });
        s.appendChild(c);
      });
    } else {
      var c2=band("flat");
      board.threads.forEach(function(t){ c2.appendChild(row(t)); });
      s.appendChild(c2);
    }
    sh.appendChild(s);
  });
}

function openIssue(is){
  sheet(function(sh){
    shHead(sh, "#"+is.number+" · "+ago(is.created_at), is.title);
    var b=el("p","any",(is.body||"").replace(/<!--[\s\S]*?-->/g,"").replace(/\*\*/g,"").replace(/^- \[ \] /gm,"\u2610 ").replace(/^- \[[xX]\] /gm,"\u2611 ").trim());
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

    var fn=el("div","fld"); fn.appendChild(el("label","tag","Notifications"));
    pushPanel(fn,"wide ghost","note"); sh.appendChild(fn);

    var duo=el("div","duo");
    var save=el("button","wide","Save and test");
    save.addEventListener("click",function(){
      var rv=$("repoin").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\.git$/,"").replace(/\/$/,"");
      if(rv) putRaw(K.repo, rv);
      var v=inp.value.trim();
      if(v){ token=v; put(K.tok,v); inp.value=""; }
      $("setst").textContent="Testing…"; $("setst").className="note";
      gh("/issues?per_page=1").then(function(){ return pullBoard(); })
        .then(function(){ return pullStatus(); })
        .then(function(){ return pullPlan(); })
        .then(function(){ return pullDates(); })
        .then(function(){ return pullTicks(); })
        .then(function(){ return pullAnswers(); })
        .then(function(){ return pullDesk(); })
        .then(function(){ return pullAdded(); })
        .then(function(){ return pullWeekEdits(); })
        .then(function(){ return pullTodos(); }).then(function(){ return pullPins(); }).then(function(){ return pullSuggestions(); })
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

    var vs=el("div","sec"); vs.appendChild(sech("This copy"));
    vs.appendChild(el("p","note","Version "+BUILD+". The app checks for a newer one each time it opens."));
    var fu=el("button","wide ghost","Force update");
    fu.addEventListener("click",function(){
      fu.textContent="Clearing…";
      try{ sessionStorage.removeItem("planner.repair"); }catch(e){}
      repairInstall();
    });
    vs.appendChild(fu);
    sh.appendChild(vs);
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
      if(tries>=2){ syncMsg="update waiting, open settings and tap Force update"; render(); return; }
      try{ sessionStorage.setItem("planner.repair",String(tries+1)); }catch(e){}
      syncMsg="updating to "+j.build; render();
      repairInstall();
    })
    .catch(function(){});
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
checkForUpdate();
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible") checkForUpdate();
});
setInterval(function(){ if(view==="now"||view==="threads") render(); }, 30000);

if(token){
  flushQueue();
  pullBoard()
    .then(function(j){ if(j){ syncMsg="synced"; render(); } })
    .then(pullStatus).then(pullPlan).then(pullDates).then(pullTicks).then(pullAnswers).then(pullDesk).then(pullAdded).then(pullWeekEdits).then(pullTodos).then(pullPins).then(pullSuggestions).then(render)
    .catch(function(e){ syncMsg=e.message; render(); });
  pullLog().then(render).catch(function(){});
}

if("serviceWorker" in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(function(reg){
      try{ reg.update(); }catch(e){}
      pushRepair();
      document.addEventListener("visibilitychange",function(){
        if(document.visibilityState==="visible"){ try{ reg.update(); }catch(e){} }
      });
    }).catch(function(){});
  });
}
})();
