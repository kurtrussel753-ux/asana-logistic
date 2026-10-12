/* v15.24 runtime bridge (zero-dependency): shadow mode with a fake runtime that calls back into the server, read-only contexts,
   token auth, and graceful fallback to the legacy path when the runtime is down (primary mode + delegated flows). */
'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const TOKEN='bridge-test-token-0123456789',PW='Test-Pass-123';let ok=0,fail=0;
const t=(n,c,x)=>{if(c){ok++;console.log('  ✓',n)}else{fail++;console.log('  ✗',n,x!==undefined?JSON.stringify(x).slice(0,500):'')}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(extra){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifa-br-'));const PORT=21000+Math.floor(Math.random()*3000);const B='http://127.0.0.1:'+PORT;
 const env={...process.env,IFA_PORT:PORT,IFA_ENV_FILE:'',IFA_HOST:'127.0.0.1',IFA_DATA:dir,IFA_ADMIN_PASS:PW,IFA_LIVE_OFF:'all',IFA_AG_AUTO:'0',IFA_DTW_AUTO:'0',IFA_PUBLIC_URL:B,...extra};delete env.IFA_LLM_PROVIDER;
 const p=spawn(process.execPath,['--experimental-sqlite','--no-warnings',path.join(__dirname,'..','server.js')],{env,stdio:['ignore','ignore','inherit']});
 const api=async(u,o={},tok)=>{const r=await fetch(B+u,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{}),...(o.headers||{})},body:o.body?JSON.stringify(o.body):undefined});const x=await r.text();let j;try{j=JSON.parse(x)}catch(e){j=x}return {s:r.status,j}};
 return {B,api,dir,kill:()=>{p.kill('SIGTERM');setTimeout(()=>fs.rmSync(dir,{recursive:true,force:true}),300)},ready:async()=>{for(let i=0;i<80;i++){try{await fetch(B+'/api/health');return}catch(e){await sleep(150)}}}}}
