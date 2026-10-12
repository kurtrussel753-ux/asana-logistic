// Phase 4 — human-in-the-loop workflows with durable suspend/resume (Mastra workflows + LibSQL snapshots).
// The runtime never executes an external/commit/money action itself: it asks the server (agCall) which files an approval
// (roles, four-eyes, kill switch, audit — unchanged). The run suspends; when the approval is decided (hook or poll) it resumes and finishes.
import {createWorkflow,createStep} from '@mastra/core/workflows';
import {z} from 'zod';

const any=z.any();
const FINAL=['executed','rejected','failed','expired','reverted'];
export {FINAL};

/** shared tail: suspend on an approval, then resume → close the server task */
function approvalStep({id,deps,request}){
  return createStep({id,inputSchema:any,outputSchema:any,resumeSchema:z.object({approval:z.number(),status:z.string()}),suspendSchema:z.object({approval:z.number(),task:z.number()}),
    execute:async({inputData:X,resumeData,suspend,runId})=>{
      const {ifa,runs}=deps;
      if(!resumeData){
        const r=await request(X);
        if(!r.pending){return {...X,decision:'executed',result:r.result}}
        await ifa.taskState(X.task,{status:'waiting',ctx:X.ctx,note:'در انتظار تأیید #'+r.approval});
        runs.put(runId,{status:'suspended',approval:r.approval,task:X.task});
        return await suspend({approval:r.approval,task:X.task});
      }
      const a=await ifa.approval(resumeData.approval);
      if(!FINAL.includes(a.status))throw new Error('تأیید #'+a.id+' هنوز تعیین تکلیف نشده است ('+a.status+')');
      const c=await ifa.taskCtx(X.task);
      return {...X,ctx:c.ctx,approval:a.id,decision:a.status,decidedBy:a.decided_by,note:a.note||'',result:a.result};
    }});
}

