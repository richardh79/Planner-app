/* Orbit, the one-look layer shared by the phone and the desktop.
   It carries no data and no network code. Each app hands it a small context of
   its own functions, and it draws one screen: the rings, the single next thing,
   the queue behind it, and a box to add a to-do.

   What it leans on, on purpose:
   - Open loops nag until closed, so the count of them is always visible.
   - One next thing, not a list, so starting costs no decision.
   - Closing is rewarded at once (a burst, a tick of the day counter), and the
     next thing arrives in the same motion, so finishing and starting are one
     gesture.
   - A ring nearing its target glows, because people finish what looks nearly done.
   - Someone waiting on you is shown as a person, not a number.
   - Colour carries meaning only: amber is late, cyan is live, violet is a person
     waiting, green is closed. Movement is reserved for the live thing. */
(function(){
"use strict";

function el(t,c,x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
var NS="http://www.w3.org/2000/svg";
function sv(t,a){ var e=document.createElementNS(NS,t); for(var k in a) e.setAttribute(k,a[k]); return e; }

var skip=0;              // how far the queue has been rotated by hand
var closedNow={};        // ids closed in this session, so a closed thing does not come straight back
var sdDraft="";
var addDraft="";         // what he was typing in the add box when the page redrew
var justClosed=null;     // what was just closed, shown once on the next draw

function dayOf(iso){
  var d=new Date(iso); if(!iso||isNaN(d.getTime())) return "";
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}

/* The days on which he closed something: a stage he set, a to-do ticked, a chase made. */
function closeDays(ctx){
  var days={};
  var st=ctx.statuses()||{}, td=ctx.todos()||{}, tk=ctx.ticks()||[];
  Object.keys(st).forEach(function(k){ var d=dayOf(st[k]&&st[k].at); if(d) days[d]=(days[d]||0)+1; });
  Object.keys(td).forEach(function(k){ var o=td[k]; if(o&&o.done){ var d=dayOf(o.at); if(d) days[d]=(days[d]||0)+1; } });
  tk.forEach(function(o){ var d=o.day||dayOf(o.at); if(d) days[d]=(days[d]||0)+1; });
  return days;
}
function streak(days, today){
  var n=0, d=new Date(today+"T12:00:00");
  if(!days[today]) d.setDate(d.getDate()-1);          // today is allowed to be still empty
  for(var i=0;i<400;i++){
    var k=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
    if(!days[k]) break;
    n++; d.setDate(d.getDate()-1);
  }
  return n;
}

/* The queue, most pressing first. Each entry says why it is there and what closing it means. */
function queue(ctx){
  var q=[], seen={};
  function add(m){ var k=m.kind+":"+m.id; if(seen[k]||closedNow[k]) return; seen[k]=1; q.push(m); }
  var today=ctx.today();

  ctx.runningIds().forEach(function(id){
    var t=ctx.T(id); if(!t) return;
    add({kind:"live", id:id, thread:t, tag:"Live", tone:"live", title:t.n,
      why:"The clock is running. Stop it when this block is done.",
      primary:{label:"Done", fn:function(){ ctx.stop(id); }},
      secondary:{label:"Focus", fn:function(){ focus(ctx,t); }}});
  });

  ctx.openTodos().forEach(function(td){
    var late=td.due&&td.due<today, now=td.due===today;
    if(!(late||now)) return;
    var t=td.thread?ctx.T(td.thread):null;
    add({kind:"todo", id:td.id, thread:t, tag:late?"Late":"Today", tone:late?"late":"flow", title:td.text,
      why:(t?t.n+" · ":"")+(late?"Past its day.":"Due today."),
      primary:{label:"Done", fn:function(){ ctx.doneTodo(td.id); }}});
  });

  ctx.threads().filter(ctx.needsChase).sort(function(a,b){ return ctx.clockDays(b)-ctx.clockDays(a); }).forEach(function(t){
    var who=String(t.who||"").replace(/^Dr\.?\s+/i,"Dr ");
    add({kind:"chase", id:t.id, thread:t, tag:"Waiting", tone:"person", title:"Chase "+who,
      why:ctx.clockDays(t)+" days of silence on "+t.n+".",
      primary:{label:"Chased", fn:function(){ ctx.markChased(t); }},
      secondary:{label:"Open", fn:function(){ ctx.openThread(t); }}});
  });

  ctx.threads().forEach(function(t){
    var b=ctx.bucketOf(t); if(b!=="overdue"&&b!=="today") return;
    add({kind:"thread", id:t.id, thread:t, tag:b==="overdue"?"Late":"Today", tone:b==="overdue"?"late":"flow", title:t.n,
      why:(b==="overdue"?"Its day has passed. ":"Dated for today. ")+"Next: "+(t.next||"open it and decide."),
      primary:{label:"Moved on", fn:function(){ var ix=ctx.stageIx(t), last=ctx.stageCount(t)-1; if(ix<last) ctx.setStage(t,ix+1); else ctx.openThread(t); }},
      secondary:{label:"Focus", fn:function(){ focus(ctx,t); }}});
  });

  ctx.threads().forEach(function(t){
    if(!t.critical||t.who) return;
    var ix=ctx.stageIx(t), last=ctx.stageCount(t)-1; if(last<1||ix>=last) return;
    add({kind:"thread", id:t.id, thread:t, tag:"Yours", tone:"flow", title:t.n,
      why:"At "+ctx.stageName(t)+". Next: "+(t.next||"open it and decide."),
      primary:{label:"Moved on", fn:function(){ ctx.setStage(t,ix+1); }},
      secondary:{label:"Focus", fn:function(){ focus(ctx,t); }}});
  });
  return q;
}

function rings(ctx, closedToday){
  var goals=(ctx.board.goals||[]).filter(function(g){ return g.target>0; }).slice(0,4);
  var s=sv("svg",{viewBox:"0 0 120 120","class":"orb-rings",role:"img","aria-label":"Year goals, "+goals.map(function(g){ return g.n+" "+g.now+" of "+g.target; }).join("; ")});
  goals.forEach(function(g,i){
    var r=53-i*11, c=2*Math.PI*r, f=Math.max(0,Math.min(1,(g.now||0)/g.target));
    s.appendChild(sv("circle",{cx:60,cy:60,r:r,fill:"none","class":"orb-track","stroke-width":6}));
    var a=sv("circle",{cx:60,cy:60,r:r,fill:"none","class":"orb-arc"+(f>=.8?" near":""),"stroke-width":6,"stroke-linecap":"round",
      "stroke-dasharray":(c*f)+" "+c,transform:"rotate(-90 60 60)"});
    a.style.setProperty("--g","var("+(g.c||"--accent")+")");
    a.style.setProperty("--len",String(c*f)); a.style.setProperty("--full",String(c));
    s.appendChild(a);
  });
  var tx=sv("text",{x:60,y:64,"text-anchor":"middle","class":"orb-n"}); tx.textContent=String(closedToday); s.appendChild(tx);
  var tl=sv("text",{x:60,y:79,"text-anchor":"middle","class":"orb-l"}); tl.textContent="closed today"; s.appendChild(tl);
  return s;
}


/* A focus session, one thing on the whole screen.
   Three beats, each there for a reason:
   1. Before: name the first action. A plan of the form "I will do X" is easier to start than a vague wish.
   2. During: the clock, the one thing, a place to park a stray thought instead of acting on it, and a
      count of how often the page was left, which is a measure, not a rebuke.
   3. After: write where you stopped and the next step, which becomes a to-do on that thread. Leaving
      work with a ready-to-resume note is the usual remedy for the pull of an unfinished task. */
function focus(ctx, t){
  if(document.getElementById("fx")) return;
  var ov=el("div","fx"); ov.id="fx"; ov.setAttribute("role","dialog"); ov.setAttribute("aria-label","Focus session");
  var len=25, total=0, t0=0, left=0, tick=null, away=0, hiddenAt=0, parked=0, lock=null, rounds=0;
  function close(){
    if(tick) clearInterval(tick);
    document.removeEventListener("visibilitychange",vis);
    try{ if(lock&&lock.release) lock.release(); }catch(e){}
    if(ov.parentNode) ov.parentNode.removeChild(ov);
    ctx.rerender();
  }
  function vis(){
    if(document.hidden){ hiddenAt=Date.now(); }
    else if(hiddenAt && Date.now()-hiddenAt>5000){ away++; var a=ov.querySelector(".fx-away"); if(a) a.textContent=awayText(); hiddenAt=0; }
    else hiddenAt=0;
  }
  function awayText(){ return away?("Left the page "+away+(away===1?" time":" times")):"Stayed on the page"; }
  function head(sub){ var h=el("div","fx-h"); h.appendChild(el("span","fx-tag",sub)); h.appendChild(el("b","fx-t any",t.n)); return h; }

  function setup(){
    ov.innerHTML=""; ov.appendChild(head("Focus"));
    var box=el("div","fx-b");
    box.appendChild(el("label","fx-l","The first action, in one line"));
    var inp=el("input"); inp.type="text"; inp.maxLength=140; inp.value=t.next||""; inp.placeholder="I will…"; box.appendChild(inp);
    box.appendChild(el("label","fx-l","How long"));
    var row=el("div","fx-chips");
    [25,50,90].forEach(function(m){
      var c=el("button","fx-chip"+(m===len?" on":""),m+" min"); c.type="button";
      c.addEventListener("click",function(){ len=m; Array.prototype.forEach.call(row.children,function(x){ x.classList.toggle("on",x===c); }); });
      row.appendChild(c);
    });
    box.appendChild(row);
    var go=el("button","orb-go fx-go","Begin"); go.type="button";
    go.addEventListener("click",function(){ run(inp.value.trim()); });
    var no=el("button","orb-alt quiet","Not now"); no.type="button"; no.addEventListener("click",close);
    var act=el("div","orb-act"); act.appendChild(go); act.appendChild(no); box.appendChild(act);
    ov.appendChild(box); setTimeout(function(){ try{ inp.focus(); }catch(e){} },50);
  }

  function run(first){
    total=len*60; t0=Date.now(); rounds++;
    ctx.start(t.id);
    try{ if(navigator.wakeLock) navigator.wakeLock.request("screen").then(function(l){ lock=l; }).catch(function(){}); }catch(e){}
    document.addEventListener("visibilitychange",vis);
    ov.innerHTML=""; ov.appendChild(head("In focus"));
    var mid=el("div","fx-mid");
    var R=44, C=2*Math.PI*R;
    var s=sv("svg",{viewBox:"0 0 100 100","class":"fx-ring"});
    s.appendChild(sv("circle",{cx:50,cy:50,r:R,fill:"none","class":"orb-track","stroke-width":3}));
    var arc=sv("circle",{cx:50,cy:50,r:R,fill:"none","class":"fx-arc","stroke-width":3,"stroke-linecap":"round","stroke-dasharray":C+" "+C,transform:"rotate(-90 50 50)"});
    s.appendChild(arc); mid.appendChild(s);
    var clk=el("div","fx-clock num","--:--"); mid.appendChild(clk);
    ov.appendChild(mid);
    if(first) ov.appendChild(el("p","fx-first any",first));
    var park=el("form","orb-add fx-park"); var pi=el("input"); pi.type="text"; pi.maxLength=140; pi.placeholder="Park a stray thought…"; pi.setAttribute("aria-label","Park a thought");
    var pb=el("button",null,"Park"); pb.type="submit"; park.appendChild(pi); park.appendChild(pb);
    park.addEventListener("submit",function(e){ e.preventDefault(); var v=pi.value.trim(); if(!v) return; ctx.addTodo(null,v,null,"focus",true); parked++; pi.value=""; pi.placeholder="Parked. Back to it."; });
    ov.appendChild(park);
    var ft=el("div","fx-foot"); ft.appendChild(el("span","fx-away",awayText()));
    var endb=el("button","orb-alt quiet","End early"); endb.type="button"; endb.addEventListener("click",finish);
    ft.appendChild(endb); ov.appendChild(ft);
    function paint(){
      left=Math.max(0,total-Math.round((Date.now()-t0)/1000));
      var m=Math.floor(left/60), sec=left%60; clk.textContent=(m<10?"0":"")+m+":"+(sec<10?"0":"")+sec;
      arc.setAttribute("stroke-dashoffset",String(C*(1-left/total)));
      if(left<=0){ try{ if(navigator.vibrate) navigator.vibrate([200,100,200]); }catch(e){} finish(); }
    }
    paint(); tick=setInterval(paint,1000);
  }

  function finish(){
    if(tick){ clearInterval(tick); tick=null; }
    var did=Math.max(1,Math.round((Date.now()-t0)/60000));
    ov.innerHTML=""; ov.appendChild(head("Session over"));
    var box=el("div","fx-b");
    box.appendChild(el("p","fx-sum",did+" min on this"+(parked?(", "+parked+" thought"+(parked===1?"":"s")+" parked"):"")+". "+awayText()+"."));
    box.appendChild(el("label","fx-l","Where did you stop, and what is the next step?"));
    var inp=el("input"); inp.type="text"; inp.maxLength=140; inp.placeholder="Next I will…"; box.appendChild(inp);
    function save(){ var v=inp.value.trim(); if(v) ctx.addTodo(t.id,"Resume: "+v,ctx.today(),"focus",true); }
    var act=el("div","orb-act");
    var again=el("button","orb-go","Another round"); again.type="button";
    again.addEventListener("click",function(){ save(); parked=0; away=0; run(inp.value.trim()); });
    var done=el("button","orb-alt","Done for now"); done.type="button";
    done.addEventListener("click",function(){ save(); ctx.stop(t.id); close(); });
    act.appendChild(again); act.appendChild(done); box.appendChild(act);
    ov.appendChild(box); setTimeout(function(){ try{ inp.focus(); }catch(e){} },50);
  }
  document.body.appendChild(ov); setup();
}

function build(ctx){
  var root=el("section","orbit"), q=queue(ctx), today=ctx.today();
  var days=closeDays(ctx), closedToday=days[today]||0, run=streak(days,today);
  var others=ctx.threads().filter(function(t){ return t.who&&t.since; });
  var overdueChase=others.filter(ctx.needsChase).length;

  // top: rings and the day's counters
  var top=el("div","orb-top");
  top.appendChild(rings(ctx,closedToday));
  var side=el("div","orb-side");
  var cnt={late:0,live:0,todo:0,chase:0};
  q.forEach(function(m){ if(m.tone==="late") cnt.late++; if(m.kind==="live") cnt.live++; if(m.kind==="todo") cnt.todo++; if(m.kind==="chase") cnt.chase++; });
  [["Late",cnt.late,"late"],["Live",cnt.live,"live"],["To do",cnt.todo,"flow"],["Chase",cnt.chase,"person"]].forEach(function(r){
    var b=el("button","orb-tile "+r[2]+(r[1]?"":" zero"));
    b.appendChild(el("b",null,String(r[1]))); b.appendChild(el("span",null,r[0]));
    b.addEventListener("click",function(){
      for(var i=0;i<q.length;i++){ var m=q[i];
        if((r[0]==="Late"&&m.tone==="late")||(r[0]==="Live"&&m.kind==="live")||(r[0]==="To do"&&m.kind==="todo")||(r[0]==="Chase"&&m.kind==="chase")){ skip=i; ctx.rerender(); return; } }
    });
    side.appendChild(b);
  });
  top.appendChild(side);
  root.appendChild(top);

  var meta=el("p","orb-meta");
  meta.appendChild(el("span","orb-run",run?(run+"-day run"):"Close one thing to start a run"));
  if(others.length) meta.appendChild(el("span",overdueChase?"orb-oth warn":"orb-oth","In others' hands: "+others.length+(overdueChase?" · "+overdueChase+" to chase":"")));
  root.appendChild(meta);

  var fresh=null;
  if(justClosed && !justClosed.at) justClosed.at=Date.now();
  if(justClosed && Date.now()-justClosed.at<3400){
    fresh=Date.now()-justClosed.at;
    var t=el("p","orb-toast"); t.appendChild(el("b",null,"Closed")); t.appendChild(document.createTextNode(" "+justClosed.text));
    t.style.animationDelay="-"+fresh+"ms";      // a redraw continues the toast instead of restarting it
    root.appendChild(t);
  } else justClosed=null;

  // the one next thing
  var n=q.length, head=n?q[((skip%n)+n)%n]:null;
  var card=el("div","orb-card "+(head?head.tone:"flow")+(n?"":" empty")); card.setAttribute("aria-live","polite");
  if(!head){
    card.appendChild(el("span","orb-tag","Clear"));
    card.appendChild(el("b","orb-title","Nothing is pressing."));
    card.appendChild(el("span","orb-why","Add the next thing below, or open a path and give it a day."));
  } else {
    var tg=el("span","orb-tag",head.tag+(n>1?" · 1 of "+n:"")); card.appendChild(tg);
    card.appendChild(el("b","orb-title any",head.title));
    card.appendChild(el("span","orb-why any",head.why));
    var act=el("div","orb-act");
    var go=el("button","orb-go",head.primary.label);
    go.addEventListener("click",function(){
      if(go.disabled) return; go.disabled=true;
      card.classList.add("burst");
      try{ if(navigator.vibrate) navigator.vibrate(18); }catch(e){}
      justClosed={text:head.title,at:0}; closedNow[head.kind+":"+head.id]=1; skip=0;
      setTimeout(function(){ if(justClosed) justClosed.at=Date.now(); head.primary.fn(); }, 560);
    });
    act.appendChild(go);
    if(head.secondary){ var s2=el("button","orb-alt",head.secondary.label); s2.addEventListener("click",head.secondary.fn); act.appendChild(s2); }
    if(n>1){ var lt=el("button","orb-alt quiet","Later"); lt.addEventListener("click",function(){ skip++; ctx.rerender(); }); act.appendChild(lt); }
    card.appendChild(act);
  }
  if(fresh!==null && fresh<700) card.style.animationDelay="-"+fresh+"ms";
  root.appendChild(card);

  // what comes after it
  if(n>1){
    var nx=el("div","orb-next"); nx.appendChild(el("span","orb-then","Then"));
    for(var k=1;k<=Math.min(3,n-1);k++){ (function(ix){
      var m=q[(((skip+ix)%n)+n)%n], c=el("button","orb-chip "+m.tone);
      c.appendChild(el("i",null)); c.appendChild(document.createTextNode(m.title));
      c.addEventListener("click",function(){ skip=skip+ix; ctx.rerender(); });
      nx.appendChild(c); })(k); }
    root.appendChild(nx);
  }

  // the evening: close the day on purpose, and name tomorrow's first thing now, while the context is warm
  if(new Date().getHours()>=18){
    var sd=el("div","orb-sd");
    sd.appendChild(el("span","orb-tag","Close the day"));
    sd.appendChild(el("span","orb-why",closedToday?(closedToday+" closed today. "+(n?n+" still open.":"Nothing left open.")):(n?n+" still open, none closed today. Name one thing for tomorrow.":"Nothing open.")));
    var sf=el("form","orb-add"); var si=el("input"); si.type="text"; si.maxLength=140; si.placeholder="Tomorrow's first thing\u2026"; si.setAttribute("aria-label","Tomorrow's first thing");
    si.value=sdDraft; si.addEventListener("input",function(){ sdDraft=si.value; });
    var sb=el("button",null,"Set"); sb.type="submit"; sf.appendChild(si); sf.appendChild(sb);
    sf.addEventListener("submit",function(e){ e.preventDefault(); var v=si.value.trim(); if(!v) return; var d=new Date(today+"T12:00:00"); d.setDate(d.getDate()+1);
      var tm=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
      ctx.addTodo(null,"First: "+v,tm,"shutdown"); si.value=""; sdDraft=""; });
    sd.appendChild(sf); root.appendChild(sd);
  }

  // add
  var f=el("form","orb-add"); f.setAttribute("autocomplete","off");
  var inp=el("input"); inp.type="text"; inp.placeholder="Add the next thing…"; inp.maxLength=160; inp.setAttribute("aria-label","Add a to-do for today");
  var ab=el("button",null,"Add"); ab.type="submit";
  f.appendChild(inp); f.appendChild(ab);
  inp.value=addDraft; inp.addEventListener("input",function(){ addDraft=inp.value; });
  f.addEventListener("submit",function(e){ e.preventDefault(); var v=inp.value.trim(); if(!v) return; ctx.addTodo(null,v,today,"one look"); inp.value=""; addDraft=""; });
  root.appendChild(f);
  return root;
}

window.Orbit={ build:build, focus:focus };
})();
