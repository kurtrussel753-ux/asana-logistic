/* ---------- v15.24 agent-runtime bridge · sidecar runtime (Mastra + Vercel AI SDK + MCP SDK) — see runtime/ and docs/runtime-migration.md ----------
 The server stays the system of record and the policy engine: every tool call the runtime makes comes back through agCall (whitelist, roles, data keys,
 budgets, autonomy levels, approvals, four-eyes, audit). Default IFA_RUNTIME_MODE=off → zero behaviour change. */
db.exec(`CREATE TABLE IF NOT EXISTS rt_shadow(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,agent TEXT,task INTEGER,q TEXT,legacy TEXT,rt TEXT,lg_mode TEXT,lg_grounded INTEGER,rt_grounded INTEGER,rt_ok INTEGER,agree REAL,ms_legacy INTEGER,ms_rt INTEGER,model TEXT,err TEXT);
CREATE INDEX IF NOT EXISTS rt_shadow_ts ON rt_shadow(ts);`);
const RTC=()=>{const e=process.env;const url=String(e.IFA_RUNTIME_URL||'').trim().replace(/\/+$/,'');const token=String(e.IFA_RUNTIME_TOKEN||'');const ready=!!url&&token.length>=16;
 const mode=ready&&['shadow','primary'].includes(e.IFA_RUNTIME_MODE)?e.IFA_RUNTIME_MODE:'off';
 return {url,token,ready,mode,agents:String(e.IFA_RUNTIME_AGENTS||'analyst').split(',').map(s=>s.trim()).filter(Boolean),flows:ready&&e.IFA_RUNTIME_FLOWS==='on',
  timeout:Math.max(5,+e.IFA_RUNTIME_TIMEOUT_SEC||120)*1000,shadowPct:Math.max(0,Math.min(100,e.IFA_RUNTIME_SHADOW_PCT==null?100:+e.IFA_RUNTIME_SHADOW_PCT||0))}};
function rtAuth(req){const C=RTC();const t=Buffer.from(String(req.headers['x-ifa-runtime-token']||'')),expected=Buffer.from(C.token);
 if(!C.ready||t.length!==expected.length||!crypto.timingSafeEqual(t,expected))throw E(401,'توکن رانتایم نامعتبر است (IFA_RUNTIME_TOKEN)');return C}
async function rtFetch(p,b,o={}){const C=RTC();if(!C.ready)throw new Error('رانتایم پیکربندی نشده است (IFA_RUNTIME_URL / IFA_RUNTIME_TOKEN)');const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),o.timeout||C.timeout);
 try{const r=await fetch(C.url+p,{method:o.method||(b===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Authorization:'Bearer '+C.token},body:b===undefined?undefined:JSON.stringify(b),signal:ac.signal});
  const x=await r.text();let j;try{j=JSON.parse(x)}catch(e){j={raw:x.slice(0,300)}}if(!r.ok)throw Object.assign(new Error(String((j&&j.error)||('runtime HTTP '+r.status)).slice(0,300)),{status:r.status,body:j});return j}
 catch(e){if(e.name==='AbortError')throw new Error('مهلت پاسخ رانتایم به پایان رسید');throw e}finally{clearTimeout(tm)}}
