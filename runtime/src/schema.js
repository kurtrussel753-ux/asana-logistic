// JSON Schema (as produced by the server's agSchema) → zod, for Mastra/AI SDK/MCP tool definitions.
import {z} from 'zod';
export function toZod(s){
  if(!s||typeof s!=='object')return z.any();
  const d=x=>s.description?x.describe(String(s.description).slice(0,500)):x;
  switch(s.type){
    case 'string':return d(z.string());
    case 'number':case 'integer':return d(z.coerce.number());
    case 'boolean':return d(z.boolean());
    case 'array':return d(z.array(toZod(s.items||{})));
    case 'object':{if(!s.properties)return d(z.record(z.string(),z.any()));const req=new Set(s.required||[]);
      const shape=Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,req.has(k)?toZod(v):toZod(v).optional()]));return d(z.object(shape).passthrough())}
    default:return d(z.any());
  }
}
export const toShape=s=>toZod({...s,type:'object',properties:(s&&s.properties)||{}}).shape;
