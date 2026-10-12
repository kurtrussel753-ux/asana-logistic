/* =====================================================================
   v1.19 SERVER-SIDE AUTOPILOT — the lane check that used to run only in the browser, now deterministic on the server:
   route comparison (cost/time/risk/deadline) → rate-bank benchmark → FX → recorded risk news (+ optional live Tavily news) → decision
   (recommended route, alternatives, top risks, confidence) → ap_runs (mode 'server') + «autopilot.done» event. Runs from the API, as an
   agent/MCP tool, as a flow template, on a per-lane schedule, and as the runtime workflow «lane-autopilot». Never sends or commits anything.
   ===================================================================== */
const APW0={every:24,web:false};
function apSrvLane(b){const pol=wbClean(b.pol,60)||'Ningbo',dest=wbClean(b.dest||b.pod,60)||'Tehran';const eq=String(b.eq||'40HC').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)||'40HC';
 const n=(v,a,m,d)=>{v=+v;return isFinite(v)&&v>=a?Math.min(m,v):d};
 return {pol,dest,eq,qty:n(b.qty,1,500,1),value:n(b.value,0,1e9,0),weightT:n(b.weightT,0,40,0)||undefined,deadlineDays:n(b.deadlineDays,0,365,0)||undefined,commodity:wbClean(b.commodity,80),scenario:b.scenario&&typeof b.scenario==='object'?b.scenario:undefined,name:wbClean(b.name,120)}}
