// HTTP API of the agent runtime (sidecar). Bearer IFA_RUNTIME_TOKEN for /v1/*, MCP keys for /mcp, /healthz is public.
import http from 'node:http';
import crypto from 'node:crypto';
import {askAgent} from './agents.js';
import {runFlow} from './workflows/flows.js';
import {handleMcp} from './mcp.js';

const send=(res,code,o)=>{if(res.headersSent)return;const b=JSON.stringify(o);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(b)};
const readBody=req=>new Promise((ok,ko)=>{let n=0;const B=[];req.on('data',d=>{n+=d.length;if(n>4e6){ko(Object.assign(new Error('درخواست بیش از حد بزرگ است'),{status:413}));req.destroy()}else B.push(d)});
  req.on('end',()=>{const s=Buffer.concat(B).toString('utf8');if(!s)return ok({});try{ok(JSON.parse(s))}catch{ko(Object.assign(new Error('JSON نامعتبر'),{status:400}))}});req.on('error',ko)});
const safeEq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b)};

export function createServer({cfg,ifa,tracer,engine}){
  const D={cfg,ifa,tracer,engine};
  return http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,'http://x');const p=u.pathname;
      if(p==='/healthz'&&req.method==='GET')return send(res,200,{ok:true,service:'asana-agent-runtime',version:cfg.version,engine:'mastra',
        model:cfg.llm?{provider:cfg.llm.gateway||cfg.llm.kind,model:cfg.llm.model,local:!!cfg.llm.local}:null,langfuse:tracer.stats(),workflows:engine.list().map(w=>w.id),waiting:engine.runs.waiting().length});
      if(p==='/mcp'){if(req.method!=='POST')return send(res,405,{jsonrpc:'2.0',error:{code:-32000,message:'Method not allowed (stateless Streamable HTTP: POST only)'},id:null});
        const b=await readBody(req);return await handleMcp(req,res,b,D)}
      if(!p.startsWith('/v1/'))return send(res,404,{error:'not found'});
      if(!safeEq((req.headers.authorization||'').replace(/^Bearer\s+/i,''),cfg.token))return send(res,401,{error:'unauthorized'});
      let m;
      if(req.method==='POST'&&(m=p.match(/^\/v1\/agents\/([\w-]+)\/ask$/))){const b=await readBody(req);if(!b.ctx||!b.question)return send(res,400,{error:'ctx و question لازم است'});
        return send(res,200,await askAgent({...D,agentId:m[1],ctx:b.ctx,question:String(b.question).slice(0,4000),by:b.by,task:b.task}))}
      if(req.method==='POST'&&p==='/v1/flows/run'){const b=await readBody(req);if(!b.ctx||!b.flow)return send(res,400,{error:'ctx و flow لازم است'});return send(res,200,await runFlow(D,b))}
      if(req.method==='GET'&&p==='/v1/workflows')return send(res,200,{workflows:engine.list()});
      if(req.method==='POST'&&(m=p.match(/^\/v1\/workflows\/([\w-]+)\/start$/))){const b=await readBody(req);return send(res,200,await engine.start(m[1],{by:b.by,role:b.role,input:b.input||{}}))}
      if(req.method==='GET'&&p==='/v1/runs')return send(res,200,{runs:engine.runs.list(100)});
      if(req.method==='GET'&&(m=p.match(/^\/v1\/runs\/([\w-]+)$/))){const r=engine.runs.get(m[1]);return r?send(res,200,r):send(res,404,{error:'اجرا یافت نشد'})}
      if(req.method==='POST'&&p==='/v1/hooks/approval'){const b=await readBody(req);const out=await engine.onApproval(+b.approval);return send(res,200,{ok:true,resumed:out.length,runs:out.map(r=>r&&{id:r.id,status:r.status})})}
      return send(res,404,{error:'not found'});
    }catch(e){const c=e.status&&e.status>=400&&e.status<600?(e.status===401||e.status===0?502:e.status):500;if(c>=500)console.error('runtime',e.message);send(res,c,{error:String(e.message||e).slice(0,500),policy:!!e.policy})}
  });
}
