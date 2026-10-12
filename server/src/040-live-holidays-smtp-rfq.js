/* ---------- 5) Official Iranian holidays (holidayapi.ir) ---------- */
let HBUSY=false;
async function holidaysSync(){if(HBUSY)return;HBUSY=true;try{const n=CFG.live.holidays.days;const C=cGet('hol',null)||{days:{}};const today=new Date();let fetched=0;
  const todo=[];for(let i=-7;i<n;i++){const d=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+i));const k=d.toISOString().slice(0,10);if(!(k in C.days))todo.push(k)}
  for(let i=0;i<todo.length;i+=4){await Promise.all(todo.slice(i,i+4).map(async k=>{try{const [y,m,d]=k.split('-');const j=await getJ(`https://holidayapi.ir/gregorian/${y}/${+m}/${+d}`,{timeout:15000});
    C.days[k]=j.is_holiday?(j.events||[]).filter(e=>e.is_holiday).map(e=>e.description).join(' · ')||'تعطیل رسمی':0;fetched++}catch(e){}}));if(fetched&&i%40===0)cSet('hol',C)}
  cSet('hol',C);lstat('holidays',true,Object.values(C.days).filter(Boolean).length+' روز تعطیل')}catch(e){lstat('holidays',false,e.message)}finally{HBUSY=false}}
const holidaysOut=()=>{const C=cGet('hol',null)||{days:{}};const L=Object.entries(C.days).filter(x=>x[1]).sort().map(([a,n])=>({a,n:String(n).replace(/\s*\/\s*/g,' / ')}));
 /* skip Fridays — the planner already treats weekends separately */return {src:'holidayapi.ir',days:Object.keys(C.days).length,holidays:L.filter(h=>new Date(h.a+'T12:00:00Z').getUTCDay()!==5)}};

/* ---------- 6) SMTP e-mail (no dependencies; implicit TLS 465 or STARTTLS 587) ---------- */
function smtpSend({to,subject,text}){const S=CFG.smtp;return new Promise((ok,no)=>{if(!S.host)return no(new Error('SMTP تنظیم نشده'));let sock,buf='',step=0,done=false;const from=S.from||S.user;
 const fin=e=>{if(done)return;done=true;try{sock.end()}catch(_){}e?no(e):ok(true)};const b64=s=>Buffer.from(s,'utf8').toString('base64');
 const msg=()=>[`From: ${from.includes('<')?from:'<'+from+'>'}`,`To: <${to}>`,`Subject: =?UTF-8?B?${b64(subject)}?=`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${crypto.randomBytes(12).toString('hex')}@ifa>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(text).replace(/.{1,76}/g,'$&\r\n'),'.'].join('\r\n');
 const addr=from.replace(/^.*</,'').replace(/>.*$/,'').trim();
 const seq=[[null,220],['EHLO ifa.local',250],...(!S.secure&&S.starttls!==false?[['STARTTLS',220,'tls'],['EHLO ifa.local',250]]:[]),...(S.user?[['AUTH LOGIN',334],[b64(S.user),334],[b64(S.pass),235]]:[]),[`MAIL FROM:<${addr}>`,250],[`RCPT TO:<${to}>`,250],['DATA',354],['__MSG__',250],['QUIT',221]];
 const next=()=>{step++;if(step>=seq.length)return fin();const [c,,act]=seq[step];if(c==='__MSG__')sock.write(msg()+'\r\n');else sock.write(c+'\r\n')};
 const onData=d=>{buf+=d.toString('utf8');let m;while((m=buf.match(/^(\d{3})([ -])(.*)\r?\n/m))){const line=m[0];buf=buf.slice(buf.indexOf(line)+line.length);if(m[2]==='-')continue;const code=+m[1],[, want,act]=seq[step];
   if(code!==want)return fin(new Error('SMTP '+code+' '+m[3]));
   if(act==='tls'){sock.removeAllListeners('data');sock=tls.connect({socket:sock,servername:S.host},()=>{sock.on('data',onData);next()});sock.on('error',fin);return}
   if(step===seq.length-1)return fin();next()}};
 sock=S.secure?tls.connect({host:S.host,port:S.port||465,servername:S.host}):net.connect({host:S.host,port:S.port||587});sock.setTimeout(30000,()=>fin(new Error('SMTP timeout')));sock.on('data',onData);sock.on('error',fin)})}
CHANNELS.email=()=>!!CFG.smtp.host;
const _deliver=deliver;deliver=async function(o){if(o.channel==='email'){const [sub,...rest]=String(o.text).split('\n');return smtpSend({to:o.target,subject:rest.length?sub:'سامانه لجستیک آسانا · '+(o.event||'اعلان'),text:rest.length?rest.join('\n'):o.text})}return _deliver(o)};

/* ---------- 7) RFQ: online quotation links for forwarders/carriers ---------- */
PERM['rfq.send']=['admin','manager','ops','sales'];
const pubBase=req=>(CFG.publicUrl||('http://'+(req.headers.host||'localhost'))).replace(/\/$/,'');
function quoteToKv(r,rq){const L=kvGet('ifa-quotes');const A=Array.isArray(L)?L:[];const id='RQ-'+r.id;const row={id,p:r.vendor,c:Math.round(r.usd),d:r.days,f:r.free||0,route:rq.route,t:r.ts,src:'online',cur:r.cur,amt:r.price,valid:r.valid||'',note:r.note||'',contact:r.contact||''};
 const i=A.findIndex(x=>x&&x.id===id);if(i>=0)A[i]=row;else A.push(row);kvPut('ifa-quotes',A,'rfq-portal')}
