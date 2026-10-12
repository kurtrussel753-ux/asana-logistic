/* ---------- 1) FX: official cross rates + Iranian free-market rial ---------- */
async function fxMarket(){const M=CFG.live.fx.market;if(!M||M==='none')return null;
 if(M==='navasan'){if(!CFG.live.fx.navasanKey)throw new Error('navasanKey تنظیم نشده');const j=await getJ('https://api.navasan.tech/latest/?api_key='+encodeURIComponent(CFG.live.fx.navasanKey));
  const g=k=>j[k]&&num(j[k].value)*10;/* navasan = toman */return {src:'navasan.tech',ts:Date.now(),USD:g('usd_sell')||g('usd'),EUR:g('eur'),AED:g('aed_sell')||g('aed'),CNY:g('cny'),TRY:g('try'),RUB:g('rub'),GBP:g('gbp')}}
 if(/^https?:/.test(M)){const j=await getJ(M);return {src:M.replace(/^https?:\/\//,'').split('/')[0],ts:Date.now(),...j}}
 const j=await getJ('https://call1.tgju.org/ajax.json');const c=j.current||{};const g=k=>c[k]?num(c[k].p):0;
 const o={src:'tgju.org',ts:Date.parse(((c.price_dollar_rl||{}).ts||'').replace(' ','T')+'+03:30')||Date.now(),USD:g('price_dollar_rl'),EUR:g('price_eur'),AED:g('price_aed'),CNY:g('price_cny'),TRY:g('price_try'),RUB:g('price_rub'),GBP:g('price_gbp'),brent:+(c.oil_brent&&c.oil_brent.p)||null,goldCoin:g('sekee')};
 if(!(o.USD>10000))throw new Error('نرخ بازار نامعتبر');return o}
async function fxLive(force){const C=cGet('fx',force?0:CFG.live.fx.everyMin*60e3);if(C)return C;
 let off=cGet('fx-off',6*3600e3),mk=null,errs=[];
 if(!off){try{const j=await getJ(CFG.live.fx.official);if(!j.rates||!j.rates.EUR)throw new Error('پاسخ نامعتبر');off={rates:j.rates,upd:j.time_last_update_utc||'',src:'open.er-api.com'}}
  catch(e){errs.push(e.message);try{const j=await getJ(CFG.live.fx.fallback);off={rates:{USD:1,...j.rates},upd:j.date,src:'frankfurter.app'}}catch(e2){errs.push(e2.message)}}if(off)cSet('fx-off',off)}
 off=off||cGet('fx-off',null);try{mk=await fxMarket()}catch(e){errs.push('market: '+e.message);const p=cGet('fx',null);mk=p&&p.market||null}
 if(!off&&!mk)throw new Error(errs.join(' · ')||'منبع ارز در دسترس نیست');
 const out={result:'success',source:'ifa-live',time_last_update_utc:off?off.upd:new Date().toUTCString(),src:[off&&off.src,mk&&mk.src].filter(Boolean).join(' + '),rates:off?off.rates:{USD:1},market:mk,fetched:Date.now(),errors:errs};
 cSet('fx',out);if(mk)for(const k of ['USD','EUR','AED','CNY','TRY'])if(mk[k])run('INSERT INTO fx_hist(ts,cur,rate,src) VALUES(?,?,?,?)',Date.now(),k,mk[k],mk.src);
 const prev=cGet('fx-last-alert',null);if(mk&&mk.USD&&prev&&prev.USD&&Math.abs(mk.USD-prev.USD)/prev.USD>=.03)fire('fx.jump',{ref:'USD',rate:mk.USD.toLocaleString('en-US'),prev:prev.USD.toLocaleString('en-US'),pct:((mk.USD-prev.USD)/prev.USD*100).toFixed(1)},'fx|'+new Date().toISOString().slice(0,13));
 if(mk&&mk.USD&&(!prev||Math.abs(mk.USD-prev.USD)/prev.USD>=.03))cSet('fx-last-alert',{USD:mk.USD});
 lstat('fx',true,out.src);return out}

/* ---------- 2) Roads: live weather watch on critical passes, corridors & borders ---------- */
const ROADPTS=[['HRZ','محور هراز (پلور–رینه)',35.85,52.06],['FRZ','محور فیروزکوه (گدوک)',35.95,52.92],['CHL','جادهٔ چالوس (کندوان)',36.33,51.33],['HYR','گردنهٔ حیران (آستارا–اردبیل)',38.40,48.62],
 ['SAN','گردنهٔ صائین (سراب–نیر)',38.15,47.95],['ASD','گردنهٔ اسدآباد (همدان–کرمانشاه)',34.78,48.15],['QSH','گردنهٔ قوشچی (ارومیه–سلماس)',37.99,45.03],['ZAG','گردنهٔ زاغه (خرم‌آباد–بروجرد)',33.50,48.70],
 ['MNJ','محور قزوین–رشت (منجیل)',36.74,49.40],['ZNJ','آزادراه زنجان–تبریز',36.90,48.20],['MZD','محور مشهد–سرخس (مزدوران)',36.15,60.53],['BND','محورهای بندرعباس',27.18,56.27],['AHZ','محور اهواز–شلمچه',31.10,48.30],['CHB','محور چابهار–زاهدان',26.30,60.90],
 ['BZG','مرز بازرگان',39.39,44.39],['SRK','مرز سرخس',36.54,61.16],['AST','مرز آستارا',38.43,48.87],['JLF','مرز جلفا',38.94,45.63],['NRD','مرز نوردوز',38.86,46.20],['BLS','مرز بیله‌سوار',39.37,48.35],
 ['MRJ','مرز میرجاوه',29.02,61.45],['INB','مرز اینچه‌برون',37.45,54.72],['LTF','مرز لطف‌آباد',37.52,59.33],['DGH','مرز دوغارون',34.66,61.07],['MHR','مرز مهران',33.12,46.16],['TMR','مرز تمرچین',36.67,45.13],['BSH','مرز باشماق',35.62,46.03],['SRO','مرز سرو',37.75,44.62]];
const WMO={45:'مه',48:'مه یخ‌زده',51:'نم‌نم باران',61:'باران',63:'باران',65:'باران شدید',66:'باران یخ‌زده',67:'باران یخ‌زده شدید',71:'برف',73:'برف',75:'برف سنگین',77:'دانهٔ برف',80:'رگبار',81:'رگبار',82:'رگبار شدید',85:'رگبار برف',86:'رگبار برف شدید',95:'توفان تندری',96:'توفان تندری با تگرگ',99:'توفان تندری با تگرگ'};
function wxAssess(H,i0){const n=Math.min(H.time.length,i0+48);let snow=0,rain24=0,tmin=99,tmax=-99,gust=0,vis=1e9,tSnow=null,tGust=null,tVis=null,tIce=null,tHeat=null,frz=0,run3=0,fogRun=0;const F=(n,d=0)=>(+n).toLocaleString('fa-IR',{maximumFractionDigits:d});
 for(let i=i0;i<n;i++){const s=H.snowfall[i]||0,p=H.precipitation[i]||0,t=H.temperature_2m[i],g=H.wind_gusts_10m[i]||0,v=H.visibility?H.visibility[i]:null;const tt=Date.parse(H.time[i]+'Z')-3.5*3600e3;
  snow+=s;if(i<i0+24)rain24+=p;if(s>=.3&&tSnow==null)tSnow=tt;if(t<tmin)tmin=t;if(t>tmax){tmax=t;if(t>=45)tHeat=tt}if(g>gust){gust=g;if(g>=60)tGust=tGust||tt}if(v!=null){if(v<300){run3++;if(run3>fogRun)fogRun=run3;if(run3>=3)tVis=tVis||tt}else run3=0;if(v<vis)vis=v}
  if(t<=-1&&p>0){frz++;tIce=tIce||tt}if([66,67,56,57].includes(H.weather_code[i])){frz++;tIce=tIce||tt}}
 const A=[];let lvl=0;const at=t=>t?' از '+faDT(t):'';
 if(snow>=10){A.push(`برف سنگین ${F(snow)} سانتی‌متر در ۴۸ ساعت آینده${at(tSnow)} — احتمال انسداد؛ زنجیر چرخ الزامی`);lvl=Math.max(lvl,3)}
 else if(snow>=1){A.push(`بارش برف ${F(snow,1)} سانتی‌متر${at(tSnow)} — زنجیر چرخ همراه داشته باشید`);lvl=Math.max(lvl,2)}
 if(frz||tmin<=-8){A.push(`یخبندان و لغزندگی (کمینه ${F(tmin)}°C)${at(tIce)}`);lvl=Math.max(lvl,frz?2:1)}
 if(gust>=60){A.push(`تندباد تا ${F(gust)} km/h${at(tGust)} — خطر واژگونی برای تریلی خالی/چادری`);lvl=Math.max(lvl,gust>=80?3:2)}
 if(fogRun>=3){A.push(`مه و کاهش دید (کمینه ${F(vis)} متر، ${F(fogRun)} ساعت پیاپی)${at(tVis)}`);lvl=Math.max(lvl,vis<100&&fogRun>=5?2:1)}
 if(rain24>=25){A.push(`بارش شدید ${F(rain24)} میلی‌متر در ۲۴ ساعت — احتمال آبگرفتگی/سیلاب`);lvl=Math.max(lvl,rain24>=50?3:2)}
 if(tmax>=45){A.push(`گرمای شدید ${F(tmax)}°C${at(tHeat)} — حرکت در ساعات خنک، مراقبت از بار حساس و لاستیک`);lvl=Math.max(lvl,1)}
 return {lvl,alerts:A,snow:+snow.toFixed(1),rain24:+rain24.toFixed(1),tmin,tmax,gust,vis:vis===1e9?null:vis}}
async function weatherFor(pts){const out=[];for(let i=0;i<pts.length;i+=50){const P=pts.slice(i,i+50);
  const u='https://api.open-meteo.com/v1/forecast?latitude='+P.map(p=>(+p[2]).toFixed(3)).join(',')+'&longitude='+P.map(p=>(+p[3]).toFixed(3)).join(',')+
   '&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,snowfall,visibility&hourly=temperature_2m,precipitation,snowfall,wind_gusts_10m,visibility,weather_code&forecast_days=3&timezone=Asia%2FTehran';
  let j=await getJ(u);if(!Array.isArray(j))j=[j];
  j.forEach((w,k)=>{const p=P[k];const H=w.hourly;const now=w.current||{};let i0=H.time.findIndex(t=>t>=String(now.time||'').slice(0,13));if(i0<0)i0=0;const a=wxAssess(H,i0);
   out.push({id:p[0],name:p[1],lat:p[2],lng:p[3],now:{t:now.temperature_2m,code:now.weather_code,desc:WMO[now.weather_code]||'',wind:now.wind_speed_10m,gust:now.wind_gusts_10m,vis:now.visibility,snow:now.snowfall,precip:now.precipitation},...a})})}
 return out}
const season=()=>{const m=new Date().getMonth()+1;return m===12||m<=2?'زمستان':m>=6&&m<=8?'تابستان':'همهٔ سال'};
function roadRows(W,t){return W.filter(w=>w.lvl>0).map(w=>({id:'LIVE-'+w.id,route:w.name,season:season(),kind:['','آب‌وهوا (زنده) · توجه','آب‌وهوا (زنده) · هشدار','آب‌وهوا (زنده) · خطر جدی'][w.lvl],
 note:w.alerts.join(' · '),src:'زنده · Open-Meteo · '+faDT(t),chk:new Date(t).toISOString().slice(0,10),live:1,lvl:w.lvl}))}
async function roadsLive(force){const C=cGet('roads',force?0:CFG.live.weather.everyMin*60e3);if(C)return C;
 const W=await weatherFor(ROADPTS);const t=Date.now();const out={fetched:t,src:'open-meteo.com',points:W,rows:roadRows(W,t)};cSet('roads',out);lstat('roads',true,out.rows.length+' هشدار');
 /* publish into the shared «محدودیت مسیر» dataset — keeps user rows, replaces live rows */
 try{const cur=kvGet('ifa-rtn');const arr=Array.isArray(cur)?cur:[];const base=arr.filter(r=>!(r&&String(r.id||'').startsWith('LIVE-')));const sig=a=>JSON.stringify(a.map(r=>[r.id,r.kind,r.note]));
  if(sig(arr.filter(r=>r&&String(r.id||'').startsWith('LIVE-')))!==sig(out.rows))kvPut('ifa-rtn',[...out.rows,...base])}catch(e){console.error('roads kv',e.message)}
 const day=new Date().toISOString().slice(0,10);for(const r of out.rows)if(r.lvl>=2)fire('road.alert',{ref:r.route,route:r.route,alerts:r.note,level:r.lvl},'road|'+r.id+'|'+day+'|'+r.lvl);
 return out}

/* ---------- 3) Routing: real road distance/time (OSRM table / OpenRouteService) ---------- */
async function routeMatrix(pts){if(!Array.isArray(pts)||pts.length<2||pts.length>100)throw E(400,'۲ تا ۱۰۰ نقطه لازم است');pts=pts.map(p=>[+(+p[0]).toFixed(4),+(+p[1]).toFixed(4)]);if(pts.some(p=>!isFinite(p[0])||!isFinite(p[1])))throw E(400,'مختصات نامعتبر');
 const key='mx|'+sha(JSON.stringify(pts)).slice(0,24);const C=cGet(key,30*864e5);if(C)return {...C,cached:true};let km,min,src;
 if(CFG.live.routing.orsKey){const j=await getJ('https://api.openrouteservice.org/v2/matrix/driving-hgv',{method:'POST',timeout:60000,headers:{'Content-Type':'application/json',Authorization:CFG.live.routing.orsKey},body:JSON.stringify({locations:pts.map(p=>[p[1],p[0]]),metrics:['distance','duration']})});
  km=j.distances.map(r=>r.map(v=>v==null?null:Math.round(v/100)/10));min=j.durations.map(r=>r.map(v=>v==null?null:Math.round(v/60)));src='openrouteservice (HGV)'}
 else{const j=await getJ(CFG.live.routing.osrmUrl.replace(/\/$/,'')+'/table/v1/driving/'+pts.map(p=>p[1]+','+p[0]).join(';')+'?annotations=distance,duration',{timeout:60000});if(j.code!=='Ok')throw new Error('OSRM: '+j.code);
  km=j.distances.map(r=>r.map(v=>v==null?null:Math.round(v/100)/10));min=j.durations.map(r=>r.map(v=>v==null?null:Math.round(v/60)));src='OSRM'}
 const out={src,fetched:Date.now(),km,min};cSet(key,out);lstat('routing',true,src);return out}

/* ---------- 4) Sanctions: OFAC SDN + Non-SDN, UN Security Council, EU — rebuilt daily ---------- */
function csvRows(t,sep=','){const R=[];let row=[],cur='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
  else if(ch==='"')q=true;else if(ch===sep){row.push(cur);cur=''}else if(ch==='\n'){row.push(cur.replace(/\r$/,''));R.push(row);row=[];cur=''}else cur+=ch}
 if(cur||row.length){row.push(cur);R.push(row)}return R}
const nz=v=>{v=String(v==null?'':v).trim();return v==='-0-'?'':v};
async function ofacList(code,prim,alt,add){const base='https://www.treasury.gov/ofac/downloads/';const [P,A,D]=await Promise.all([prim,alt,add].map(f=>getT(base+f)));
 const al=new Map(),cn=new Map();csvRows(A).forEach(r=>{const id=r[0],n=nz(r[3]);if(id&&n){if(!al.has(id))al.set(id,[]);al.get(id).push(n)}});
 csvRows(D).forEach(r=>{const id=r[0],c=nz(r[4]);if(id&&c){if(!cn.has(id))cn.set(id,new Set());cn.get(id).add(c)}});
 return csvRows(P).filter(r=>r.length>3&&nz(r[1])).map(r=>{const ty=nz(r[2]).toLowerCase();return [code,ty==='individual'?'i':ty==='vessel'?'v':ty==='aircraft'?'a':'e',nz(r[1]),nz(r[3]).replace(/[\[\]]/g,' ').replace(/\s+/g,' ').trim(),al.get(r[0])||[],[...(cn.get(r[0])||[])]]})}
async function unList(){const x=await getT('https://scsanctions.un.org/resources/xml/en/consolidated.xml');const tag=(b,t)=>{const m=b.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>'));return m?m[1].trim():''};
 const all=(b,t)=>[...b.matchAll(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>','g'))].map(m=>m[1].trim());const dec=s=>s.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');const out=[];
 for(const [blk,ty] of [['INDIVIDUAL','i'],['ENTITY','e']])for(const m of x.matchAll(new RegExp('<'+blk+'>([\\s\\S]*?)</'+blk+'>','g'))){const b=m[1];
  const name=dec(['FIRST_NAME','SECOND_NAME','THIRD_NAME','FOURTH_NAME'].map(t=>tag(b,t)).filter(Boolean).join(' '));if(!name)continue;
  const aliases=all(b,'ALIAS_NAME').map(dec).filter(Boolean);const cs=new Set([...all(b,'COUNTRY'),...[...b.matchAll(/<NATIONALITY>[\s\S]*?<VALUE>([^<]+)<\/VALUE>/g)].map(z=>z[1])].map(s=>dec(s).trim()).filter(Boolean));
  out.push(['U',ty,name.toUpperCase(),tag(b,'UN_LIST_TYPE'),aliases.map(a=>a.toUpperCase()),[...cs]])}return out}
async function euList(){const t=await getT('https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',{timeout:180000});const R=csvRows(t,';');const H=R.shift().map(h=>h.trim());const ix=n=>H.indexOf(n);
 const I={id:ix('Entity_LogicalId'),ty:ix('Entity_SubjectType'),pg:ix('Entity_Regulation_Programme'),wn:ix('NameAlias_WholeName'),ln:ix('NameAlias_NameLanguage'),c1:ix('Address_CountryDescription'),c2:ix('Citizenship_CountryDescription')};const M=new Map();
 for(const r of R){const id=r[I.id];if(!id)continue;let e=M.get(id);if(!e){e={ty:r[I.ty]==='P'?'i':'e',pg:r[I.pg]||'',names:[],cs:new Set()};M.set(id,e)}const n=(r[I.wn]||'').trim();if(n&&!e.names.some(x=>x[0]===n))e.names.push([n,/^(EN|)$/.test((r[I.ln]||'').trim())?0:1]);
  for(const c of [r[I.c1],r[I.c2]])if(c&&c.trim()&&!/UNKNOWN/i.test(c))e.cs.add(c.trim().toLowerCase().replace(/(^|[\s(,-])\w/g,m=>m.toUpperCase()))}
 return [...M.values()].filter(e=>e.names.length).map(e=>{const N=e.names.map((x,i)=>[...x,i]).sort((a,b)=>a[1]-b[1]||a[2]-b[2]).map(x=>x[0]);return ['E',e.ty,N[0],e.pg,N.slice(1,13),[...e.cs]]})}
const SFILE=()=>path.join(CFG.dataDir,'sanctions.json');let SBUSY=null;
async function sanctionsBuild(){if(SBUSY)return SBUSY;SBUSY=(async()=>{const parts={},errs=[];
  const jobs=[['O',()=>ofacList('O','sdn.csv','alt.csv','add.csv')],['C',()=>ofacList('C','consolidated/cons_prim.csv','consolidated/cons_alt.csv','consolidated/cons_add.csv')],['U',unList]];if(CFG.live.sanctions.eu)jobs.push(['E',euList]);
  for(const [k,f] of jobs){try{parts[k]=await f()}catch(e){errs.push(k+': '+e.message)}}
  let prev=null;try{prev=JSON.parse(fs.readFileSync(SFILE(),'utf8'))}catch(e){}
  for(const k of Object.keys(parts))if(parts[k].length<(k==='C'?50:300)){errs.push(k+': تعداد رکورد مشکوک ('+parts[k].length+')');delete parts[k]}
  for(const k of ['O','C','U','E'])if(!parts[k]&&prev)parts[k]=prev.d.filter(e=>e[0]===k);
  const d=[].concat(...['O','C','U','E'].map(k=>parts[k]||[]));if(d.length<1000)throw new Error('ساخت فهرست ناموفق: '+errs.join(' · '));
  const counts={};d.forEach(e=>counts[e[0]]=(counts[e[0]]||0)+1);const J={m:{date:new Date().toISOString().slice(0,10),counts,src:'live',built:Date.now(),errors:errs},d};
  fs.writeFileSync(SFILE()+'.tmp',JSON.stringify(J));fs.renameSync(SFILE()+'.tmp',SFILE());lstat('sanctions',true,d.length+' رکورد');
  audit('system','','sanctions.update','sanctions','',{counts,errors:errs});return J.m})().catch(e=>{lstat('sanctions',false,e.message);throw e}).finally(()=>{SBUSY=null});return SBUSY}
const sanctionsMeta=()=>{try{const st=fs.statSync(SFILE());const fd=fs.openSync(SFILE(),'r');const b=Buffer.alloc(8192);const n=fs.readSync(fd,b,0,8192,0);fs.closeSync(fd);const h=b.slice(0,n).toString('utf8');const m=JSON.parse(h.slice(5,h.indexOf(',"d":')));return {...m,bytes:st.size}}catch(e){return null}};