async function apServerRun(b,by,opt){opt=opt||{};const L=apSrvLane(b||{});const t0=Date.now();const st={},vals=[],finds=[];const stage=async(k,f)=>{const s=Date.now();try{const r=await f();st[k]={st:'ok',ms:Date.now()-s};return r}catch(e){st[k]={st:'warn',ms:Date.now()-s,note:String(e.message).slice(0,60)};return null}};
 const C=await stage('cmp',()=>compareRoutes({pol:L.pol,dest:L.dest,eq:L.eq,qty:L.qty,value:L.value,weightT:L.weightT,deadlineDays:L.deadlineDays,scenario:L.scenario}));
 const R=(C&&C.routes||[]).filter(r=>r&&isFinite(+r.totalUSD));const ok=R.filter(r=>r.feasible!==false&&r.status!=='closed').sort((a,b)=>a.totalUSD-b.totalUSD);
 const best=(C&&C.best&&ok.find(r=>r.id===C.best))||ok[0]||null;const alts=ok.filter(r=>r!==best).slice(0,3);
 const RS=await stage('rate',()=>TOOLS.rates_search.run({pol:L.pol,pod:L.dest,eq:L.eq,days:120}));
 const FX=await stage('fx',()=>fxNow());
 const pat=[L.pol,L.dest,...(best?String(best.name||'').split(/[\s→>،,()\-]+/):[])].map(s=>String(s||'').toLowerCase()).filter(s=>s.length>=4);
 const NW=await stage('news',()=>q("SELECT kind,title,url,sev,src,ts FROM web_news WHERE ts>=? AND kind IN ('risk','road','port','customs') AND sev IN ('hi','md') ORDER BY ts DESC LIMIT 200",Date.now()-5*864e5)
  .filter(n=>n.sev==='hi'||pat.some(p=>String(n.title).toLowerCase().includes(p))).slice(0,12))||[];
 let live=null;if(opt.web&&tvKey()&&!tvOff())live=await stage('web',async()=>{const r=await tvSearch({query:'shipping disruption '+L.pol+' '+L.dest+' Iran route port border',topic:'news',days:3,n:6},by&&/^agent:/.test(by)?by:(by||'autopilot'),'autopilot.news');return r});
 if(best){vals.push({k:'best',label:'مسیر پیشنهادی',value:best.name,p:{src:'routes_compare',f:'min totalUSD among feasible',conf:best.confidence,at:new Date().toISOString(),band:null}});vals.push({k:'land',label:'هزینهٔ کل (دلار)',value:String(best.totalUSD),p:{src:'routes_compare',f:'main+domestic+carry+risk',conf:best.confidence}});vals.push({k:'days',label:'زمان (روز)',value:best.daysMin+'–'+best.daysMax,p:{src:'routes_compare',f:'corridor days',conf:best.confidence}})}
 if(RS&&RS.n)vals.push({k:'rate',label:'میانهٔ نرخ بانک ('+RS.n+')',value:String(RS.median),p:{src:'rates_search',f:'median of '+RS.n+' rates (120d)',conf:Math.min(1,RS.n/8)}});
 if(FX&&FX.free)vals.push({k:'fx',label:'دلار آزاد (ریال)',value:String(Math.round(FX.free)),p:{src:'fx',f:'server cache',at:FX.date||null}});
 for(const n of NW)finds.push({k:'news',id:'n'+(n.ts%1e6),sev:n.sev==='hi'?'hi':'md',t:wbClean(n.title,200),d:(n.src||'')+' · '+n.url});
 for(const x of (live&&live.results||[]).slice(0,4)){const sv=WBINJ.test(x.title+x.snippet)?'lo':wbSev(x.title+' '+x.snippet);if(sv!=='lo')finds.push({k:'web',id:'w'+finds.length,sev:sv,t:x.title,d:'Tavily · '+x.url})}
 if(!best)finds.push({k:'cmp',id:'nobest',sev:'hi',t:'هیچ مسیر امکان‌پذیری پیدا نشد',d:'وضعیت مسیرها یا مهلت را بررسی کنید'});
 for(const r of R.filter(r=>r.tight||r.feasible===false).slice(0,4))finds.push({k:'cmp',id:'r'+r.id,sev:r.feasible===false?'md':'lo',t:'«'+r.name+'» '+(r.feasible===false?'با مهلت/وضعیت فعلی امکان‌پذیر نیست':'مهلت تنگ است'),d:(r.notes||[]).slice(0,2).join(' · ')});
 if(RS&&RS.n&&best&&RS.median&&best.mainUSD&&Math.abs(best.mainUSD-RS.median)/RS.median>0.25)finds.push({k:'rate',id:'dev',sev:'md',t:'کرایهٔ مسیر پیشنهادی با میانهٔ بانک نرخ بیش از ۲۵٪ فاصله دارد',d:'کرایهٔ مدل '+best.mainUSD+' در برابر میانهٔ '+RS.median});
 const hi=finds.filter(f=>f.sev==='hi').length,md=finds.filter(f=>f.sev==='md').length;const conf=best?+Math.max(0.05,Math.min(0.99,(best.confidence||0.5)*(RS&&RS.n?1:0.85)*(hi?0.8:1))).toFixed(2):0;
 const score=Math.max(0,Math.min(100,Math.round(100-hi*15-md*5-(conf<0.5?10:0)-Object.values(st).filter(s=>s.st==='warn').length*5)));
 const verdict=!best?'توقف — مسیر امکان‌پذیر نیست':hi?'احتیاط — '+best.name+' با '+fa_(hi)+' ریسک بحرانی':'پیشنهاد — '+best.name;
 const dec={verdict,rec:best?{name:best.name,cost:best.totalUSD,days:best.days||best.daysMax,risk:+(best.riskUSD||0)}:null,alts:alts.map(a=>({name:a.name,cost:a.totalUSD,days:a.days||a.daysMax,risk:+(a.riskUSD||0)})),
  risks:finds.filter(f=>f.sev!=='lo').sort((a,b)=>(a.sev==='hi'?0:1)-(b.sev==='hi'?0:1)).slice(0,3).map(f=>f.t),conf,band:best?[Math.round(best.totalUSD*0.9),best.totalUSD,Math.round(best.totalUSD*1.15)]:null};
 const lane=apLaneN(L.pol+'>'+L.dest+'_'+L.eq);const name=L.name||(L.pol+' → '+L.dest+' · '+L.eq);const dur=Date.now()-t0;
 const data=JSON.stringify({stages:st,vals,finds,healed:[],input:L,assumptions:C&&C.assumptions||[],sources:[...(RS&&RS.sources||[]).slice(0,5),...(live?tvSrc(live.results):[])]});
 const r=run('INSERT INTO ap_runs(lane,name,route,mode,score,verdict,dur,ok,warn,hi,md,timeouts,land,rec,data,ts,by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',lane,name,best?best.name:'',opt.mode||'server',score,verdict,dur,Object.values(st).filter(s=>s.st==='ok').length,Object.values(st).filter(s=>s.st==='warn').length,hi,md,0,best?best.totalUSD:null,JSON.stringify(dec),data,Date.now(),by||'system');
 const id=Number(r.lastInsertRowid);try{audit(by||'system','','autopilot.run','ap_runs',String(id),{lane,score,mode:'server'})}catch(e){}
 try{memAdd('autopilot','lane:'+lane,'خودکارگردان '+name,[verdict,'امتیاز '+score,dec.rec?'پیشنهاد: '+dec.rec.name+' · $'+dec.rec.cost+' · '+dec.rec.days+' روز':'',dec.alts.length?'جایگزین‌ها: '+dec.alts.map(x=>x.name+' $'+x.cost).join('، '):'',dec.risks.length?'ریسک‌ها: '+dec.risks.join(' | '):''].filter(Boolean).join('\n'),'autopilot')}catch(e){}
 try{fire('autopilot.done',{id,lane,name,score,verdict,rec:best?best.name:'—',risks:dec.risks.join(' | '),hi,by:by||'system'},'ap|'+id)}catch(e){}
 return {id,lane,name,mode:opt.mode||'server',score,verdict,decision:dec,stages:st,values:vals,findings:finds,routes:ok.slice(0,5).map(r=>({id:r.id,name:r.name,totalUSD:r.totalUSD,days:r.days,daysMin:r.daysMin,daysMax:r.daysMax,confidence:r.confidence,status:r.status})),
  sources:[...(RS&&RS.sources||[]).slice(0,5),{kind:'autopilot',ref:'ap_runs#'+id,title:'اجرای خودکارگردان سرور #'+id,view:'agt'},...(live?tvSrc(live.results):[])],dur}}