export function hitlWorkflows(deps){
  const {ifa}=deps;
  /* ---------- procurement: lane → RFQ draft → recipients → sanctions screen → approval → send (server) → notify ---------- */
  const rOpen=createStep({id:'open',inputSchema:any,outputSchema:any,execute:async({inputData:I,runId})=>{
    const lane=I.lane||{};if(!lane.pol||!(lane.dest||lane.pod))throw new Error('مبدأ (pol) و مقصد (dest) لازم است');
    const o=await ifa.openTask({agent:'procurement',title:'گردش‌کار استعلام · '+lane.pol+' → '+(lane.dest||lane.pod)+(lane.eq?' '+lane.eq:''),by:I.by||'system',input:I,workflow:'procurement-rfq',run:runId,trig:'runtime:workflow'});
    deps.runs.put(runId,{workflow:'procurement-rfq',task:o.task,by:I.by||'system',status:'running'});
    return {...I,lane:{...lane,dest:lane.dest||lane.pod},task:o.task,ctx:o.ctx}}});
  const rDraft=createStep({id:'draft',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const L=X.lane;const d=await ifa.call(X.ctx,'rfq_draft',{pol:L.pol,dest:L.dest,eq:L.eq,qty:L.qty,commodity:L.commodity,incoterm:L.incoterm,ready:L.ready,route:L.route,deadlineDays:L.deadlineDays});
    let bench=null;try{const r=await ifa.call(X.ctx,'rates_search',{pol:L.pol,pod:L.dest,eq:L.eq});bench=r.result&&r.result.stats||null}catch{}
    return {...X,draft:d.result,bench}}});
  const rRecipients=createStep({id:'recipients',inputSchema:any,outputSchema:any,execute:async({inputData:X,bail})=>{
    let R=(Array.isArray(X.recipients)?X.recipients:[]).filter(r=>r&&r.email).slice(0,20);
    if(!R.length){const p=await ifa.call(X.ctx,'partners_list',{lane:X.lane.pol+' '+X.lane.dest});R=((p.result&&p.result.partners)||[]).filter(x=>x.email).slice(0,10).map(x=>({name:x.name,email:x.email}))}
    if(!R.length){await ifa.closeTask(X.task,{ctx:X.ctx,status:'failed',err:'هیچ گیرنده‌ای (فورواردر با ایمیل) برای این مسیر پیدا نشد',workflow:'procurement-rfq'});return bail({...X,ctx:undefined,outcome:'no-recipients'})}
    return {...X,recipients:R}}});
  const rScreen=createStep({id:'screen',inputSchema:any,outputSchema:any,execute:async({inputData:X,bail})=>{
    const s=await ifa.call(X.ctx,'sanctions_screen',{names:X.recipients.map(r=>r.name||r.email)});const hits=((s.result&&s.result.results)||[]).filter(r=>r.hits&&r.hits.length);
    if(hits.length){await ifa.closeTask(X.task,{ctx:X.ctx,status:'rejected',err:'غربال تحریم: '+hits.map(h=>h.name).join('، '),out:{summary:'⛔ ارسال استعلام متوقف شد: تطابق در فهرست تحریم برای '+hits.map(h=>h.name).join('، ')},workflow:'procurement-rfq'});return bail({...X,ctx:undefined,outcome:'sanctions',hits})}
    return {...X,screened:X.recipients.length}}});
  const rApproval=approvalStep({id:'approval',deps,request:async X=>{const D=X.draft||{};
    const r=await ifa.call(X.ctx,'rfq_send',{items:[{title:D.title,text:D.text,route:D.route,days:X.lane.deadlineDays,recipients:X.recipients}]},'گردش‌کار استعلام رانتایم: '+X.recipients.length+' گیرنده، غربال تحریم بدون تطابق');return r}});
  const rFinish=createStep({id:'finish',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const ok=X.decision==='executed';const rfqs=(X.result&&X.result.rfqs)||[];
    const summary=ok?'✅ استعلام «'+((X.draft||{}).title||'')+'» برای '+X.recipients.length+' فورواردر ارسال شد'+(X.decidedBy?' (تأیید: '+X.decidedBy+')':''):'⏹ استعلام ارسال نشد: '+X.decision+(X.note?' — '+X.note:'');
    if(ok){try{await ifa.call(X.ctx,'team_notify',{event:'agent.report',text:summary,ref:'task#'+X.task,dedupe:'rt-rfq|'+X.task})}catch{}}
    await ifa.closeTask(X.task,{ctx:X.ctx,status:ok?'done':X.decision==='rejected'?'rejected':'failed',out:{summary,rfqs:rfqs.map(r=>r.id||r),approval:X.approval},err:ok?null:'تأیید: '+X.decision,workflow:'procurement-rfq'});
    return {outcome:ok?'sent':X.decision,task:X.task,approval:X.approval,summary,rfqs:rfqs.map(r=>r.id||r)}}});
  const procurementRfq=createWorkflow({id:'procurement-rfq',description:'استعلام نرخ با تأیید انسانی: پیش‌نویس، گیرندگان، غربال تحریم، تأیید، ارسال',inputSchema:any,outputSchema:any})
    .then(rOpen).then(rDraft).then(rRecipients).then(rScreen).then(rApproval).then(rFinish).commit();

  /* ---------- finance: payment request → checks (fx, optional invoice↔quote reconcile) → approval (finance/admin, four-eyes) → record ---------- */
  const fOpen=createStep({id:'open',inputSchema:any,outputSchema:any,execute:async({inputData:I,runId})=>{
    for(const k of ['vendor','amount','cur','ref'])if(I[k]==null||I[k]==='')throw new Error('فیلد «'+k+'» لازم است');if(!(+I.amount>0))throw new Error('مبلغ نامعتبر است');
    const o=await ifa.openTask({agent:'finance',title:'گردش‌کار پرداخت · '+I.vendor+' · '+I.amount+' '+I.cur,by:I.by||'system',input:I,workflow:'finance-payment',run:runId,trig:'runtime:workflow'});
    deps.runs.put(runId,{workflow:'finance-payment',task:o.task,by:I.by||'system',status:'running'});return {...I,task:o.task,ctx:o.ctx}}});
  const fCheck=createStep({id:'check',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const fx=await ifa.call(X.ctx,'fx_get',{});let rec=null;
    if(X.invoice&&X.quote){try{rec=(await ifa.call(X.ctx,'invoice_reconcile',{invoice:X.invoice,quote:X.quote,qty:X.qty})).result}catch(e){rec={error:e.message}}}
    const flags=rec&&Array.isArray(rec.issues)?rec.issues.filter(i=>i&&(i.sev==='high'||i.severity==='high')).length:0;
    return {...X,fx:fx.result&&{freeUSD:fx.result.freeUSD,date:fx.result.date},reconcile:rec,flags}}});
  const fApproval=approvalStep({id:'approval',deps,request:X=>ifa.call(X.ctx,'payment_request',{vendor:X.vendor,amount:+X.amount,cur:X.cur,ref:X.ref,reason:X.reason||''},
    'گردش‌کار پرداخت رانتایم'+(X.reconcile?' · تطبیق صورتحساب: '+(X.flags?X.flags+' مورد پرخطر':'بدون مورد پرخطر'):'')+' · درخواست‌دهنده: '+(X.by||'system'))});
  const fFinish=createStep({id:'finish',inputSchema:any,outputSchema:any,execute:async({inputData:X})=>{
    const ok=X.decision==='executed';const summary=ok?'✅ درخواست پرداخت '+X.amount+' '+X.cur+' به «'+X.vendor+'» ('+X.ref+') تأیید و در صف پرداخت ثبت شد'+(X.decidedBy?' — تأییدکننده: '+X.decidedBy:''):'⏹ درخواست پرداخت ثبت نشد: '+X.decision+(X.note?' — '+X.note:'');
    await ifa.closeTask(X.task,{ctx:X.ctx,status:ok?'done':X.decision==='rejected'?'rejected':'failed',out:{summary,approval:X.approval,payq:X.result&&X.result.id||null},err:ok?null:'تأیید: '+X.decision,workflow:'finance-payment'});
    return {outcome:ok?'queued':X.decision,task:X.task,approval:X.approval,summary}}});
  const financePayment=createWorkflow({id:'finance-payment',description:'درخواست پرداخت با کنترل ارز/تطبیق و تأیید مالی (اصل چهار چشم)',inputSchema:any,outputSchema:any})
    .then(fOpen).then(fCheck).then(fApproval).then(fFinish).commit();
  return {'procurement-rfq':procurementRfq,'finance-payment':financePayment};
}