let RTH={at:0,v:null};
async function rtHealth(force){if(!force&&Date.now()-RTH.at<15e3)return RTH.v;let v;try{v=await rtFetch('/healthz',undefined,{timeout:3000})}catch(e){v={ok:false,error:e.message}}RTH={at:Date.now(),v};return v}
/* execution contexts handed to the runtime: the runtime only ever holds an opaque id; the live ctx (task, agent, actor, sources, approvals) stays here */
const RTCTX=new Map();
function rtCtxOpen(ctx,o={}){const now=Date.now();for(const [k,v] of RTCTX)if(v.exp<now)RTCTX.delete(k);const id='c'+crypto.randomBytes(12).toString('hex');ctx.rtObs=ctx.rtObs||[];ctx.sources=ctx.sources||[];RTCTX.set(id,{ctx,exp:now+(o.ttl||30*60e3),ro:!!o.ro});return id}
function rtCtx(id){const e=RTCTX.get(String(id||''));if(!e||e.exp<Date.now())throw E(410,'زمینهٔ اجرا منقضی یا نامعتبر است');return e}
const rtCtxClose=id=>RTCTX.delete(id);
const rtToolPub=n=>{const t=TOOLS[n];return t&&{name:t.name,cls:t.cls,description:t.d,schema:agSchema(t),untrusted:t.cls==='web'||!!t.taint,hard:HARD.includes(t.cls),approvers:t.approvers||null,fourEyes:!!t.fourEyes}};
function rtPolicy(ag){const C=agCfg();const B=agBudget(ag),U=agUseGet(ag.id);return {agent:ag.id,name:ag.n,kill:!!C.kill,paused:!!C.paused[ag.id],level:agLevel(ag),budget:B,usage:{calls:U.calls,tokens:U.tokens,cost:U.cost,ext:U.ext},mask:!!C.mask,
 llm:{maxTokens:C.llm.maxTokens||1400,temperature:C.llm.temperature},canModel:!C.kill&&!C.paused[ag.id]&&U.tokens<(B.tokens||0)&&U.cost<(B.usd||0)}}
const rtTaskFin=(id,st,o)=>{run('UPDATE ag_task SET status=?,output=?,sources=?,flags=?,cost=?,tokens=?,calls=?,model=?,finished=?,err=? ,tainted=? WHERE id=?',st,o.out?clip(o.out,60000):null,JSON.stringify(o.src||[]),JSON.stringify(o.flags||{}),o.cost||0,o.tokens||0,o.calls||0,o.model||null,Date.now(),o.err||null,o.tainted?1:0,id);return q1('SELECT * FROM ag_task WHERE id=?',id)};
const rtTaskCtx=T=>{const ag=AGENTS[T.agent];if(!ag)throw E(400,'عامل ناشناخته');let a=[];try{a=(JSON.parse(T.flags||'{}').approvals)||[]}catch(e){}return {task:T.id,ag,actor:agActor(ag),sources:[],steps:T.calls||0,tokens:T.tokens||0,cost:T.cost||0,inj:[],by:T.by,approvals:a,runtime:true}};
/* --- runtime → server (shared-secret) --- */
route('GET','/api/runtime/agents',req=>{rtAuth(req);return {version:VERSION,agents:Object.values(AGENTS).map(a=>({id:a.id,name:a.n,instructions:a.instr||'',level:agLevel(a),maxLevel:a.maxLevel??3,web:!!a.web,role:a.role,kinds:a.kinds,tools:a.tools.map(rtToolPub).filter(Boolean)}))}});
route('GET','/api/runtime/policy',req=>{rtAuth(req);const sp=new URL(req.url,'http://x').searchParams;const c=sp.get('ctx');const ag=c?rtCtx(c).ctx.ag:AGENTS[sp.get('agent')];if(!ag)throw E(404,'عامل ناشناخته');return rtPolicy(ag)});
route('POST','/api/runtime/call',async req=>{rtAuth(req);const b=await body(req);const e=rtCtx(b.ctx);const ctx=e.ctx;const t=TOOLS[b.tool];if(!t)throw E(404,'ابزار ناشناخته: '+b.tool);
 if(ctx.task&&FLCANCEL.has(ctx.task))return {__code:409,error:'اجرا توسط کاربر لغو شد',cancelled:true};
 if(e.ro&&!['read','compute'].includes(t.cls))return {__code:403,error:'در این زمینه فقط ابزارهای خواندنی/محاسباتی مجازند',policy:true};
 if(b.why)ctx.why=String(b.why).slice(0,600);
 try{const r=await agCall(ctx,t.name,b.args&&typeof b.args==='object'&&!Array.isArray(b.args)?b.args:{});const un=t.cls==='web'||!!t.taint;
  if(un){const hit=agInj(JSON.stringify(r??null).slice(0,40000));if(hit.length)(ctx.inj=ctx.inj||[]).push(...hit)}const id='S'+(ctx.rtObs.length+1);ctx.rtObs.push({id,tool:t.name,res:r});
  return {id,result:r??null,untrusted:un,pending:!!(r&&r.pending===true),approval:r&&r.pending===true?r.approval:null}}
 catch(err){if(err.policy)return {__code:403,error:err.message,policy:true};return {__code:422,error:String(err.message||err).slice(0,500)}}});
