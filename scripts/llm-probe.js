#!/usr/bin/env node
// Phase 0 — zero-dependency probe of the configured model endpoint (direct provider or LiteLLM gateway):
// checks auth, latency, NATIVE tool calling (tool_calls / tool_use), the tool-result round trip, JSON output and Persian.
// Reads RT_LLM_* → IFA_LLM_* → LITELLM_URL (same as runtime/src/config.js) and .env next to server.js. Costs a few hundred tokens.
// Usage: node scripts/llm-probe.js [--json]
'use strict';
const fs=require('fs'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch(e){}
const E=process.env,g=k=>E['RT_LLM_'+k]!=null&&E['RT_LLM_'+k]!==''?E['RT_LLM_'+k]:E['IFA_LLM_'+k];
let kind=String(g('PROVIDER')||'').toLowerCase(),url=String(g('URL')||''),model=g('MODEL')||'',key=g('KEY')||'';
if((!kind||kind==='litellm')&&E.LITELLM_URL){kind='openai';url=E.LITELLM_URL.replace(/\/+$/,'')+(/\/v1$/.test(E.LITELLM_URL)?'':'/v1');model=model||E.LITELLM_MODEL||'ifa-default';key=E.LITELLM_KEY||key||'sk-litellm'}
if(kind==='openai-compatible')kind='openai';
if(!kind||kind==='none'){console.error('هیچ مدلی تنظیم نشده است (RT_LLM_PROVIDER / IFA_LLM_PROVIDER / LITELLM_URL)');process.exit(2)}
const TOOL={name:'rates_search',description:'Search the freight rate bank for a lane',schema:{type:'object',properties:{pol:{type:'string'},pod:{type:'string'},eq:{type:'string'}},required:['pol','pod']}};
const RESULT={id:'S1',data:{n:3,median:2500,currency:'USD'}};
const Q='میانهٔ نرخ حمل یک کانتینر 40HC از Ningbo به Bandar Abbas چقدر است؟ حتماً از ابزار استفاده کن و عدد را با [S1] بیاور.';
async function post(u,h,b){const t0=Date.now();const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b),signal:AbortSignal.timeout((+g('TIMEOUT')||120)*1000)});const x=await r.text();let j;try{j=JSON.parse(x)}catch(e){j={_raw:x.slice(0,300)}}
 if(!r.ok)throw new Error('HTTP '+r.status+' — '+JSON.stringify(j.error||j._raw||j).slice(0,300));return {j,ms:Date.now()-t0}}
async function openai(){let b=(url||(kind==='ollama'?'http://127.0.0.1:11434':'https://api.openai.com/v1')).replace(/\/+$/,'').replace(/\/chat\/completions$/,'');if(kind==='ollama'&&!/\/v1$/.test(b))b+='/v1';
 const U=b+'/chat/completions',H={Authorization:'Bearer '+(key||'none')};const tools=[{type:'function',function:{name:TOOL.name,description:TOOL.description,parameters:TOOL.schema}}];
 const msgs=[{role:'system',content:'You are a freight analyst. Use tools for every number.'},{role:'user',content:Q}];
 const a=await post(U,H,{model,messages:msgs,tools,tool_choice:'auto',max_tokens:400,temperature:0});const m1=a.j.choices&&a.j.choices[0]&&a.j.choices[0].message||{};const tc=(m1.tool_calls||[])[0];
 const out={step1ms:a.ms,toolCall:!!tc,toolArgs:tc?tc.function.arguments:null,tokens:a.j.usage||null,served:a.j.model||model};
 if(tc){const b2=await post(U,H,{model,messages:[...msgs,{role:'assistant',content:m1.content||null,tool_calls:[tc]},{role:'tool',tool_call_id:tc.id,content:JSON.stringify(RESULT)}],tools,max_tokens:400,temperature:0});
  const txt=(b2.j.choices[0].message||{}).content||'';out.step2ms=b2.ms;out.answer=txt.slice(0,300);out.grounded=/2[,٬]?500|۲[,٬]?۵۰۰/.test(txt);out.persian=/[\u0600-\u06FF]/.test(txt)}
 const c=await post(U,H,{model,messages:[{role:'system',content:'Reply with JSON only.'},{role:'user',content:'Return {"ok":true,"echo":"سلام"}'}],max_tokens:100,temperature:0,...(g('JSON')==='0'?{}:{response_format:{type:'json_object'}})}).catch(e=>({err:e.message}));
 out.json=c.err?('error: '+c.err):/"ok"\s*:\s*true/.test(((c.j.choices||[])[0]||{message:{}}).message.content||'');return out}
async function anthropic(){let b=(url||'https://api.anthropic.com').replace(/\/+$/,'').replace(/\/messages$/,'');if(!/\/v1$/.test(b))b+='/v1';const U=b+'/messages';
 const H={'anthropic-version':'2023-06-01',...(g('AUTH')==='bearer'?{Authorization:'Bearer '+key}:{'x-api-key':key})};const tools=[{name:TOOL.name,description:TOOL.description,input_schema:TOOL.schema}];
 const msgs=[{role:'user',content:Q}];const a=await post(U,H,{model,max_tokens:400,system:'You are a freight analyst. Use tools for every number.',messages:msgs,tools});const tu=(a.j.content||[]).find(c=>c.type==='tool_use');
 const out={step1ms:a.ms,toolCall:!!tu,toolArgs:tu?JSON.stringify(tu.input):null,tokens:a.j.usage||null,served:a.j.model||model};
 if(tu){const b2=await post(U,H,{model,max_tokens:400,messages:[...msgs,{role:'assistant',content:a.j.content},{role:'user',content:[{type:'tool_result',tool_use_id:tu.id,content:JSON.stringify(RESULT)}]}],tools});
  const txt=(b2.j.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');out.step2ms=b2.ms;out.answer=txt.slice(0,300);out.grounded=/2[,٬]?500|۲[,٬]?۵۰۰/.test(txt);out.persian=/[\u0600-\u06FF]/.test(txt)}
 return out}
(async()=>{try{const r=kind==='anthropic'?await anthropic():await openai();const res={provider:kind,url:url||E.LITELLM_URL||'(default)',model,...r,
  verdict:r.toolCall&&r.grounded?'✅ آمادهٔ رانتایم (فراخوانی بومی ابزار + پاسخ مستند)':r.toolCall?'⚠️ ابزار فراخوانده شد ولی پاسخ نهایی عدد ابزار را نقل نکرد':'❌ این مدل/واسط فراخوانی بومی ابزار را برنگرداند — برای رانتایم مدل دیگری یا LiteLLM را امتحان کنید'};
 if(process.argv.includes('--json'))console.log(JSON.stringify(res,null,1));else{for(const [k,v] of Object.entries(res))console.log(k.padEnd(10),typeof v==='object'?JSON.stringify(v):v)}process.exit(r.toolCall?0:1)}
 catch(e){console.error('probe failed:',e.message);process.exit(1)}})();