function rfqPage(rq,inv,prev,msg){const exp=rq.expires<Date.now();return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><title>RFQ · ${esc(rq.title)}</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:#141414;color:#eee;margin:0;padding:24px;line-height:1.8}main{max-width:760px;margin:auto}.c{background:#1d1d1d;border:1px solid #2c2c2c;border-radius:14px;padding:18px 20px;margin-bottom:14px}pre{white-space:pre-wrap;font:inherit;margin:0;color:#ccc}label{display:block;margin:8px 0}input,textarea,select{width:100%;box-sizing:border-box;background:#111;border:1px solid #333;color:#eee;border-radius:8px;padding:9px;font:inherit}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}button{background:#eee;color:#111;border:0;border-radius:10px;padding:11px 22px;font:inherit;font-weight:700;cursor:pointer}.m{color:#999;font-size:13px}.ok{background:#16351f;border-color:#2a6b3b}.bad{background:#3a1a1a;border-color:#6b2a2a}h1{font-size:20px;margin:0 0 4px}</style></head><body><main><div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><img src="/icons/icon.svg" width="34" height="34" alt="" style="border-radius:8px"><b style="font-size:15px">سامانه لجستیک آسانا</b></div>
<div class="c"><h1>درخواست پیشنهاد قیمت · Request for Quotation</h1><div class="m">${esc(rq.route||'')} · ${inv.vendor?esc(inv.vendor)+' · ':''}مهلت پاسخ / Deadline: ${faDT(rq.expires)}</div></div>
${msg?`<div class="c ${msg[0]}">${esc(msg[1])}</div>`:''}<div class="c"><pre dir="auto">${esc(rq.text)}</pre></div>
${exp?'<div class="c bad">مهلت پاسخ به این استعلام تمام شده است. / This RFQ has expired.</div>':`<form class="c" method="post" id="f"><b>ثبت پیشنهاد · Submit your offer</b>${prev?'<p class="m">پیشنهاد قبلی شما ثبت شده؛ ارسال دوباره آن را به‌روز می‌کند. / Re-submitting updates your previous offer.</p>':''}
${inv.vendor?'':'<label>نام شرکت / Company<input name="vendor" required maxlength="120"></label>'}
<div class="g"><label>مبلغ کل حمل / Total freight<input name="price" type="number" step="0.01" min="1" required value="${prev?prev.price:''}"></label><label>ارز / Currency<select name="cur">${['USD','EUR','AED','CNY','IRR'].map(c=>`<option ${prev&&prev.cur===c?'selected':''}>${c}</option>`).join('')}</select></label>
<label>زمان ترانزیت (روز) / Transit days<input name="days" type="number" step="0.5" min="0" required value="${prev?prev.days:''}"></label><label>روز آزاد / Free days<input name="free" type="number" min="0" value="${prev?prev.free:''}"></label>
<label>اعتبار پیشنهاد تا / Valid until<input name="valid" type="date" value="${prev?esc(prev.valid||''):''}"></label><label>تماس / Contact (email/phone)<input name="contact" maxlength="120" value="${prev?esc(prev.contact||''):''}"></label></div>
<label>توضیحات / Remarks (شامل/غیرشامل، شرایط)<textarea name="note" rows="3" maxlength="1500">${prev?esc(prev.note||''):''}</textarea></label><button>ارسال پیشنهاد · Submit</button></form>`}
<p class="m" style="text-align:center">Asana Logistics · سامانه لجستیک آسانا · RFQ ${esc(rq.id)}</p></main></body></html>`}
function formBody(req){return new Promise((ok,no)=>{let n=0;const ch=[];req.on('data',c=>{n+=c.length;if(n>65536){no(E(413,'too large'));req.destroy()}else ch.push(c)});req.on('end',()=>{const t=Buffer.concat(ch).toString('utf8');
 try{ok(/json/.test(req.headers['content-type']||'')?JSON.parse(t||'{}'):Object.fromEntries(new URLSearchParams(t)))}catch(e){no(E(400,'بدنهٔ نامعتبر'))}});req.on('error',no)})}
const QFAIL=new Map();
async function rfqPublic(req,res,token){const inv=q1('SELECT * FROM rfq_inv WHERE token=?',token);const rq=inv&&q1('SELECT * FROM rfq WHERE id=?',inv.rfq);
 if(!inv||!rq)return send(res,404,'<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma;padding:40px;background:#141414;color:#eee">این پیوند استعلام معتبر نیست.</body>');
 const prevOf=()=>q1('SELECT * FROM rfq_resp WHERE token=? ORDER BY id DESC LIMIT 1',token);
 if(req.method==='GET'){if(!inv.opened)run('UPDATE rfq_inv SET opened=? WHERE token=?',Date.now(),token);return send(res,200,rfqPage(rq,inv,inv.vendor?prevOf():null),{'Cache-Control':'no-store'})}
 const ip=ipOf(req);const f=QFAIL.get(ip)||{n:0,t:Date.now()};if(Date.now()-f.t>3600e3){f.n=0;f.t=Date.now()}if(++f.n>30){QFAIL.set(ip,f);return send(res,429,rfqPage(rq,inv,null,['bad','تعداد ارسال بیش از حد؛ بعداً تلاش کنید.']))}QFAIL.set(ip,f);
 if(rq.expires<Date.now())return send(res,410,rfqPage(rq,inv,null));const b=await formBody(req);const vendor=String(inv.vendor||b.vendor||'').trim().slice(0,120);
 const price=+b.price,days=+b.days,free=+b.free||0,cur=['USD','EUR','AED','CNY','IRR'].includes(b.cur)?b.cur:'USD';
 if(!vendor||!(price>0)||!(days>=0))return send(res,400,rfqPage(rq,inv,null,['bad','نام شرکت، مبلغ و زمان ترانزیت لازم است.']));
 let usd=price;if(cur!=='USD'){let fx=null;try{fx=await fxLive()}catch(e){}const R=fx&&fx.rates||{};const mk=fx&&fx.market;usd=cur==='IRR'?(mk&&mk.USD?price/mk.USD:R.IRR?price/R.IRR:0):R[cur]?price/R[cur]:0;if(!usd)return send(res,400,rfqPage(rq,inv,null,['bad','تبدیل ارز ممکن نشد؛ مبلغ را به دلار وارد کنید.']))}
 const prev=inv.vendor?prevOf():null;const r={vendor,price,cur,usd,days,free,valid:String(b.valid||'').slice(0,10),note:String(b.note||'').slice(0,1500),contact:String(b.contact||'').slice(0,120),ts:Date.now()};
 let id;if(prev){run('UPDATE rfq_resp SET vendor=?,price=?,cur=?,usd=?,days=?,free=?,valid=?,note=?,contact=?,ts=?,ip=? WHERE id=?',vendor,price,cur,usd,days,free,r.valid,r.note,r.contact,r.ts,ip,prev.id);id=prev.id}
 else id=Number(run('INSERT INTO rfq_resp(rfq,token,vendor,price,cur,usd,days,free,valid,note,contact,ts,ip) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',rq.id,token,vendor,price,cur,usd,days,free,r.valid,r.note,r.contact,r.ts,ip).lastInsertRowid);
 run('UPDATE rfq_inv SET responded=? WHERE token=?',Date.now(),token);quoteToKv({...r,id},rq);audit('rfq-portal',ip,'rfq.response','rfq',rq.id,{vendor,usd:Math.round(usd),days});
 fire('quote.received',{ref:rq.id,company:vendor,usd:Math.round(usd),days,route:rq.route,deviation:rq.model?(((usd-rq.model)/rq.model)*100).toFixed(0)+'%':''});dispatch().catch(()=>{});
 return send(res,200,rfqPage(rq,inv,inv.vendor?prevOf():null,['ok','پیشنهاد شما با موفقیت ثبت شد. سپاس! / Your offer has been received. Thank you.']))}
route('POST','/api/rfq',async(req,u)=>{const b=await body(req);if(!b.text)throw E(400,'متن استعلام لازم است');const id='RFQ-'+Date.now().toString(36).toUpperCase();const days=Math.min(60,Math.max(1,+b.validDays||CFG.live.rfq.days));
 run('INSERT INTO rfq(id,title,text,route,model,days,created,expires,by) VALUES(?,?,?,?,?,?,?,?,?)',id,String(b.title||'RFQ').slice(0,200),String(b.text).slice(0,20000),String(b.route||'').slice(0,200),+b.model||null,+b.days||null,Date.now(),Date.now()+days*864e5,u.username);
 const base=pubBase(req);const mk=(vendor,email)=>{const t=crypto.randomBytes(16).toString('base64url');run('INSERT INTO rfq_inv(token,rfq,vendor,email) VALUES(?,?,?,?)',t,id,vendor,email);return {name:vendor,email,url:base+'/q/'+t,token:t}};
 const open=mk(null,null);const inv=(Array.isArray(b.recipients)?b.recipients:[]).slice(0,200).filter(r=>r&&r.email&&/@/.test(r.email)).map(r=>mk(String(r.name||r.email).slice(0,120),String(r.email).slice(0,160)));
 let emailed=0;if(b.send!==false&&CHANNELS.email()){for(const i of inv){enqueue('rfq.sent','email',i.email,`${b.title||'Request for Quotation'}\n${b.greeting||'Dear '+i.name+','}\n\n${b.text}\n\n————————\nثبت آنلاین پیشنهاد قیمت / Submit your quotation online:\n${i.url}\n`);run('UPDATE rfq_inv SET sent=? WHERE token=?',Date.now(),i.token);emailed++}dispatch().catch(()=>{})}
 audit(u.username,ipOf(req),'rfq.create','rfq',id,{recipients:inv.length,emailed});return {id,expires:Date.now()+days*864e5,open:{url:open.url},invites:inv.map(({token,...x})=>x),emailed,smtp:CHANNELS.email()}},'rfq.send');
route('GET','/api/rfq',()=>q('SELECT * FROM rfq ORDER BY created DESC LIMIT 200').map(r=>({...r,text:undefined,invites:q('SELECT vendor,email,sent,opened,responded FROM rfq_inv WHERE rfq=? AND vendor IS NOT NULL',r.id),responses:q('SELECT vendor,price,cur,usd,days,free,valid,note,contact,ts FROM rfq_resp WHERE rfq=? ORDER BY usd',r.id)})),'rfq.send');

/* ---------- live routes (read-only public data; cached server-side) ---------- */
const lerr=(k,e)=>{lstat(k,false,e.message);throw E(502,'منبع زنده در دسترس نیست: '+e.message)};
route('GET','/api/live/status',()=>({config:{fxMarket:CFG.live.fx.market,weather:CFG.live.weather.enabled,routing:CFG.live.routing.orsKey?'openrouteservice':'osrm',sanctions:CFG.live.sanctions.enabled,holidays:CFG.live.holidays.enabled,smtp:CHANNELS.email(),imap:!!(CFG.imap&&CFG.imap.host),freightos:!!(CFG.live.ext&&CFG.live.ext.freightos),rateApi:!!(CFG.live.ext&&CFG.live.ext.custom.url),dtw:!!(CFG.dtw&&CFG.dtw.on)},status:LST,sanctions:sanctionsMeta(),market:(()=>{const C=cGet('mkt',null);return C?{t:C.t,series:Object.fromEntries(Object.entries(C.series).map(([k,v])=>[k,v.date])),errors:C.errors}:null})()}));
route('GET','/api/live/fx',async req=>{try{return await fxLive(new URL(req.url,'http://x').searchParams.has('fresh'))}catch(e){lerr('fx',e)}});
route('GET','/api/live/fx/history',req=>{const s=new URL(req.url,'http://x').searchParams;const cur=String(s.get('cur')||'USD').toUpperCase();const d=Math.min(365,+s.get('days')||30);
 return q("SELECT date(ts/1000,'unixepoch') day,AVG(rate) rate,MIN(rate) low,MAX(rate) high FROM fx_hist WHERE cur=? AND ts>=? GROUP BY day ORDER BY day",cur,Date.now()-d*864e5)});
route('GET','/api/live/roads',async req=>{if(!CFG.live.weather.enabled)throw E(501,'پایش جاده غیرفعال است');try{return await roadsLive(new URL(req.url,'http://x').searchParams.has('fresh'))}catch(e){lerr('roads',e)}});
route('POST','/api/live/weather',async req=>{const b=await body(req);const P=(b.points||[]).slice(0,100).map((p,i)=>[String(p.id||i),String(p.name||''),+p.lat,+p.lng]).filter(p=>isFinite(p[2])&&isFinite(p[3]));if(!P.length)throw E(400,'نقطه‌ای ارسال نشده');
 const key='wx|'+sha(JSON.stringify(P.map(p=>[p[2].toFixed(2),p[3].toFixed(2)]))).slice(0,24);const C=cGet(key,30*60e3);if(C)return C;try{const W=await weatherFor(P);const out={fetched:Date.now(),points:W};cSet(key,out);return out}catch(e){lerr('weather',e)}});
route('POST','/api/live/matrix',async req=>{const b=await body(req);try{return await routeMatrix(b.points)}catch(e){if(e.code&&e.code<500)throw e;lerr('routing',e)}});
route('GET','/api/live/sanctions/meta',()=>sanctionsMeta()||{date:null});
route('POST','/api/live/sanctions/refresh',async()=>{sanctionsBuild().catch(()=>{});return {ok:true,started:true}},'backup');
route('GET','/api/live/holidays',()=>holidaysOut());

/* live schedulers */
if(require.main===module){const safe=(k,f)=>()=>f().catch(e=>{lstat(k,false,e.message);console.error('live/'+k+':',e.message)});
 setTimeout(safe('fx',()=>fxLive(true)),3000);setInterval(safe('fx',()=>fxLive(true)),CFG.live.fx.everyMin*60e3);
 if(CFG.live.weather.enabled){setTimeout(safe('roads',()=>roadsLive(true)),6000);setInterval(safe('roads',()=>roadsLive(true)),CFG.live.weather.everyMin*60e3)}
 if(CFG.live.sanctions.enabled){const due=()=>{const m=sanctionsMeta();return !m||Date.now()-(m.built||0)>CFG.live.sanctions.everyHours*3600e3};setTimeout(()=>{if(due())sanctionsBuild().catch(e=>console.error('live/sanctions:',e.message))},15000);setInterval(()=>{if(due())sanctionsBuild().catch(()=>{})},3600e3)}
 if(CFG.live.holidays.enabled){setTimeout(holidaysSync,20000);setInterval(holidaysSync,24*3600e3)}}

/* =====================================================================
   MARKET INDICES — شاخص‌های بازار حمل (v15.4)
   CCFI (+ خلیج فارس/دریای سرخ) · SCFI (کامپوزیت) · Drewry WCI · Freightos FBX · سوخت فجیره/سنگاپور
   تاریخچه در SQLite انباشته می‌شود (منابع عمومی تاریخچهٔ رایگان نمی‌دهند)
   ===================================================================== */
db.exec(`CREATE TABLE IF NOT EXISTS idx_hist(series TEXT,line TEXT,date TEXT,value REAL,unit TEXT,PRIMARY KEY(series,line,date));`);
CFG.live.market={enabled:true,everyHours:6,jumpPct:5,ccfi:true,scfi:true,wci:true,fbx:true,bunker:true,diesel:true,...((CFG.live&&CFG.live.market)||{}),...(CFG._mk||{})};
if(process.env.IFA_LIVE_OFF&&process.env.IFA_LIVE_OFF.split(',').includes('market'))CFG.live.market.enabled=false;
const BUA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36','Accept':'text/html,application/json;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.8'};
const MSRC={
 ccfi:{name:'CCFI — شاخص کرایهٔ صادراتی کانتینری چین',unit:'نقطه (۱۹۹۸=۱۰۰۰)',src:'Shanghai Shipping Exchange',url:'https://en.sse.net.cn/indices/ccfinew.jsp',freq:'هفتگی (جمعه)',lic:'عمومی — مقدار شاخص'},
 scfi:{name:'SCFI — شاخص کرایهٔ کانتینری شانگهای',unit:'نقطه',src:'Shanghai Shipping Exchange',url:'https://en.sse.net.cn/indices/scfinew.jsp',freq:'هفتگی (جمعه)',lic:'فقط شاخص ترکیبی عمومی است؛ نرخ مسیرها لایسنسی'},
 wci:{name:'Drewry WCI — شاخص جهانی کانتینر',unit:'USD/FEU',src:'Drewry',url:'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',freq:'هفتگی (پنجشنبه)',lic:'از متن عمومی صفحه — حداکثر روزی یک‌بار'},
 fbx:{name:'Freightos FBX — شاخص جهانی کانتینر',unit:'USD/FEU',src:'Freightos Baltic Index',url:'https://www.freightos.com/enterprise/terminal/freightos-baltic-index-global-container-pricing-index/',freq:'روزانه',lic:'از تیکر عمومی صفحه — حداکثر روزی یک‌بار'},
 bunker:{name:'قیمت سوخت کشتی (بانکر)',unit:'USD/mt',src:'Ship & Bunker',url:'https://shipandbunker.com/prices',freq:'روزانه',lic:'از جدول عمومی صفحه'},
 diesel:{name:'قیمت گازوئیل خرده‌فروشی کشورها',unit:'USD/L',src:'GlobalPetrolPrices.com',url:'https://www.globalpetrolprices.com/diesel_prices/',freq:'هفتگی/ماهانه (بسته به کشور)',lic:'جدول عمومی صفحه — حداکثر روزی یک‌بار'}};
const CCFIFA={'COMPOSITE INDEX':'ترکیبی','JAPAN':'ژاپن','EUROPE':'اروپا','W/C AMERICA':'ساحل غربی آمریکا','E/C AMERICA':'ساحل شرقی آمریکا','KOREA':'کره','SOUTHEAST':'جنوب شرق آسیا','MEDITERRANEAN':'مدیترانه','AUSTRALIA/NEW ZEALAND':'استرالیا/نیوزیلند','SOUTH AFRICA':'آفریقای جنوبی','SOUTH AMERICA':'آمریکای جنوبی','WEST EAST AFRICA':'آفریقای غربی/شرقی','PERSIAN GULF/RED SEA':'خلیج فارس/دریای سرخ'};
const FBXFA={FBX:'جهانی (ترکیبی)',FBX01:'چین ← ساحل غربی آمریکا',FBX02:'ساحل غربی آمریکا ← چین',FBX03:'چین ← ساحل شرقی آمریکا',FBX04:'ساحل شرقی آمریکا ← چین',FBX11:'چین ← شمال اروپا',FBX12:'شمال اروپا ← چین',FBX13:'چین ← مدیترانه',FBX14:'مدیترانه ← چین',FBX21:'ساحل شرقی آمریکا ← اروپا',FBX22:'اروپا ← ساحل شرقی آمریکا',FBX24:'اروپا ← آمریکای جنوبی (شرق)',FBX26:'اروپا ← آمریکای جنوبی (غرب)'};
const WCIFA={COMP:'ترکیبی WCI','New York':'شانگهای ← نیویورک','Los Angeles':'شانگهای ← لس‌آنجلس','Genoa':'شانگهای ← جنوا','Rotterdam':'شانگهای ← روتردام'};
const BPORTS=[['FUJ','فجیره','https://shipandbunker.com/prices/emea/me/ae-fjr-fujairah'],['SIN','سنگاپور','https://shipandbunker.com/prices/apac/sea/sg-sin-singapore']];
const slug=s=>String(s).toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');
const MON={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
const isoD=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
async function mGetT(url){const r=await fetch(url,{headers:BUA,redirect:'follow',signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error('HTTP '+r.status+' · '+url.replace(/\?.*/,''));return r.text()}
async function mGetJ(url){const r=await fetch(url,{headers:{...BUA,Accept:'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
/* parsers are pure (exported for tests) */
function parseSSE(j){const d=j&&j.data;if(!d||!Array.isArray(d.lineDataList))throw new Error('ساختار پاسخ SSE تغییر کرده');
 return {date:d.currentDate,prevDate:d.lastDate,lines:d.lineDataList.filter(l=>l.currentContent!=null&&l.currentContent!=='').map(l=>{const en=(l.properties&&l.properties.lineName_EN||'').trim();return {k:slug(en)||'X',en,n:CCFIFA[en.toUpperCase()]||en,v:+l.currentContent,prev:l.lastContent!=null?+l.lastContent:null}})}}
function parseFBX(h){const m=h.match(/frProductIntroTickerData\[[^\]]*\]\s*=\s*(\[[\s\S]*?\])\s*;?/);if(!m)throw new Error('تیکر FBX یافت نشد');const A=JSON.parse(m[1]);
 const lines=A.filter(x=>/^FBX\d*$/.test(x.label)).map(x=>{const v=num(x.value),c=x.change!=null?parseFloat(String(x.change).replace(/[^\d.\-]/g,'')):null;return {k:x.label,n:FBXFA[x.label]||x.label,v,prev:c!=null&&isFinite(c)?Math.round(v/(1+c/100)):null}}).filter(l=>l.v>0);if(!lines.length)throw new Error('FBX خالی');return {date:new Date().toISOString().slice(0,10),lines}}
function parseWCI(h){const t=h.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
 const dm=t.match(/assessment for \w+day,?\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i);if(!dm)throw new Error('تاریخ WCI یافت نشد');const date=isoD(dm[3],MON[dm[2].toUpperCase()],dm[1]);
 const lines=[];const cm=t.slice(dm.index,dm.index+1500).match(/WCI[^$]{0,200}?to \$([\d,]+(?:\.\d+)?) per 40ft/i);if(cm)lines.push({k:'COMP',n:WCIFA.COMP,v:num(cm[1])});
 const re=/from Shanghai to ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)\s+(?:(rose|increased|climbed|jumped|surged|fell|decreased|dropped|declined|slipped|decreased)\s+(\d+(?:\.\d+)?)%\s+)?[^$]{0,60}?(?:to|at) \$([\d,]+) per 40ft/g;let m;const seen=new Set();
 while((m=re.exec(t))){const port=m[1];if(seen.has(port))continue;seen.add(port);const v=num(m[4]);const p=m[3]?+m[3]:null;const up=m[2]&&/rose|incr|climb|jump|surg/.test(m[2]);lines.push({k:slug(port),n:WCIFA[port]||'شانگهای ← '+port,v,prev:p!=null?Math.round(v/(1+(up?p:-p)/100)):null})}
 if(!lines.length)throw new Error('نرخ WCI یافت نشد');return {date,lines}}
function parseBunker(h,yr){const out={};for(const g of ['VLSFO','MGO','IFO380']){const i=h.search(new RegExp('<table[^>]*class="[^"]*price-table '+g+'\\b'));if(i<0)continue;const tb=h.slice(i,h.indexOf('</table>',i));
  const rows=[...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(r=>r[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());const pts=[];
  for(const r of rows){const m=r.match(/^(?:[A-Z][a-z]{0,2}\s+)?([A-Z][a-z]{2})\s+(\d{1,2})\s+([\d,]+\.\d+)/);if(!m||!MON[m[1].toUpperCase()])continue;const mo=MON[m[1].toUpperCase()];const now=new Date();let y=yr||now.getUTCFullYear();if(mo>now.getUTCMonth()+2)y--;pts.push([isoD(y,mo,+m[2]),num(m[3])])}
  if(pts.length)out[g]=pts.sort((a,b)=>a[0]<b[0]?-1:1)}
 if(!Object.keys(out).length)throw new Error('جدول قیمت سوخت یافت نشد');return out}
/* diesel retail prices by country (USD/L) — used for live road-freight fuel adjustment */
const DSLC={Iran:['IR','ایران'],Turkey:['TR','ترکیه'],UAE:['AE','امارات'],China:['CN','چین'],Kazakhstan:['KZ','قزاقستان'],Uzbekistan:['UZ','ازبکستان'],Turkmenistan:['TM','ترکمنستان'],Kyrgyzstan:['KG','قرقیزستان'],Tajikistan:['TJ','تاجیکستان'],Russia:['RU','روسیه'],Azerbaijan:['AZ','آذربایجان'],Armenia:['AM','ارمنستان'],Georgia:['GE','گرجستان'],Pakistan:['PK','پاکستان'],Afghanistan:['AF','افغانستان'],Iraq:['IQ','عراق'],Oman:['OM','عمان'],Qatar:['QA','قطر'],Kuwait:['KW','کویت'],'Saudi Arabia':['SA','عربستان'],Jordan:['JO','اردن'],India:['IN','هند'],Belarus:['BY','بلاروس'],Poland:['PL','لهستان'],Germany:['DE','آلمان'],Netherlands:['NL','هلند'],Belgium:['BE','بلژیک'],Italy:['IT','ایتالیا'],Greece:['GR','یونان'],Austria:['AT','اتریش'],Hungary:['HU','مجارستان'],Serbia:['RS','صربستان'],Bulgaria:['BG','بلغارستان'],Malaysia:['MY','مالزی'],Singapore:['SG','سنگاپور'],'Sri Lanka':['LK','سریلانکا'],'South Korea':['KR','کره جنوبی'],Egypt:['EG','مصر'],Spain:['ES','اسپانیا'],France:['FR','فرانسه'],USA:['US','آمریکا']};
function parseDiesel(h){const tm=h.match(/<title>[^<]*?(\d{1,2})-([A-Za-z]{3})-(\d{4})/);if(!tm||!MON[tm[2].toUpperCase()])throw new Error('تاریخ جدول گازوئیل یافت نشد');const date=isoD(tm[3],MON[tm[2].toUpperCase()],tm[1]);
 const N=[...h.matchAll(/graph_outside_link'>([^<]*)<\/a>/g)].map(m=>m[1].replace(/&nbsp;/g,' ').replace(/\*/g,'').trim()),V=[...h.matchAll(/color:\s*#000000;">\s*([\d.]+)\s*<\/div>/g)].map(m=>+m[1]);
 if(N.length<20||N.length!==V.length)throw new Error('ساختار جدول گازوئیل تغییر کرده ('+N.length+'/'+V.length+')');const lines=[];N.forEach((c,i)=>{const m=DSLC[c];if(m&&V[i]>0&&V[i]<10)lines.push({k:m[0],n:m[1],v:V[i]})});if(lines.length<8)throw new Error('کشورهای کافی یافت نشد');return {date,lines,all:N.length}}
const hPut=(s,l,d,v,u)=>{if(!(v>0)||!/^\d{4}-\d\d-\d\d$/.test(d||''))return;run('INSERT INTO idx_hist(series,line,date,value,unit) VALUES(?,?,?,?,?) ON CONFLICT(series,line,date) DO UPDATE SET value=excluded.value',s,l,d,v,u||'')};
const hPrev=(s,l,d)=>{const r=q1('SELECT value,date FROM idx_hist WHERE series=? AND line=? AND date<? ORDER BY date DESC LIMIT 1',s,l,d);return r||null};
const mkLines=(s,P)=>{for(const l of P.lines){if(l.prev!=null&&P.prevDate)hPut(s,l.k,P.prevDate,l.prev,MSRC[s].unit);hPut(s,l.k,P.date,l.v,MSRC[s].unit)}
 return P.lines.map(l=>{const pr=l.prev!=null?l.prev:(hPrev(s,l.k,P.date)||{}).value;return {k:l.k,n:l.n,v:l.v,prev:pr==null?null:pr,chg:pr?Math.round((l.v/pr-1)*1e4)/100:null}})};
const MFETCH={
 ccfi:async()=>{const P=parseSSE(await mGetJ('https://en.sse.net.cn/currentIndex?indexName=ccfi'));return {date:P.date,lines:mkLines('ccfi',P)}},
 scfi:async()=>{const P=parseSSE(await mGetJ('https://en.sse.net.cn/currentIndex?indexName=scfi'));P.lines.forEach(l=>{if(/COMPREHENSIVE/i.test(l.en)){l.n='ترکیبی SCFI'}});return {date:P.date,lines:mkLines('scfi',P)}},
 wci:async()=>{const P=parseWCI(await mGetT(MSRC.wci.url));return {date:P.date,lines:mkLines('wci',P)}},
 fbx:async()=>{const P=parseFBX(await mGetT('https://terminal.freightos.com/freightos-baltic-index-global-container-pricing-index/'));return {date:P.date,lines:mkLines('fbx',P)}},
 bunker:async()=>{const lines=[];let date='';const errs=[];for(const [code,fa,url] of BPORTS){try{const B=parseBunker(await mGetT(url));for(const [g,pts] of Object.entries(B)){const k=code+'_'+g;for(const [d,v] of pts)hPut('bunker',k,d,v,'USD/mt');const L=pts[pts.length-1],P=pts.length>1?pts[pts.length-2]:null;if(L[0]>date)date=L[0];
   const wk=hPrev('bunker',k,isoD(...(()=>{const x=new Date(Date.parse(L[0])-6*864e5);return [x.getUTCFullYear(),x.getUTCMonth()+1,x.getUTCDate()]})()));lines.push({k,n:fa+' · '+g,v:L[1],prev:P?P[1]:null,chg:P?Math.round((L[1]/P[1]-1)*1e4)/100:null,wk:wk?Math.round((L[1]/wk.value-1)*1e4)/100:null})}}catch(e){errs.push(fa+': '+e.message)}}
  if(!lines.length)throw new Error(errs.join(' | ')||'بدون داده');return {date,lines,warn:errs.length?errs:undefined}},
 diesel:async()=>{const P=parseDiesel(await mGetT(MSRC.diesel.url));return {date:P.date,lines:mkLines('diesel',P)}}};
const MEVERY={wci:24,fbx:24,diesel:24};let MBUSY=null;
async function marketRefresh(force){if(MBUSY)return MBUSY;MBUSY=(async()=>{const C=cGet('mkt',null)||{series:{},errors:{}};const alerts=[];
 for(const s of Object.keys(MFETCH)){if(CFG.live.market[s]===false)continue;const cur=C.series[s];const age=cur?Date.now()-(cur.fetched||0):1e15;if(!force&&age<(MEVERY[s]||CFG.live.market.everyHours)*3600e3*0.95)continue;
  try{const R=await MFETCH[s]();C.series[s]={...MSRC[s],date:R.date,fetched:Date.now(),lines:R.lines,warn:R.warn};delete C.errors[s];lstat('mkt.'+s,true,R.date+' · '+R.lines.length+' خط');
   const oldDate=cur&&cur.date;if(R.date!==oldDate)for(const l of R.lines){const ch=l.wk!=null?l.wk:l.chg;if(ch!=null&&Math.abs(ch)>=CFG.live.market.jumpPct){alerts.push({s,k:l.k,n:l.n,v:l.v,chg:ch});
     fire('rate.jump',{ref:s.toUpperCase()+' '+l.k,index:MSRC[s].src,lane:l.n,value:l.v,unit:MSRC[s].unit,change:(ch>0?'+':'')+ch+'%',date:R.date},'jump|'+s+'|'+l.k+'|'+R.date)}}}
  catch(e){C.errors[s]={at:Date.now(),err:String(e.message).slice(0,200)};lstat('mkt.'+s,false,e.message)}}
 try{const MW=kvGet('ifa-mkt');const W=(MW&&Array.isArray(MW.watch)?MW.watch:[]).filter(w=>w.type==='index'&&w.key);for(const w of W){const [ss,ll]=String(w.key).split('|');const L=((C.series[ss]||{}).lines||[]).find(x=>x.k===ll);if(!L)continue;const hit=w.op==='<'?L.v<=w.val:L.v>=w.val;if(hit)fire('rate.threshold',{ref:w.key,name:L.n+' ('+(MSRC[ss]||{}).src+')',value:L.v,op:w.op==='<'?'زیر':'بالای',threshold:w.val,date:C.series[ss].date},'thr|'+w.id+'|'+C.series[ss].date)}}catch(e){}
 C.t=Date.now();if(alerts.length)C.alerts=[...alerts.map(a=>({...a,t:C.t})),...(C.alerts||[])].slice(0,60);cSet('mkt',C);return C})().finally(()=>{MBUSY=null});return MBUSY}
function marketOut(days){const C=cGet('mkt',null)||{series:{},errors:{}};const since=new Date(Date.now()-days*864e5).toISOString().slice(0,10);const hist={};
 for(const r of q('SELECT series,line,date,value FROM idx_hist WHERE date>=? ORDER BY date',since))(hist[r.series+'|'+r.line]=hist[r.series+'|'+r.line]||[]).push([r.date,r.value]);
 const src=Object.fromEntries(Object.entries(MSRC).map(([k,v])=>[k,{...v,enabled:CFG.live.market.enabled&&CFG.live.market[k]!==false}]));return {t:C.t||null,series:C.series,hist,errors:C.errors,alerts:C.alerts||[],sources:src,jumpPct:CFG.live.market.jumpPct}}
route('GET','/api/live/indices',async req=>{const s=new URL(req.url,'http://x').searchParams;if(!cGet('mkt',null)&&CFG.live.market.enabled){try{await marketRefresh(false)}catch(e){}}return marketOut(Math.min(1500,+s.get('days')||400))});
route('POST','/api/live/indices/refresh',async()=>{if(!CFG.live.market.enabled)throw E(501,'شاخص‌های بازار غیرفعال است');await marketRefresh(true);return marketOut(400)},'backup');
route('POST','/api/live/indices/manual',async(req,u)=>{const b=await body(req);const s=String(b.series||'').toLowerCase(),l=slug(b.line||''),d=String(b.date||''),v=+b.value;if(!MSRC[s]||!l||!(v>0)||!/^\d{4}-\d\d-\d\d$/.test(d))throw E(400,'سری/خط/تاریخ/مقدار نامعتبر');
 hPut(s,l,d,v,MSRC[s].unit);audit(u.username,ipOf(req),'index.manual','idx',s+'|'+l,{d,v});return {ok:true}},'backup');
const MKTP={parseSSE,parseFBX,parseWCI,parseBunker,parseDiesel};
if(require.main===module&&CFG.live.market.enabled){const go=()=>marketRefresh(false).catch(e=>console.error('live/market:',e.message));setTimeout(go,25000);setInterval(go,3600e3)}

/* =====================================================================
   v15.7 · phase 3 — partner rate panel · weekly market report · external quote APIs · rate e-mail inbox (IMAP)
   ===================================================================== */
db.exec(`CREATE TABLE IF NOT EXISTS partners(token TEXT PRIMARY KEY,name TEXT,email TEXT,lanes TEXT,created INTEGER,by TEXT,revoked INTEGER DEFAULT 0,last_sent INTEGER,last_resp INTEGER,opened INTEGER);
CREATE TABLE IF NOT EXISTS prates(id INTEGER PRIMARY KEY AUTOINCREMENT,token TEXT,partner TEXT,mode TEXT,pol TEXT,pod TEXT,eq TEXT,amt REAL,cur TEXT,usd REAL,valid TEXT,incl TEXT,days REAL,note TEXT,ts INTEGER,ip TEXT,status TEXT DEFAULT 'new',by TEXT);
CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT,msgid TEXT UNIQUE,uid INTEGER,sender TEXT,subject TEXT,date TEXT,text TEXT,atts TEXT,status TEXT DEFAULT 'new',ts INTEGER);`);
PERM['partners.manage']=['admin','manager','sales','ops'];
CFG.partners={day:6,hour:9,...(CFG.partners||{})};CFG.reports={enabled:true,day:6,hour:8,...(CFG.reports||{})};
CFG.live.ext={freightos:true,minGapSec:20,maxPerDay:60,...((CFG.live&&CFG.live.ext)||{})};CFG.live.ext.custom={url:'',key:'',header:'Authorization',path:'',name:'API نرخ سفارشی',...(CFG.live.ext.custom||{})};
CFG.imap={host:'',port:993,tls:true,user:'',pass:'',box:'INBOX',everyMin:30,days:14,...(CFG.imap||{})};
{const E=process.env;if(E.IFA_RATEAPI_URL)CFG.live.ext.custom.url=E.IFA_RATEAPI_URL;if(E.IFA_RATEAPI_KEY)CFG.live.ext.custom.key=E.IFA_RATEAPI_KEY;if(E.IFA_RATEAPI_HEADER)CFG.live.ext.custom.header=E.IFA_RATEAPI_HEADER;if(E.IFA_RATEAPI_PATH)CFG.live.ext.custom.path=E.IFA_RATEAPI_PATH;if(E.IFA_RATEAPI_NAME)CFG.live.ext.custom.name=E.IFA_RATEAPI_NAME;
 if(E.IFA_LIVE_OFF&&E.IFA_LIVE_OFF.split(',').includes('ext'))CFG.live.ext.freightos=false;
 if(E.IFA_IMAP_HOST)CFG.imap.host=E.IFA_IMAP_HOST;if(E.IFA_IMAP_PORT)CFG.imap.port=+E.IFA_IMAP_PORT;if(E.IFA_IMAP_USER)CFG.imap.user=E.IFA_IMAP_USER;if(E.IFA_IMAP_PASS)CFG.imap.pass=E.IFA_IMAP_PASS;if(E.IFA_IMAP_TLS)CFG.imap.tls=E.IFA_IMAP_TLS!=='0';if(E.IFA_IMAP_BOX)CFG.imap.box=E.IFA_IMAP_BOX}
const tehran=(t=Date.now())=>{const d=new Date(t+3.5*3600e3);return {day:d.getUTCDay(),hour:d.getUTCHours(),date:d.toISOString().slice(0,10)}};
const weekKey=(t=Date.now())=>{const d=new Date(t+3.5*3600e3);const back=(d.getUTCDay()+1)%7;return new Date(d.getTime()-back*864e5).toISOString().slice(0,10)};/* Saturday-based week */
async function toUsd(v,cur){if(!cur||cur==='USD')return v;let fx=null;try{fx=await fxLive()}catch(e){}const R=fx&&fx.rates||{},mk=fx&&fx.market;return cur==='IRR'?(mk&&mk.USD?v/mk.USD:R.IRR?v/R.IRR:0):R[cur]?v/R[cur]:0}
const PCUR=['USD','EUR','AED','CNY','IRR'],PMODE={sea:'دریایی FCL',lcl:'دریایی LCL',rail:'ریلی',road:'جاده‌ای',air:'هوایی',dom:'داخلی ایران'},PINC={'all-in':'All-in','base+baf':'Base + BAF','base':'فقط کرایهٔ پایه'};
const PSTY=`body{font-family:Vazirmatn,Tahoma,sans-serif;background:#141414;color:#eee;margin:0;padding:22px;line-height:1.8}main{max-width:980px;margin:auto}.c{background:#1d1d1d;border:1px solid #2c2c2c;border-radius:14px;padding:16px 18px;margin-bottom:14px}input,select,textarea{width:100%;box-sizing:border-box;background:#111;border:1px solid #333;color:#eee;border-radius:8px;padding:7px;font:inherit;font-size:13px}table{width:100%;border-collapse:collapse}td,th{padding:6px 5px;border-bottom:1px solid #2a2a2a;text-align:right;font-size:13px;vertical-align:top}th{color:#999;font-weight:500}button{background:#eee;color:#111;border:0;border-radius:10px;padding:11px 22px;font:inherit;font-weight:700;cursor:pointer}.m{color:#999;font-size:13px}.ok{background:#16351f;border-color:#2a6b3b}.bad{background:#3a1a1a;border-color:#6b2a2a}h1{font-size:20px;margin:0 0 4px}.ln{direction:ltr;text-align:left;white-space:nowrap}@media(max-width:700px){td,th{display:block;border:0}tr{display:block;border-bottom:1px solid #333;padding:6px 0}}`;
const pLanes=p=>{try{const a=JSON.parse(p.lanes||'[]');return Array.isArray(a)?a:[]}catch(e){return []}};
const laneTxt=l=>`${l.pol||'?'} → ${l.pod||'?'}${l.eq?' · '+l.eq:''}`;
function partnerPage(p,msg){const L=pLanes(p);const prev=q('SELECT * FROM prates WHERE token=? AND ts>? ORDER BY id DESC LIMIT 60',p.token,Date.now()-35*864e5);const last=k=>prev.find(r=>(r.mode+'|'+r.pol+'|'+r.pod+'|'+r.eq)===k);
 const curSel=(n,v)=>`<select name="${n}">${PCUR.map(c=>`<option ${v===c?'selected':''}>${c}</option>`).join('')}</select>`,incSel=(n,v)=>`<select name="${n}">${Object.entries(PINC).map(([k,x])=>`<option value="${k}" ${v===k?'selected':''}>${x}</option>`).join('')}</select>`;
 const row=(i,l)=>{const pr=last((l.mode||'sea')+'|'+l.pol+'|'+l.pod+'|'+(l.eq||''));return `<tr><td><b class="ln">${esc(laneTxt(l))}</b><div class="m">${esc(PMODE[l.mode||'sea']||l.mode||'')}${pr?' · قبلی / last: '+esc(pr.amt+' '+pr.cur)+' ('+new Date(pr.ts).toISOString().slice(0,10)+')':''}</div></td><td><input name="a${i}" type="number" step="0.01" min="0" placeholder="Rate"></td><td>${curSel('c'+i,pr?pr.cur:'USD')}</td><td>${incSel('i'+i,pr?pr.incl:'all-in')}</td><td><input name="d${i}" type="number" step="0.5" min="0" placeholder="T/T days"></td><td><input name="v${i}" type="date"></td><td><input name="n${i}" maxlength="300" placeholder="Remarks"></td></tr>`};
 return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><title>Rate panel · ${esc(p.name)}</title><style>${PSTY}</style></head><body><main><div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><img src="/icons/icon.svg" width="34" height="34" alt="" style="border-radius:8px"><b style="font-size:15px">سامانه لجستیک آسانا</b></div>
<div class="c"><h1>پنل نرخ هفتگی · Weekly rate panel</h1><div class="m">${esc(p.name)} · هفتهٔ ${esc(weekKey())} · لطفاً نرخ‌های جاری خود را برای مسیرهای زیر ثبت کنید؛ ردیف‌های خالی نادیده گرفته می‌شوند. / Please submit your current rates; empty rows are ignored.</div></div>
${msg?`<div class="c ${msg[0]}">${esc(msg[1])}</div>`:''}
<form class="c" method="post"><table><thead><tr><th>مسیر / Lane</th><th>نرخ / Rate</th><th>ارز</th><th>شمول / Incl.</th><th>زمان ترانزیت</th><th>اعتبار تا / Valid to</th><th>توضیح</th></tr></thead><tbody>${L.map((l,i)=>row(i,l)).join('')}
<tr><td><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><input name="xpol" placeholder="POL (e.g. Ningbo)"><input name="xpod" placeholder="POD (e.g. Bandar Abbas)"><select name="xmode">${Object.entries(PMODE).map(([k,x])=>`<option value="${k}">${x}</option>`).join('')}</select><input name="xeq" placeholder="40HC / 20DV / kg"></div><div class="m">مسیر دیگر / other lane</div></td><td><input name="ax" type="number" step="0.01" min="0"></td><td>${curSel('cx','USD')}</td><td>${incSel('ix','all-in')}</td><td><input name="dx" type="number" step="0.5" min="0"></td><td><input name="vx" type="date"></td><td><input name="nx" maxlength="300"></td></tr></tbody></table>
<p><button>ثبت نرخ‌ها · Submit rates</button></p></form>
${prev.length?`<div class="c"><b>ثبت‌های اخیر شما / Your recent submissions</b><table>${prev.slice(0,15).map(r=>`<tr><td class="ln">${esc(laneTxt(r))}</td><td>${esc(r.amt+' '+r.cur)}</td><td class="m">${new Date(r.ts).toISOString().slice(0,10)}</td><td class="m">${r.status==='ok'?'تأیید شد':r.status==='rej'?'رد شد':'در انتظار بررسی'}</td></tr>`).join('')}</table></div>`:''}
<p class="m" style="text-align:center">Asana Logistics · Partner rate panel</p></main></body></html>`}
const PFAIL=new Map();
async function partnerPublic(req,res,token){const p=q1('SELECT * FROM partners WHERE token=? AND revoked=0',token);
 if(!p)return send(res,404,'<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma;padding:40px;background:#141414;color:#eee">این پیوند پنل نرخ معتبر نیست.</body>');
 if(req.method==='GET'){run('UPDATE partners SET opened=? WHERE token=?',Date.now(),token);return send(res,200,partnerPage(p),{'Cache-Control':'no-store'})}
 const ip=ipOf(req);const f=PFAIL.get(ip)||{n:0,t:Date.now()};if(Date.now()-f.t>3600e3){f.n=0;f.t=Date.now()}if(++f.n>40){PFAIL.set(ip,f);return send(res,429,partnerPage(p,['bad','تعداد ارسال بیش از حد؛ بعداً تلاش کنید.']))}PFAIL.set(ip,f);
 const b=await formBody(req);const L=pLanes(p);const rows=[];const take=(k,l)=>{const amt=+b['a'+k];if(!(amt>0))return;rows.push({mode:PMODE[l.mode]?l.mode:'sea',pol:String(l.pol||'').slice(0,80),pod:String(l.pod||'').slice(0,80),eq:String(l.eq||'').slice(0,20),amt,cur:PCUR.includes(b['c'+k])?b['c'+k]:'USD',incl:PINC[b['i'+k]]?b['i'+k]:'all-in',days:+b['d'+k]||null,valid:/^\d{4}-\d\d-\d\d$/.test(b['v'+k]||'')?b['v'+k]:'',note:String(b['n'+k]||'').slice(0,300)})};
 L.forEach((l,i)=>take(i,l));if(b.xpol&&b.xpod)take('x',{mode:b.xmode,pol:b.xpol,pod:b.xpod,eq:b.xeq});
 if(!rows.length)return send(res,400,partnerPage(p,['bad','هیچ نرخی وارد نشده است. / No rate entered.']));
 for(const r of rows){const usd=await toUsd(r.amt,r.cur);run('INSERT INTO prates(token,partner,mode,pol,pod,eq,amt,cur,usd,valid,incl,days,note,ts,ip) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',token,p.name,r.mode,r.pol,r.pod,r.eq,r.amt,r.cur,usd||null,r.valid,r.incl,r.days,r.note,Date.now(),ip)}
 run('UPDATE partners SET last_resp=? WHERE token=?',Date.now(),token);audit('partner-portal',ip,'partner.rates','partner',p.name,{n:rows.length});
 fire('partner.rates',{ref:p.name,company:p.name,n:rows.length,lanes:rows.slice(0,6).map(r=>laneTxt(r)+' '+r.amt+' '+r.cur).join(' | ')});dispatch().catch(()=>{});
 return send(res,200,partnerPage(p,['ok',`${rows.length} نرخ ثبت شد. سپاس! / ${rows.length} rate(s) received. Thank you.`]),{'Cache-Control':'no-store'})}
const pInviteText=(p,url,first)=>`${first?'دعوت به پنل نرخ هفتگی':'یادآوری ثبت نرخ هفتگی'} · Asana Logistics\n${first?'Dear':'Reminder for'} ${p.name},\n\n${first?'You are invited to our weekly rate panel. Please submit your current rates for the lanes below every week:':'Please update this week\'s rates for:'}\n${pLanes(p).map(l=>'• '+laneTxt(l)).join('\n')||'• (any lane you serve)'}\n\nثبت آنلاین / Submit online:\n${url}\n`;
route('POST','/api/partners',async(req,u)=>{const b=await body(req);const name=String(b.name||'').trim().slice(0,120);if(!name)throw E(400,'نام شریک لازم است');const email=/@/.test(b.email||'')?String(b.email).trim().slice(0,160):'';
 const lanes=(Array.isArray(b.lanes)?b.lanes:[]).slice(0,40).filter(l=>l&&l.pol&&l.pod).map(l=>({mode:PMODE[l.mode]?l.mode:'sea',pol:String(l.pol).slice(0,80),pod:String(l.pod).slice(0,80),eq:String(l.eq||'').slice(0,20)}));
 const t=crypto.randomBytes(16).toString('base64url');run('INSERT INTO partners(token,name,email,lanes,created,by) VALUES(?,?,?,?,?,?)',t,name,email,JSON.stringify(lanes),Date.now(),u.username);const url=pubBase(req)+'/r/'+t;
 let emailed=false;if(email&&b.send!==false&&CHANNELS.email()){enqueue('partner.invite','email',email,pInviteText({name,lanes:JSON.stringify(lanes)},url,true));run('UPDATE partners SET last_sent=? WHERE token=?',Date.now(),t);emailed=true;dispatch().catch(()=>{})}
 audit(u.username,ipOf(req),'partner.create','partner',name,{lanes:lanes.length,emailed});return {token:t,url,emailed}},'partners.manage');
route('GET','/api/partners',(req)=>{const base=pubBase(req);return q('SELECT * FROM partners ORDER BY created DESC').map(p=>({...p,lanes:pLanes(p),url:base+'/r/'+p.token,n:q1('SELECT COUNT(*) n FROM prates WHERE token=?',p.token).n,pending:q1("SELECT COUNT(*) n FROM prates WHERE token=? AND status='new'",p.token).n}))},'partners.manage');
route('PATCH','/api/partners/:token',async(req,u,P)=>{const b=await body(req);const p=q1('SELECT * FROM partners WHERE token=?',P.token);if(!p)throw E(404,'شریک یافت نشد');
 if(b.name)run('UPDATE partners SET name=? WHERE token=?',String(b.name).slice(0,120),P.token);if(b.email!=null)run('UPDATE partners SET email=? WHERE token=?',String(b.email).slice(0,160),P.token);
 if(Array.isArray(b.lanes))run('UPDATE partners SET lanes=? WHERE token=?',JSON.stringify(b.lanes.slice(0,40).filter(l=>l&&l.pol&&l.pod).map(l=>({mode:PMODE[l.mode]?l.mode:'sea',pol:String(l.pol).slice(0,80),pod:String(l.pod).slice(0,80),eq:String(l.eq||'').slice(0,20)}))),P.token);
 if(b.revoked!=null)run('UPDATE partners SET revoked=? WHERE token=?',b.revoked?1:0,P.token);audit(u.username,ipOf(req),'partner.update','partner',p.name,null);return {ok:true}},'partners.manage');
route('POST','/api/partners/:token/remind',(req,u,P)=>{const p=q1('SELECT * FROM partners WHERE token=? AND revoked=0',P.token);if(!p)throw E(404,'شریک یافت نشد');if(!p.email)throw E(400,'ایمیل شریک ثبت نشده');if(!CHANNELS.email())throw E(501,'SMTP تنظیم نشده');
 enqueue('partner.remind','email',p.email,pInviteText(p,pubBase(req)+'/r/'+p.token,false));run('UPDATE partners SET last_sent=? WHERE token=?',Date.now(),p.token);dispatch().catch(()=>{});return {ok:true}},'partners.manage');
route('GET','/api/partners/rates',(req)=>{const s=new URL(req.url,'http://x').searchParams;const st=s.get('status');const days=Math.min(400,+s.get('days')||60);
 return q(`SELECT id,partner,mode,pol,pod,eq,amt,cur,usd,valid,incl,days,note,ts,status FROM prates WHERE ts>? ${st&&st!=='all'?'AND status=?':''} ORDER BY id DESC LIMIT 1000`,...[Date.now()-days*864e5,...(st&&st!=='all'?[st]:[])])},'partners.manage');
route('POST','/api/partners/rates',async(req,u)=>{const b=await body(req);const st=b.status==='ok'?'ok':b.status==='rej'?'rej':null;if(!st)throw E(400,'وضعیت نامعتبر');const ids=(Array.isArray(b.ids)?b.ids:[]).map(Number).filter(Boolean).slice(0,500);
 const R=ids.map(id=>q1('SELECT * FROM prates WHERE id=?',id)).filter(Boolean);let added=0;
 if(st==='ok'){const A0=kvGet('ifa-rates');const A=Array.isArray(A0)?A0:[];for(const r of R){const id='PR-'+r.id;if(A.some(x=>x&&x.id===id))continue;A.unshift({id,mode:r.mode==='lcl'?'sea':r.mode,vendor:r.partner,pol:r.pol,pod:r.pod,eq:r.mode==='lcl'?'LCL':r.eq,amt:r.amt,cur:r.cur,from:new Date(r.ts).toISOString().slice(0,10),to:r.valid||'',src:'partner',incl:PINC[r.incl]||r.incl||'',note:[r.note,r.days?('T/T '+r.days+'d'):''].filter(Boolean).join(' · '),t:r.ts});added++}if(added)kvPut('ifa-rates',A,'partner-panel')}
 for(const r of R)run('UPDATE prates SET status=?,by=? WHERE id=?',st,u.username,r.id);audit(u.username,ipOf(req),'partner.rates.'+st,'prates',ids.join(',').slice(0,200),{added});return {ok:true,n:R.length,added}},'partners.manage');
