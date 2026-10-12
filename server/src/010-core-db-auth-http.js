#!/usr/bin/env node
/* IFA Team Server — سرور سازمانی اطلس باری ایران
   بدون وابستگی خارجی · Node.js ≥ 22.5 (node:sqlite) · اجرا: node --experimental-sqlite --no-warnings server.js */
'use strict';
const http=require('node:http'),zlib=require('node:zlib'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'))}catch(e){console.error('این سرور به Node.js نسخهٔ 22.5 یا جدیدتر نیاز دارد. اجرا:\n  node --experimental-sqlite --no-warnings server.js');process.exit(1)}
const VERSION='1.19.0';
/* ---------- optional .env next to server.js (never served; real environment variables win) ---------- */
(()=>{const f=process.env.IFA_ENV_FILE===undefined?path.join(__dirname,'.env'):process.env.IFA_ENV_FILE;if(!f)return;try{if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){if(/^\s*(#|$)/.test(l))continue;const m=l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m)continue;let v=m[2];if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}catch(e){console.error('.env:',e.message)}})();
const CFG_FILE=process.env.IFA_CONFIG||path.join(__dirname,'config.json');
const DEF={port:8080,host:'0.0.0.0',dataDir:path.join(__dirname,'data'),secret:'',tokenHours:12,maxUploadMB:25,publicUrl:'',cors:'*',appFile:'',
 bale:{token:''},telegram:{token:''},kavenegar:{apiKey:'',sender:''},webhook:{url:'',secret:''},dcsa:{baseUrl:'',apiKey:'',header:'API-Key'},moadian:{submitUrl:'',authHeader:'',privateKeyFile:''},
 scheduler:{rateDays:3,overdueHours:24,everyMin:10}};
const CFG=(()=>{let f={};try{if(fs.existsSync(CFG_FILE))f=JSON.parse(fs.readFileSync(CFG_FILE,'utf8'))}catch(e){console.error('config.json نامعتبر:',e.message);process.exit(1)}
 const c={...DEF,...f};for(const k of ['bale','telegram','kavenegar','webhook','dcsa','moadian','scheduler'])c[k]={...DEF[k],...(f[k]||{})};
 const E=process.env;if(E.IFA_PORT)c.port=+E.IFA_PORT;if(E.IFA_HOST)c.host=E.IFA_HOST;if(E.IFA_DATA)c.dataDir=E.IFA_DATA;if(E.IFA_SECRET)c.secret=E.IFA_SECRET;if(E.IFA_PUBLIC_URL)c.publicUrl=E.IFA_PUBLIC_URL;
 if(E.IFA_BALE_TOKEN)c.bale.token=E.IFA_BALE_TOKEN;if(E.IFA_TELEGRAM_TOKEN)c.telegram.token=E.IFA_TELEGRAM_TOKEN;if(E.IFA_KAVENEGAR_KEY)c.kavenegar.apiKey=E.IFA_KAVENEGAR_KEY;if(E.IFA_KAVENEGAR_SENDER)c.kavenegar.sender=E.IFA_KAVENEGAR_SENDER;
 if(E.IFA_DCSA_URL)c.dcsa.baseUrl=E.IFA_DCSA_URL;if(E.IFA_DCSA_KEY)c.dcsa.apiKey=E.IFA_DCSA_KEY;return c})();
fs.mkdirSync(path.join(CFG.dataDir,'files'),{recursive:true});
if(!CFG.secret){const sf=path.join(CFG.dataDir,'.secret');if(!fs.existsSync(sf))fs.writeFileSync(sf,crypto.randomBytes(32).toString('hex'),{mode:0o600});CFG.secret=fs.readFileSync(sf,'utf8').trim()}

/* ---------- database ---------- */
const db=new DatabaseSync(path.join(CFG.dataDir,'ifa.db'));
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT,role TEXT NOT NULL,salt TEXT,hash TEXT,active INTEGER DEFAULT 1,tv INTEGER DEFAULT 0,phone TEXT,chat TEXT,created INTEGER,last_login INTEGER);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT,version INTEGER,updated_at INTEGER,updated_by TEXT);
CREATE TABLE IF NOT EXISTS kv_hist(id INTEGER PRIMARY KEY,key TEXT,version INTEGER,value TEXT,ts INTEGER,user TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts INTEGER,user TEXT,ip TEXT,action TEXT,entity TEXT,ref TEXT,detail TEXT,prev TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,job TEXT,name TEXT,mime TEXT,size INTEGER,sha256 TEXT,version INTEGER,tags TEXT,public INTEGER DEFAULT 0,by TEXT,ts INTEGER,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rules(id INTEGER PRIMARY KEY,event TEXT,channel TEXT,target TEXT,template TEXT,active INTEGER DEFAULT 1,created INTEGER,by TEXT);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,ts INTEGER,event TEXT,dedupe TEXT,channel TEXT,target TEXT,text TEXT,status TEXT,tries INTEGER DEFAULT 0,next_at INTEGER,err TEXT,sent INTEGER);
CREATE TABLE IF NOT EXISTS portal(token TEXT PRIMARY KEY,job TEXT,ship TEXT,scopes TEXT,note TEXT,created INTEGER,expires INTEGER,by TEXT,revoked INTEGER DEFAULT 0,views INTEGER DEFAULT 0,last_view INTEGER);
CREATE TABLE IF NOT EXISTS einv(id INTEGER PRIMARY KEY,inno TEXT,taxid TEXT,job TEXT,json TEXT,status TEXT,ts INTEGER,by TEXT,resp TEXT);
CREATE TABLE IF NOT EXISTS trackcache(ref TEXT PRIMARY KEY,ts INTEGER,json TEXT);
CREATE INDEX IF NOT EXISTS ix_files_job ON files(job,name);CREATE INDEX IF NOT EXISTS ix_out_st ON outbox(status,next_at);CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit(ts);`);
const q=(sql,...a)=>db.prepare(sql).all(...a),q1=(sql,...a)=>db.prepare(sql).get(...a),run=(sql,...a)=>db.prepare(sql).run(...a);

/* ---------- roles & permissions ---------- */
const ROLES={admin:'مدیر سیستم',manager:'مدیر',ops:'عملیات',finance:'مالی',sales:'فروش',viewer:'مشاهده‌گر'};
const PERM={'users.manage':['admin'],'audit.read':['admin','manager'],'files.write':['admin','manager','ops','finance','sales'],'files.delete':['admin','manager'],'notify.rules':['admin','manager'],'notify.send':['admin','manager','ops','sales'],
 'portal.create':['admin','manager','ops','sales'],'einv.submit':['admin','finance'],'track.query':['admin','manager','ops','sales','finance'],'backup':['admin'],'events.post':['admin','manager','ops','finance','sales']};
const KACL={'ifa-jobs':['admin','manager','ops','finance'],'ifa-pfx':['admin','manager','finance'],'ifa-rates':['admin','manager','sales','finance','ops'],'ifa-einv':['admin','manager','finance'],'ifa-einv-cfg':['admin','finance'],'ifa-wb':['admin','manager','ops'],'ifa-ship':['admin','manager','ops'],
 'ifa-crm':['admin','manager','sales'],'ifa-quotes':['admin','manager','sales'],'ifa-rfqx':['admin','manager','sales'],'ifa-sdec':['admin','manager','ops'],'ifa-sparties':['admin','manager','ops','sales'],'ifa-tar-ref':['admin','manager','ops','finance'],
 'ifa-leads':['admin','manager','sales'],'ifa-quo':['admin','manager','sales'],'ifa-ctr':['admin','manager','sales','finance'],'ifa-crd':['admin','manager','sales','finance'],'ifa-grt':['admin','manager','finance'],'ifa-com':['admin','manager','finance'],'ifa-acc':['admin','manager','finance'],'ifa-fxc':['admin','manager','finance','ops'],'ifa-clm':['admin','manager','ops','finance'],'ifa-tasks':['admin','manager','ops','sales','finance'],'ifa-jlog':['admin','manager','ops','sales','finance'],'ifa-jms':['admin','manager','ops','sales','finance'],'ifa-tpl':['admin','manager','ops','sales'],'ifa-pay':['admin','manager','finance']};
const KDEF=['admin','manager','ops'];
const can=(u,p)=>!!u&&(PERM[p]||[]).includes(u.role);
const canKey=(u,k)=>!!u&&(KACL[k]||KDEF).includes(u.role);
const KEYRE=/^ifa-[a-z0-9-]{1,40}$/;

/* ---------- crypto helpers ---------- */
const b64u=b=>Buffer.from(b).toString('base64url');
const hashPw=(pw,salt)=>crypto.scryptSync(String(pw),salt,64,{N:16384,r:8,p:1}).toString('hex');
function mkToken(u){const p=b64u(JSON.stringify({id:u.id,tv:u.tv,exp:Date.now()+CFG.tokenHours*3600e3}));return p+'.'+crypto.createHmac('sha256',CFG.secret).update(p).digest('base64url')}
function readToken(t){if(!t||!t.includes('.'))return null;const [p,s]=t.split('.');const g=crypto.createHmac('sha256',CFG.secret).update(p).digest('base64url');if(s.length!==g.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(g)))return null;
 let o;try{o=JSON.parse(Buffer.from(p,'base64url'))}catch(e){return null}if(o.exp<Date.now())return null;const u=q1('SELECT * FROM users WHERE id=?',o.id);if(!u||!u.active||u.tv!==o.tv)return null;return u}
const pub=u=>u&&({id:u.id,username:u.username,name:u.name,role:u.role,roleName:ROLES[u.role],active:!!u.active,phone:u.phone||'',chat:u.chat||'',created:u.created,last_login:u.last_login});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');

/* ---------- audit (hash chain) ---------- */
function audit(user,ip,action,entity,ref,detail){const last=q1('SELECT hash FROM audit ORDER BY id DESC LIMIT 1');const prev=last?last.hash:'GENESIS';const ts=Date.now();const d=JSON.stringify(detail??null);
 const h=sha(prev+'|'+JSON.stringify([ts,user||'',action,entity||'',ref||'',d]));run('INSERT INTO audit(ts,user,ip,action,entity,ref,detail,prev,hash) VALUES(?,?,?,?,?,?,?,?,?)',ts,user||'',ip||'',action,entity||'',ref||'',d,prev,h)}
function auditVerify(){let prev='GENESIS',n=0;for(const r of db.prepare('SELECT * FROM audit ORDER BY id').iterate()){const h=sha(prev+'|'+JSON.stringify([r.ts,r.user,r.action,r.entity,r.ref,r.detail]));if(r.prev!==prev||r.hash!==h)return {ok:false,brokenAt:r.id,checked:n};prev=r.hash;n++}return {ok:true,checked:n}}

/* ---------- bootstrap admin ---------- */
function setPw(id,pw){const salt=crypto.randomBytes(16).toString('hex');run('UPDATE users SET salt=?,hash=?,tv=tv+1 WHERE id=?',salt,hashPw(pw,salt),id)}
if(process.argv.includes('--reset-admin')){const pw=process.env.IFA_ADMIN_PASS||crypto.randomBytes(9).toString('base64url');let a=q1("SELECT * FROM users WHERE username='admin'");if(!a){run("INSERT INTO users(username,name,role,created) VALUES('admin','مدیر سیستم','admin',?)",Date.now());a=q1("SELECT * FROM users WHERE username='admin'")}run('UPDATE users SET active=1 WHERE id=?',a.id);setPw(a.id,pw);audit('cli','','user.reset','user','admin',null);console.log('رمز جدید admin:',pw);process.exit(0)}
if(!q1('SELECT id FROM users LIMIT 1')){const pw=process.env.IFA_ADMIN_PASS||crypto.randomBytes(9).toString('base64url');run("INSERT INTO users(username,name,role,created) VALUES('admin','مدیر سیستم','admin',?)",Date.now());setPw(q1("SELECT id FROM users WHERE username='admin'").id,pw);
 fs.writeFileSync(path.join(CFG.dataDir,'ADMIN_PASSWORD.txt'),'username: admin\npassword: '+pw+'\n(پس از اولین ورود رمز را تغییر دهید و این فایل را حذف کنید)\n',{mode:0o600});console.log('کاربر اولیه ساخته شد → admin / '+pw+(String(process.env.IFA_AUTH||'open').toLowerCase()==='password'?'':'  (حالت بدون رمز فعال است؛ این رمز فقط برای IFA_AUTH=password لازم است)'));audit('system','','bootstrap','user','admin',null)}

/* ---------- http helpers ---------- */
const LIM=CFG.maxUploadMB*1024*1024*1.4+65536;
function body(req){return new Promise((ok,no)=>{let n=0;const ch=[];req.on('data',c=>{n+=c.length;if(n>LIM){no(Object.assign(new Error('حجم درخواست بیش از حد مجاز است'),{code:413}));req.destroy()}else ch.push(c)});req.on('end',()=>{if(!n)return ok({});try{ok(JSON.parse(Buffer.concat(ch).toString('utf8')))}catch(e){no(Object.assign(new Error('JSON نامعتبر'),{code:400}))}});req.on('error',no)})}
function send(res,code,obj,hdr={}){const b=typeof obj==='string'||Buffer.isBuffer(obj)?obj:JSON.stringify(obj);res.writeHead(code,{'Content-Type':typeof obj==='string'?'text/html; charset=utf-8':Buffer.isBuffer(obj)?'application/octet-stream':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',...cors(),...hdr});res.end(b)}
const cors=()=>CFG.cors?{'Access-Control-Allow-Origin':CFG.cors,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}:{};
const E=(code,msg)=>Object.assign(new Error(msg),{code});
const ipOf=req=>(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'';
const FAILS=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kvGet=k=>{const r=q1('SELECT value FROM kv WHERE key=?',k);try{return r?JSON.parse(r.value):null}catch(e){return null}};

/* ---------- notifications ---------- */
const CHANNELS={log:()=>true,bale:()=>!!CFG.bale.token,telegram:()=>!!CFG.telegram.token,sms:()=>!!(CFG.kavenegar.apiKey&&CFG.kavenegar.sender),webhook:()=>!!CFG.webhook.url};
function render(t,d){return String(t||'{{type}} · {{ref}}').replace(/\{\{\s*([\w.]+)\s*\}\}/g,(m,k)=>{const v=k.split('.').reduce((o,x)=>o==null?o:o[x],d);return v==null?'':typeof v==='object'?JSON.stringify(v):String(v)})}
function enqueue(event,channel,target,text,dedupe){if(dedupe&&q1("SELECT id FROM outbox WHERE dedupe=? AND ts>?",dedupe,Date.now()-864e5))return 0;run('INSERT INTO outbox(ts,event,dedupe,channel,target,text,status,next_at) VALUES(?,?,?,?,?,?,?,?)',Date.now(),event,dedupe||null,channel,target,String(text).slice(0,3500),'pending',Date.now());return 1}
function fire(type,data,dedupe){const rs=q('SELECT * FROM rules WHERE active=1 AND (event=? OR event=?)',type,'*');let n=0;const d={type,...data,time:new Date().toLocaleString('fa-IR',{timeZone:'Asia/Tehran'})};
 for(const r of rs)n+=enqueue(type,r.channel,r.target,render(r.template,d),dedupe?dedupe+'|'+r.id:null);return n}
async function deliver(o){const T=o.target,txt=o.text;
 if(o.channel==='log')return;
 if(o.channel==='bale'||o.channel==='telegram'){const base=o.channel==='bale'?'https://tapi.bale.ai/bot':'https://api.telegram.org/bot';const tok=o.channel==='bale'?CFG.bale.token:CFG.telegram.token;const r=await fetch(base+tok+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:T,text:txt}),signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw new Error((j.description||('HTTP '+r.status)).slice(0,200));return}
 if(o.channel==='sms'){const u=`https://api.kavenegar.com/v1/${encodeURIComponent(CFG.kavenegar.apiKey)}/sms/send.json?receptor=${encodeURIComponent(T)}&sender=${encodeURIComponent(CFG.kavenegar.sender)}&message=${encodeURIComponent(txt)}`;const r=await fetch(u,{signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(!r.ok||(j.return&&j.return.status!==200))throw new Error(((j.return&&j.return.message)||('HTTP '+r.status)).slice(0,200));return}
 if(o.channel==='webhook'){const url=T&&/^https?:/.test(T)?T:CFG.webhook.url;const b=JSON.stringify({event:o.event,text:txt,ts:o.ts});const h={'Content-Type':'application/json'};if(CFG.webhook.secret)h['X-IFA-Signature']=crypto.createHmac('sha256',CFG.webhook.secret).update(b).digest('hex');const r=await fetch(url,{method:'POST',headers:h,body:b,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('HTTP '+r.status);return}
 throw new Error('کانال ناشناخته')}
let busy=false;
async function dispatch(){if(busy)return;busy=true;try{for(const o of q("SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY id LIMIT 20",Date.now())){
 if(!CHANNELS[o.channel]||!CHANNELS[o.channel]()){run("UPDATE outbox SET status='failed',err=? WHERE id=?",'کانال «'+o.channel+'» در config.json پیکربندی نشده',o.id);continue}
 try{await deliver(o);run("UPDATE outbox SET status='sent',sent=?,tries=tries+1,err=NULL WHERE id=?",Date.now(),o.id)}catch(e){const t=o.tries+1;run('UPDATE outbox SET tries=?,err=?,status=?,next_at=? WHERE id=?',t,String(e.message).slice(0,300),t>=5?'failed':'pending',Date.now()+t*t*60e3,o.id)}}}finally{busy=false}}
function schedule(){const S=CFG.scheduler,now=Date.now(),today=new Date().toISOString().slice(0,10);
 const rates=kvGet('ifa-rates')||[];for(const r of rates){if(!r.to)continue;const d=Math.round((Date.parse(r.to)-Date.parse(today))/864e5);if(d>=0&&d<=S.rateDays)fire('rate.expiring',{ref:r.id,vendor:r.vendor,lane:`${r.pol} → ${r.pod}`,eq:r.eq,amount:r.amt,cur:r.cur,to:r.to,days:d},'rate|'+r.id+'|'+today)}
 const ships=kvGet('ifa-ship')||[];for(const s of ships){const m=(s.ms||[]).find(x=>x.act==null);if(m&&m.pl&&now-m.pl>S.overdueHours*3600e3)fire('shipment.overdue',{ref:s.ref,name:s.name,ctr:s.ctr,milestone:m.n,planned:new Date(m.pl).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}),hours:Math.round((now-m.pl)/3600e3)},'ovd|'+s.id+'|'+m.id)}
 const dd=kvGet('ifa-dd-alerts')||[];for(const a of dd){const d=Math.round((Date.parse(a.freeEnd)-Date.parse(today))/864e5);if(d>=0&&d<=2)fire('demurrage.freetime',{ref:a.ref,ctr:a.ctr,freeEnd:a.freeEnd,days:d,perDay:a.perDay},'dd|'+a.ref+'|'+today)}}
setInterval(()=>dispatch().catch(()=>{}),15000);setInterval(()=>{try{schedule()}catch(e){console.error('scheduler',e.message)}},CFG.scheduler.everyMin*60e3);setTimeout(()=>{try{schedule()}catch(e){}},5000);

