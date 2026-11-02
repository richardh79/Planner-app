/* Sessions: ask Claude Code on the PC to start working, from the app.
   The app writes a signed request to desktop/commands.jsonl in the planner repository. A small
   program on the PC (scripts/pc_runner.py there) checks the signature, checks that the folder is
   one of his project folders, and opens Claude Code in it. The PIN that signs requests lives only
   in this browser and in a file on the PC, never in the repository.
   Cloud fallback: the same task can be copied and pasted into Claude on the web. */
(function(){
"use strict";
function el(t,c,x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
function hex(buf){ return Array.prototype.map.call(new Uint8Array(buf),function(b){ return ("0"+b.toString(16)).slice(-2); }).join(""); }
function isoNow(){ return new Date().toISOString().slice(0,19)+"Z"; }
function rid(){ return "r"+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

var cache={};
var form={folder:"",thread:"",mode:"terminal",text:""};   // survives the page redrawing itself while he types
   // the page redraws often; the repository is asked at most once a minute

function sign(pin, cmd){
  var enc=new TextEncoder();
  var msg=[cmd.id,cmd.folder,cmd.mode,cmd.prompt].join("|");
  return crypto.subtle.importKey("raw",enc.encode(pin),{name:"HMAC",hash:"SHA-256"},false,["sign"])
    .then(function(k){ return crypto.subtle.sign("HMAC",k,enc.encode(msg)); }).then(hex);
}

/* The task text, written from what the planner already knows about the thread. */
function draft(ctx, t){
  if(!t) return "";
  var L=["Work on: "+t.n+"."];
  L.push("Stage: "+ctx.stageName(t)+". Next step on record: "+(t.next||"none written.")+(t.who?(" Waiting on "+t.who+"."):""));
  var resume=ctx.openTodos(t.id).slice(0,4).map(function(x){ return "- "+x.text; });
  if(resume.length){ L.push("Open to-dos on it:"); L=L.concat(resume); }
  L.push("Read CLAUDE.md and the project's own notes first. Do the next step, commit as you go, and tell me what changed.");
  return L.join("\n");
}

function panel(ctx){
  var root=el("section","ses");
  root.appendChild(el("h3","ses-h","Claude Code on your PC"));
  var body=el("div","ses-b"); root.appendChild(body);
  var state={folders:null,runs:[],pin:""};
  try{ state.pin=localStorage.getItem("planner.pin")||""; }catch(e){}

  function load(force){
    if(!force && cache.at && Date.now()-cache.at<60000){ state.folders=cache.folders; state.runs=cache.runs; return Promise.resolve(); }
    return Promise.all([ctx.getFile("desktop/folders.json"), ctx.getFile("desktop/runs.jsonl")]).then(function(r){
      try{ state.folders=r[0]?JSON.parse(r[0].text):null; }catch(e){ state.folders=null; }
      state.runs=[]; if(r[1]) r[1].text.split("\n").forEach(function(l){ try{ if(l.trim()) state.runs.push(JSON.parse(l)); }catch(e){} });
      cache={at:Date.now(),folders:state.folders,runs:state.runs};
    }).catch(function(){});
  }

  function draw(){
    body.innerHTML="";
    if(!state.folders||!state.folders.folders||!state.folders.folders.length){
      body.appendChild(el("p","ses-n","Nothing connected yet. On the PC, open a terminal in the planner folder and run:"));
      body.appendChild(el("code","ses-c","py scripts\\pc_runner.py --root \"C:\\Users\\User\\Desktop\\Claude\" --setup"));
      body.appendChild(el("p","ses-n","It lists your project folders here and waits for requests. Leave it running."));
      var rb=el("button","orb-alt","Check again"); rb.type="button"; rb.addEventListener("click",function(){ load(true).then(draw); }); body.appendChild(rb);
      return;
    }
    var f=el("div","ses-f");
    var fs=el("select"); fs.setAttribute("aria-label","Project folder");
    state.folders.folders.forEach(function(x){ var o=el("option",null,x.name+(x.touched?"  \u00b7  "+x.touched:"")); o.value=x.name; fs.appendChild(o); });
    var ts=el("select"); ts.setAttribute("aria-label","Planner thread");
    var none=el("option",null,"No thread"); none.value=""; ts.appendChild(none);
    ctx.threads().forEach(function(t){ var o=el("option",null,t.n); o.value=t.id; ts.appendChild(o); });
    var ms=el("select"); ms.setAttribute("aria-label","Mode");
    [["terminal","Open a terminal, I press Enter"],["headless","Run in the background, read-only"]].forEach(function(m){ var o=el("option",null,m[1]); o.value=m[0]; ms.appendChild(o); });
    var ta=el("textarea"); ta.rows=5; ta.maxLength=6000; ta.placeholder="What should it do?"; ta.setAttribute("aria-label","Task");
    ts.addEventListener("change",function(){ form.thread=ts.value; var t=ctx.T(ts.value); if(t){ ta.value=draft(ctx,t); form.text=ta.value; } });
    fs.addEventListener("change",function(){ form.folder=fs.value; });
    ms.addEventListener("change",function(){ form.mode=ms.value; });
    ta.addEventListener("input",function(){ form.text=ta.value; });
    if(form.folder) fs.value=form.folder; if(form.thread) ts.value=form.thread; if(form.mode) ms.value=form.mode; if(form.text) ta.value=form.text;
    f.appendChild(fs); f.appendChild(ts); f.appendChild(ta); f.appendChild(ms);
    if(!state.pin){
      f.appendChild(el("p","ses-n","Type the PIN you chose on the PC, once. It stays in this browser."));
      var pi=el("input"); pi.type="password"; pi.placeholder="PIN"; pi.autocomplete="off"; pi.setAttribute("aria-label","PIN"); f.appendChild(pi);
      pi.addEventListener("input",function(){ state.pin=pi.value; });
    }
    var msg=el("p","ses-n"); msg.setAttribute("aria-live","polite");
    var row=el("div","orb-act");
    var go=el("button","orb-go","Start it"); go.type="button";
    go.addEventListener("click",function(){
      var task=ta.value.trim(); if(!task){ msg.textContent="Write the task first."; return; }
      if(!state.pin){ msg.textContent="Enter the PIN."; return; }
      go.disabled=true; msg.textContent="Sending\u2026";
      var cmd={id:rid(),at:isoNow(),folder:fs.value,mode:ms.value,prompt:task,thread:ts.value||null};
      sign(state.pin,cmd).then(function(s){
        cmd.sig=s;
        return ctx.appendLine("desktop/commands.jsonl",JSON.stringify(cmd),"Session request from the app");
      }).then(function(){
        try{ localStorage.setItem("planner.pin",state.pin); }catch(e){}
        msg.textContent="Sent. The PC picks it up within about 20 seconds."; go.disabled=false; form.text=""; ta.value="";
        setTimeout(function(){ load(true).then(draw); },25000);
      }).catch(function(e){ msg.textContent="Could not send: "+(e&&e.message?e.message:"no signal"); go.disabled=false; });
    });
    var cp=el("button","orb-alt","Copy for the cloud"); cp.type="button";
    cp.addEventListener("click",function(){
      try{ navigator.clipboard.writeText(ta.value); msg.textContent="Copied. Paste it into Claude on the web."; }catch(e){ msg.textContent="Could not copy."; }
    });
    row.appendChild(go); row.appendChild(cp); f.appendChild(row); f.appendChild(msg);
    body.appendChild(f);
    var last=state.runs.slice(-5).reverse();
    if(last.length){
      var h=el("p","ses-n ses-rh","Recent requests"); body.appendChild(h);
      last.forEach(function(r){
        var line=el("p","ses-r"); line.appendChild(el("b",r.outcome==="refused"||r.outcome==="failed"?"bad":"",r.outcome));
        line.appendChild(document.createTextNode(" "+r.folder+(r.detail?" \u00b7 "+r.detail:"")));
        body.appendChild(line);
      });
    }
    var rf=el("button","orb-alt quiet","Refresh"); rf.type="button"; rf.addEventListener("click",function(){ load(true).then(draw); }); body.appendChild(rf);
  }
  body.appendChild(el("p","ses-n","Loading\u2026"));
  load().then(draw);
  return root;
}

window.Sessions={ panel:panel, sign:sign, draft:draft };
})();
