// Client for the server's runtime bridge (/api/runtime/*, shared-secret header). The server stays the policy engine and system of record.
export class IfaError extends Error{constructor(msg,status,body){super(msg);this.status=status;this.body=body||{};this.policy=!!(body&&body.policy);this.cancelled=!!(body&&body.cancelled)}}

export function ifaClient({url,token,timeoutMs=120000}){
  const req=async(method,p,b,t=timeoutMs)=>{
    let r;try{r=await fetch(url+p,{method,headers:{'Content-Type':'application/json','X-IFA-Runtime-Token':token},body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(t)})}
    catch(e){throw new IfaError('سرور IFA در دسترس نیست: '+(e.cause&&e.cause.code||e.message),0)}
    const x=await r.text();let j;try{j=JSON.parse(x)}catch{j={error:x.slice(0,300)}}
    if(!r.ok)throw new IfaError(String(j.error||('IFA HTTP '+r.status)),r.status,j);return j};
  let defs={at:0,v:null};
  return {
    url,
    async agents(force){if(!force&&defs.v&&Date.now()-defs.at<60e3)return defs.v;defs={at:Date.now(),v:(await req('GET','/api/runtime/agents')).agents};return defs.v},
    async agent(id){const A=await this.agents();const a=A.find(x=>x.id===id);if(!a)throw new IfaError('عامل ناشناخته: '+id,404);return a},
    policy:ctx=>req('GET','/api/runtime/policy?ctx='+encodeURIComponent(ctx)),
    call:(ctx,tool,args,why)=>req('POST','/api/runtime/call',{ctx,tool,args:args||{},why}),
    usage:(ctx,u)=>req('POST','/api/runtime/usage',{ctx,...u},15000),
    step:(ctx,s)=>req('POST','/api/runtime/step',{ctx,...s},15000),
    agentRun:(ctx,agent,kind,input)=>req('POST','/api/runtime/agent-run',{ctx,agent,kind,input},30*60e3),
    openTask:o=>req('POST','/api/runtime/tasks/open',o),
    taskCtx:id=>req('POST','/api/runtime/tasks/'+id+'/ctx',{}),
    taskState:(id,o)=>req('POST','/api/runtime/tasks/'+id+'/state',o),
    closeTask:(id,o)=>req('POST','/api/runtime/tasks/'+id+'/close',o),
    approval:id=>req('GET','/api/runtime/approvals/'+id),
    mcpAuth:authorization=>req('POST','/api/runtime/mcp-auth',{authorization},15000),
  };
}
