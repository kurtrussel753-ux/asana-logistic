// End-to-end: real server.js (bridge in primary mode, flows delegated) + real runtime (Mastra, AI SDK, MCP SDK) + fake OpenAI-compatible model
// with native tool calling + fake Langfuse + fake SMTP. No network. Run: npm test (in runtime/)
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startRuntime} from '../src/index.js';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ifa-rt-'));const RTDATA=path.join(dir,'rt');
const P0=20000+Math.floor(Math.random()*4000),PORT=P0,RTPORT=P0+1,B='http://127.0.0.1:'+PORT,RB='http://127.0.0.1:'+RTPORT,PW='Test-Pass-123',TOKEN='rt-test-token-0123456789abcdef';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=(s,p)=>new Promise(r=>s.listen(p,'127.0.0.1',()=>r(s.address().port)));

/* fake SMTP (rfq_send e-mails) */
const MAILS=[];const smtp=net.createServer(c=>{let data=false,buf='',cur={};c.write('220 fake\r\n');c.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\r\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+2);if(data){if(l==='.'){data=false;MAILS.push(cur);cur={};c.write('250 ok\r\n')}else cur.body=(cur.body||'')+l+'\n';continue}
 if(/^EHLO/i.test(l))c.write('250-fake\r\n250 AUTH LOGIN\r\n');else if(/^AUTH LOGIN/i.test(l))c.write('334 VXNlcm5hbWU6\r\n');else if(/^MAIL FROM/i.test(l))c.write('250 ok\r\n');else if(/^RCPT TO:<(.*)>/i.test(l)){cur.to=l.match(/<(.*)>/)[1];c.write('250 ok\r\n')}else if(/^DATA/i.test(l)){data=true;c.write('354 go\r\n')}else if(/^QUIT/i.test(l)){c.write('221 bye\r\n');c.end()}else if(cur.a===undefined){cur.a=1;c.write('334 UGFzc3dvcmQ6\r\n')}else c.write('235 ok\r\n')}})});
/* fake OpenAI-compatible model with native tool calling */
const LLMLOG=[];
const llm=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{LLMLOG.push(b);const j=JSON.parse(b||'{}');const M=j.messages||[];
  const sys=M.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const users=M.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const tools=M.filter(m=>m.role==='tool');let msg;
  if(/دستیار عملیات/.test(sys))msg={role:'assistant',content:'خلاصهٔ فرایند: وضعیت عادی است.'};
  else if((j.tools||[]).some(t=>t.function&&t.function.name==='rates_search')&&!tools.length&&!/<data/.test(users))msg={role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'rates_search',arguments:JSON.stringify({pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC'})}}]};
  else{const all=tools.map(t=>typeof t.content==='string'?t.content:JSON.stringify(t.content)).join('\n')+users;const md=all.match(/\\?"median\\?":(\d+(?:\.\d+)?)/);const id=(all.match(/\\?"id\\?":\\?"(S\d+)/)||[])[1]||'S1';
    msg={role:'assistant',content:/HALLUCINATE/.test(users)?'میانهٔ نرخ 98765 دلار است ['+id+']':'میانهٔ نرخ نینگبو به بندرعباس '+(md?md[1]:'?')+' دلار است ['+id+']'}}
  const fin=msg.tool_calls?'tool_calls':'stop';const usage={prompt_tokens:200,completion_tokens:40,total_tokens:240};
  if(j.stream){r.writeHead(200,{'Content-Type':'text/event-stream'});const delta=msg.tool_calls?{role:'assistant',tool_calls:[{index:0,...msg.tool_calls[0]}]}:{role:'assistant',content:msg.content};
    r.write('data: '+JSON.stringify({id:'x',object:'chat.completion.chunk',created:1,model:'fake',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
    r.write('data: '+JSON.stringify({id:'x',object:'chat.completion.chunk',created:1,model:'fake',choices:[{index:0,delta:{},finish_reason:fin}],usage})+'\n\n');return r.end('data: [DONE]\n\n')}
  r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify({id:'x',object:'chat.completion',created:1,model:'fake',choices:[{index:0,message:msg,finish_reason:fin}],usage}))})});
/* fake Tavily (research create → in_progress → completed; search for live autopilot news) */
let TVP=0;const TVLOG=[];const tv=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{const j=JSON.parse(b||'{}');TVLOG.push({u:q.url,auth:q.headers.authorization,b:j});const out=(c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
  if(q.headers.authorization!=='Bearer tvly-e2e-key-0123456789')return out(401,{detail:{error:'bad key'}});
  if(q.url==='/research')return out(201,{request_id:'rs-e2e-1',status:'pending',model:j.model});
  if(q.url.startsWith('/research/'))return ++TVP<2?out(202,{request_id:'rs-e2e-1',status:'in_progress'}):out(200,{request_id:'rs-e2e-1',status:'completed',content:{answer:'Hormuz transits are limited.',findings:[{point:'Few transits',detail:'Lloyd’s List'}]},sources:[{title:'LL',url:'https://lloydslist.example.com/a'}],usage:{credits:9}});
  if(q.url==='/search')return out(200,{query:j.query,results:[{title:'Tanker seized near Hormuz',url:'https://news.example.com/t1',content:'seized vessel, shipping disruption',score:0.9,published_date:'2026-10-11'}],usage:{credits:1}});
  out(404,{})})});
/* fake Langfuse ingestion */
const LF=[];const lf=http.createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{LF.push({auth:q.headers.authorization,url:q.url,body:JSON.parse(b||'{}')});r.writeHead(207,{'Content-Type':'application/json'});r.end('{"successes":[],"errors":[]}')})});

