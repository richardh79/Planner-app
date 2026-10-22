// Block-assignment keys and message ticks, in both apps.   node tests/logic.unit.js
const fs=require("fs");
function grab(file, startMark, endMark){ const s=fs.readFileSync(require("path").join(__dirname,"..",file),"utf8"); const a=s.indexOf(startMark); const b=s.indexOf(endMark,a); return s.slice(a,b); }
let fail=0; const check=(n,ok,d)=>{ if(!ok) fail++; console.log((ok?"PASS ":"FAIL ")+n+(ok?"":"  "+d)); };
for (const file of ["app.js","desktop.js"]) {
  console.log("== "+file);
  // plan key
  const code=grab(file,"/* A day's blocks are a list","function planned")+"function planned(dateStr, blockIx){ return plan[dateStr+\"#\"+blockId(dateStr,blockIx)]||\"\"; }\n"+
    "function assignKey(d,ix){ return d+\"#\"+blockId(d,ix); }\nreturn {planned:planned, setPlan:function(k,v){plan[k]=v;}, key:assignKey, setBoard:function(b){board=b;}};";
  const mk=new Function("var board={week:[[],[],[],[],[],[],[]]}; var plan={};\n"+code)();
  const day=[["09","A","",'x',480,540,1],["13","B","",'x',780,900,1],["14","C","",'x',840,1260,1]];
  const wed="2026-10-21"; // a Wednesday = index 3
  const board={week:[[],[],[],JSON.parse(JSON.stringify(day)),[],[],[]]}; mk.setBoard(board);
  mk.setPlan(mk.key(wed,2),"thread-for-C");
  check("assignment found at its block", mk.planned(wed,2)==="thread-for-C");
  // a new block is added at 10:00: C moves from index 2 to 3
  board.week[3].splice(1,0,["10","New","",'x',600,660,1]);
  check("after a block is inserted, C still has its thread", mk.planned(wed,3)==="thread-for-C", mk.planned(wed,3));
  check("and the new block at C's old index does not inherit it", mk.planned(wed,2)==="", mk.planned(wed,2));
  // read ticks
  const src=fs.readFileSync(require("path").join(__dirname,"..",file),"utf8");
  const ms=src.slice(src.indexOf("function msgState"), src.indexOf("\n}\n", src.indexOf("function msgState"))+3);
  const st=new Function("var replies={}; "+ms+"\nreturn {msgState:msgState, replies:replies};")();
  check("sent: no comments", st.msgState({number:1,state:"open",comments:0})==="sent");
  st.replies[2]={answered:false}; check("organizer-only comment is not 'answered'", st.msgState({number:2,state:"open",comments:1})==="sent");
  st.replies[3]={answered:true};  check("a reply from a person turns it to seen", st.msgState({number:3,state:"open",comments:2})==="seen");
  check("closed is filed", st.msgState({number:4,state:"closed",comments:0})==="filed");
}
process.exit(fail?1:0);