route('POST','/api/runtime/usage',async req=>{rtAuth(req);const b=await body(req);const ctx=rtCtx(b.ctx).ctx;const tin=Math.max(0,+b.tin||0),tout=Math.max(0,+b.tout||0),cost=Math.max(0,+b.cost||0);
 agUse(ctx.ag.id,{tokens:tin+tout,cost});ctx.tokens=(ctx.tokens||0)+tin+tout;ctx.cost=(ctx.cost||0)+cost;ctx.model=String(b.provider||'runtime')+':'+String(b.model||'');
 agStep(ctx,'llm','runtime · '+String(b.provider||'')+' · '+String(b.model||''),{masked:+b.masked||0,local:!!b.local,engine:'ai-sdk'},{tin,tout,stop:String(b.stop||''),trace:b.trace||undefined},+b.ms||0,1,cost);return {ok:true,policy:rtPolicy(ctx.ag)}});
route('POST','/api/runtime/step',async req=>{rtAuth(req);const b=await body(req);const ctx=rtCtx(b.ctx).ctx;agStep(ctx,String(b.kind||'runtime').slice(0,20),String(b.name||'step'),b.input??null,b.output??null,+b.ms||0,b.ok!==false);return {ok:true,cancelled:!!(ctx.task&&FLCANCEL.has(ctx.task))}});
route('POST','/api/runtime/agent-run',async req=>{rtAuth(req);const b=await body(req);const ctx=rtCtx(b.ctx).ctx;if(ctx.task&&FLCANCEL.has(ctx.task))return {__code:409,error:'اجرا توسط کاربر لغو شد',cancelled:true};
 const tid=agEnqueue(String(b.agent||''),String(b.kind||''),b.input&&typeof b.input==='object'?b.input:{},{by:ctx.by,trig:String(b.trig||'runtime'),parent:ctx.task||null});const T=await agRun(tid);let o={};try{o=JSON.parse(T.output||'{}')}catch(e){}return {task:T.id,status:T.status,err:T.err||null,...o}});
route('POST','/api/runtime/tasks/open',async req=>{rtAuth(req);const b=await body(req);const ag=AGENTS[b.agent];if(!ag)throw E(400,'عامل ناشناخته');const C=agCfg();
 if(C.kill)throw E(423,'کلید توقف اضطراری فعال است');if(C.paused[ag.id])throw E(423,'«'+ag.n+'» متوقف شده است');
 const by=String(b.by||'system').slice(0,60);const id=Number(run('INSERT INTO ag_task(agent,kind,title,status,input,trig,parent,by,created,started) VALUES(?,?,?,?,?,?,?,?,?,?)',ag.id,'workflow',String(b.title||'گردش‌کار رانتایم').slice(0,120),'running',JSON.stringify(b.input||{}),String(b.trig||'runtime').slice(0,80),null,by,Date.now(),Date.now()).lastInsertRowid);
 agUse(ag.id,{tasks:1});const ctx=rtTaskCtx(q1('SELECT * FROM ag_task WHERE id=?',id));audit(by,'','runtime.task.open','agent',String(id),{agent:ag.id,workflow:b.workflow||null,run:b.run||null});return {task:id,ctx:rtCtxOpen(ctx,{ttl:2*3600e3})}});
