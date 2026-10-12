// Phase 1 — model layer on the Vercel AI SDK: one provider factory (OpenAI-compatible incl. LiteLLM/OpenRouter/vLLM, Anthropic, Ollama),
// native tool calling, and a middleware that enforces the server's privacy + budget rules on *every* model call:
//   • PII masking (the same PII patterns as server.js) on system/user/assistant/tool-result content before a non-local model sees it, unmasking of the output
//   • budget pre-check against the server policy (daily tokens/USD per agent, kill switch, pause)
//   • usage + cost reporting back to the server (ag_use, ag_step) and to Langfuse (masked prompt)
import {wrapLanguageModel} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {createAnthropic} from '@ai-sdk/anthropic';
import {piiMask,piiUnmask} from './legacy.gen.js';

export function baseModel(spec,{fetch:f}={}){
  if(!spec)return null;
  const url=String(spec.url||'').trim().replace(/\/+$/,'');
  if(spec.kind==='anthropic'){
    let b=(url||'https://api.anthropic.com').replace(/\/messages$/,'');if(!/\/v1$/.test(b))b+='/v1';
    const headers=spec.auth==='bearer'?{Authorization:'Bearer '+(spec.key||'')}:undefined;
    return createAnthropic({baseURL:b,apiKey:spec.key||'none',headers,fetch:f})(spec.model||'claude-sonnet-4-5');
  }
  // openai + ollama (Ollama serves an OpenAI-compatible API under /v1 with native tool calling)
  let b=url||(spec.kind==='ollama'?'http://127.0.0.1:11434':'https://api.openai.com/v1');b=b.replace(/\/chat\/completions$/,'');
  if(spec.kind==='ollama'&&!/\/v1$/.test(b))b=b.replace(/\/api$/,'')+'/v1';
  return createOpenAICompatible({name:spec.gateway||spec.kind,baseURL:b,apiKey:spec.key||'none',includeUsage:true,fetch:f}).chatModel(spec.model||'gpt-4o-mini');
}

export const costOf=(spec,tin,tout)=>spec?((tin||0)*(+spec.priceIn||0)+(tout||0)*(+spec.priceOut||0))/1e6:0;

/* ---- deep masking of an AI SDK (LanguageModelV2) prompt ---- */
const mapStrings=(v,f)=>typeof v==='string'?f(v):Array.isArray(v)?v.map(x=>mapStrings(x,f)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,mapStrings(x,f)])):v;
function maskPart(p,mk){
  if(!p||typeof p!=='object')return p;
  if(p.type==='text'||p.type==='reasoning')return {...p,text:mk(p.text)};
  if(p.type==='tool-call')return {...p,input:typeof p.input==='string'?mk(p.input):mapStrings(p.input,mk)};
  if(p.type==='tool-result'){const o=p.output;if(!o)return p;return {...p,output:{...o,value:mapStrings(o.value,mk)}}}
  return p;
}
export function maskPrompt(prompt,M){const mk=s=>piiMask(s,M);return prompt.map(m=>typeof m.content==='string'?{...m,content:mk(m.content)}:{...m,content:(m.content||[]).map(p=>maskPart(p,mk))})}
const promptText=prompt=>prompt.map(m=>m.role+': '+(typeof m.content==='string'?m.content:(m.content||[]).map(p=>p.text||(p.input?JSON.stringify(p.input):'')||(p.output?JSON.stringify(p.output.value):'')).join(' '))).join('\n').slice(0,12000);

/**
 * Wrap a model with the governance middleware.
 * hooks.before(): async; throw to block the call (budget/kill)   hooks.usage(u): async; report {tin,tout,cost,ms,masked,local,provider,model,stop}
 */
export function governedModel(spec,{mask=true,hooks={},trace=null,name='llm',fetch:f}={}){
  const model=baseModel(spec,{fetch:f});if(!model)return null;
  const doMask=mask&&!spec.local;const MAPS=new WeakMap();
  const report=async(params,usage,stop,t0,text)=>{const tin=usage&&(usage.inputTokens||0)||0,tout=usage&&(usage.outputTokens||0)||0;const M=MAPS.get(params);const ms=Date.now()-t0;
    const u={tin,tout,cost:costOf(spec,tin,tout),ms,masked:M?M.size:0,local:!!spec.local,provider:spec.gateway||spec.kind,model:spec.model,stop:String(stop||'')};
    try{if(trace)u.trace=trace.generation({name,model:spec.model,input:promptText(params.prompt),output:text,usage:{input:tin,output:tout},start:t0,end:Date.now(),metadata:{masked:u.masked,local:u.local,provider:u.provider,cost:u.cost}})}catch{}
    try{await hooks.usage?.(u)}catch{}};
  return wrapLanguageModel({model,middleware:{
    middlewareVersion:'v2',
    async transformParams({params}){await hooks.before?.();if(!doMask)return params;const M=new Map();const p={...params,prompt:maskPrompt(params.prompt,M)};MAPS.set(p,M);return p},
    async wrapGenerate({doGenerate,params}){const t0=Date.now();const r=await doGenerate();const M=MAPS.get(params);
      const content=M&&M.size?r.content.map(c=>c.type==='text'||c.type==='reasoning'?{...c,text:piiUnmask(c.text,M)}:c.type==='tool-call'?{...c,input:piiUnmask(c.input,M)}:c):r.content;
      await report(params,r.usage,r.finishReason,t0,r.content.filter(c=>c.type==='text').map(c=>c.text).join('')||r.content.filter(c=>c.type==='tool-call').map(c=>c.toolName+' '+c.input).join('\n'));
      return {...r,content}},
    async wrapStream({doStream,params}){const t0=Date.now();const r=await doStream();const M=MAPS.get(params);let usage=null,stop='',acc='';const hold=new Map();
      const flushable=s=>{const i=s.lastIndexOf('[');return i>=0&&s.length-i<28&&!s.slice(i).includes(']')?i:s.length};
      const ts=new TransformStream({
        transform(ch,ctl){
          if(ch.type==='text-delta'){acc+=ch.delta;if(!M||!M.size)return ctl.enqueue(ch);const s=(hold.get(ch.id)||'')+ch.delta;const k=flushable(s);hold.set(ch.id,s.slice(k));if(k)ctl.enqueue({...ch,delta:piiUnmask(s.slice(0,k),M)});return}
          if(ch.type==='text-end'&&hold.get(ch.id)){ctl.enqueue({type:'text-delta',id:ch.id,delta:piiUnmask(hold.get(ch.id),M)});hold.delete(ch.id)}
          if(ch.type==='tool-call'&&M&&M.size)return ctl.enqueue({...ch,input:piiUnmask(ch.input,M)});
          if(ch.type==='finish'){usage=ch.usage;stop=ch.finishReason}
          ctl.enqueue(ch)},
        async flush(ctl){for(const [id,s] of hold)if(s)ctl.enqueue({type:'text-delta',id,delta:piiUnmask(s,M)});await report(params,usage,stop,t0,acc)}});
      return {...r,stream:r.stream.pipeThrough(ts)}},
  }});
}
