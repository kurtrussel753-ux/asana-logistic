// Tavily-powered runtime workflows (phase 8): deep research with a durable poll loop, and the server-side lane autopilot.
// Like every runtime workflow, all actions go back through the server's policy gateway (agCall): budgets, credit caps, audit.
import {createWorkflow,createStep} from '@mastra/core/workflows';
import {z} from 'zod';

const any=z.any();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function researchWorkflows(deps){
  const {ifa,cfg}=deps;const pollMs=Math.max(200,(cfg.researchPollSec??15)*1000),maxPolls=Math.max(1,cfg.researchMaxPolls??240);
  /* ---------- deep-research: question → Tavily Research job (server web_jobs) → poll until done → org memory (server) → notify → close ---------- */
  const dOpen=createStep({id:'open',inputSchema:any,outputSchema:any,execute:async({inputData:I,runId})=>{
    const q=String(I.q||I.question||I.input||'').trim();if(q.length<10)throw new Error('پرسش پژوهش لازم است (حداقل ۱۰ نویسه)');
    const o=await ifa.openTask({agent:'analyst',title:'پژوهش عمیق · '+q.slice(0,70),by:I.by||'system',input:I,workflow:'deep-research',run:runId,trig:'runtime:workflow'});
    deps.runs.put(runId,{workflow:'deep-research',task:o.task,by:I.by||'system',status:'running'});
    return {...I,q,model:['mini','pro','auto'].includes(I.model)?I.model:'mini',task:o.task,ctx:o.ctx,polls:0}}});
  const dStart=createStep({id:'start',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const r=await ifa.call(X.ctx,'tavily_research',{q:X.q,model:X.model,...(Array.isArray(X.domains)?{domains:X.domains}:{})});
    const job=r.result&&r.result.id;if(!job)throw new Error('پژوهش آغاز نشد');await ifa.taskState(X.task,{status:'running',ctx:X.ctx,note:'پژوهش Tavily #'+job+' در جریان است'});
    return {...X,job,status:'queued'}}});
  const dPoll=createStep({id:'poll',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    if(X.polls>0)await sleep(pollMs);const r=await ifa.call(X.ctx,'tavily_research_get',{id:X.job});const J=r.result||{};
    const done=['done','failed'].includes(J.status)||X.polls+1>=maxPolls;
    return {...X,polls:X.polls+1,status:J.status,done,result:J.result||null,sources:(J.sources||[]).slice(0,12),err:J.err||null}}});
  const dFinish=createStep({id:'finish',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const ok=X.status==='done';const ans=ok?String((X.result&&(X.result.answer||X.result.report))||'').slice(0,1500):'';
    const summary=ok?'🔎 پژوهش «'+X.q.slice(0,80)+'» آماده شد ('+X.sources.length+' منبع): '+ans.slice(0,400):'⏹ پژوهش «'+X.q.slice(0,80)+'» '+(X.status==='failed'?'ناموفق بود: '+(X.err||''):'در زمان مقرر تمام نشد (کار #'+X.job+' روی سرور ادامه دارد)');
    if(ok&&X.notify!==false){try{await ifa.call(X.ctx,'team_notify',{event:'agent.report',text:summary,ref:'web_jobs#'+X.job,dedupe:'rt-res|'+X.job})}catch{}}
    await ifa.closeTask(X.task,{ctx:X.ctx,status:ok?'done':'failed',out:{summary,job:X.job,answer:ans,sources:X.sources},err:ok?null:(X.err||X.status),workflow:'deep-research'});
    return {outcome:ok?'done':X.status||'timeout',task:X.task,job:X.job,answer:ans,sources:X.sources,summary}}});
  const deepResearch=createWorkflow({id:'deep-research',description:'پژوهش عمیق Tavily با استناد: شروع، پیگیری تا پایان، حافظهٔ سازمانی و اعلان',inputSchema:any,outputSchema:any})
    .then(dOpen).then(dStart).dountil(dPoll,async({inputData})=>!!inputData.done).then(dFinish).commit();

  /* ---------- lane-autopilot: server autopilot (route compare, rate bank, FX, risk news + live Tavily news) → optional analyst narrative → notify ---------- */
  const aOpen=createStep({id:'open',inputSchema:any,outputSchema:any,execute:async({inputData:I,runId})=>{
    const lane=I.lane||I;if(!lane.pol||!(lane.dest||lane.pod))throw new Error('مبدأ (pol) و مقصد (dest) لازم است');
    const o=await ifa.openTask({agent:'analyst',title:'خودکارگردان سرور · '+lane.pol+' → '+(lane.dest||lane.pod),by:I.by||'system',input:I,workflow:'lane-autopilot',run:runId,trig:'runtime:workflow'});
    deps.runs.put(runId,{workflow:'lane-autopilot',task:o.task,by:I.by||'system',status:'running'});
    return {...I,lane:{pol:lane.pol,dest:lane.dest||lane.pod,eq:lane.eq||'40HC',qty:lane.qty,value:lane.value,deadlineDays:lane.deadlineDays},web:I.web!==false,task:o.task,ctx:o.ctx}}});
  const aRun=createStep({id:'autopilot',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const r=await ifa.call(X.ctx,'autopilot_run',{...X.lane,web:X.web});return {...X,ap:r.result}}});
  const aFinish=createStep({id:'finish',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const A=X.ap||{};const D=A.decision||{};const rec=D.rec?D.rec.name+' · $'+D.rec.cost+' · '+D.rec.days+' روز':'—';
    const summary='🧭 خودکارگردان سرور '+X.lane.pol+' → '+X.lane.dest+': '+(A.verdict||'')+' (امتیاز '+A.score+') · پیشنهاد: '+rec+(D.risks&&D.risks.length?' · ریسک‌ها: '+D.risks.join(' | '):'');
    if(X.notify!==false){try{await ifa.call(X.ctx,'team_notify',{event:'agent.report',text:summary,ref:'ap_runs#'+A.id,dedupe:'rt-ap|'+A.id})}catch{}}
    await ifa.closeTask(X.task,{ctx:X.ctx,status:'done',out:{summary,run:A.id,decision:D},workflow:'lane-autopilot'});
    return {outcome:'done',task:X.task,run:A.id,score:A.score,verdict:A.verdict,decision:D,summary}}});
  const laneAutopilot=createWorkflow({id:'lane-autopilot',description:'خودکارگردان مسیر روی سرور: مقایسهٔ مسیر، بانک نرخ، ارز، خبر ریسک و خبر زندهٔ Tavily → پیشنهاد و اعلان',inputSchema:any,outputSchema:any})
    .then(aOpen).then(aRun).then(aFinish).commit();
  return {'deep-research':deepResearch,'lane-autopilot':laneAutopilot};
}
