// Runtime configuration. The runtime reads the same .env as the server (IFA_LLM_*), plus RT_* overrides.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const PKG=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','package.json'),'utf8'));
export const VERSION=PKG.version;

/** Model provider from env. RT_LLM_* wins over IFA_LLM_* (so the runtime can use a different model/gateway than the legacy path). */
export function providerSpec(env=process.env){
  const g=k=>{const v=env['RT_LLM_'+k];return v!=null&&v!==''?v:env['IFA_LLM_'+k]};
  let kind=String(g('PROVIDER')||'').toLowerCase();
  // Phase 0 shortcut: LITELLM_URL routes everything through the LiteLLM gateway (OpenAI-compatible, native tool calling).
  if((!kind||kind==='litellm')&&env.LITELLM_URL){return {kind:'openai',gateway:'litellm',url:env.LITELLM_URL.replace(/\/+$/,'')+(/\/v1$/.test(env.LITELLM_URL)?'':'/v1'),model:g('MODEL')||env.LITELLM_MODEL||'ifa-default',key:env.LITELLM_KEY||g('KEY')||'sk-litellm',local:env.LITELLM_LOCAL==='1',priceIn:+g('PRICE_IN')||0,priceOut:+g('PRICE_OUT')||0,auth:'',maxTokens:+g('MAX_TOKENS')||0,timeoutSec:+g('TIMEOUT')||120}}
  if(!kind||kind==='none')return null;
  if(kind==='openai-compatible'||kind==='litellm')kind='openai';
  if(!['openai','anthropic','ollama'].includes(kind))throw new Error('RT_LLM_PROVIDER/IFA_LLM_PROVIDER نامعتبر: '+kind);
  const url=String(g('URL')||'');
  return {kind,url,model:g('MODEL')||'',key:g('KEY')||'',local:g('LOCAL')==='1'||(g('LOCAL')!=='0'&&(kind==='ollama'||/localhost|127\.0\.0\.1|:11434/.test(url))),
    priceIn:+g('PRICE_IN')||0,priceOut:+g('PRICE_OUT')||0,auth:g('AUTH')||'',maxTokens:+g('MAX_TOKENS')||0,timeoutSec:+g('TIMEOUT')||120,label:g('LABEL')||''};
}

export function loadConfig(env=process.env){
  const token=String(env.IFA_RUNTIME_TOKEN||'');
  return {
    version:VERSION,
    host:env.RT_HOST||'0.0.0.0',
    port:env.RT_PORT!=null?+env.RT_PORT:8090,
    token,
    ifaUrl:String(env.IFA_SERVER_URL||'http://127.0.0.1:8080').replace(/\/+$/,''),
    dataDir:path.resolve(env.RT_DATA||'./data'),
    llm:providerSpec(env),
    maxSteps:Math.max(2,Math.min(12,+env.RT_MAX_STEPS||6)),
    pollSec:Math.max(5,+env.RT_POLL_SEC||60),
    researchPollSec:Math.max(0.2,+env.RT_RESEARCH_POLL_SEC||15),researchMaxPolls:Math.max(1,+env.RT_RESEARCH_MAX_POLLS||240),
    langfuse:{host:String(env.LANGFUSE_HOST||env.LANGFUSE_BASE_URL||'').replace(/\/+$/,''),publicKey:env.LANGFUSE_PUBLIC_KEY||'',secretKey:env.LANGFUSE_SECRET_KEY||'',release:env.LANGFUSE_RELEASE||VERSION},
  };
}
