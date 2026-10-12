/* ---------- server ---------- */
const PUB=path.join(__dirname,'public');
const appFile=()=>{if(CFG.appFile&&fs.existsSync(CFG.appFile))return CFG.appFile;if(fs.existsSync(path.join(PUB,'index.html')))return path.join(PUB,'index.html');
 const c=[__dirname,PUB].filter(d=>fs.existsSync(d)).flatMap(d=>fs.readdirSync(d).filter(f=>/^iran-freight-atlas.*\.html$/.test(f)).map(f=>path.join(d,f))).sort((a,b)=>path.basename(a).localeCompare(path.basename(b),undefined,{numeric:true}));return c.length?c[c.length-1]:null};
/* ---------- static assets (app shell, fonts, PWA) with gzip/brotli + ETag ---------- */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
const SCACHE=new Map();
function sendStatic(req,res,fp,cc){let st;try{st=fs.statSync(fp)}catch(e){return false}if(!st.isFile())return false;
 const key=fp+'|'+st.mtimeMs+'|'+st.size;let c=SCACHE.get(fp);if(!c||c.key!==key){const raw=fs.readFileSync(fp);const ext=path.extname(fp).toLowerCase();const z=/^\.(html|js|css|json|webmanifest|svg|txt)$/.test(ext);
  c={key,raw,type:MIME[ext]||'application/octet-stream',etag:'"'+crypto.createHash('sha1').update(raw).digest('base64url').slice(0,22)+'"',gz:z?zlib.gzipSync(raw,{level:9}):null,br:z?zlib.brotliCompressSync(raw,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9}}):null};SCACHE.set(fp,c)}
 const h={'Content-Type':c.type,'ETag':c.etag,'Cache-Control':cc,'Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN'};
 if(req.headers['if-none-match']===c.etag){res.writeHead(304,h);res.end();return true}
 const ae=String(req.headers['accept-encoding']||'');let b=c.raw;if(c.br&&/\bbr\b/.test(ae)){b=c.br;h['Content-Encoding']='br'}else if(c.gz&&/\bgzip\b/.test(ae)){b=c.gz;h['Content-Encoding']='gzip'}
 h['Content-Length']=b.length;res.writeHead(200,h);res.end(req.method==='HEAD'?undefined:b);return true}
function serveStatic(req,res,p){if(req.method!=='GET'&&req.method!=='HEAD')return false;
 if(p==='/'||p==='/index.html'){const f=appFile();return f?sendStatic(req,res,f,'no-cache'):false}
 let rel;try{rel=decodeURIComponent(p).replace(/^\/+/,'')}catch(e){return false}const fp=path.resolve(PUB,rel);if(!fp.startsWith(PUB+path.sep))return false;
 const cc=/^(sw\.js|manifest\.webmanifest)$/.test(rel)?'no-cache':/^fonts\//.test(rel)?'public, max-age=31536000, immutable':'public, max-age=86400';return sendStatic(req,res,fp,cc)}
const srv=http.createServer(async(req,res)=>{try{
 if(req.method==='OPTIONS')return send(res,204,'');const url=new URL(req.url,'http://x');const p=url.pathname;
 const pm=p.match(/^\/p\/([A-Za-z0-9_-]{20,40})(?:\/f\/(\d+))?$/);
 if(pm&&req.method==='GET'){const t=q1('SELECT * FROM portal WHERE token=?',pm[1]);if(!t||t.revoked||t.expires<Date.now())return send(res,404,'<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma;padding:40px;background:#141414;color:#eee">این پیوند معتبر نیست یا منقضی شده است.</body>');
  if(pm[2]){const f=q1('SELECT * FROM files WHERE id=? AND job=? AND public=1 AND deleted=0',+pm[2],t.job);if(!f)return send(res,404,{error:'سند یافت نشد'});audit('portal','','portal.download','file',f.job+'/'+f.name,null);return streamFile(res,f)}
  run('UPDATE portal SET views=views+1,last_view=? WHERE token=?',Date.now(),t.token);if(t.views===0)fire('portal.view',{ref:t.job});return send(res,200,portalPage(t),{'Cache-Control':'no-store'})}
 const rm=p.match(/^\/r\/([A-Za-z0-9_-]{20,40})$/);if(rm&&(req.method==='GET'||req.method==='POST'))return await partnerPublic(req,res,rm[1]);
 const qm=p.match(/^\/q\/([A-Za-z0-9_-]{16,40})$/);if(qm&&(req.method==='GET'||req.method==='POST'))return await rfqPublic(req,res,qm[1]);
 if(p==='/api/live/sanctions'&&(req.method==='GET'||req.method==='HEAD')){if(sendStatic(req,res,SFILE(),'no-cache'))return;return send(res,404,{error:'فهرست تحریم هنوز ساخته نشده است'})}
 if(p==='/mcp'&&req.method==='POST')return await mcpHandle(req,res);
 if(!p.startsWith('/api/')){if(serveStatic(req,res,p))return;if(p==='/favicon.ico')return send(res,204,'');return send(res,404,{error:'یافت نشد'})}
 for(const r of R){if(r.m!==req.method)continue;const m=p.match(r.re);if(!m)continue;let u=null;if(r.perm!==undefined){u=auth(req);need(u,r.perm||null)}
  const out=await r.f(req,u,m.groups||{},res);if(out===null)return;if(out&&out.__code){const c=out.__code;delete out.__code;return send(res,c,out)}return send(res,200,out)}
 send(res,404,{error:'مسیر API یافت نشد'})}catch(e){const c=e.code&&Number.isInteger(e.code)?e.code:500;if(c===500)console.error(e);if(!res.headersSent)send(res,c,{error:e.message||'خطای سرور'})}});
if(require.main===module){srv.listen(CFG.port,CFG.host,()=>console.log(`Asana Logistics Server ${VERSION} → http://${CFG.host}:${CFG.port}  (data: ${CFG.dataDir}, app: ${appFile()||'—'})`));
 const stop=sig=>{console.log('\n'+sig+' — در حال توقف امن سرور…');srv.close(()=>{try{db.close()}catch(e){}process.exit(0)});setTimeout(()=>{try{db.close()}catch(e){}process.exit(0)},5000).unref()};
 process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'))}
module.exports={srv,taxId,verhoeff,einvValidate,auditVerify,market:MKTP,p3:P3,p4:P4,p5:P5};
