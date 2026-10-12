#!/usr/bin/env node
// Builds server.js from its sources (server/manifest.json): base sections in server/src/*.js + feature modules in dev/src/p5 and dev/src/shared.
// server.js stays a single zero-dependency file (that is what ships and what the in-app installer embeds); the sources are what you edit.
// Usage: node scripts/build-server.js [--check]   (--check: exit 1 if server.js differs from the sources)
'use strict';
const fs=require('fs'),path=require('path');const R=path.join(__dirname,'..');const check=process.argv.includes('--check');
const M=JSON.parse(fs.readFileSync(path.join(R,'server','manifest.json'),'utf8'));
const out=M.parts.map(p=>{if(p.file)return fs.readFileSync(path.join(R,p.file),'utf8');
 const name=path.basename(p.module);const src=fs.readFileSync(path.join(R,p.module),'utf8').replace(/\s+$/,'');
 return (p.markers?'/* >>> '+name+' */\n'+src+'\n/* <<< '+name+' */\n':src)+(p.after||'')}).join('');
const dst=path.join(R,M.output||'server.js');const cur=fs.existsSync(dst)?fs.readFileSync(dst,'utf8'):'';
if(check){if(cur!==out){console.error('build-server: server.js is out of date with server/src + dev/src — run: npm run build:server');process.exit(1)}console.log('build-server: server.js up to date ('+M.parts.length+' parts)');process.exit(0)}
if(cur===out)console.log('build-server: no change');else{fs.writeFileSync(dst,out);console.log('build-server: wrote '+(M.output||'server.js')+' ('+out.length+' chars, '+M.parts.length+' parts)')}
