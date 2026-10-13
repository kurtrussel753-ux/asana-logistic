/* =====================================================================
   v1.19 TAVILY — Search · Extract · Crawl · Map · Research (async) · Usage: one governed client for agents, flows, monitors, the page
   assistant and the agent runtime. Key: IFA_TAVILY_KEY (or «دادهٔ وب › Tavily», kept server-side) · optional IFA_TAVILY_PROJECT (X-Project-ID).
   Every call: kill switch (IFA_WEB_OFF / IFA_TAVILY_OFF / IFA_LIVE_OFF) → URL guard → credit caps (day / month / agents per day) + the shared
   web USD budget → retry on 429/5xx → usage row in web_usage (svc 'tv', units = Tavily credits) → content is untrusted (injection scan).
   ===================================================================== */
db.exec(`CREATE TABLE IF NOT EXISTS tv_watch(id INTEGER PRIMARY KEY,name TEXT,query TEXT,kind TEXT,topic TEXT,days INTEGER,every INTEGER,depth TEXT,domains TEXT,xdomains TEXT,country TEXT,active INTEGER,last INTEGER,runs INTEGER,hits INTEGER,err TEXT,ts INTEGER,by TEXT);`);
// Research reservations survive restarts; ordinary HTTP calls reserve synchronously until their usage row is written.
db.exec(`CREATE TABLE IF NOT EXISTS tv_reservations(job INTEGER PRIMARY KEY,credits REAL NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS tv_job_policy(job INTEGER PRIMARY KEY,private INTEGER NOT NULL DEFAULT 0,owner TEXT);`);
if(!q('PRAGMA table_info(tv_job_policy)').some(x=>x.name==='owner'))db.exec('ALTER TABLE tv_job_policy ADD COLUMN owner TEXT');
const tvJobVisible=(j,u)=>{const p=q1('SELECT private,owner FROM tv_job_policy WHERE job=?',j.id);return !p||!p.private||!!u&&((p.owner||j.by)===u.username||['admin','manager'].includes(u.role))};
const TVINFLIGHT=new Map();
Object.assign(WB0,{tvCredit:0.008,tvDayCredits:200,tvMonthCredits:1500,tvAgentDayCredits:60,tvResearchModel:'auto'});
WBN.tv='Tavily';
const TVB=()=>String(process.env.IFA_TAVILY_BASE||'https://api.tavily.com').replace(/\/+$/,'');
const tvKey=()=>process.env.IFA_TAVILY_KEY||wbSecret('tv');
const tvKeySrc=()=>process.env.IFA_TAVILY_KEY?'env':wbSecret('tv')?'db':'';
const tvOff=()=>process.env.IFA_WEB_OFF==='1'||process.env.IFA_TAVILY_OFF==='1'||(/(^|,)(all|web|tavily)(,|$)/.test(String(process.env.IFA_LIVE_OFF||''))&&!process.env.IFA_TAVILY_BASE);
const tvCfg=()=>{const c=wbCfg(),e=process.env;const n=(k,d)=>e[k]!=null&&String(e[k]).trim()!==''&&Number.isFinite(+e[k])&&+e[k]>=0?+e[k]:d;return {...c,tvCredit:n('IFA_TAVILY_CREDIT_USD',c.tvCredit),tvDayCredits:n('IFA_TAVILY_DAY_CREDITS',c.tvDayCredits),tvMonthCredits:n('IFA_TAVILY_MONTH_CREDITS',c.tvMonthCredits),tvAgentDayCredits:n('IFA_TAVILY_AGENT_DAY_CREDITS',c.tvAgentDayCredits),tvResearchModel:['mini','pro','auto'].includes(e.IFA_TAVILY_RESEARCH_MODEL)?e.IFA_TAVILY_RESEARCH_MODEL:c.tvResearchModel}};
function tvSpent(who){const d=wbDay();const s=(w,a)=>+(+((q1("SELECT COALESCE(SUM(units),0) s FROM web_usage WHERE svc='tv' AND "+w,...a)||{}).s||0)).toFixed(2);
 const o={day:s('day=?',[d]),month:s('day>=?',[d.slice(0,8)+'01']),agents:s("day=? AND by LIKE 'agent:%'",[d])};if(who)o.who=s('day=? AND by=?',[d,who]);
 // Pending research remains reserved across date boundaries until terminal status. Missing legacy reservations use the conservative pro estimate.
 const holds=[...TVINFLIGHT.values(),...q("SELECT j.by,COALESCE(r.credits,120) credits FROM web_jobs j LEFT JOIN tv_reservations r ON r.job=j.id WHERE j.engine='tv' AND j.status IN ('queued','running')")];
 o.reserved={credits:holds.reduce((n,h)=>n+h.credits,0),agents:holds.filter(h=>/^agent:/.test(h.by||'')).reduce((n,h)=>n+h.credits,0)};return o}
function tvBudget(cr,who){const C=tvCfg(),S=tvSpent(who);
 if(S.day+S.reserved.credits+cr>C.tvDayCredits)throw E(429,'سقف روزانهٔ اعتبار Tavily ('+C.tvDayCredits+' کردیت) پر شده است؛ در «دادهٔ وب › Tavily» سقف را تغییر دهید یا فردا دوباره امتحان کنید');
 if(S.month+S.reserved.credits+cr>C.tvMonthCredits)throw E(429,'سقف ماهانهٔ اعتبار Tavily ('+C.tvMonthCredits+' کردیت) پر شده است');
 if(who&&/^agent:/.test(who)&&S.agents+S.reserved.agents+cr>C.tvAgentDayCredits)throw E(429,'سقف روزانهٔ اعتبار Tavily برای عامل‌ها ('+C.tvAgentDayCredits+' کردیت) پر شده است');
 wbBudget((cr+S.reserved.credits)*C.tvCredit)}
const TVERR={400:[400,'درخواست نامعتبر'],401:[502,'کلید API نامعتبر یا منقضی است'],403:[502,'این کلید به این عملیات دسترسی ندارد'],404:[404,'یافت نشد'],422:[400,'پارامترها نامعتبر است'],429:[429,'محدودیت نرخ درخواست؛ کمی بعد دوباره امتحان کنید'],432:[402,'سقف اعتبار طرح Tavily پر شده است (ارتقای طرح یا صبر تا دورهٔ بعد)'],433:[402,'سقف پرداخت به‌ازای مصرف (Pay-as-you-go) Tavily پر شده است']};
const tvSleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tvCall(op,p,o,by,ref){if(tvOff())throw E(503,'اتصال Tavily خاموش است (IFA_WEB_OFF، IFA_TAVILY_OFF یا IFA_LIVE_OFF)');const key=tvKey();if(!key)throw E(412,'کلید Tavily تنظیم نشده است (IFA_TAVILY_KEY یا «دادهٔ وب › Tavily»)');
 const C=tvCfg(),est=Math.max(0,+o.est||0);const hold=Symbol(op);if(est>0){tvBudget(est,by);TVINFLIGHT.set(hold,{credits:est,by})}
 const H={Authorization:'Bearer '+key,Accept:'application/json'};if(o.body)H['Content-Type']='application/json';if(process.env.IFA_TAVILY_PROJECT)H['X-Project-ID']=String(process.env.IFA_TAVILY_PROJECT);
 let ok=0,units=0,err='',st=0,j={};const t0=Date.now();
 try{for(let i=0;;i++){let r;
   try{r=await fetch(TVB()+p,{method:o.method||'POST',headers:H,body:o.body?JSON.stringify(o.body):undefined,signal:AbortSignal.timeout(o.timeout||60e3)})}
   catch(e){if(e.name==='TimeoutError'||e.name==='AbortError'){err='timeout';throw E(504,'Tavily: پاسخ در زمان مقرر نرسید')}if(i<1){await tvSleep(700);continue}throw e}
   st=r.status;j=await r.json().catch(()=>({}));
   if((st===429||st>=500)&&i<(o.retries==null?1:o.retries)){const ra=+r.headers.get('retry-after');await tvSleep(Math.min(8000,ra>0?ra*1000:1200*(i+1)));continue}break}
  if(st<200||st>=300){const d=j&&j.detail;err=String((d&&typeof d==='object'?(d.error||d.message||JSON.stringify(d)):d)||j.error||j.message||('HTTP '+st)).slice(0,300);const m=TVERR[st]||[502,'خطای سرویس (HTTP '+st+')'];throw E(m[0],'Tavily: '+m[1]+(st===400||st===422?' — '+err:''))}
  ok=1;units=o.bill===false?0:j&&j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:est;return j}
 catch(e){if(!err)err=String(e.message||e).slice(0,300);if(e.code)throw e;throw E(502,'Tavily: '+err)}
 finally{try{run('INSERT INTO web_usage(ts,day,svc,op,units,usd,ok,ref,by,err) VALUES(?,?,?,?,?,?,?,?,?,?)',Date.now(),wbDay(),'tv',op,units,+(units*C.tvCredit).toFixed(5),ok,String(ref||'').slice(0,200),by||'system',err||null)}catch(e){}TVINFLIGHT.delete(hold);lstat('tavily',!!ok,ok?op+' · '+(Date.now()-t0)+'ms':err)}}