route('POST','/api/runtime/tasks/:id/ctx',(req,u,P)=>{rtAuth(req);const T=q1('SELECT * FROM ag_task WHERE id=?',+P.id);if(!T)throw E(404,'کار یافت نشد');if(!['running','waiting'].includes(T.status))throw E(409,'کار در وضعیت «'+T.status+'» است');return {task:T.id,ctx:rtCtxOpen(rtTaskCtx(T),{ttl:2*3600e3})}});
route('POST','/api/runtime/tasks/:id/state',async(req,u,P)=>{rtAuth(req);const b=await body(req);const st=b.status==='waiting'?'waiting':'running';run("UPDATE ag_task SET status=? WHERE id=? AND status IN ('running','waiting')",st,+P.id);
 if(b.ctx){try{const c=rtCtx(b.ctx).ctx;run('UPDATE ag_task SET flags=?,sources=?,calls=?,tokens=?,cost=? WHERE id=?',JSON.stringify({approvals:c.approvals||[],waiting:b.note||null}),JSON.stringify((c.sources||[]).slice(0,40)),c.steps||0,c.tokens||0,c.cost||0,+P.id)}catch(e){}}return {ok:true,status:st}});
route('POST','/api/runtime/tasks/:id/close',async(req,u,P)=>{rtAuth(req);const b=await body(req);const T=q1('SELECT * FROM ag_task WHERE id=?',+P.id);if(!T)throw E(404,'کار یافت نشد');if(!['running','waiting'].includes(T.status))return {task:T.id,status:T.status};
 let c={sources:[],approvals:[]};try{if(b.ctx)c=rtCtx(b.ctx).ctx}catch(e){}const st=['done','failed','rejected','cancelled'].includes(b.status)?b.status:'done';const out=b.out&&typeof b.out==='object'?b.out:{summary:String(b.out||'')};
 const seen=new Set();const src=[...(Array.isArray(out.sources)?out.sources:[]),...(c.sources||[])].filter(s=>s&&!seen.has(srcKey(s))&&seen.add(srcKey(s))).slice(0,40);delete out.sources;
 const R=rtTaskFin(T.id,st,{out,src,flags:{tainted:!!c.tainted,inj:[...new Set(c.inj||[])].slice(0,10),denied:c.denied||0,approvals:c.approvals||[],engine:'runtime',workflow:b.workflow||null,run:b.run||null},cost:c.cost||T.cost,tokens:c.tokens||T.tokens,calls:c.steps||T.calls,model:c.model||null,err:b.err?String(b.err).slice(0,500):null,tainted:c.tainted});
 if(b.ctx)rtCtxClose(b.ctx);const ag=AGENTS[T.agent];const summ=String(out.summary||out.answer||'');if(st==='done'){memAdd('task',String(T.id),ag.n+' · '+T.title,summ,ag.id);_fire0('agent.done',{ref:'#'+T.id,agent:ag.n,kind:T.title,summary:summ.slice(0,400)},'agd|'+T.id)}return {task:R.id,status:R.status}});
route('GET','/api/runtime/approvals/:id',(req,u,P)=>{rtAuth(req);const a=q1('SELECT * FROM ag_appr WHERE id=?',+P.id);if(!a)throw E(404,'مورد تأیید یافت نشد');const p=apPub(a);return {id:p.id,task:p.task,agent:p.agent,tool:p.tool,cls:p.cls,status:p.status,decided_by:p.decided_by,decided_at:p.decided_at,note:p.note,result:p.result,expires:p.expires}});
// Workflow wrappers must not bypass the initiating user's role or an MCP key's tool whitelist.
const RTWFTOOLS={
 'procurement-rfq':['rfq_draft','rates_search','partners_list','sanctions_screen','rfq_send','team_notify'],
 'finance-payment':['fx_get','invoice_reconcile','payment_request'],
 'deep-research':['tavily_research','tavily_research_get','team_notify'],
 'lane-autopilot':['autopilot_run','team_notify']};
