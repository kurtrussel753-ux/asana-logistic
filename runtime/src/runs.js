// Durable index of workflow runs (the step snapshots themselves live in Mastra's LibSQL storage). Survives restarts; drives approval polling.
import fs from 'node:fs';
import path from 'node:path';
export function runIndex(dir){
  fs.mkdirSync(dir,{recursive:true});const F=path.join(dir,'runs.json');let R={};
  try{R=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}
  const save=()=>{const tmp=F+'.tmp';fs.writeFileSync(tmp,JSON.stringify(R));fs.renameSync(tmp,F)};
  return {
    put(id,o){R[id]={...(R[id]||{}),...o,id,updated:Date.now()};if(!R[id].created)R[id].created=Date.now();
      const ids=Object.keys(R);if(ids.length>2000)for(const k of ids.sort((a,b)=>R[a].updated-R[b].updated).slice(0,ids.length-2000))delete R[k];save();return R[id]},
    get:id=>R[id]||null,
    list:(n=100)=>Object.values(R).sort((a,b)=>b.updated-a.updated).slice(0,n),
    waiting:()=>Object.values(R).filter(r=>r.status==='suspended'&&r.approval),
  };
}
