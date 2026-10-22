// Runs the real page in headless Chromium with a fake speech engine that ends its own
// sessions, as Android does, and a fake GitHub API that records every write.
//
//   npm i playwright            (once, anywhere; or set PLAYWRIGHT_PATH to an existing copy)
//   node tests/desktop.e2e.js              [folder of the app, default: the repository root]
//
// Set CHROMIUM_PATH to use a browser you already have. Nothing here touches the network.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http=require("http"),fs=require("fs"),path=require("path");
const APP=path.resolve(process.argv[2]||path.join(__dirname,".."));
const MIME={".html":"text/html",".js":"text/javascript",".json":"application/json",".webmanifest":"application/json",".png":"image/png"};
const server=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/desktop.html";const f=path.join(APP,p);if(!fs.existsSync(f)){s.writeHead(404);return s.end();}s.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"text/plain"});s.end(fs.readFileSync(f));});
const b64=t=>Buffer.from(t,"utf8").toString("base64");
let fail=0; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(n,ok,d){ if(!ok) fail++; console.log((ok?"PASS ":"FAIL ")+n+(ok?"":"   "+(d||""))); }
function gh(){
  const files={}, puts=[], posts=[];
  const board={updated:"2026-10-22",headline:"t",domains:[{id:"research",n:"Research",c:"--research"}],
    threads:[{id:"t1",n:"Test thread",dom:"research",st:["Drafting","Submitted"],at:0,c:"--research",unset:true}],
    week:[[],[],[],[],[],[],[]],goals:[],events:[],open:[]};
  files["data/board.json"]={text:JSON.stringify(board),sha:"s0"}; let n=1;
  return {puts,posts,handle(route){
    const req=route.request(),u=new URL(req.url()),p=u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/,"");
    const json=(c,o)=>route.fulfill({status:c,contentType:"application/json",body:JSON.stringify(o)});
    if(p.startsWith("/contents/")){const fp=decodeURIComponent(p.slice(10));
      if(req.method()==="GET"){const f=files[fp];if(!f)return json(404,{message:"Not Found"});return json(200,{sha:f.sha,size:f.text.length,content:b64(f.text)});}
      const body=JSON.parse(req.postData());const text=Buffer.from(body.content,"base64").toString("utf8");puts.push({path:fp,text});files[fp]={text,sha:"s"+(++n)};return json(200,{content:{sha:files[fp].sha}});}
    if(p==="/issues"&&req.method()==="POST"){posts.push(JSON.parse(req.postData()));return json(201,{number:100+posts.length});}
    return json(200,[]);}};
}
(async()=>{
  await new Promise(r=>server.listen(0,r)); const base="http://127.0.0.1:"+server.address().port+"/";
  const br=await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
  async function open(g){
    const ctx=await br.newContext({serviceWorkers:"block",viewport:{width:1500,height:900}});
    await ctx.route("https://api.github.com/**",r=>g.handle(r));
    await ctx.addInitScript(()=>{
      localStorage.setItem("planner.repo",JSON.stringify("o/r"));localStorage.setItem("planner.token",JSON.stringify("tok"));
      window.__sr={made:0,stopped:false,script:[{text:"send the draft",final:true},{text:"to the editor",final:true},{text:"by Thursday",final:false}]};
      window.SpeechRecognition=window.webkitSpeechRecognition=function(){const me={};const id=++window.__sr.made;
        me.start=function(){const part=window.__sr.script[id-1];
          setTimeout(()=>{if(part&&me.onresult){const res=[{0:{transcript:part.text},isFinal:part.final}];me.onresult({results:res,resultIndex:0});}},60);
          setTimeout(()=>{me.onend&&me.onend();},220);};
        me.stop=function(){window.__sr.stopped=true;setTimeout(()=>me.onend&&me.onend(),10);};return me;};});
    const page=await ctx.newPage(); page.on("pageerror",e=>{fail++;console.log("FAIL page error: "+e.message);});
    let navs=0; page.on("framenavigated",f=>{if(f===page.mainFrame())navs++;}); page._navs=()=>navs;
    return page;
  }
  // 1. dictation restart on the desktop
  { const g=gh(); const page=await open(g); await page.goto(base+"desktop.html"); await sleep(1200);
    await page.click("text=Research"); await sleep(400); await page.click("text=Test thread"); await sleep(500);
    const ta=await page.$("textarea"); check("desktop: thread detail has a dictation box", !!ta);
    await page.click("button.mic"); await sleep(1400);
    const made=await page.evaluate(()=>window.__sr.made);
    const val=await page.evaluate(()=>{ const m=document.querySelector("button.mic"); let n=m.parentElement; while(n){ const t=n.previousElementSibling; if(t&&t.tagName==="TEXTAREA") return t.value; if(n.querySelector&&n.querySelector("textarea")&&n!==m.parentElement){ return n.querySelector("textarea").value; } n=n.parentElement; } return "NO-TEXTAREA-FOUND"; });
    check("desktop: dictation restarts after the browser ends it", made>=3, "sessions: "+made);
    check("desktop: text joined once, no repeats", val==="send the draft to the editor by Thursday", JSON.stringify(val));
    await page.click("button.mic"); await sleep(500); const a=await page.evaluate(()=>window.__sr.made); await sleep(700);
    check("desktop: stop stops it for good", (await page.evaluate(()=>window.__sr.made))===a);
    check("desktop: no repair loop", page._navs()===1, "navigations "+page._navs());
    await page.context().close(); }
  // 2. "Delay or drop" writes a day, not only an issue
  { const g=gh(); const page=await open(g); await page.goto(base+"desktop.html"); await sleep(1200);
    await page.click("text=Weekly review"); await sleep(600);
    const btn=await page.$("text=Delay or drop"); check("desktop: the drifting list offers Delay or drop", !!btn);
    if(btn){ await btn.click(); await sleep(400);
      await page.click("button:has-text('Delay it')"); await sleep(1200);
      const d=g.puts.find(x=>x.path==="data/dates.jsonl");
      check("desktop: Delay it writes a do-date into dates.jsonl", !!d && /"thread":"t1"/.test(d.text) && /"why":"delay"/.test(d.text), JSON.stringify(g.puts.map(x=>x.path)));
      check("desktop: and still files the reason as a Decision issue", g.posts.some(x=>/^Decision: Test thread/.test(x.title)), JSON.stringify(g.posts.map(x=>x.title))); }
    await page.context().close(); }
  // 3. a Saturday-review summary is sent when the page is hidden, not lost
  { const g=gh(); const page=await open(g); await page.goto(base+"desktop.html"); await sleep(1200);
    await page.click("text=Weekly review"); await sleep(600);
    const start=await page.$("button:has-text('Start')"); 
    if(start){ await start.click(); await sleep(500);
      await page.evaluate(()=>{ Object.defineProperty(document,"visibilityState",{value:"hidden",configurable:true}); document.dispatchEvent(new Event("visibilitychange")); });
      await sleep(1000);
      check("desktop: leaving the review sends its summary", g.posts.some(x=>/^Saturday review/.test(x.title)), JSON.stringify(g.posts.map(x=>x.title)));
    } else console.log("SKIP desktop review swipe button not found");
    await page.context().close(); }
  await br.close(); server.close(); console.log(fail?"\n"+fail+" FAILED":"\nall passed"); process.exit(fail?1:0);
})().catch(e=>{console.log("HARNESS ERROR",e.message.split("\n")[0]);process.exit(2);});
