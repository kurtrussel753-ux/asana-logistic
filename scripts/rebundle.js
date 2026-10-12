#!/usr/bin/env node
// Re-embeds the shipped server.js into public/index.html (const SRVJS='<base64>') and regenerates bundle/index parts + manifest.
// Only the parts that cover the changed byte range are rewritten, so a server.js change touches 2–3 part files instead of all 18.
// Usage: node scripts/rebundle.js [--check]   (--check: exit 1 if index.html/bundle are stale)
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const R=path.join(__dirname,'..'),MF=path.join(R,'bundle','manifest.json'),M=JSON.parse(fs.readFileSync(MF,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const pp=k=>path.join(R,'bundle','index',`part-${String(k).padStart(2,'0')}.txt`);
const check=process.argv.includes('--check'),MAX=950000,STD=560000;
const old=Array.from({length:M.index.parts},(_,k)=>fs.readFileSync(pp(k)));const oldB=Buffer.concat(old);
if(sha(oldB)!==M.index.sha256){console.error('rebundle: bundle parts do not match manifest');process.exit(1)}
const H=oldB.toString('utf8');const re=/const SRVJS='([A-Za-z0-9+\/=]*)'/;const m=H.match(re);if(!m){console.error('rebundle: SRVJS not found in index.html');process.exit(1)}
const b64=fs.readFileSync(path.join(R,'server.js')).toString('base64');
const newB=Buffer.from(H.replace(re,()=>"const SRVJS='"+b64+"'"),'utf8');
if(newB.equals(oldB)){if(!fs.existsSync(path.join(R,M.index.path))||sha(fs.readFileSync(path.join(R,M.index.path)))!==M.index.sha256)fs.writeFileSync(path.join(R,M.index.path),newB);console.log('rebundle: up to date');process.exit(0)}
if(check){console.error('rebundle: public/index.html bundle is stale — run: node scripts/rebundle.js');process.exit(1)}
let a=0;while(a<oldB.length&&a<newB.length&&oldB[a]===newB[a])a++;let s=0;while(s<oldB.length-a&&s<newB.length-a&&oldB[oldB.length-1-s]===newB[newB.length-1-s])s++;
const off=[0];for(const p of old)off.push(off[off.length-1]+p.length);
let k0=0;while(k0<old.length-1&&off[k0+1]<=a)k0++;let k1=old.length-1;while(k1>k0&&off[k1]>=oldB.length-s)k1--;
const start=off[k0],endOld=off[k1+1],endNew=newB.length-(oldB.length-endOld);const mid=newB.subarray(start,endNew);const n=k1-k0+1;
const cut=(buf,cnt)=>{const out=[];let p=0;for(let i=1;i<cnt;i++){let c=Math.round(buf.length*i/cnt);while(c<buf.length&&(buf[c]&0xC0)===0x80)c++;out.push(buf.subarray(p,c));p=c}out.push(buf.subarray(p));return out};
let parts;if(Math.ceil(mid.length/MAX)<=n){parts=[...old.slice(0,k0),...cut(mid,n),...old.slice(k1+1)]}
else{parts=[];for(let p=0;p<newB.length;){let c=Math.min(newB.length,p+STD);while(c<newB.length&&(newB[c]&0xC0)===0x80)c++;parts.push(newB.subarray(p,c));p=c}}
const changed=[];parts.forEach((b,k)=>{if(!(old[k]&&old[k].equals(b))){fs.writeFileSync(pp(k),b);changed.push(k)}});for(let k=parts.length;k<old.length;k++)fs.unlinkSync(pp(k));
M.index={...M.index,parts:parts.length,sha256:sha(newB),bytes:newB.length};fs.writeFileSync(MF,JSON.stringify(M,null,1));fs.writeFileSync(path.join(R,M.index.path),newB);
console.log('rebundle: index.html '+newB.length+' bytes · rewrote part(s) '+changed.map(k=>String(k).padStart(2,'0')).join(', ')+' of '+parts.length);
