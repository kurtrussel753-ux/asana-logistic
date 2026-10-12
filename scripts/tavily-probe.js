#!/usr/bin/env node
// Live Tavily smoke test through the real server code (temp data dir, your key from the environment or .env next to server.js).
// Spends ~6 credits (search, extract, map, crawl ×5 pages, usage); add --research for one «mini» research task (~5–40 credits).
// Usage: IFA_TAVILY_KEY=tvly-... node scripts/tavily-probe.js [--research]
'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=path.join(__dirname,'..');let key=process.env.IFA_TAVILY_KEY;
if(!key){try{const m=fs.readFileSync(path.join(R,'.env'),'utf8').match(/^\s*IFA_TAVILY_KEY\s*=\s*['"]?([^'"\s]+)/m);if(m)key=m[1]}catch(e){}}
if(!key){console.error('IFA_TAVILY_KEY is not set (env or .env)');process.exit(2)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifa-tvp-'));const PORT=27000+Math.floor(Math.random()*2000),B='http://127.0.0.1:'+PORT,PW='Probe-Pass-123';
const env={...process.env,IFA_PORT:PORT,IFA_ENV_FILE:'',IFA_HOST:'127.0.0.1',IFA_DATA:dir,IFA_ADMIN_PASS:PW,IFA_AG_AUTO:'0',IFA_DTW_AUTO:'0',IFA_TAVILY_KEY:key,IFA_TAVILY_POLL_SEC:'5'};delete env.IFA_LIVE_OFF;delete env.IFA_TAVILY_BASE;
const p=spawn(process.execPath,['--experimental-sqlite','--no-warnings',path.join(R,'server.js')],{env,stdio:['ignore','ignore','inherit']});
const api=async(u,o={},tok)=>{const r=await fetch(B+u,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{})},body:o.body?JSON.stringify(o.body):undefined});const x=await r.text();let j;try{j=JSON.parse(x)}catch(e){j=x}return {s:r.status,j}};
let bad=0;const show=(n,r,f)=>{const ok=r.s>=200&&r.s<300;if(!ok)bad++;console.log((ok?'✓ ':'✗ ')+n.padEnd(10)+' HTTP '+r.s+' · '+(ok?f(r.j):String(r.j&&r.j.error||JSON.stringify(r.j)).slice(0,200)))};
(async()=>{try{for(let i=0;i<80;i++){try{await fetch(B+'/api/health');break}catch(e){await sleep(150)}}
 const T=(await api('/api/login',{method:'POST',body:{username:'admin',password:PW}})).j.token;
 let r=await api('/api/tavily/search',{method:'POST',body:{query:'container shipping Bandar Abbas port news',topic:'news',days:7,max_results:3,include_answer:'basic'}},T);show('search',r,j=>j.results.length+' results · '+j.credits+' cr · '+(j.results[0]?j.results[0].url:'')+' · answer '+(j.answer?'yes':'no'));
 r=await api('/api/tavily/extract',{method:'POST',body:{urls:['https://en.wikipedia.org/wiki/Bandar_Abbas'],query:'port',chunks_per_source:2}},T);show('extract',r,j=>j.results.length+' ok / '+j.failed.length+' failed · '+(j.results[0]?j.results[0].chars:0)+' chars · '+j.credits+' cr');
 r=await api('/api/tavily/map',{method:'POST',body:{url:'https://docs.tavily.com',limit:10}},T);show('map',r,j=>j.count+' urls · '+j.credits+' cr');
 r=await api('/api/tavily/crawl',{method:'POST',body:{url:'https://docs.tavily.com',limit:5}},T);show('crawl',r,j=>j.pages+' pages · '+j.credits+' cr');
 r=await api('/api/tavily/usage',{},T);show('usage',r,j=>'key '+j.key.usage+'/'+(j.key.limit??'∞')+' · plan '+j.account.plan+' '+j.account.planUsage+'/'+j.account.planLimit);
 if(process.argv.includes('--research')){r=await api('/api/tavily/research',{method:'POST',body:{q:'What is the current status of container shipping through the Strait of Hormuz? Answer briefly.',model:'mini',output_length:'short'}},T);show('research',r,j=>'job #'+j.id);
  if(r.s===200){let J;for(let i=0;i<60;i++){await sleep(5000);J=(await api('/api/tavily/research/'+r.j.id,{},T)).j;if(['done','failed'].includes(J.status))break}
   show('research✓',{s:J.status==='done'?200:500,j:J},j=>(j.sources||[]).length+' sources · '+String(j.result&&j.result.answer||'').slice(0,140)+' · $'+j.usd)}}
 r=await api('/api/tavily/status',{},T);console.log('credits used in this probe:',r.j.spent.day);
}catch(e){bad++;console.error(e)}finally{p.kill('SIGTERM');setTimeout(()=>{fs.rmSync(dir,{recursive:true,force:true});process.exit(bad?1:0)},300)}})();
