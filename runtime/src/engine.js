// Mastra instance (LibSQL storage → durable workflow snapshots), workflow start/resume, approval hook + poller (Phase 4/7).
import path from 'node:path';
import fs from 'node:fs';
import {Mastra} from '@mastra/core/mastra';
import {LibSQLStore} from '@mastra/libsql';
import {hitlWorkflows,FINAL} from './workflows/hitl.js';
import {runIndex} from './runs.js';

export function createEngine({cfg,ifa,tracer}){
  fs.mkdirSync(cfg.dataDir,{recursive:true});
  const runs=runIndex(cfg.dataDir);
  const deps={ifa,cfg,tracer,runs};
  const WF=hitlWorkflows(deps);
  const mastra=new Mastra({workflows:WF,storage:new LibSQLStore({id:'ifa-runtime',url:'file:'+path.join(cfg.dataDir,'mastra.db')}),logger:false});
  const busy=new Set();

  const pub=(id,r,extra={})=>{const s=r.status;const sp=s==='suspended'?(Object.values(r.steps||{}).find(x=>x&&x.status==='suspended')||{}).suspendPayload:null;
    return {runId:id,status:s,approval:sp&&sp.approval||null,task:sp&&sp.task||extra.task||null,result:s==='success'?r.result:null,error:s==='failed'?String(r.error&&r.error.message||r.error||'').slice(0,500):null}};
  async function settle(runId,r){const cur=runs.get(runId)||{};const p=pub(runId,r,cur);
    if(p.status==='failed'&&cur.task){try{await ifa.closeTask(cur.task,{status:'failed',err:p.error||'خطای گردش‌کار',workflow:cur.workflow,run:runId})}catch{}}
    runs.put(runId,{status:p.status,approval:p.approval||(p.status==='suspended'?cur.approval:null),task:p.task||cur.task,result:p.result,error:p.error});return {...runs.get(runId),runId}}

  async function start(wfId,{by,role,input}){
    const wf=WF[wfId]&&mastra.getWorkflow(wfId);if(!wf)throw Object.assign(new Error('گردش‌کار ناشناخته: '+wfId),{status:404});
    const run=await wf.createRun();runs.put(run.runId,{workflow:wfId,by:by||'system',role:role||null,status:'running',input});
    const tr=tracer.trace({name:'workflow:'+wfId,input,userId:by||undefined,tags:['workflow',wfId]});
    const r=await run.start({inputData:{...(input||{}),by:by||'system'}});tr.end({output:{status:r.status}});tracer.flush().catch(()=>{});
    return settle(run.runId,r);
  }
  async function resume(runId,approval,status){
    const cur=runs.get(runId);if(!cur||cur.status!=='suspended'||busy.has(runId))return cur;busy.add(runId);
    try{const wf=mastra.getWorkflow(cur.workflow);const run=await wf.createRun({runId});
      const r=await run.resume({step:'approval',resumeData:{approval:+approval,status:String(status)}});return await settle(runId,r)}
    catch(e){return runs.put(runId,{lastError:String(e.message||e).slice(0,300)})}
    finally{busy.delete(runId)}
  }
  async function onApproval(approvalId){const out=[];for(const r of runs.waiting().filter(x=>+x.approval===+approvalId)){let a;try{a=await ifa.approval(approvalId)}catch{continue}if(FINAL.includes(a.status))out.push(await resume(r.id,a.id,a.status))}return out}
  async function poll(){for(const r of runs.waiting()){try{const a=await ifa.approval(r.approval);if(FINAL.includes(a.status))await resume(r.id,a.id,a.status)}catch{}}}
  let timer=null;
  return {mastra,runs,workflows:WF,start,resume,onApproval,poll,
    list:()=>Object.entries(WF).map(([id,w])=>({id,description:w.description||''})),
    startPolling(){timer=setInterval(()=>poll().catch(()=>{}),cfg.pollSec*1000);timer.unref?.()},stop(){if(timer)clearInterval(timer)}};
}