/* ---------- parameter hygiene ---------- */
const tvPick=(v,L,d)=>L.includes(v)?v:d;
const tvInt=(v,a,b,d)=>{if(v==null||v==='')return d;v=Math.round(+v);return isFinite(v)?Math.max(a,Math.min(b,v)):d};
const tvBool=v=>v===true||v==='true'||v===1||v==='1';
const tvList=v=>Array.isArray(v)?v:v==null||v===''?[]:String(v).split(/[\s,،]+/);
const tvDom=(v,n)=>[...new Set(tvList(v).map(s=>String(s).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'')).filter(s=>/^[a-z0-9*][a-z0-9.*-]*\.[a-z*]{2,}(\/[\w\-./]*)?$/.test(s)))].slice(0,n);
const tvRx=v=>tvList(v).map(s=>String(s).slice(0,200)).filter(s=>{try{new RegExp(s);return !!s}catch(e){return false}}).slice(0,20);
const tvDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s):undefined;
const tvHostIn=(u,L)=>{const h=wbHost(u);return L.some(d=>h===d||h.endsWith('.'+d))};
const tvBlocked=u=>tvHostIn(u,wbCfg().block);
const tvMx=s=>String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ');
function tvAgUrl(u,ctx){if(!ctx||!ctx.ag||process.env.IFA_TAVILY_AGENT_OPEN==='1')return;const h=wbHost(u);if(!agAllowed(h))throw E(403,'دامنهٔ «'+h+'» در فهرست دامنه‌های مجاز عامل‌ها نیست (تنظیمات عامل‌ها › دامنه‌های مجاز، یا IFA_TAVILY_AGENT_OPEN=1)')}
function tvInj(ctx,name,n){if(n&&ctx)(ctx.inj=ctx.inj||[]).push(name)}
const tvSrc=L=>(L||[]).filter(r=>r&&r.url).slice(0,10).map(r=>({kind:'web',url:r.url,title:wbClean(r.title||r.url,120),ts:r.date||null}));
/* ---------- credit estimates (published Tavily pricing) ---------- */
const TVRC={mini:40,pro:120,auto:80};
function tvEst(op,a){a=a||{};const lim=(d,m)=>tvInt(a.limit,1,m,d);const ins=a.instructions?2:1;
 if(op==='search')return ['advanced'].includes(a.search_depth||a.depth)||tvBool(a.auto_parameters)?2:1;
 if(op==='extract'){const n=Math.max(1,tvList(a.urls||a.url).length);return Math.ceil(n/5)*((a.extract_depth||a.depth)==='advanced'?2:1)}
 if(op==='map')return Math.ceil(lim(50,500)/10)*ins;
 if(op==='crawl'){const l=lim(20,100);return Math.ceil(l/10)*ins+Math.ceil(l/5)*((a.extract_depth||a.depth)==='advanced'?2:1)}
 if(op==='research')return TVRC[a.model]||TVRC[tvCfg().tvResearchModel]||80;return 0}
/* ================= 1) Search ================= */
const TVTOPIC=['general','news','finance'],TVDEPTH=['basic','advanced','fast','ultra-fast'],TVTR=['day','week','month','year','d','w','m','y'];
function tvSearchBody(a){const b={query:wbClean(a.query??a.q,400)};if(b.query.length<2)throw E(400,'عبارت جست‌وجو لازم است');
 b.search_depth=tvPick(a.search_depth||a.depth,TVDEPTH,'basic');b.topic=tvPick(a.topic||(tvBool(a.news)?'news':''),TVTOPIC,'general');b.max_results=tvInt(a.max_results??a.n,1,20,8);
 if(b.search_depth==='advanced'&&a.chunks_per_source!=null)b.chunks_per_source=tvInt(a.chunks_per_source,1,3,3);
 if(TVTR.includes(a.time_range))b.time_range=a.time_range;else if(+a.days>0)b.start_date=new Date(Date.now()-Math.min(3650,+a.days)*864e5).toISOString().slice(0,10);
 if(tvDate(a.start_date))b.start_date=a.start_date;if(tvDate(a.end_date))b.end_date=a.end_date;if(b.time_range)delete b.start_date;
 const ans=a.include_answer??a.answer;if(ans===true||ans==='true'||ans==='basic'||ans==='advanced')b.include_answer=ans==='true'?true:ans;
 const raw=a.include_raw_content??a.raw;if(raw===true||raw==='true'||raw==='markdown'||raw==='text')b.include_raw_content=raw==='text'?'text':'markdown';
 for(const k of ['include_images','include_image_descriptions','include_favicon','include_published_date','filter_by_published_date','exact_match','auto_parameters'])if(a[k]!=null)b[k]=tvBool(a[k]);
 if(b.include_image_descriptions)b.include_images=true;
 if(a.safe_search!=null&&!['fast','ultra-fast'].includes(b.search_depth))b.safe_search=tvBool(a.safe_search);
 const inc=tvDom(a.include_domains??a.domains,300),exc=tvDom([...tvList(a.exclude_domains??a.exclude),...wbCfg().block],150);if(inc.length)b.include_domains=inc;if(exc.length)b.exclude_domains=exc;
 if(inc.length&&['restrict','prefer'].includes(a.include_domains_mode))b.include_domains_mode=a.include_domains_mode;
 if(a.country&&b.topic==='general')b.country=wbClean(a.country,40).toLowerCase();
 if(a.language){b.language=wbClean(a.language,20).toLowerCase();if(a.filter_by_language!=null)b.filter_by_language=tvBool(a.filter_by_language)}
 b.include_usage=true;return b}
