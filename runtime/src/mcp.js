// Phase 6 — standards-complete MCP endpoint on the official TypeScript SDK (Streamable HTTP, stateless).
// Auth: the same `ifa_mcp_…` keys (or user tokens) as the server; the key's role/level/tool list is resolved by the server.
// Exposes: the key's server tools (hard ones → approval, as before) + ask_analyst (grounded Mastra agent) + workflow tools.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {toShape} from './schema.js';
import {askAgent} from './agents.js';

const txt=(o,isError=false)=>({content:[{type:'text',text:typeof o==='string'?o:JSON.stringify(o,null,1).slice(0,20000)}],...(o&&typeof o==='object'&&!Array.isArray(o)?{structuredContent:o}:{}),isError});

export async function handleMcp(req,res,parsed,{cfg,ifa,tracer,engine}){
  let id;try{id=await ifa.mcpAuth(String(req.headers.authorization||''))}catch(e){res.writeHead(401,{'Content-Type':'application/json','WWW-Authenticate':'Bearer'});return res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'Unauthorized: Bearer ifa_mcp_ key or IFA user token required'},id:null}))}
  const server=new McpServer({name:'asana-agent-runtime',title:'سامانه لجستیک آسانا — رانتایم عامل‌ها',version:cfg.version},{instructions:'ابزارهای دادهٔ IFA + پرسش از تحلیل‌گر (پاسخ مستند) + گردش‌کارهای دارای تأیید انسانی. اقدام‌های بیرونی/مالی فقط درخواست تأیید می‌سازند.'});
  for(const t of id.tools){
    server.registerTool(t.name,{description:(t.description+' · نوع: '+t.cls+(t.hard?' (نیازمند تأیید انسانی)':'')).slice(0,1000),inputSchema:toShape(t.schema),
      annotations:{readOnlyHint:['read','compute','web'].includes(t.cls),destructiveHint:false,openWorldHint:['web','external'].includes(t.cls)}},
      async args=>{try{const r=await ifa.call(id.ctx,t.name,args||{});return r.pending?txt('درخواست تأیید انسانی ثبت شد: #'+r.approval+' (کارتابل تأیید در IFA)'):txt(r.result??null)}catch(e){return txt('خطا: '+e.message,true)}});
  }
  server.registerTool('ask_analyst',{description:'پرسش فارسی از «تحلیل‌گر بازار» روی داده‌های IFA؛ هر عدد پاسخ با منبع ابزار سنجیده می‌شود (Mastra + AI SDK)',inputSchema:{question:z.string().describe('پرسش')},annotations:{readOnlyHint:true}},
    async({question})=>{try{const r=await askAgent({cfg,ifa,tracer,agentId:'analyst',ctx:id.ctx,question,by:id.who});return txt({answer:r.answer,grounded:r.grounded,sources:r.sources,model:r.model},!r.grounded)}catch(e){return txt('خطا: '+e.message,true)}});
  server.registerTool('workflow_start',{description:'شروع گردش‌کار رانتایم: procurement-rfq (استعلام با تأیید)، finance-payment (پرداخت با تأیید)، deep-research (پژوهش عمیق Tavily: {q, model})، lane-autopilot (خودکارگردان مسیر: {pol, dest, eq, web})',inputSchema:{workflow:z.enum(['procurement-rfq','finance-payment','deep-research','lane-autopilot']),input:z.record(z.string(),z.any())}},
    async({workflow,input})=>{try{if(!(id.workflows||[]).includes(workflow))return txt('دسترسی به ابزارهای این گردش‌کار برای این نقش یا کلید MCP مجاز نیست',true);return txt(await engine.start(workflow,{by:id.who,role:id.role,input}))}catch(e){return txt('خطا: '+e.message,true)}});
  server.registerTool('workflow_status',{description:'وضعیت یک اجرای گردش‌کار',inputSchema:{runId:z.string()},annotations:{readOnlyHint:true}},
    async({runId})=>{const r=engine.runs.get(runId);return r&&(id.role==='admin'||r.by===id.who)?txt(r):txt('یافت نشد یا دسترسی ندارید',true)});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close().catch(()=>{});server.close().catch(()=>{})});
  await server.connect(transport);await transport.handleRequest(req,res,parsed);
}