function rtWorkflowsFor(id){const actor={username:id.who,role:id.role};if(!can(actor,'agents.use')||id.level<1)return [];
 return Object.entries(RTWFTOOLS).filter(([wf,names])=>names.every(n=>{const t=TOOLS[n];return t&&(!id.tools||id.tools.includes(n))&&(!t.perm||can(actor,t.perm))&&(t.keys||[]).every(k=>canKey(actor,k))})).map(([wf])=>wf)}
route('POST','/api/runtime/mcp-auth',async req=>{rtAuth(req);const b=await body(req);const id=mcpIdentity({headers:{authorization:String(b.authorization||'')}});if(!id)throw E(401,'Unauthorized');const ag=mcpAgent(id);
 const ctx={ag,actor:{id:0,username:id.who,role:id.role,name:id.who},sources:[],steps:0,inj:[],approvals:[],by:id.who};return {who:id.who,role:id.role,level:id.level,workflows:rtWorkflowsFor(id),ctx:rtCtxOpen(ctx,{ttl:10*60e3}),tools:ag.tools.map(rtToolPub).filter(Boolean)}});
/* --- runtime-backed ask (phase 3): grounding is re-checked here against the tool results the server itself returned --- */
async function rtAsk(ctx,qs,o={}){const id=rtCtxOpen(ctx,{ro:true,ttl:10*60e3});const n0=ctx.rtObs.length;const t0=Date.now();
 try{const r=await rtFetch('/v1/agents/'+encodeURIComponent(ctx.ag.id)+'/ask',{ctx:id,task:ctx.task||null,question:String(qs).slice(0,4000),by:ctx.by||null});
  const obs=ctx.rtObs.slice(n0);const ans=String(r.answer||'');const g=agGround(ans,obs.map(x=>x.res),qs);const ids=new Set((r.sources||[]).map(String));
  const src=obs.filter(x=>!ids.size||ids.has(x.id)).flatMap(x=>(x.res&&Array.isArray(x.res.sources)&&x.res.sources.length?x.res.sources:[{kind:'tool',ref:x.id,title:x.tool}])).slice(0,20);
  if(o.record!==false)agStep(ctx,'runtime',ctx.ag.id+'.ask',{q:clip(qs,300),engine:r.engine||'mastra'},{grounded:g.ok,bad:g.bad,tools:obs.map(x=>x.tool),model:r.model||null,trace:r.trace||null},Date.now()-t0,g.ok?1:0);
  return {answer:ans,sources:src,grounded:g.ok&&!!ans,ungrounded:g.bad,steps:obs.length,mode:'runtime',engine:r.engine||'mastra',model:r.model?String(r.model):ctx.model,trace:r.trace||null,ms:Date.now()-t0,
   note:!ans?'پاسخ خالی':!g.ok?'اعداد بدون منبع: '+g.bad.join('، '):!src.length?'پاسخ بدون منبع':''}}
 finally{rtCtxClose(id)}}
const rtAgree=(a,b)=>{const A=new Set(numsOf(a).filter(v=>v>=10)),B=new Set(numsOf(b).filter(v=>v>=10));if(!A.size&&!B.size)return 1;let n=0;for(const v of A)if(B.has(v))n++;return +(n/(A.size+B.size-n)).toFixed(3)};
async function rtShadow(ctx,qs,L,msL){const sc={ag:ctx.ag,actor:ctx.actor,sources:[],steps:0,inj:[],by:ctx.by,approvals:[],shadow:true};let r=null,err=null;try{r=await rtAsk(sc,qs,{record:false})}catch(e){err=e.message}
 const la=String(L&&(L.answer||L.summary)||'');run('INSERT INTO rt_shadow(ts,agent,task,q,legacy,rt,lg_mode,lg_grounded,rt_grounded,rt_ok,agree,ms_legacy,ms_rt,model,err) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',Date.now(),ctx.ag.id,ctx.task||null,clip(qs,1000),clip(la,4000),r?clip(r.answer,4000):null,
  String(L&&L.mode||(L&&L.grounded!=null?'llm':'rule')),L&&L.grounded?1:0,r&&r.grounded?1:0,r?1:0,r?rtAgree(la,r.answer):null,msL||0,r?r.ms:null,r?r.model:null,err||(r&&r.note)||null);
 run('DELETE FROM rt_shadow WHERE id<=(SELECT MAX(id)-5000 FROM rt_shadow)')}