let srv,RT,T,FIN;
const api=async(p,o={},tok)=>{const r=await fetch(B+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{}),...(o.headers||{})},body:o.body?JSON.stringify(o.body):undefined});const x=await r.text();let j;try{j=JSON.parse(x)}catch{j=x}return {s:r.status,j}};
const until=async(f,ms=15000)=>{const t0=Date.now();for(;;){const v=await f();if(v)return v;if(Date.now()-t0>ms)return v;await sleep(150)}};
const rtEnv=()=>({...process.env,IFA_SERVER_URL:B,IFA_RUNTIME_TOKEN:TOKEN,RT_PORT:String(RTPORT),RT_HOST:'127.0.0.1',RT_DATA:RTDATA,RT_POLL_SEC:'5',RT_RESEARCH_POLL_SEC:'0.3',
  RT_LLM_PROVIDER:'openai',RT_LLM_URL:'http://127.0.0.1:'+llm.address().port+'/v1',RT_LLM_MODEL:'fake-tools',RT_LLM_KEY:'k',RT_LLM_LOCAL:'0',RT_LLM_PRICE_IN:'3',RT_LLM_PRICE_OUT:'15',
  IFA_LLM_PROVIDER:'',LANGFUSE_HOST:'http://127.0.0.1:'+lf.address().port,LANGFUSE_PUBLIC_KEY:'pk-lf-test',LANGFUSE_SECRET_KEY:'sk-lf-test'});

