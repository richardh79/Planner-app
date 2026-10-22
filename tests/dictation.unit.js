// Dictation merge: the two shapes browsers send, in both apps.   node tests/dictation.unit.js
const fs=require("fs");
function load(file, cumulative){
  const src=fs.readFileSync(require("path").join(__dirname,"..",file),"utf8");
  const a=src.indexOf("function dictWords"), b=src.indexOf("function joinResults");
  const e=src.indexOf("\n}\n", b)+3;
  const code="var CUMULATIVE="+cumulative+";\n"+src.slice(a,e)+"\nreturn joinResults;";
  return new Function(code)();
}
// a result list as the browser gives it: array of results, each result[0].transcript, plus isFinal
const R=(t,f)=>{const r=[{transcript:t}]; r.isFinal=f; return r;};
let fail=0;
function check(name, got, want){ const ok=got===want; if(!ok) fail++; console.log((ok?"PASS ":"FAIL ")+name+(ok?"":"\n   got:  "+got+"\n   want: "+want)); }
for (const file of ["app.js","desktop.js"]) {
  console.log("== "+file);
  const desk=load(file,false), andr=load(file,true);
  // desktop Chrome: separate phrases, one interim at the end
  check("desktop: finals then interim", desk([R("send the draft",true),R("to Dr",false)]), "send the draft to Dr");
  check("desktop: finals only", desk([R("send the draft",true),R("by Thursday",true)]), "send the draft by Thursday");
  // Android: one entry, cumulative interims, newest wins
  check("android: single growing entry", andr([R("send the draft today",false)]), "send the draft today");
  // Android: a final followed by an interim that extends it (the case my first version dropped)
  check("android: interim extends last final", andr([R("hello there",true),R("hello there how are",false)]), "hello there how are");
  // Android: several stacked cumulative interims, only the newest should show, no repeats
  check("android: stacked interims", andr([R("send the",false),R("send the draft",false),R("send the draft today",false)]), "send the draft today");
  // Android: the newest interim revises a word
  check("android: revision", andr([R("book the exam",true),R("book the exam for November",false)]), "book the exam for November");
  // a genuinely new sentence after a final, not a restatement
  check("android: new sentence after final", andr([R("I submitted the paper",true),R("then I called Dr Ali",false)]), "I submitted the paper then I called Dr Ali");
  // Arabic
  check("arabic finals", desk([R("الاختبار يوم الاحد",true),R("للبنين",false)]), "الاختبار يوم الاحد للبنين");
  check("empty", desk([]), "");
}
process.exit(fail?1:0);
