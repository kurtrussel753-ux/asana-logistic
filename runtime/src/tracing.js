// Phase 2 — observability. Langfuse public ingestion API (traces, generations, spans), batched; a no-op when keys are not set.
// Prompts sent to tracing are the *masked* prompts (PII never leaves the server unmasked, also not to the tracer).
import crypto from 'node:crypto';
const uid=()=>crypto.randomUUID();
const iso=t=>new Date(t||Date.now()).toISOString();
const cap=(v,n=8000)=>{if(v==null)return v;const s=typeof v==='string'?v:JSON.stringify(v);return s.length>n?s.slice(0,n)+'…':(typeof v==='string'?v:JSON.parse(s))};

export function createTracer({host,publicKey,secretKey,release}={},{flushMs=2000}={}){
  const enabled=!!(host&&publicKey&&secretKey);const Q=[];let timer=null;let sent=0,errors=0;
  const push=(type,body)=>{if(!enabled)return;Q.push({id:uid(),type,timestamp:iso(),body});if(Q.length>=50)flush();else if(!timer){timer=setTimeout(flush,flushMs);timer.unref?.()}};
  async function flush(){if(timer){clearTimeout(timer);timer=null}if(!enabled||!Q.length)return;const batch=Q.splice(0,Q.length);
    try{const r=await fetch(host+'/api/public/ingestion',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(publicKey+':'+secretKey).toString('base64')},body:JSON.stringify({batch,metadata:{sdk:'asana-agent-runtime'}}),signal:AbortSignal.timeout(10000)});
      if(!r.ok)errors++;else sent+=batch.length}catch{errors++}}
  function trace({name,input,userId,sessionId,metadata,tags}={}){
    const id=uid();push('trace-create',{id,name,input:cap(input),userId:userId||undefined,sessionId:sessionId||undefined,metadata,tags,release,timestamp:iso()});
    const obs=parent=>({
      generation(g){const gid=uid();push('generation-create',{id:gid,traceId:id,parentObservationId:parent||undefined,name:g.name||'llm',startTime:iso(g.start),endTime:iso(g.end),model:g.model,input:cap(g.input),output:cap(g.output),
        usage:g.usage?{input:g.usage.input||0,output:g.usage.output||0,total:(g.usage.input||0)+(g.usage.output||0),unit:'TOKENS'}:undefined,metadata:g.metadata,level:g.level||'DEFAULT',statusMessage:g.statusMessage});return gid},
      span(s){const sid=uid();push('span-create',{id:sid,traceId:id,parentObservationId:parent||undefined,name:s.name,startTime:iso(s.start),endTime:iso(s.end||Date.now()),input:cap(s.input),output:cap(s.output),metadata:s.metadata,level:s.level||'DEFAULT',statusMessage:s.statusMessage});return {id:sid,...obs(sid)}},
    });
    return {id,...obs(null),update(o){push('trace-create',{id,...o,output:cap(o.output)})},end(o={}){push('trace-create',{id,output:cap(o.output),metadata:o.metadata,tags:o.tags})}};
  }
  return {enabled,trace,flush,stats:()=>({enabled,sent,errors,queued:Q.length})};
}