const _agAskLegacy=agAsk;
agAsk=async function(ctx,qs){const C=RTC();if(C.mode==='off'||!ctx||!ctx.ag||!C.agents.includes(ctx.ag.id))return _agAskLegacy(ctx,qs);
 if(C.mode==='shadow'){const t0=Date.now();const R=await _agAskLegacy(ctx,qs);const ms=Date.now()-t0;if(Math.random()*100<C.shadowPct)rtShadow(ctx,qs,R,ms).catch(e=>console.error('runtime shadow',e.message));return R}
 let r=null,err=null;try{r=await rtAsk(ctx,qs)}catch(e){err=e.message}if(r&&r.grounded&&r.sources.length)return r;
 agStep(ctx,'runtime','fallback',{q:clip(qs,300)},{error:err,note:r&&r.note},0,0);const R=await _agAskLegacy(ctx,qs);R.note=((R.note?R.note+' ':'')+(err?'رانتایم در دسترس نبود ('+String(err).slice(0,100)+')':'پاسخ رانتایم پذیرفته نشد ('+(r&&r.note||'بدون منبع')+')')+'؛ مسیر قبلی استفاده شد.').trim();return R};
/* --- approvals → runtime (phase 4): suspended human-in-the-loop workflows resume when an approval is decided (the runtime also polls) --- */
async function rtHook(id){if(!RTC().ready)return;const a=q1('SELECT id,task,agent,tool,status FROM ag_appr WHERE id=?',id);if(!a)return;try{await rtFetch('/v1/hooks/approval',{approval:a.id,task:a.task,agent:a.agent,tool:a.tool,status:a.status},{timeout:5000})}catch(e){}}
const _apDecide=apDecide;
apDecide=async function(id,u,ip,b){try{return await _apDecide(id,u,ip,b)}finally{rtHook(+id).catch(()=>{})}};
/* --- flows → runtime workflows (phase 5): the runtime compiles the flow definition to a Mastra workflow; tool/agent/notify steps come back through agCall --- */
const _flRun=PB.flow.run;
PB.flow.run=async function(ctx,i){const C=RTC();if(!C.flows)return _flRun.call(this,ctx,i);const h=await rtHealth();
 if(!h||!h.ok){agStep(ctx,'runtime','flow.fallback',{flow:i.flow},{error:(h&&h.error)||'runtime unreachable'},0,0);return _flRun.call(this,ctx,i)}
 const F=q1('SELECT * FROM ag_flow WHERE id=?',+i.flow);if(!F)throw new Error('فرایند یافت نشد');const D=flPub(F);ctx.sources.push({kind:'flow',ref:'flow:'+F.id,title:'فرایند «'+F.name+'»',view:'agt'});
 const cid=rtCtxOpen(ctx,{ttl:6*3600e3});let r;
 try{r=await rtFetch('/v1/flows/run',{ctx:cid,task:ctx.task||null,by:ctx.by||null,flow:{id:F.id,name:F.name,steps:D.steps,vars:D.vars||{}},vars:i.vars&&typeof i.vars==='object'?i.vars:{},event:i.event||null,today:agDay()},{timeout:6*3600e3})}finally{rtCtxClose(cid)}
 const log=Array.isArray(r.log)?r.log.slice(0,200):[];const status=['ok','stopped','cancelled','failed'].includes(r.status)?r.status:'failed';const why=String(r.why||'').slice(0,500);FLCANCEL.delete(ctx.task);
 const ap=log.filter(x=>x.status==='approval').length,ok=log.filter(x=>x.status==='ok').length,fl=log.filter(x=>x.status==='fail').length;const last=r.text?String(r.text):'';
 const summary=(status==='ok'?'✅':status==='stopped'?'⏹':status==='cancelled'?'⛔':'❌')+' فرایند «'+F.name+'»: '+ok+' گام انجام شد'+(ap?' · '+ap+' اقدام در کارتابل تأیید':'')+(fl?' · '+fl+' خطا':'')+(why?' — '+why:'')+(last?'\n\n'+last:'');
 run('UPDATE ag_flow SET runs=runs+1,last_run=?,last_status=?,last_task=?,last_log=? WHERE id=?',Date.now(),status,ctx.task,JSON.stringify(log).slice(0,60000),F.id);
 if(status==='failed')throw new Error(summary);return {summary,status,steps:log,approvals:ctx.approvals,flow:{id:F.id,name:F.name},engine:'runtime',run:r.runId||null}};