(async()=>{
 /* fake runtime: answers by calling the bridge exactly like the real one does */
 let S1=null;const seen={};
 const fake=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',async()=>{const j=b?JSON.parse(b):{};const out=(c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
  if(q.url==='/healthz')return out(200,{ok:true,engine:'fake'});
  if(q.headers.authorization!=='Bearer '+TOKEN)return out(401,{error:'unauthorized'});
  if(q.url==='/v1/agents/analyst/ask'){const H={'Content-Type':'application/json','X-IFA-Runtime-Token':TOKEN};
   const c=await fetch(S1.B+'/api/runtime/call',{method:'POST',headers:H,body:JSON.stringify({ctx:j.ctx,tool:'rates_search',args:{pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC'}})}).then(x=>x.json());
   seen.write=(await fetch(S1.B+'/api/runtime/call',{method:'POST',headers:H,body:JSON.stringify({ctx:j.ctx,tool:'team_notify',args:{text:'x'}})})).status;
   seen.pol=await fetch(S1.B+'/api/runtime/policy?ctx='+j.ctx,{headers:H}).then(x=>x.json());
   await fetch(S1.B+'/api/runtime/usage',{method:'POST',headers:H,body:JSON.stringify({ctx:j.ctx,tin:100,tout:20,cost:0.001,provider:'fake',model:'m'})});
   return out(200,{answer:'میانه '+(c.result&&c.result.median)+' دلار ['+c.id+']',sources:[c.id],engine:'fake',model:'fake:m'})}
  out(404,{})})}).listen(0,'127.0.0.1');await new Promise(r=>fake.on('listening',r));
 const RB='http://127.0.0.1:'+fake.address().port;
 try{
  console.log('— shadow mode');
  S1=boot({IFA_RUNTIME_URL:RB,IFA_RUNTIME_TOKEN:TOKEN,IFA_RUNTIME_MODE:'shadow'});await S1.ready();
  const T=(await S1.api('/api/login',{method:'POST',body:{username:'admin',password:PW}})).j.token;
  const d=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
  await S1.api('/api/kv/ifa-rates',{method:'PUT',body:{value:JSON.stringify([{id:'R1',mode:'sea',vendor:'A',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC',amt:2400,cur:'USD',from:d(2),to:'2026-12-31',src:'manual'},{id:'R2',mode:'sea',vendor:'B',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC',amt:2600,cur:'USD',from:d(3),to:'2026-12-31',src:'manual'}]),base:0}},T);
  let r=await S1.api('/api/runtime/status',{},T);t('status: shadow mode, runtime healthy',r.j.mode==='shadow'&&r.j.health&&r.j.health.ok===true,r.j);
  t('bridge rejects missing token',(await S1.api('/api/runtime/agents')).s===401);
  t('bridge rejects wrong token',(await S1.api('/api/runtime/agents',{headers:{'X-IFA-Runtime-Token':'x'.repeat(TOKEN.length)}})).s===401);
  r=await S1.api('/api/runtime/agents',{headers:{'X-IFA-Runtime-Token':TOKEN}});const an=(r.j.agents||[]).find(a=>a.id==='analyst');
  t('bridge exposes agent registry + JSON schemas',an&&an.tools.some(x=>x.name==='rates_search'&&x.schema&&x.schema.type==='object')&&!!an.instructions);
  t('stale/unknown ctx → 410',(await S1.api('/api/runtime/call',{method:'POST',headers:{'X-IFA-Runtime-Token':TOKEN},body:{ctx:'cdeadbeef',tool:'fx_get'}})).s===410);
  r=await S1.api('/api/agents/ask',{method:'POST',body:{q:'میانهٔ نرخ نینگبو به بندرعباس 40HC؟'}},T);
  t('shadow: user gets the legacy answer',r.s===200&&r.j.status==='done'&&r.j.mode!=='runtime',r.j);
  let sh=null;for(let i=0;i<40&&!(sh&&sh.stats.n);i++){await sleep(100);sh=(await S1.api('/api/runtime/shadow',{},T)).j}
  t('shadow: comparison stored (runtime grounded by server re-check)',sh&&sh.stats.n===1&&sh.rows[0].rt_ok===1&&sh.rows[0].rt_grounded===1&&/2500/.test(sh.rows[0].rt),sh);
  t('read-only ask context blocks notify/write tools (403)',seen.write===403,seen);
  t('policy endpoint returns level + budget',seen.pol&&seen.pol.agent==='analyst'&&seen.pol.level===2&&seen.pol.budget&&seen.pol.canModel===true,seen.pol);
  t('shadow tokens accounted in daily usage',((await S1.api('/api/agents',{},T)).j.agents.find(a=>a.id==='analyst').usage).tokens>=120);
  t('runtime workflows proxy needs login',(await S1.api('/api/runtime/runs')).s===401);
  S1.kill();
  console.log('— primary mode, runtime down → legacy fallback');
  const S2=boot({IFA_RUNTIME_URL:'http://127.0.0.1:9',IFA_RUNTIME_TOKEN:TOKEN,IFA_RUNTIME_MODE:'primary',IFA_RUNTIME_FLOWS:'on',IFA_RUNTIME_TIMEOUT_SEC:'5'});await S2.ready();
  const T2=(await S2.api('/api/login',{method:'POST',body:{username:'admin',password:PW}})).j.token;
  r=await S2.api('/api/agents/ask',{method:'POST',body:{q:'نرخ ارز امروز؟'}},T2);t('primary + runtime down: answered by legacy path with note',r.s===200&&r.j.status==='done'&&/رانتایم/.test(String(r.j.note||'')),r.j);
  r=await S2.api('/api/flows',{method:'POST',body:{template:'daily_brief'}},T2);r=await S2.api('/api/flows/'+r.j.flow.id+'/run',{method:'POST',body:{wait:true}},T2);
  const tk=(await S2.api('/api/agents/tasks/'+r.j.task.id,{},T2)).j;t('flows on + runtime down: legacy flow engine runs, fallback logged',r.j.task.status==='done'&&tk.steps.some(s=>s.name==='flow.fallback'),tk.steps&&tk.steps.map(s=>s.name));
  r=await S2.api('/api/runtime/status',{},T2);t('status shows runtime unhealthy',r.j.mode==='primary'&&r.j.health&&r.j.health.ok===false,r.j);
  S2.kill();
  console.log('— default: off');
  const S3=boot({});await S3.ready();const T3=(await S3.api('/api/login',{method:'POST',body:{username:'admin',password:PW}})).j.token;
  r=await S3.api('/api/runtime/status',{},T3);t('no env → mode off, bridge closed',r.j.mode==='off'&&r.j.configured===false&&(await S3.api('/api/runtime/agents',{headers:{'X-IFA-Runtime-Token':TOKEN}})).s===401,r.j);
  S3.kill();
 }catch(e){fail++;console.error(e)}
 fake.close();console.log(`\n${ok} passed, ${fail} failed`);await sleep(400);process.exit(fail?1:0)})();
