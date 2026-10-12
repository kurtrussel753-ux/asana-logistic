#!/usr/bin/env node
// Entry point: node src/index.js   (env: IFA_SERVER_URL, IFA_RUNTIME_TOKEN, RT_PORT, RT_DATA, RT_LLM_* | IFA_LLM_* | LITELLM_URL, LANGFUSE_*)
import {loadConfig} from './config.js';
import {ifaClient} from './ifa.js';
import {createTracer} from './tracing.js';
import {createEngine} from './engine.js';
import {createServer} from './server.js';

export async function startRuntime(env=process.env){
  const cfg=loadConfig(env);
  if(cfg.token.length<16)throw new Error('IFA_RUNTIME_TOKEN باید دست‌کم ۱۶ نویسه باشد (همان مقدار سرور)');
  const ifa=ifaClient({url:cfg.ifaUrl,token:cfg.token});
  const tracer=createTracer(cfg.langfuse);
  const engine=createEngine({cfg,ifa,tracer});
  const srv=createServer({cfg,ifa,tracer,engine});
  await new Promise(ok=>srv.listen(cfg.port,cfg.host,ok));
  engine.startPolling();
  const close=async()=>{engine.stop();await tracer.flush().catch(()=>{});await new Promise(ok=>srv.close(()=>ok()))};
  return {cfg,srv,engine,tracer,close,port:srv.address().port};
}

if(import.meta.url===`file://${process.argv[1]}`){
  startRuntime().then(r=>{console.log(`Asana agent runtime ${r.cfg.version} → http://${r.cfg.host}:${r.port} · IFA: ${r.cfg.ifaUrl} · model: ${r.cfg.llm?(r.cfg.llm.gateway||r.cfg.llm.kind)+':'+r.cfg.llm.model:'—'} · Langfuse: ${r.tracer.enabled?'on':'off'}`);
    const stop=s=>{console.log(s+' — stopping runtime');r.close().then(()=>process.exit(0))};process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'))})
  .catch(e=>{console.error('runtime:',e.message);process.exit(1)});
}
