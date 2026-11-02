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
      secondary:{label:"Open", fn:function(){ ctx.openThread(t); }}});
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
      secondary:{label:"Start", fn:function(){ ctx.start(t.id); }}});
  });

  ctx.threads().forEach(function(t){
    if(!t.critical||t.who) return;
    var ix=ctx.stageIx(t), last=ctx.stageCount(t)-1; if(last<1||ix>=last) return;
    add({kind:"thread", id:t.id, thread:t, tag:"Yours", tone:"flow", title:t.n,
      why:"At "+ctx.stageName(t)+". Next: "+(t.next||"open it and decide."),
      primary:{label:"Moved on", fn:function(){ ctx.setStage(t,ix+1); }},
      secondary:{label:"Start", fn:function(){ ctx.start(t.id); }}});
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

  // add
  var f=el("form","orb-add"); f.setAttribute("autocomplete","off");
  var inp=el("input"); inp.type="text"; inp.placeholder="Add the next thing…"; inp.maxLength=160; inp.setAttribute("aria-label","Add a to-do for today");
  var ab=el("button",null,"Add"); ab.type="submit";
  f.appendChild(inp); f.appendChild(ab);
  f.addEventListener("submit",function(e){ e.preventDefault(); var v=inp.value.trim(); if(!v) return; ctx.addTodo(null,v,today,"one look"); inp.value=""; });
  root.appendChild(f);
  return root;
}

window.Orbit={ build:build };
})();
