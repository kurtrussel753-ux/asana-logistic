#!/usr/bin/env node
// Inserts (or refreshes) a dev/src/p5 module inside server.js, between `/* >>> <name> */` and `/* <<< <name> */` markers,
// right before the `/* ---------- server ---------- */` section. Idempotent. Usage: node scripts/inject-module.js r_runtime.js [--check]
'use strict';
const fs=require('fs'),path=require('path');const R=path.join(__dirname,'..');
const name=process.argv[2]||'r_runtime.js',check=process.argv.includes('--check');
const src=fs.readFileSync(path.join(R,'dev','src','p5',name),'utf8').replace(/\s+$/,'')+'\n';
const S=fs.readFileSync(path.join(R,'server.js'),'utf8');const a='/* >>> '+name+' */\n',b='/* <<< '+name+' */\n',mk='/* ---------- server ---------- */';
const block=a+src+b;let out;const i=S.indexOf(a),j=S.indexOf(b);
if(i>=0&&j>i)out=S.slice(0,i)+block+S.slice(j+b.length);else{const k=S.indexOf(mk);if(k<0){console.error('marker not found');process.exit(1)}out=S.slice(0,k)+block+S.slice(k)}
if(check){if(out!==S){console.error('server.js is out of date with dev/src/p5/'+name+' — run: node scripts/inject-module.js '+name);process.exit(1)}console.log('inject: server.js up to date ('+name+')');process.exit(0)}
if(out===S)console.log('inject: no change');else{fs.writeFileSync(path.join(R,'server.js'),out);console.log('inject: server.js updated with '+name)}