/* per-lane schedule (kv «ap:lanes»: [{pol,dest,eq,qty,value,deadlineDays,every,web,last}]) */
const apLanes=()=>{const L=kvGet('ap:lanes');return Array.isArray(L)?L:[]};
async function apSrvTick(){const C=agCfg();if(C.kill)return [];const L=apLanes();const now=Date.now(),out=[];let ch=false;
 for(const x of L){if(out.length>=4)break;if(x.active===false)continue;const ev=Math.max(1,+x.every||APW0.every);if(now-(+x.last||0)<ev*3600e3)continue;x.last=now;ch=true;try{const r=await apServerRun(x,'scheduler',{web:!!x.web});out.push({id:r.id,lane:r.lane,score:r.score})}catch(e){x.err=String(e.message).slice(0,160)}}
 if(ch)kvPut('ap:lanes',L,'system');return out}
if(require.main===module)setInterval(()=>{apSrvTick().catch(e=>console.error('autopilot tick',e.message))},15*60e3).unref?.();
tool('autopilot_run',{d:'اجرای خودکارگردان مسیر روی سرور: مقایسهٔ مسیرها، سنجش با بانک نرخ، ارز، خبرهای ریسک (و در صورت web=true خبر زندهٔ Tavily) → مسیر پیشنهادی، جایگزین‌ها، ریسک‌ها و اطمینان (فقط تحلیل؛ چیزی ارسال نمی‌شود)',cls:'compute',keys:['ifa-rates'],
 args:{pol:['string','مبدأ (مثل Ningbo)',1],dest:['string','مقصد نهایی',1],eq:['string','40HC/20GP'],qty:['number','تعداد'],value:['number','ارزش کالا (دلار)'],deadlineDays:['number','مهلت تحویل (روز)'],weightT:['number','وزن (تن)'],web:['boolean','خبر زندهٔ Tavily (۱ کردیت)']},
 run:async(a,ctx)=>{const w=a.web===true||a.web==='true';return apServerRun(a,ctx&&ctx.ag?(w?wbAgBudget(ctx):'agent:'+ctx.ag.id):'system',{web:w})}});
for(const a of ['analyst','procurement','risk','flow'])if(AGENTS[a]&&!AGENTS[a].tools.includes('autopilot_run'))AGENTS[a].tools.push('autopilot_run');
FLTPL.push({k:'lane_autopilot',name:'خودکارگردان روزانهٔ مسیر (سمت سرور)',d:'هر روز: اجرای خودکارگردان برای مسیر تعریف‌شده روی سرور (بدون مرورگر) با خبر زندهٔ Tavily؛ اگر ریسک بحرانی یا تغییر مسیر پیشنهادی بود، هشدار.',sched:{mode:'daily',at:'07:30'},
 vars:{pol:'Ningbo',dest:'Tehran',eq:'40HC',qty:1,value:50000,deadlineDays:45,web:true},
 steps:[{type:'tool',title:'خودکارگردان سرور',tool:'autopilot_run',args:{pol:'{{vars.pol}}',dest:'{{vars.dest}}',eq:'{{vars.eq}}',qty:'{{vars.qty}}',value:'{{vars.value}}',deadlineDays:'{{vars.deadlineDays}}',web:'{{vars.web}}'}},
  {type:'llm',title:'جمع‌بندی',prompt:'نتیجهٔ خودکارگردان را در ۴ تا ۶ خط بنویس: مسیر پیشنهادی با هزینه و زمان، دو جایگزین، مهم‌ترین ریسک‌ها و اقدام پیشنهادی. اعداد فقط از داده.',fallback:'{{s1.verdict}} · امتیاز {{s1.score}}'},
  {type:'notify',title:'گزارش به تیم',event:'agent.report',text:'{{s2.text}}',dedupe:'apsrv|{{vars.pol}}|{{vars.dest}}|{{today}}'}]});
route('POST','/api/ap/server-run',async(req,u)=>{const b=await body(req);if(agCfg().kill)throw E(423,'کلید توقف اضطراری فعال است');return apServerRun(b||{},u.username,{web:!!(b&&(b.web===true||b.web==='true'))})},'agents.use');
route('GET','/api/ap/lanes',()=>({lanes:apLanes(),every:APW0.every}),'');
route('PUT','/api/ap/lanes',async(req,u)=>{const b=await body(req);const L=(Array.isArray(b.lanes)?b.lanes:[]).slice(0,20).map(x=>({...apSrvLane(x),every:Math.max(1,Math.min(168,+x.every||APW0.every)),web:!!x.web,active:x.active!==false,last:+x.last||0}));kvPut('ap:lanes',L,u.username);audit(u.username,ipOf(req),'autopilot.lanes','kv','ap:lanes',{n:L.length});return {ok:true,lanes:L}},'flows.edit');
route('POST','/api/ap/lanes/tick',async()=>({ok:true,runs:await apSrvTick()}),'agents.use');