test('boot server + runtime',async()=>{
  const smtpPort=await listen(smtp,0);await listen(llm,0);await listen(lf,0);await listen(tv,0);
  RT=await startRuntime(rtEnv());
  const env={...process.env,IFA_PORT:String(PORT),IFA_ENV_FILE:'',IFA_HOST:'127.0.0.1',IFA_DATA:dir,IFA_ADMIN_PASS:PW,IFA_LIVE_OFF:'all',IFA_AG_AUTO:'0',IFA_AG_ALLOW_LOCAL:'1',IFA_DTW_AUTO:'0',
    IFA_SMTP_HOST:'127.0.0.1',IFA_SMTP_PORT:String(smtpPort),IFA_SMTP_SECURE:'0',IFA_SMTP_USER:'u',IFA_SMTP_PASS:'p',IFA_SMTP_FROM:'ops@ifa.test',IFA_SMTP_NOTLS:'1',IFA_PUBLIC_URL:B,
    IFA_RUNTIME_URL:RB,IFA_RUNTIME_TOKEN:TOKEN,IFA_RUNTIME_MODE:'primary',IFA_RUNTIME_FLOWS:'on',IFA_RUNTIME_AGENTS:'analyst',
    IFA_TAVILY_KEY:'tvly-e2e-key-0123456789',IFA_TAVILY_BASE:'http://127.0.0.1:'+tv.address().port,IFA_TAVILY_POLL_SEC:'1'};
  delete env.IFA_LLM_PROVIDER;
  srv=spawn(process.execPath,['--experimental-sqlite','--no-warnings',path.join(ROOT,'server.js')],{env,stdio:['ignore','ignore','inherit']});
  for(let i=0;i<80;i++){try{await fetch(B+'/api/health');break}catch{await sleep(200)}}
  T=(await api('/api/login',{method:'POST',body:{username:'admin',password:PW}})).j.token;assert.ok(T);
  await api('/api/users',{method:'POST',body:{username:'fin1',name:'Fin',role:'finance',password:'Fin-Pass-1234'}},T);
  FIN=(await api('/api/login',{method:'POST',body:{username:'fin1',password:'Fin-Pass-1234'}})).j.token;assert.ok(FIN);
  const d=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
  const rates=[{id:'R1',mode:'sea',vendor:'Sea Star',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC',amt:2400,cur:'USD',from:d(5),to:'2026-12-31',src:'manual'},{id:'R2',mode:'sea',vendor:'Blue Ocean',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC',amt:2600,cur:'USD',from:d(9),to:'2026-12-31',src:'manual'},{id:'R3',mode:'sea',vendor:'Gulf Line',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC',amt:2500,cur:'USD',from:d(3),to:'2026-12-31',src:'manual'}];
  assert.equal((await api('/api/kv/ifa-rates',{method:'PUT',body:{value:JSON.stringify(rates),base:0}},T)).s,200);
  await api('/api/partners',{method:'POST',body:{name:'Sea Star Logistics',email:'quotes@seastar.test',lanes:[{mode:'fcl',pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC'}],send:false}},T);
});

test('health + status + bridge auth',async()=>{
  const h=await (await fetch(RB+'/healthz')).json();assert.equal(h.ok,true);assert.equal(h.engine,'mastra');assert.deepEqual(h.workflows,['procurement-rfq','finance-payment','deep-research','lane-autopilot']);assert.equal(h.langfuse.enabled,true);
  const s=await api('/api/runtime/status',{},T);assert.equal(s.s,200);assert.equal(s.j.mode,'primary');assert.equal(s.j.health.ok,true);assert.equal(s.j.flows,true);
  assert.equal((await api('/api/runtime/agents')).s,401,'no token → 401');
  assert.equal((await api('/api/runtime/agents',{headers:{'X-IFA-Runtime-Token':'wrong-token-wrong-token-xx'}})).s,401,'wrong token → 401');
  assert.equal((await fetch(RB+'/v1/runs')).status,401,'runtime /v1 needs bearer');
});

let ASKTASK;
test('phase 1–3: analyst ask runs on Mastra + AI SDK (native tool calling), grounded, PII masked, usage accounted',async()=>{
  const r=await api('/api/agents/ask',{method:'POST',body:{q:'میانهٔ نرخ نینگبو به بندرعباس 40HC چقدر است؟ پاسخ را به ali.rezaei@example.com هم بگو'}},T);
  assert.equal(r.s,200);assert.equal(r.j.status,'done',JSON.stringify(r.j).slice(0,400));assert.equal(r.j.mode,'runtime');assert.equal(r.j.engine,'mastra');
  assert.match(r.j.answer,/2500/);assert.ok(r.j.sources.length>0,'sources');ASKTASK=r.j.task;
  const tk=(await api('/api/agents/tasks/'+r.j.task,{},T)).j;
  assert.ok(tk.steps.some(s=>s.kind==='tool'&&s.name==='rates_search'),'tool call went through agCall');
  assert.ok(tk.steps.some(s=>s.kind==='llm'&&/runtime/.test(s.name)&&s.cost>0),'llm usage + cost recorded');
  assert.ok(tk.steps.some(s=>s.kind==='runtime'&&s.ok===1),'runtime ask step recorded grounded');
  const sent=LLMLOG.join('\n');assert.ok(!sent.includes('ali.rezaei@example.com'),'email never reaches the model');assert.ok(sent.includes('[EMAIL_1]'),'masked token sent');
  const ov=(await api('/api/agents',{},T)).j;const an=ov.agents.find(a=>a.id==='analyst');assert.ok(an.usage.tokens>0);
});

test('phase 3: ungrounded runtime answer is rejected server-side → legacy fallback with note',async()=>{
  const r=await api('/api/agents/ask',{method:'POST',body:{q:'HALLUCINATE میانهٔ نرخ نینگبو چقدر است؟'}},T);
  assert.equal(r.s,200);assert.notEqual(r.j.mode,'runtime');assert.ok(!String(r.j.answer||r.j.summary||'').includes('98765'));assert.match(String(r.j.note||''),/رانتایم/);
});

test('phase 2: Langfuse traces + generations (masked)',async()=>{
  await RT.tracer.flush();const ok=await until(()=>LF.length>0,5000);assert.ok(ok,'ingestion called');
  const ev=LF.flatMap(x=>x.body.batch||[]);assert.ok(ev.some(e=>e.type==='trace-create'&&/analyst\.ask/.test(e.body.name||'')));
  const g=ev.filter(e=>e.type==='generation-create');assert.ok(g.length>0);assert.ok(g.some(e=>e.body.usage&&e.body.usage.input===200));
  assert.ok(!JSON.stringify(ev).includes('ali.rezaei@example.com'),'no PII in traces');assert.match(LF[0].auth,/^Basic /);
});

test('phase 5: flow templates run as Mastra workflows (delegated by PB.flow.run)',async()=>{
  let r=await api('/api/flows',{method:'POST',body:{template:'daily_brief'}},T);const FID=r.j.flow.id;
  r=await api('/api/flows/'+FID+'/run',{method:'POST',body:{wait:true}},T);assert.equal(r.s,200);assert.equal(r.j.task.status,'done',JSON.stringify(r.j).slice(0,500));
  const f=(await api('/api/flows/'+FID,{},T)).j.flow;assert.equal(f.last_status,'ok');
  const tk=(await api('/api/agents/tasks/'+r.j.task.id,{},T)).j;const out=tk.output||{};assert.equal(out.engine,'runtime');assert.ok(out.run,'mastra run id');
  assert.ok(tk.steps.filter(s=>s.kind==='flow').length>=2,'per-step logs');assert.ok(tk.steps.some(s=>s.kind==='llm'&&/runtime/.test(s.name)),'llm step via runtime model');
  r=await api('/api/flows',{method:'POST',body:{name:'gate test',steps:[{type:'tool',tool:'approvals_list',id:'a'},{type:'gate',cond:'{{a.count}} > 999999'},{type:'notify',text:'never'}]}},T);const G=r.j.flow.id;
  r=await api('/api/flows/'+G+'/run',{method:'POST',body:{wait:true}},T);const g2=(await api('/api/flows/'+G,{},T)).j.flow;assert.equal(r.j.task.status,'done');assert.equal(g2.last_status,'stopped');
  r=await api('/api/flows',{method:'POST',body:{name:'fail test',steps:[{type:'tool',tool:'rates_search',id:'x',args:{pol:'{{vars.p}}'}},{type:'agent',agent:'nope',kind:'x',id:'y'}],vars:{p:'Ningbo'}}},T);
  if(r.s===200){const F3=r.j.flow.id;r=await api('/api/flows/'+F3+'/run',{method:'POST',body:{wait:true}},T);assert.equal(r.j.task.status,'failed')}
});

async function runDone(id){return until(async()=>{const r=(await api('/api/runtime/runs/'+id,{},T)).j;return r&&['success','failed'].includes(r.status)?r:null},20000)}

test('phase 4: procurement RFQ workflow suspends on approval, resumes on decision, sends via server',async()=>{
  const r=await api('/api/runtime/workflows/procurement-rfq/start',{method:'POST',body:{input:{lane:{pol:'Ningbo',dest:'Bandar Abbas',eq:'40HC',qty:2,commodity:'machinery'}}}},T);
  assert.equal(r.s,200,JSON.stringify(r.j));assert.equal(r.j.status,'suspended',JSON.stringify(r.j));assert.ok(r.j.approval);
  const ap=(await api('/api/agents/approvals',{},T)).j.find(a=>a.id===r.j.approval);assert.equal(ap.tool,'rfq_send');assert.equal(ap.status,'pending');
  let tk=(await api('/api/agents/tasks/'+r.j.task,{},T)).j;assert.equal(tk.status,'waiting');assert.ok(tk.steps.some(s=>s.name==='sanctions_screen'));
  const d=await api('/api/agents/approvals/'+r.j.approval,{method:'POST',body:{decision:'approve',note:'ok'}},T);assert.equal(d.s,200,JSON.stringify(d.j));
  const done=await runDone(r.j.runId);assert.equal(done.status,'success',JSON.stringify(done));assert.equal(done.result.outcome,'sent');
  tk=(await api('/api/agents/tasks/'+r.j.task,{},T)).j;assert.equal(tk.status,'done');assert.ok(await until(()=>MAILS.some(m=>m.to==='quotes@seastar.test'),5000),'RFQ e-mail sent');
  const r2=await api('/api/runtime/workflows/procurement-rfq/start',{method:'POST',body:{input:{lane:{pol:'Ningbo',dest:'Bandar Abbas',eq:'40HC'}}}},T);
  await api('/api/agents/approvals/'+r2.j.approval,{method:'POST',body:{decision:'reject',note:'نه'}},T);const d2=await runDone(r2.j.runId);assert.equal(d2.result.outcome,'rejected');
  assert.equal((await api('/api/agents/tasks/'+r2.j.task,{},T)).j.status,'rejected');
});

test('phase 4+7: finance payment — four-eyes enforced by server, durable across runtime restart',async()=>{
  const r=await api('/api/runtime/workflows/finance-payment/start',{method:'POST',body:{input:{vendor:'Sea Star',amount:1200,cur:'USD',ref:'INV-77',reason:'freight'}}},T);
  assert.equal(r.j.status,'suspended',JSON.stringify(r.j));
  const self=await api('/api/agents/approvals/'+r.j.approval,{method:'POST',body:{decision:'approve'}},T);assert.equal(self.s,403,'requester cannot approve own payment');
  await RT.close();RT=await startRuntime(rtEnv());   // restart: state comes back from LibSQL + run index
  const d=await api('/api/agents/approvals/'+r.j.approval,{method:'POST',body:{decision:'approve',note:'ok'}},FIN);assert.equal(d.s,200,JSON.stringify(d.j));
  const done=await runDone(r.j.runId);assert.equal(done.status,'success',JSON.stringify(done));assert.equal(done.result.outcome,'queued');
  const pq=(await api('/api/kv?keys=ifa-payq',{},T)).j['ifa-payq'];assert.ok(JSON.parse(pq.value||'[]').some(p=>p.ref==='INV-77'&&p.approvedBy==='fin1'));
});

test('phase 6: MCP (official SDK, Streamable HTTP) with ifa_mcp_ keys',async()=>{
  const k=(await api('/api/agents/keys',{method:'POST',body:{name:'rt-mcp',role:'sales',level:1}},T)).j.key;assert.match(k,/^ifa_mcp_/);
  const c=new Client({name:'test',version:'1.0.0'});await c.connect(new StreamableHTTPClientTransport(new URL(RB+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+k}}}));
  const L=await c.listTools();const names=L.tools.map(t=>t.name);for(const n of ['rates_search','ask_analyst','workflow_start','workflow_status'])assert.ok(names.includes(n),n);
  const x=await c.callTool({name:'rates_search',arguments:{pol:'Ningbo',pod:'Bandar Abbas',eq:'40HC'}});assert.ok(!x.isError);assert.match(x.content[0].text,/median/);
  const a=await c.callTool({name:'ask_analyst',arguments:{question:'میانهٔ نرخ نینگبو به بندرعباس؟'}});assert.ok(!a.isError,JSON.stringify(a).slice(0,300));assert.equal(a.structuredContent.grounded,true);
  await c.close();
  const bad=new Client({name:'bad',version:'1'});await assert.rejects(bad.connect(new StreamableHTTPClientTransport(new URL(RB+'/mcp'),{requestInit:{headers:{Authorization:'Bearer ifa_mcp_nope'}}})));
});

test('MCP workflow wrappers respect role, tool whitelist and run ownership',async()=>{
  const cases=[
    {name:'restricted-sales',role:'sales',level:1,tools:['rates_search'],workflow:'procurement-rfq'},
    {name:'viewer-workflows',role:'viewer',level:1,workflow:'lane-autopilot'},
    {name:'sales-finance',role:'sales',level:1,workflow:'finance-payment'}
  ];
  for(const data of cases){
    const k=(await api('/api/agents/keys',{method:'POST',body:data},T)).j.key;
    const c=new Client({name:'scope-test',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(RB+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+k}}}));
    const before=RT.engine.runs.list(100).length;
    const r=await c.callTool({name:'workflow_start',arguments:{workflow:data.workflow,input:{lane:{pol:'Ningbo',dest:'Tehran'},pol:'Ningbo',dest:'Tehran',vendor:'X',amount:1,cur:'USD',ref:'SCOPED'}}});
    assert.equal(r.isError,true,data.name);assert.equal(RT.engine.runs.list(100).length,before,'denied request must not create a workflow');
    const foreign=RT.engine.runs.list(100).find(x=>x.by==='admin');assert.ok(foreign);
    const status=await c.callTool({name:'workflow_status',arguments:{runId:foreign.id}});assert.equal(status.isError,true,'foreign workflow data must not leak');await c.close();
  }
  await api('/api/users',{method:'POST',body:{username:'sales-scope',name:'Sales',role:'sales',password:'Sales-Pass-1234'}},T);
  const sales=(await api('/api/login',{method:'POST',body:{username:'sales-scope',password:'Sales-Pass-1234'}})).j.token;
  const r=await api('/api/runtime/workflows/finance-payment/start',{method:'POST',body:{input:{vendor:'X',amount:1,cur:'USD',ref:'DENIED'}}},sales);assert.equal(r.s,403,'HTTP proxy must enforce initiating role');
});

test('phase 8: deep-research workflow — Tavily Research job polled to completion, memory + task closed',async()=>{
  const r=await api('/api/runtime/workflows/deep-research/start',{method:'POST',body:{input:{q:'Status of container shipping through the Strait of Hormuz',model:'mini'}}},T);
  assert.equal(r.s,200,JSON.stringify(r.j));
  const run=await until(async()=>{const x=(await api('/api/runtime/runs/'+r.j.runId,{},T)).j;return x&&x.status==='success'&&x},20000);
  assert.ok(run,'run did not finish');assert.equal(run.result.outcome,'done');assert.match(run.result.answer,/Hormuz/);assert.equal(run.result.sources[0].url,'https://lloydslist.example.com/a');
  assert.ok(TVLOG.some(x=>x.u==='/research'&&x.b.model==='mini'&&x.b.output_schema));
  const tk=(await api('/api/agents/tasks/'+run.result.task,{},T)).j;assert.equal(tk.status,'done');
});

test('phase 8: lane-autopilot workflow — server autopilot with live Tavily news',async()=>{
  const r=await api('/api/runtime/workflows/lane-autopilot/start',{method:'POST',body:{input:{pol:'Ningbo',dest:'Tehran',eq:'40HC',value:50000,web:true}}},T);
  assert.equal(r.s,200,JSON.stringify(r.j));assert.equal(r.j.status,'success',JSON.stringify(r.j));
  assert.ok(r.j.result.decision&&r.j.result.decision.rec,'no recommendation');assert.ok(TVLOG.some(x=>x.u==='/search'&&x.b.topic==='news'));
  const ap=(await api('/api/ap/runs?mode=server',{},T)).j;assert.ok(ap.runs.some(x=>x.id===r.j.result.run));
});

test('kill switch blocks runtime',async()=>{
  await api('/api/agents/kill',{method:'POST',body:{on:true}},T);
  const r=await api('/api/runtime/workflows/finance-payment/start',{method:'POST',body:{input:{vendor:'X',amount:1,cur:'USD',ref:'K'}}},T);assert.equal(r.s,423);
  await api('/api/agents/kill',{method:'POST',body:{on:false}},T);
});

after(async()=>{try{srv&&srv.kill('SIGTERM')}catch{}try{await RT?.close()}catch{}smtp.close();llm.close();lf.close();tv.close();await sleep(300);fs.rmSync(dir,{recursive:true,force:true})});