const tvRes=(r,n)=>({title:wbClean(r.title,200),url:r.url,snippet:wbClean(r.content,n||600),score:isFinite(+r.score)&&r.score!=null?+(+r.score).toFixed(3):null,date:r.published_date||null,...(r.raw_content?{raw:tvMx(r.raw_content).slice(0,12000)}:{}),...(r.favicon?{favicon:r.favicon}:{}),...(Array.isArray(r.images)&&r.images.length?{images:r.images.slice(0,4)}:{})});
async function tvSearch(a,by,op){const b=tvSearchBody(a||{});const est=tvEst('search',b);
 const j=await tvCall(op||'search','/search',{body:b,est,timeout:(b.search_depth==='advanced'||b.include_raw_content?60:30)*1e3},by,b.query);
 const R=(j.results||[]).filter(r=>r&&/^https?:\/\//.test(r.url||'')&&!tvBlocked(r.url)).map(r=>tvRes(r,a&&a.snip));
 const answer=j.answer?wbClean(j.answer,3000):null;const inj=R.filter(r=>WBINJ.test(r.title+' '+r.snippet+' '+(r.raw||'').slice(0,6000))).length+(answer&&WBINJ.test(answer)?1:0);
 return {query:b.query,depth:b.search_depth,topic:b.topic,answer,results:R,images:(j.images||[]).slice(0,10).map(i=>typeof i==='string'?{url:i}:{url:i.url,description:wbClean(i.description,200)}),
  auto:j.auto_parameters||null,credits:j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:est,responseTime:+j.response_time||null,requestId:j.request_id||null,injection:inj}}
/* ================= 2) Extract ================= */
async function tvExtract(a,by,op,ctx){a=a||{};let U=tvList(a.urls??a.url).filter(Boolean).slice(0,20);if(!U.length)throw E(400,'حداقل یک نشانی لازم است');U=[...new Set(U.map(u=>wbUrl(u)))];for(const u of U)tvAgUrl(u,ctx);
 const b={urls:U.length===1?U[0]:U,extract_depth:tvPick(a.extract_depth||a.depth,['basic','advanced'],'basic'),format:tvPick(a.format,['markdown','text'],'markdown'),include_usage:true};
 if(a.query){b.query=wbClean(a.query,400);if(a.chunks_per_source!=null)b.chunks_per_source=tvInt(a.chunks_per_source,1,5,3)}
 if(tvBool(a.include_images))b.include_images=true;if(tvBool(a.include_favicon))b.include_favicon=true;if(a.timeout!=null)b.timeout=tvInt(a.timeout,1,60,30);
 const est=tvEst('extract',{urls:U,extract_depth:b.extract_depth});const max=tvInt(a.max_chars,500,60000,12000);
 const j=await tvCall(op||'extract','/extract',{body:b,est,timeout:((b.timeout||(b.extract_depth==='advanced'?30:10))+20)*1e3},by,U[0]+(U.length>1?' +'+(U.length-1):''));
 const R=(j.results||[]).map(r=>{const c=tvMx(r.raw_content);return {url:r.url,title:wbClean((c.match(/^#\s+(.+)$/m)||[])[1]||'',160),content:c.slice(0,max),chars:c.length,truncated:c.length>max,...(Array.isArray(r.images)&&r.images.length?{images:r.images.slice(0,8)}:{}),...(r.favicon?{favicon:r.favicon}:{})}});
 return {results:R,failed:(j.failed_results||[]).map(f=>({url:f.url,error:wbClean(f.error,200)})),credits:j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:est,responseTime:+j.response_time||null,requestId:j.request_id||null,injection:R.filter(r=>WBINJ.test(r.content)).length}}
/* ================= 3) Crawl  ·  4) Map ================= */
function tvSiteBody(a,crawl){const url=wbUrl(a.url);const b={url,max_depth:tvInt(a.max_depth,1,5,1),max_breadth:tvInt(a.max_breadth,1,500,20),limit:tvInt(a.limit,1,crawl?100:500,crawl?20:50),allow_external:tvBool(a.allow_external),include_usage:true};
 if(a.instructions)b.instructions=wbClean(a.instructions,400);for(const k of ['select_paths','select_domains','exclude_paths','exclude_domains']){const L=tvRx(a[k]);if(L.length)b[k]=L}
 const blk=wbCfg().block.map(d=>'^(.*\\.)?'+d.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');if(blk.length)b.exclude_domains=[...(b.exclude_domains||[]),...blk].slice(0,40);
 if(a.timeout!=null)b.timeout=tvInt(a.timeout,10,150,150);
 if(crawl){b.extract_depth=tvPick(a.extract_depth||a.depth,['basic','advanced'],'basic');b.format=tvPick(a.format,['markdown','text'],'markdown');if(b.instructions&&a.chunks_per_source!=null)b.chunks_per_source=tvInt(a.chunks_per_source,1,5,3);if(tvBool(a.include_images))b.include_images=true;if(tvBool(a.include_favicon))b.include_favicon=true}
 return b}
async function tvCrawl(a,by,op,ctx){a=a||{};const b=tvSiteBody(a,true);tvAgUrl(b.url,ctx);const est=tvEst('crawl',b);const max=tvInt(a.max_chars,300,20000,4000);
 const j=await tvCall(op||'crawl','/crawl',{body:b,est,timeout:((b.timeout||150)+20)*1e3,retries:0},by,b.url);
 const R=(j.results||[]).filter(r=>r&&r.url&&!tvBlocked(r.url)).map(r=>{const c=tvMx(r.raw_content);return {url:r.url,title:wbClean((c.match(/^#\s+(.+)$/m)||[])[1]||'',160),content:c.slice(0,max),chars:c.length,...(r.favicon?{favicon:r.favicon}:{})}});
 return {baseUrl:j.base_url||b.url,results:R,pages:R.length,credits:j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:est,responseTime:+j.response_time||null,requestId:j.request_id||null,injection:R.filter(r=>WBINJ.test(r.content)).length}}
async function tvMap(a,by,op,ctx){a=a||{};const b=tvSiteBody(a,false);tvAgUrl(b.url,ctx);const est=tvEst('map',b);
 const j=await tvCall(op||'map','/map',{body:b,est,timeout:((b.timeout||150)+20)*1e3,retries:0},by,b.url);
 const L=[...new Set((j.results||[]).map(x=>typeof x==='string'?x:x&&x.url).filter(u=>/^https?:\/\//.test(u||'')&&!tvBlocked(u)))];
 return {baseUrl:j.base_url||b.url,urls:L.slice(0,tvInt(a.max_urls,1,1000,500)),count:L.length,credits:j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:est,responseTime:+j.response_time||null,requestId:j.request_id||null}}
/* ================= 5) Research (async: create → poll) — tracked as web_jobs(engine 'tv') ================= */
const TVRS={properties:{answer:{type:'string',description:'Concise, direct answer in the language of the question (3-8 sentences).'},findings:{type:'array',description:'Key findings, each backed by the cited sources.',items:{type:'object',description:'One finding',properties:{point:{type:'string',description:'The finding in one sentence'},detail:{type:'string',description:'Evidence, numbers with dates and units, and the source'}}}},figures:{type:'array',description:'Numeric facts found (rates, fees, dates, volumes).',items:{type:'object',description:'One figure',properties:{label:{type:'string',description:'What the number measures'},value:{type:'string',description:'The value exactly as published'},unit:{type:'string',description:'Unit or currency'},asOf:{type:'string',description:'Date of the figure (ISO) if stated'}}}},caveats:{type:'string',description:'Gaps, uncertainty, conflicting sources.'}},required:['answer','findings']};
function tvSchemaOk(s,d){if(!s||typeof s!=='object'||d>5)return false;if(d===0&&(typeof s.properties!=='object'||!Object.keys(s.properties).length))return false;
 for(const v of Object.values(s.properties||{})){if(!v||!['object','string','integer','number','array','boolean'].includes(v.type)||!v.description)return false;if(v.type==='object'&&!tvSchemaOk(v,d+1))return false;if(v.type==='array'&&(!v.items||typeof v.items!=='object'||(v.items.type==='object'&&!tvSchemaOk(v.items,d+1))))return false}return true}
function tvResearchBody(a){const input=wbClean(a.input??a.q,4000);if(input.length<10)throw E(400,'پرسش پژوهش کوتاه است (حداقل ۱۰ نویسه)');
 const b={input,model:tvPick(a.model,['mini','pro','auto'],tvCfg().tvResearchModel),citation_format:tvPick(a.citation_format,['numbered','mla','apa','chicago'],'numbered')};
 if(['short','standard','long'].includes(a.output_length))b.output_length=a.output_length;
 if(a.output_schema!=null){if(!tvSchemaOk(a.output_schema,0))throw E(400,'output_schema نامعتبر است: باید properties داشته باشد و هر ویژگی type و description');b.output_schema=a.output_schema}else if(a.structured!==false)b.output_schema=TVRS;
 const inc=tvDom(a.include_domains??a.domains,100),exc=tvDom([...tvList(a.exclude_domains??a.exclude),...wbCfg().block],100);if(inc.length)b.include_domains=inc;if(exc.length)b.exclude_domains=exc;
 if(Array.isArray(a.files)&&a.files.length){const F=a.files.slice(0,5).map(f=>({filename:wbClean(f&&f.filename,120),base64:String(f&&f.base64||'').replace(/^data:[^,]*,/,'')})).filter(f=>f.filename&&/^[A-Za-z0-9+/=\s]+$/.test(f.base64));
  if(F.reduce((s,f)=>s+f.base64.length,0)>14e6)throw E(413,'حجم پیوست‌های پژوهش بیش از حد است');if(F.length)b.files=F}
 return b}
async function tvResearchCreate(b,by){const j=await tvCall('research.create','/research',{body:b,est:0,bill:false,timeout:60e3},by,b.input.slice(0,120));if(!j.request_id)throw E(502,'Tavily: شناسهٔ پژوهش برنگشت');return j}
async function tvResearchGet(rid,by){if(!/^[A-Za-z0-9_\-]{6,80}$/.test(String(rid||'')))throw E(400,'شناسهٔ پژوهش نامعتبر است');
 const j=await tvCall('research.get','/research/'+encodeURIComponent(rid)+'?include_usage=true',{method:'GET',est:0,bill:false,timeout:30e3,retries:2},by,rid);
 const S=(Array.isArray(j.sources)?j.sources:[]).map(s=>typeof s==='string'?{url:s}:{url:s&&s.url,title:wbClean(s&&s.title,140)}).filter(s=>s.url&&/^https?:\/\//.test(s.url)&&!tvBlocked(s.url)).slice(0,25);
 return {requestId:j.request_id||rid,status:j.status||'pending',content:j.content==null?null:typeof j.content==='string'?tvMx(j.content).slice(0,60000):j.content,sources:S,credits:j.usage&&isFinite(+j.usage.credits)?+j.usage.credits:null,responseTime:+j.response_time||null,createdAt:j.created_at||null,error:j.error||null}}
function tvJobAdd(b,by,owner=by){const C=tvCfg();if(tvOff())throw E(503,'اتصال Tavily خاموش است');if(!tvKey())throw E(412,'کلید Tavily تنظیم نشده است');const body_=tvResearchBody(b||{});
 if(q("SELECT id FROM web_jobs WHERE status IN ('queued','running')").length>=5)throw E(409,'حداکثر ۵ پژوهش هم‌زمان');tvBudget(tvEst('research',body_),by);
 const id=Number(run('INSERT INTO web_jobs(kind,engine,q,status,ts,by,usd) VALUES(?,?,?,?,?,?,0)','research','tv',body_.input,'queued',Date.now(),by).lastInsertRowid);run('INSERT INTO tv_reservations(job,credits) VALUES(?,?)',id,tvEst('research',body_));wbCachePut('tvjob:'+id,body_);if(b&&b.memory===false)run('INSERT INTO tv_job_policy(job,private,owner) VALUES(?,1,?)',id,owner);
 setTimeout(()=>tvJobRun(id).catch(()=>{}),10);audit(by,'','web.research','web_jobs',String(id),{engine:'tv',model:body_.model});return {ok:true,id,engine:'tv',model:body_.model}}
const TVJBUSY=new Set();
async function tvJobRun(id){if(TVJBUSY.has(id))return;const J=q1('SELECT * FROM web_jobs WHERE id=?',id);if(!J||J.engine!=='tv'||!['queued','running'].includes(J.status))return;TVJBUSY.add(id);const C=tvCfg();
 const fin=(st,res,src,err,cr)=>{run('UPDATE web_jobs SET status=?,result=?,sources=?,err=?,done=?,usd=COALESCE(usd,0)+? WHERE id=?',st,res?JSON.stringify(res).slice(0,60000):null,JSON.stringify(src||[]),err||null,Date.now(),+((cr||0)*C.tvCredit).toFixed(4),id);
  if(cr)try{run('INSERT INTO web_usage(ts,day,svc,op,units,usd,ok,ref,by,err) VALUES(?,?,?,?,?,?,?,?,?,?)',Date.now(),wbDay(),'tv','research.credits',cr,+(cr*C.tvCredit).toFixed(5),1,J.xid||String(id),J.by,null)}catch(e){}
  run('DELETE FROM tv_reservations WHERE job=?',id);
  if((q1('SELECT private FROM tv_job_policy WHERE job=?',id)||{}).private)return;
  if(st==='done')wbJobMem(id);else try{fire('web.research',{id,text:'پژوهش «'+J.q.slice(0,80)+'» ناموفق بود: '+String(err||'').slice(0,120),q:J.q.slice(0,200)},'wr|job|'+id+'|f')}catch(e){}};
 try{if(!J.xid&&Date.now()-J.ts>3*3600e3){fin('failed',null,[],'زمان انتظار پژوهش به پایان رسید (۳ ساعت)',0);return}if(!J.xid){const b=(wbCacheGet('tvjob:'+id,72)||{});delete b.cachedAt;if(!b.input)b.input=J.q;const j=await tvResearchCreate(b,J.by);run("UPDATE web_jobs SET xid=?,status='running' WHERE id=?",j.request_id,id);return}
  const r=await tvResearchGet(J.xid,J.by);
  if(r.status==='completed'){const c=r.content;let res;if(c&&typeof c==='object')res={...c,answer:wbClean(c.answer||c.summary||'',4000)||JSON.stringify(c).slice(0,1500)};else{const t=String(c||'');res={answer:wbClean(t.replace(/[#*_>`]/g,' '),1500),report:t,findings:[]}}
   res.engine='tavily';res.model=(wbCacheGet('tvjob:'+id,96)||{}).model||null;res.injection=WBINJ.test(JSON.stringify(c||''));fin('done',res,r.sources,null,r.credits||0)}
  else if(r.status==='failed')fin('failed',null,[],'Tavily: '+wbClean(r.error||'پژوهش ناموفق بود',200),r.credits||0);
  else if(Date.now()-J.ts>3*3600e3)fin('failed',null,[],'زمان پژوهش به پایان رسید (۳ ساعت)',0)}
 catch(e){if(e.code===429&&!J.xid)return;if(!J.xid||e.code===404||e.code===400||e.code===402||Date.now()-J.ts>3*3600e3)fin('failed',null,[],String(e.message).slice(0,300),0)}
 finally{TVJBUSY.delete(id)}}
{const _add=wbJobAdd;wbJobAdd=function(b,by){b=b||{};const tv=['tv','tavily'].includes(b.engine)||(!b.engine&&!wbKey('exa')&&!!tvKey());return tv?tvJobAdd(b,by):_add(b,by)}}
{const _run=wbJobRun;wbJobRun=async function(id){const J=q1('SELECT engine FROM web_jobs WHERE id=?',id);return J&&J.engine==='tv'?tvJobRun(id):_run(id)}}
setInterval(()=>{if(tvOff())return;for(const j of q("SELECT id FROM web_jobs WHERE engine='tv' AND status IN ('queued','running')"))tvJobRun(j.id).catch(()=>{})},Math.max(5,+process.env.IFA_TAVILY_POLL_SEC||+process.env.IFA_WEB_JOB_SEC||20)*1e3).unref?.();
async function tvJobWait(id,sec){const t=Date.now()+Math.max(0,Math.min(240,+sec||0))*1e3;let r=q1('SELECT * FROM web_jobs WHERE id=?',id);while(r&&['queued','running'].includes(r.status)&&Date.now()<t){await tvSleep(Math.max(1000,(+process.env.IFA_TAVILY_POLL_SEC||10)*1000));await tvJobRun(id).catch(()=>{});r=q1('SELECT * FROM web_jobs WHERE id=?',id)}return wbJobRow(r)}
/* ================= 6) Usage ================= */
async function tvUsage(by){const j=await tvCall('usage','/usage',{method:'GET',est:0,bill:false,timeout:20e3,retries:1},by,'usage');const k=j.key||{},a=j.account||{};const n=v=>v==null?null:+v;
 return {key:{usage:n(k.usage),limit:n(k.limit),search:n(k.search_usage),extract:n(k.extract_usage),crawl:n(k.crawl_usage),map:n(k.map_usage),research:n(k.research_usage)},account:{plan:a.current_plan||null,planUsage:n(a.plan_usage),planLimit:n(a.plan_limit),paygoUsage:n(a.paygo_usage),paygoLimit:n(a.paygo_limit),search:n(a.search_usage),extract:n(a.extract_usage),crawl:n(a.crawl_usage),map:n(a.map_usage),research:n(a.research_usage)},local:tvSpent()}}
function tvStatus(){const C=tvCfg(),k=tvKey();const by=q("SELECT op,COUNT(*) n,SUM(units) credits,SUM(usd) usd,SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) err FROM web_usage WHERE svc='tv' AND day>=? GROUP BY op ORDER BY credits DESC",wbDay().slice(0,8)+'01').map(r=>({...r,credits:+(+r.credits||0).toFixed(2),usd:+(+r.usd||0).toFixed(4)}));
 return {configured:!!k,key:wbMask(k),from:tvKeySrc(),project:!!process.env.IFA_TAVILY_PROJECT,base:process.env.IFA_TAVILY_BASE?'custom':'api.tavily.com',off:tvOff(),last:LST.tavily||null,spent:tvSpent(),
  caps:{day:C.tvDayCredits,month:C.tvMonthCredits,agentsDay:C.tvAgentDayCredits,creditUSD:C.tvCredit,researchModel:C.tvResearchModel},byOp:by,watches:(q1('SELECT COUNT(*) n FROM tv_watch WHERE active=1')||{}).n||0,
  jobs:(q1("SELECT COUNT(*) n FROM web_jobs WHERE engine='tv' AND status IN ('queued','running')")||{}).n||0,estimates:{search:1,searchAdvanced:2,extract5:1,map10:1,crawl20:6,research:TVRC}}}
{const _s=wbStatus;wbStatus=function(){const s=_s();try{s.tv=tvStatus()}catch(e){}return s}}
/* ================= 7) monitoring: Tavily watches → web_news (+ alerts), and Tavily as the fallback engine for the built-in news sweeps ================= */
const TVWK=['risk','customs','road','port','page','market'];
function tvWatchPub(w){return {...w,active:!!w.active,domains:tvList(w.domains),xdomains:tvList(w.xdomains)}}
function tvWatchSave(b,by,id){const name=wbClean(b.name,80),query=wbClean(b.query,400);if(name.length<2||query.length<3)throw E(400,'نام و عبارت پایش لازم است');
 const kind=tvPick(b.kind,TVWK,'risk'),topic=tvPick(b.topic,TVTOPIC,'news'),days=tvInt(b.days,1,60,topic==='news'?3:14),every=tvInt(b.every,1,168,6),depth=tvPick(b.depth,['basic','advanced'],'basic');
 const dom=tvDom(b.domains,50).join(','),xd=tvDom(b.xdomains,50).join(','),country=wbClean(b.country,40);const act=b.active===false?0:1;
 if(id){run('UPDATE tv_watch SET name=?,query=?,kind=?,topic=?,days=?,every=?,depth=?,domains=?,xdomains=?,country=?,active=? WHERE id=?',name,query,kind,topic,days,every,depth,dom,xd,country,act,id);return tvWatchPub(q1('SELECT * FROM tv_watch WHERE id=?',id))}
 if((q1('SELECT COUNT(*) n FROM tv_watch')||{}).n>=30)throw E(409,'حداکثر ۳۰ پایشگر Tavily');
 const nid=Number(run('INSERT INTO tv_watch(name,query,kind,topic,days,every,depth,domains,xdomains,country,active,last,runs,hits,ts,by) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?)',name,query,kind,topic,days,every,depth,dom,xd,country,act,Date.now(),by).lastInsertRowid);
 audit(by,'','tavily.watch','tv_watch',String(nid),{kind,every});return tvWatchPub(q1('SELECT * FROM tv_watch WHERE id=?',nid))}
async function tvWatchRun(w,by){const out={id:w.id,name:w.name,fresh:0,hi:[],results:0,credits:0};
 try{const r=await tvSearch({query:w.query,topic:w.topic||'news',days:w.days||3,depth:w.depth||'basic',n:10,domains:w.domains,exclude:w.xdomains,country:w.country||undefined},by||'tavily-watch','watch.'+(w.kind||'risk'));
  out.results=r.results.length;out.credits=r.credits;
  for(const x of r.results){const sv=WBINJ.test(x.title+' '+x.snippet)?'lo':wbSev(x.title+' '+x.snippet);
   try{run('INSERT INTO web_news(kind,topic,url,title,pub,snip,sev,src,ts) VALUES(?,?,?,?,?,?,?,?,?)',w.kind||'risk',w.name,x.url,x.title,x.date||null,x.snippet,sv,'Tavily · '+wbHost(x.url),Date.now());out.fresh++;if(sv==='hi')out.hi.push({title:x.title,url:x.url})}catch(e){}}
  run('UPDATE tv_watch SET last=?,runs=COALESCE(runs,0)+1,hits=COALESCE(hits,0)+?,err=NULL WHERE id=?',Date.now(),out.fresh,w.id);
  if(out.hi.length)try{fire(w.kind==='customs'?'web.customs':'web.risk',{topic:w.name,title:out.hi[0].title,url:out.hi[0].url,n:out.hi.length,sev:'بحرانی',text:fa_(out.hi.length)+' خبر بحرانی تازه («'+w.name+'» · Tavily) — '+out.hi[0].title},'tvw|'+w.id+'|'+out.hi[0].url)}catch(e){}}
 catch(e){run('UPDATE tv_watch SET last=?,err=? WHERE id=?',Date.now(),String(e.message).slice(0,200),w.id);out.error=String(e.message).slice(0,200);if(e.code===429||e.code===402||e.code===412)out.stop=true}
 return out}
async function tvWatchTick(by){if(tvOff()||!tvKey())return [];const now=Date.now(),out=[];
 for(const w of q('SELECT * FROM tv_watch WHERE active=1 ORDER BY last'))if(now-(w.last||0)>=(w.every||6)*3600e3){if(out.length>=6)break;const r=await tvWatchRun(w,by||'scheduler');out.push(r);if(r.stop)break}return out}
const TVWSUG=[['تنگهٔ هرمز و خلیج فارس','Strait of Hormuz Persian Gulf shipping disruption tanker container','risk'],['دریای سرخ و باب‌المندب','Red Sea Bab el-Mandeb shipping attack container lines diversion','risk'],['بنادر ایران','Bandar Abbas Shahid Rajaee port congestion vessels','port'],['بخشنامه‌های گمرک ایران','بخشنامه جدید گمرک جمهوری اسلامی ایران واردات ترخیص','customs'],['مرزهای زمینی','صف کامیون مرز بازرگان سرخس میرجاوه','road'],['نرخ کرایهٔ کانتینر','container freight rates Asia Middle East Jebel Ali surcharge GRI','market']];
/* Exa-shaped fallback: when no Exa key is set, non-schema Exa searches (news sweeps, exa_search tool) run on Tavily */
{const _x=exaSearch;exaSearch=async function(o,by,op){if(wbKey('exa')||o.schema||!tvKey()||(process.env.IFA_TAVILY_FALLBACK==='0'))return _x(o,by,op);
 const r=await tvSearch({query:o.query,topic:o.category==='news'?'news':'general',n:Math.min(o.n||8,20),start_date:o.since?String(o.since).slice(0,10):undefined,domains:o.include},by,'exa.'+(op||'search'));
 return {results:r.results.map(x=>({title:x.title,url:x.url,publishedDate:x.date,highlights:[x.snippet]})),costDollars:{total:+(r.credits*tvCfg().tvCredit).toFixed(5)},engine:'tavily'}}}
{const _t=wbTick;wbTick=async function(){await _t();const C=wbCfg();if(!C.auto||tvOff()||!tvKey())return;
 try{if(!wbKey('exa')&&process.env.IFA_TAVILY_FALLBACK!=='0'){const st=kvGet('web:st')||{};if(Date.now()-(st['n:risk']||0)>C.riskEvery*3600e3)await wbNews('risk',WBRISK,'scheduler',false).catch(e=>lstat('tavily',false,e.message));if(Date.now()-(st['n:customs']||0)>C.customsEvery*3600e3)await wbNews('customs',WBCUS,'scheduler',false).catch(e=>lstat('tavily',false,e.message))}
  await tvWatchTick('scheduler')}catch(e){console.error('tavily tick',e.message)}}}
/* page assistant / web_search provider chain: Tavily with Bearer auth and dates */
WSP.tavily={on:()=>!!tvKey()&&!tvOff(),run:async(q_,n,news)=>{const r=await tvSearch({query:q_,n:Math.min(+n||6,10),topic:news?'news':'general'},'assist','assist.search');return r.results.map(x=>({title:x.title,url:x.url,snippet:x.snippet.slice(0,500),date:x.date||''}))}};
/* ================= 8) forwarder discovery & counterparty screening on Tavily (used when Exa is not configured, or engine:'tavily') ================= */
const TVDIR=/(linkedin|facebook|instagram|twitter|x\.com|youtube|wikipedia|alibaba|made-in-china|indiamart|yelp|tripadvisor|glassdoor|indeed|reddit|quora|medium\.com|pinterest)/i;
async function tvFind(b,by){const from=wbClean(b.from,60),to=wbClean(b.to,60);if(!from||!to)throw E(400,'مبدأ و مقصد لازم است');const mode=tvPick(b.mode,['sea','air','road','rail'],'sea');const svc=wbClean(b.services,120);
 const lane=(from+' > '+to+' · '+mode).toLowerCase();const MF={sea:'sea freight FCL LCL',air:'air freight',road:'road freight trucking TIR',rail:'rail freight'}[mode];const C=tvCfg();const c0=tvSpent().month;
 const s=await tvSearch({query:'freight forwarder '+from+' to '+to+' '+MF+(svc?' '+svc:'')+' company contact',depth:'advanced',n:15,exclude:'linkedin.com,facebook.com,youtube.com,wikipedia.org'},by,'forwarders.search');
 const seen=new Set(),pick=[];for(const r of s.results){const h=wbHost(r.url);if(!h||TVDIR.test(h)||seen.has(h)||WBINJ.test(r.title+' '+r.snippet))continue;seen.add(h);pick.push(r);if(pick.length>=Math.max(1,Math.min(8,+b.n||6)))break}
 let X={results:[]};if(pick.length)try{X=await tvExtract({urls:pick.map(p=>p.url),query:'company name, services, contact email, phone, offices',chunks_per_source:3},by,'forwarders.extract')}catch(e){if(e.code===429||e.code===402)throw e}
 const P=q('SELECT name,email FROM partners');const known=c=>P.some(p=>(c.email&&p.email&&p.email.toLowerCase()===c.email.toLowerCase())||(p.name&&c.name&&p.name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,10)===c.name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,10)));
 const items=[];for(const r of pick){const x=(X.results||[]).find(e=>wbHost(e.url)===wbHost(r.url))||{};const txt=(x.content||'')+' '+r.snippet;if(WBINJ.test(r.title+' '+txt))continue;
  const email=((txt.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).find(e=>!/\.(png|jpg|gif|webp)$/i.test(e)&&!/@(example\.(com|org|net)$|sentry|wixpress)/i.test(e))||'');const phone=wbClean((txt.match(/\+\d[\d\s().-]{7,18}\d/)||[])[0]||'',40);
  const name=wbClean(String(r.title||wbHost(r.url)).split(/\s[|\-–—:]\s/)[0],120)||wbHost(r.url);let web='';try{web=new URL(r.url).origin}catch(e){}
  const services=['FCL','LCL','air','road','rail','customs','warehous','project','reefer','NVOCC','door'].filter(k=>new RegExp(k,'i').test(txt)).slice(0,8);
  const it={name,website:web,country:'',city:'',services,lanes:wbClean(r.snippet,160),email,phone,certs:['FIATA','IATA','AEO','ISO 9001'].filter(k=>txt.includes(k)),url:r.url,conf:r.score,engine:'tavily',injection:WBINJ.test(txt)};it.known=known(it);
  let id;try{id=Number(run('INSERT INTO web_cand(lane,name,website,country,city,services,email,phone,certs,url,known,status,ts,by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',lane,name,web||r.url,'','',JSON.stringify(services),email,phone,JSON.stringify(it.certs),r.url,it.known?1:0,'new',Date.now(),by).lastInsertRowid)}catch(e){const o=q1('SELECT id FROM web_cand WHERE lane=? AND website=?',lane,web||r.url);id=o&&o.id}it.id=id;items.push(it)}
 audit(by,'','web.forwarders','web_cand',lane,{n:items.length,engine:'tavily'});const cr=+(tvSpent().month-c0).toFixed(2);
 return {lane,items,engine:'tavily',credits:cr,usd:+(cr*C.tvCredit).toFixed(4),note:'فهرست از وب‌سایت خود شرکت‌ها (Tavily Search + Extract)؛ پیش از ارسال استعلام، غربال تحریم و اعتبارسنجی کنید'}}
{const _f=wbFind;wbFind=async function(b,by){b=b||{};if(b.engine==='tavily'||(!wbKey('exa')&&tvKey()&&b.engine!=='exa'))return tvFind(b,by);return _f(b,by)}}
const TVSANC=/(sanction|designat|OFAC|SDN|blacklist|embargo|seiz|indict|fraud|تحریم|توقیف)/i;
{const _p=wbParty;wbParty=async function(b,by){b=b||{};const useTv=b.web!==false&&tvKey()&&!tvOff()&&(b.engine==='tavily'||!wbKey('exa'));if(!useTv)return _p(b,by);
 const out=await _p({...b,web:false},by);try{const nm=out.name;const r=await tvSearch({query:'"'+nm+'"'+(out.country?' '+out.country:'')+' sanctions OFAC designation ownership adverse news',depth:'advanced',answer:'basic',n:8,exact_match:false},by,'party.screen');
  const hits=r.results.filter(x=>TVSANC.test(x.title+' '+x.snippet)&&(x.title+' '+x.snippet).toLowerCase().includes(String(nm).toLowerCase().split(/\s+/)[0]));
  out.web={engine:'tavily',summary:r.answer||'',adverse:hits.slice(0,6).map(h=>({topic:'web',summary:h.title,url:h.url,date:h.date})),results:r.results.slice(0,6).map(x=>({title:x.title,url:x.url,date:x.date}))};
  if(hits.length&&out.risk==='low'){out.risk='medium';out.reasons.push('Tavily: '+fa_(hits.length)+' منبع وب با اشاره به تحریم/خبر منفی دربارهٔ این نام — بررسی دستی لازم است')}
  out.sources=[...(out.sources||[]),...r.results.slice(0,6).map(x=>({url:x.url,title:x.title}))].slice(0,10);out.credits=r.credits;
  try{run('UPDATE web_party SET web=?,risk=? WHERE id=(SELECT MAX(id) FROM web_party WHERE name=?)',JSON.stringify(out.web),out.risk,nm)}catch(e){}}catch(e){out.webError=String(e.message).slice(0,200)}return out}}
const tvHasCert=(text,label)=>new RegExp('(?:^|[^A-Za-z0-9])'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^A-Za-z0-9])','i').test(text);
async function tvSite(b,by,ctx){const url=wbUrl(b.url);tvAgUrl(url,ctx);const host=wbHost(url);
 const r=await tvCrawl({url,instructions:wbClean(b.instructions,300)||'Company profile: about us, services, lanes, offices, certifications, contact details',limit:tvInt(b.limit,3,30,10),max_depth:2,chunks_per_source:3,extract_depth:'basic',max_chars:6000},by,'site.crawl',ctx);
 const all=r.results.map(x=>x.content).join('\n');const emails=[...new Set((all.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).filter(e=>!/\.(png|jpg|gif|webp)$/i.test(e)))].slice(0,8);const phones=[...new Set((all.match(/\+\d[\d\s().-]{7,18}\d/g)||[]).map(p=>p.trim()))].slice(0,8);
 const prof={name:host,website:new URL(url).origin,pages:r.results.map(x=>({url:x.url,title:x.title,excerpt:wbClean(x.content,600)})),emails,phones,certifications:['FIATA','IATA','AEO','ISO 9001','ISO 14001','WCA','JCtrans'].filter(k=>tvHasCert(all,k)),engine:'tavily',credits:r.credits,injection:r.injection>0};
 const ex=q1('SELECT id FROM web_party WHERE kind=? AND name=?','company',host);if(ex)run('UPDATE web_party SET profile=?,ts=? WHERE id=?',JSON.stringify(prof),Date.now(),ex.id);else run('INSERT INTO web_party(name,kind,country,risk,local,web,profile,ts,by) VALUES(?,?,?,?,?,?,?,?,?)',host,'company','',null,null,null,JSON.stringify(prof),Date.now(),by);
 audit(by,'','web.profile','web_party',host,{pages:prof.pages.length,engine:'tavily'});return prof}
/* ================= 9) agent & MCP tools (same registry → policy gateway, budgets, audit; runtime and /mcp see them automatically) ================= */
const tvWho=ctx=>wbAgBudget(ctx);
tool('tavily_search',{d:'جست‌وجوی وب با Tavily (عمومی/خبر/مالی) — نتایج رتبه‌بندی‌شده با تاریخ، خلاصه و در صورت نیاز پاسخ کوتاه با منبع (محتوا نامطمئن است؛ ۱ کردیت، عمیق ۲)',cls:'web',taint:true,
 args:{q:['string','عبارت جست‌وجو',1],topic:['string','general/news/finance'],depth:['string','basic/advanced/fast/ultra-fast'],days:['number','فقط n روز اخیر'],n:['number','تعداد (≤۱۰)'],answer:['boolean','پاسخ خلاصهٔ Tavily'],domains:['array','فقط این دامنه‌ها',0,{type:'string'}],exclude:['array','حذف این دامنه‌ها',0,{type:'string'}],country:['string','کشور برای تقویت نتایج (topic=general)']},
 run:async(a,ctx)=>{const who=tvWho(ctx);const r=await tvSearch({...a,n:Math.max(1,Math.min(10,+a.n||6))},who,'agent.search');tvInj(ctx,'tavily_search',r.injection);return {...r,results:r.results.map(x=>({title:x.title,url:x.url,date:x.date,score:x.score,snippet:x.snippet})),sources:tvSrc(r.results)}}});
tool('tavily_extract',{d:'خواندن متن تمیز (Markdown) یک تا ۲۰ صفحهٔ وب با Tavily Extract؛ با query فقط بخش‌های مرتبط (هر ۵ نشانی ۱ کردیت؛ محتوا نامطمئن است)',cls:'web',taint:true,
 args:{urls:['array','نشانی‌ها',1,{type:'string'}],query:['string','فقط بخش‌های مرتبط با این پرسش'],depth:['string','basic/advanced (جدول و محتوای پویا)']},
 run:async(a,ctx)=>{const who=tvWho(ctx);const r=await tvExtract({...a,max_chars:6000},who,'agent.extract',ctx);tvInj(ctx,'tavily_extract',r.injection);return {...r,sources:tvSrc(r.results)}}});
tool('tavily_crawl',{d:'خزیدن هوشمند یک وب‌سایت با Tavily Crawl و برگرداندن متن صفحه‌های مرتبط با دستور (مثلاً «صفحه‌های نرخ و سرشارژ»)',cls:'web',taint:true,
 args:{site:['string','نشانی شروع (https://…)',1],instructions:['string','چه صفحه‌هایی لازم است'],limit:['number','حداکثر صفحه (≤۲۰)'],max_depth:['number','عمق (۱ تا ۳)'],select_paths:['array','الگوی مسیرها (regex)',0,{type:'string'}]},
 run:async(a,ctx)=>{const who=tvWho(ctx);const r=await tvCrawl({...a,url:a.site||a.url,limit:Math.min(20,+a.limit||10),max_depth:Math.min(3,+a.max_depth||1),max_chars:2500},who,'agent.crawl',ctx);tvInj(ctx,'tavily_crawl',r.injection);return {...r,sources:tvSrc(r.results)}}});
tool('tavily_map',{d:'نقشهٔ نشانی‌های یک وب‌سایت با Tavily Map (بدون محتوا؛ برای یافتن صفحهٔ تماس، نرخ، اطلاعیه)',cls:'web',taint:true,
 args:{site:['string','نشانی سایت (https://…)',1],instructions:['string','کدام بخش‌ها'],limit:['number','حداکثر نشانی (≤۱۰۰)'],max_depth:['number','عمق (۱ تا ۳)']},
 run:async(a,ctx)=>{const who=tvWho(ctx);const r=await tvMap({...a,url:a.site||a.url,limit:Math.min(100,+a.limit||50),max_depth:Math.min(3,+a.max_depth||1),max_urls:100},who,'agent.map',ctx);return {...r,sources:[{kind:'web',url:r.baseUrl,title:'نقشهٔ سایت '+wbHost(r.baseUrl)}]}}});
tool('tavily_research',{d:'شروع پژوهش عمیق Tavily (ناهمگام؛ گزارش با استناد چند دقیقه بعد در «پژوهش‌ها» و حافظهٔ سازمانی). wait = چند ثانیه منتظر بماند (≤۱۲۰)',cls:'web',
 args:{q:['string','پرسش پژوهش',1],model:['string','mini/pro/auto'],wait:['number','ثانیهٔ انتظار برای نتیجه'],domains:['array','دامنه‌های ترجیحی',0,{type:'string'}]},
 run:async(a,ctx)=>{const who=tvWho(ctx);const r=tvJobAdd({q:a.q,model:a.model,domains:a.domains},who);if(+a.wait>0){const J=await tvJobWait(r.id,Math.min(120,+a.wait));return {...r,status:J.status,result:J.result,sources:(J.sources||[]).map(s=>({kind:'web',url:s.url,title:s.title||s.url}))}}return {...r,status:'queued',sources:[]}}});
tool('tavily_research_get',{d:'وضعیت و نتیجهٔ یک پژوهش Tavily (شناسهٔ کار پژوهش)',args:{id:['number','شناسهٔ پژوهش',1]},
 run:async(a,ctx)=>{const r=q1('SELECT * FROM web_jobs WHERE id=?',+a.id);if(!r||!tvJobVisible(r,ctx.actor||agActor(ctx.ag)))throw E(404,'پژوهش یافت نشد');if(r.engine==='tv'&&['queued','running'].includes(r.status))await tvJobRun(r.id).catch(()=>{});const J=wbJobRow(q1('SELECT * FROM web_jobs WHERE id=?',+a.id));
  return {...J,result:J.result&&J.result.report?{...J.result,report:String(J.result.report).slice(0,8000)}:J.result,sources:(J.sources||[]).map(s=>({kind:'web',url:s.url,title:s.title||s.url}))}}});
tool('tavily_usage',{d:'مصرف اعتبار Tavily: امروز/ماه در سامانه، سقف‌ها و (در صورت امکان) مصرف کلید و طرح حساب',run:async()=>{const S=tvStatus();let live=null;try{live=await tvUsage('agent')}catch(e){live={error:String(e.message).slice(0,160)}}return {spent:S.spent,caps:S.caps,byOp:S.byOp,account:live}}});
const TVT=['tavily_search','tavily_extract','tavily_crawl','tavily_map','tavily_research','tavily_research_get','tavily_usage'];
for(const [a,T] of [['analyst',['tavily_search','tavily_extract','tavily_research','tavily_research_get','tavily_usage']],['risk',['tavily_search','tavily_extract','tavily_research','tavily_research_get']],['procurement',['tavily_search','tavily_map','tavily_crawl','tavily_extract']],['docs',['tavily_extract']],['tracker',['tavily_search']],['finance',['tavily_search']],['flow',TVT]])if(AGENTS[a])for(const t of T)if(!AGENTS[a].tools.includes(t))AGENTS[a].tools.push(t);
/* ================= 10) flow templates (server-side, schedulable; tool steps go through the same policy gateway) ================= */
FLTPL.push(
 {k:'tv_risk_watch',name:'پایش خبری ریسک مسیر با Tavily',d:'هر ۶ ساعت: خبرهای ۲ روز اخیر دربارهٔ مسیر/بندر/تنگه با Tavily News؛ اگر خبر تازه‌ای بود تحلیل کوتاه و هشدار به تیم.',sched:{mode:'every',minutes:360},vars:{query:'Strait of Hormuz OR Bandar Abbas shipping disruption',days:2},
  steps:[{type:'tool',title:'جست‌وجوی خبر (Tavily)',tool:'tavily_search',args:{q:'{{vars.query}}',topic:'news',days:'{{vars.days}}',n:8}},
   {type:'gate',title:'خبری هست؟',cond:'{{s1.results.length}} > 0',stopMsg:'خبر تازه‌ای نبود'},
   {type:'llm',title:'تحلیل ریسک',prompt:'خبرها را در ۴ تا ۶ خط تحلیل کن: چه اتفاقی افتاده، کدام مسیرها/بنادر اثر می‌پذیرند، اقدام پیشنهادی برای محموله‌های در راه. فقط به خبرهای همین داده استناد کن.',fallback:'{{s1.results.length}} خبر تازه دربارهٔ «{{vars.query}}»'},
   {type:'notify',title:'هشدار به تیم',event:'agent.alert',text:'{{s3.text}}',dedupe:'tvrisk|{{today}}|{{s1.results.0.url}}'}]},
 {k:'tv_market_brief',name:'خلاصهٔ هفتگی بازار حمل با Tavily',d:'هر هفته: خبرهای نرخ کرایه، سرشارژ و ظرفیت (آسیا ← خاورمیانه) با پاسخ خلاصهٔ Tavily؛ جمع‌بندی برای مدیر.',sched:{mode:'weekly',at:'09:00',dow:6},vars:{query:'container freight rates Asia to Middle East Jebel Ali Bandar Abbas surcharge GRI this week'},
  steps:[{type:'tool',title:'جست‌وجوی خبر بازار',tool:'tavily_search',args:{q:'{{vars.query}}',topic:'news',days:7,n:10,answer:true,depth:'advanced'}},
   {type:'tool',title:'شاخص‌های داخلی',tool:'market_indices',onFail:'continue'},
   {type:'llm',title:'جمع‌بندی هفتگی',prompt:'یک خلاصهٔ هفتگی ۶ تا ۸ خطی بنویس: روند نرخ‌ها و سرشارژها، ظرفیت، اثر بر قیمت‌گذاری ما و توصیه. اعداد فقط از داده‌ها.',fallback:'{{s1.answer}}'},
   {type:'notify',title:'ارسال به مدیر',event:'agent.report',text:'{{s3.text}}',dedupe:'tvmkt|{{today}}'}]},
 {k:'tv_forwarder_scout',name:'شناسایی فورواردر تازه برای یک مسیر (Tavily)',d:'هر ماه: یافتن فورواردرهای یک مسیر از وب‌سایت خودشان (Search + Extract)، غربال تحریم نام‌ها و گزارش نامزدها.',sched:{mode:'every',minutes:43200},vars:{from:'Ningbo',to:'Bandar Abbas',mode:'sea'},
  steps:[{type:'tool',title:'یافتن نامزدها',tool:'web_forwarders',args:{from:'{{vars.from}}',to:'{{vars.to}}',mode:'{{vars.mode}}'}},
   {type:'gate',title:'نامزدی پیدا شد؟',cond:'{{s1.items.length}} > 0',stopMsg:'نامزدی پیدا نشد'},
   {type:'llm',title:'گزارش نامزدها',prompt:'نامزدهای فورواردر را در جدول کوتاه (نام، سایت، ایمیل، خدمات) فهرست کن و بگو کدام برای استعلام مناسب‌ترند. یادآوری کن پیش از استعلام غربال تحریم لازم است.',fallback:'{{s1.items.length}} فورواردر برای {{vars.from}} → {{vars.to}}'},
   {type:'notify',title:'ارسال به تدارکات',event:'agent.report',text:'{{s3.text}}',dedupe:'tvfw|{{vars.from}}|{{vars.to}}|{{today}}'}]},
 {k:'tv_deep_research',name:'پژوهش عمیق دوره‌ای (Tavily Research)',d:'هر ماه: یک پرسش پژوهشی (مقررات، کریدور، بازار) با Tavily Research؛ گزارش با استناد به «پژوهش‌ها» و حافظهٔ سازمانی می‌رود و به تیم اعلام می‌شود.',sched:{mode:'every',minutes:43200},vars:{q:'تغییرات مقررات واردات و ترانزیت ایران و کشورهای همسایه در ماه گذشته و اثر آن بر حمل کانتینری',model:'mini'},
  steps:[{type:'tool',title:'شروع پژوهش',tool:'tavily_research',args:{q:'{{vars.q}}',model:'{{vars.model}}'}},
   {type:'notify',title:'اعلام شروع',event:'agent.report',text:'پژوهش Tavily شمارهٔ {{s1.id}} آغاز شد: {{vars.q}} — نتیجه در «دادهٔ وب › پژوهش‌ها»',dedupe:'tvres|{{s1.id}}'}]});
/* ================= 11) routes ================= */
const tvBody=async req=>{const b=await body(req);return b&&typeof b==='object'?b:{}};
route('GET','/api/tavily/status',()=>tvStatus(),'');
route('GET','/api/tavily/usage',async(req,u)=>tvUsage(u.username),'web.use');
route('PUT','/api/tavily/key',async(req,u)=>{const b=await tvBody(req);const v=String(b.key==null?'':b.key).trim();if(v&&!/^tvly-[A-Za-z0-9_\-]{10,200}$/.test(v))throw E(400,'قالب کلید Tavily نامعتبر است (باید با tvly- شروع شود)');
 if(v)run('INSERT INTO web_secret(k,v,ts,by) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,ts=excluded.ts,by=excluded.by','tv',v,Date.now(),u.username);else run("DELETE FROM web_secret WHERE k='tv'");
 audit(u.username,ipOf(req),'web.keys','web_secret','tv',{set:!!v});return {ok:true,status:tvStatus()}},'web.manage');
route('PUT','/api/tavily/caps',async(req,u)=>{const b=await tvBody(req);const c=kvGet('web:cfg')||{};const n=(v,a,m)=>v==null?undefined:Math.max(a,Math.min(m,+v||0));
 const o={...c,...Object.fromEntries(Object.entries({tvDayCredits:n(b.day,1,100000),tvMonthCredits:n(b.month,1,1e6),tvAgentDayCredits:n(b.agentsDay,0,100000),tvCredit:n(b.creditUSD,0,1)}).filter(([k,v])=>v!==undefined))};if(['mini','pro','auto'].includes(b.researchModel))o.tvResearchModel=b.researchModel;
 kvPut('web:cfg',o,u.username);audit(u.username,ipOf(req),'tavily.caps','kv','web:cfg',{day:o.tvDayCredits,month:o.tvMonthCredits});return {ok:true,status:tvStatus()}},'web.manage');
route('POST','/api/tavily/test',async(req,u)=>{const t0=Date.now();const r=await tvSearch({query:'container shipping news',n:1,depth:'basic'},u.username,'test');return {ok:true,ms:Date.now()-t0,results:r.results.length,credits:r.credits,requestId:r.requestId}},'web.manage');
route('POST','/api/tavily/estimate',async req=>{const b=await tvBody(req);const op=tvPick(b.op,['search','extract','crawl','map','research'],'search');const cr=tvEst(op,b);const C=tvCfg();return {op,credits:cr,usd:+(cr*C.tvCredit).toFixed(4),spent:tvSpent(),caps:{day:C.tvDayCredits,month:C.tvMonthCredits}}},'');
route('POST','/api/tavily/search',async(req,u)=>tvSearch(await tvBody(req),u.username,'api.search'),'web.use');
route('POST','/api/tavily/extract',async(req,u)=>tvExtract(await tvBody(req),u.username,'api.extract'),'web.use');
route('POST','/api/tavily/crawl',async(req,u)=>tvCrawl(await tvBody(req),u.username,'api.crawl'),'web.use');
route('POST','/api/tavily/map',async(req,u)=>tvMap(await tvBody(req),u.username,'api.map'),'web.use');
route('POST','/api/tavily/research',async(req,u)=>{const b=await tvBody(req);const r=tvJobAdd(b,u.username);return +b.wait>0?{...r,job:await tvJobWait(r.id,Math.min(60,+b.wait))}:r},'web.research');
route('GET','/api/tavily/research',(req,u)=>({items:q("SELECT * FROM web_jobs WHERE engine='tv' ORDER BY id DESC LIMIT 40").filter(j=>tvJobVisible(j,u)).map(wbJobRow),model:tvCfg().tvResearchModel,estimates:TVRC}),'');
route('GET','/api/tavily/research/:id',(req,u,P)=>{const r=q1("SELECT * FROM web_jobs WHERE id=? AND engine='tv'",+P.id);if(!r||!tvJobVisible(r,u))throw E(404,'یافت نشد');return wbJobRow(r)},'');
route('POST','/api/tavily/research/:id/poll',async(req,u,P)=>{const r=q1("SELECT * FROM web_jobs WHERE id=? AND engine='tv'",+P.id);if(!r||!tvJobVisible(r,u))throw E(404,'یافت نشد');await tvJobRun(r.id);return wbJobRow(q1('SELECT * FROM web_jobs WHERE id=?',r.id))},'web.research');
route('GET','/api/tavily/watches',()=>({items:q('SELECT * FROM tv_watch ORDER BY active DESC,id DESC').map(tvWatchPub),suggest:TVWSUG.map(([name,query,kind])=>({name,query,kind})),kinds:TVWK}),'');
route('POST','/api/tavily/watches',async(req,u)=>tvWatchSave(await tvBody(req),u.username),'web.manage');
route('PUT','/api/tavily/watches/:id',async(req,u,P)=>{if(!q1('SELECT id FROM tv_watch WHERE id=?',+P.id))throw E(404,'پایشگر یافت نشد');return tvWatchSave(await tvBody(req),u.username,+P.id)},'web.manage');
route('DELETE','/api/tavily/watches/:id',(req,u,P)=>{run('DELETE FROM tv_watch WHERE id=?',+P.id);audit(u.username,ipOf(req),'tavily.watch.delete','tv_watch',String(P.id),{});return {ok:true}},'web.manage');
route('POST','/api/tavily/watches/:id/run',async(req,u,P)=>{const w=q1('SELECT * FROM tv_watch WHERE id=?',+P.id);if(!w)throw E(404,'پایشگر یافت نشد');return tvWatchRun(w,u.username)},'web.use');
route('POST','/api/tavily/watches/tick',async(req,u)=>({ok:true,items:await tvWatchTick(u.username)}),'web.manage');
route('POST','/api/tavily/forwarders',async(req,u)=>tvFind(await tvBody(req),u.username),'web.use');
route('POST','/api/tavily/party',async(req,u)=>wbParty({...(await tvBody(req)),engine:'tavily'},u.username),'web.use');
route('POST','/api/tavily/site',async(req,u)=>tvSite(await tvBody(req),u.username),'web.use');
if(TOOLS.web_research)TOOLS.web_research.args.engine=['string','exa/fc/tv (tv = Tavily Research)'];
