set -e
cd /data/atlas/src/p5 && cat a_core.js b_domain.js c_ops.js d_tools.js e_agents.js f_orch.js g_ai.js h_open.js ../shared/calc.js i_flow.js j_conn.js ../shared/inv.js k_actual.js l_iran.js m_aprun.js n_plan.js o_web.js p_web2.js q_web3.js r_runtime.js > ../p5.js
cd /data/atlas && cp src/server.v158.js ifa/server.js && python3 - <<'P'
p='/data/atlas/ifa/server.js';s=open(p,encoding='utf8').read()
m=open('/data/atlas/src/p5.js',encoding='utf8').read()
a='/* ---------- server ---------- */'
s=s.replace(a,m+'\n'+a)
envl='''/* ---------- optional .env next to server.js (never served; real environment variables win) ---------- */
(()=>{const f=process.env.IFA_ENV_FILE===undefined?path.join(__dirname,'.env'):process.env.IFA_ENV_FILE;if(!f)return;try{if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\\r?\\n/)){if(/^\\s*(#|$)/.test(l))continue;const m=l.match(/^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$/);if(!m)continue;let v=m[2];if(/^(['"]).*\\1$/.test(v))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}catch(e){console.error('.env:',e.message)}})();
'''
c='const CFG_FILE='
assert s.count(c)==1
s=s.replace(c,envl+c)
s=s.replace("const VERSION='1.7.0';","const VERSION='1.18.0';")
b=" if(!p.startsWith('/api/')){if(serveStatic"
s=s.replace(b," if(p==='/mcp'&&req.method==='POST')return await mcpHandle(req,res);\n"+b)
s=s.replace("market:MKTP,p3:P3,p4:P4};","market:MKTP,p3:P3,p4:P4,p5:P5};")
h="live:{fx:CFG.live?CFG.live.fx.market:null}}));"
assert s.count(h)==1
s=s.replace(h,"live:{fx:CFG.live?CFG.live.fx.market:null},auth:AUTHM.mode,openScope:AUTHM.scope}));")
x="console.log('کاربر اولیه ساخته شد → admin / '+pw);"
assert s.count(x)==1
s=s.replace(x,"console.log('کاربر اولیه ساخته شد → admin / '+pw+(String(process.env.IFA_AUTH||'open').toLowerCase()==='password'?'':'  (حالت بدون رمز فعال است؛ این رمز فقط برای IFA_AUTH=password لازم است)'));")
# --- brand: سامانه لجستیک آسانا
for x,y in [("subject:rest.length?sub:'اطلس باربری ایران · '","subject:rest.length?sub:'سامانه لجستیک آسانا · '"),("Iran Freight Atlas · RFQ","Asana Logistics · سامانه لجستیک آسانا · RFQ"),("Iran Freight Atlas · Partner rate panel","Asana Logistics · Partner rate panel"),("· Iran Freight Atlas\\n","· Asana Logistics\\n"),("console.log(`IFA Team Server ","console.log(`Asana Logistics Server ")]:
    assert s.count(x)>=1,x;s=s.replace(x,y)
s=s.replace('<meta name="robots" content="noindex">','<meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">')
s=s.replace('</head><body><main>','</head><body><main><div style="display:flex;align-items:center;gap:10px;margin:0 0 14px"><img src="/icons/icon.svg" width="34" height="34" alt="" style="border-radius:8px"><b style="font-size:15px">سامانه لجستیک آسانا</b></div>')
open(p,'w',encoding='utf8').write(s)
P
cd ifa && node --check server.js && echo SYNTAX_OK