/* --- user-facing routes --- */
function rtShadowStats(){const r=q1('SELECT COUNT(*) n,AVG(agree) agree,AVG(rt_grounded) rg,AVG(lg_grounded) lg,AVG(rt_ok) ok,AVG(ms_rt) ms_rt,AVG(ms_legacy) ms_lg FROM rt_shadow WHERE ts>?',Date.now()-30*864e5)||{};
 return {n:r.n||0,agree:r.agree==null?null:+(+r.agree).toFixed(3),runtimeGrounded:r.rg==null?null:+(+r.rg).toFixed(3),legacyGrounded:r.lg==null?null:+(+r.lg).toFixed(3),runtimeOk:r.ok==null?null:+(+r.ok).toFixed(3),msRuntime:r.ms_rt==null?null:Math.round(r.ms_rt),msLegacy:r.ms_lg==null?null:Math.round(r.ms_lg)}}
route('GET','/api/runtime/status',async()=>{const C=RTC();const h=C.ready?await rtHealth(true):null;return {mode:C.mode,configured:C.ready,agents:C.agents,flows:C.flows,shadowPct:C.shadowPct,health:h,shadow:rtShadowStats()}},'agents.use');
route('GET','/api/runtime/shadow',()=>({stats:rtShadowStats(),rows:q('SELECT * FROM rt_shadow ORDER BY id DESC LIMIT 100')}),'agents.admin');
route('GET','/api/runtime/workflows',async()=>{if(!RTC().ready)throw E(503,'رانتایم پیکربندی نشده است');return rtFetch('/v1/workflows')},'agents.use');
route('POST','/api/runtime/workflows/:wf/start',async(req,u,P)=>{if(!RTC().ready)throw E(503,'رانتایم پیکربندی نشده است');const b=await body(req);if(agCfg().kill)throw E(423,'کلید توقف اضطراری فعال است');if(!RTWFTOOLS[P.wf])throw E(404,'گردش‌کار ناشناخته');if(!rtWorkflowsFor({who:u.username,role:u.role,level:1,tools:null}).includes(P.wf))throw E(403,'مجوز ابزارهای این گردش‌کار را ندارید');
 const r=await rtFetch('/v1/workflows/'+encodeURIComponent(P.wf)+'/start',{by:u.username,role:u.role,input:b.input&&typeof b.input==='object'?b.input:b});audit(u.username,ipOf(req),'runtime.workflow.start','workflow',P.wf,{run:r.runId||null,status:r.status||null});return r},'agents.use');
route('GET','/api/runtime/runs',async()=>{if(!RTC().ready)throw E(503,'رانتایم پیکربندی نشده است');return rtFetch('/v1/runs')},'agents.use');
route('GET','/api/runtime/runs/:id',async(req,u,P)=>{if(!RTC().ready)throw E(503,'رانتایم پیکربندی نشده است');return rtFetch('/v1/runs/'+encodeURIComponent(P.id))},'agents.use');
Object.assign(P5,{RTC,rtAgree,rtCtxOpen});
