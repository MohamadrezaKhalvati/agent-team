import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,statSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startMonitor } from './monitor.mjs';
import { generateReport } from '../reports/report.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
async function fixture(t){const project=mkdtempSync(join(tmpdir(),'team-monitor-'));const m=await startMonitor({project,port:0});t.after(()=>m.close());const c=JSON.parse(readFileSync(m.connection));const post=(event,headers={})=>fetch(m.url+'/api/events',{method:'POST',headers:{'Authorization':`Bearer ${c.token}`,...headers},body:JSON.stringify(event)});return {...m,c,post,project};}
async function cli(args){return new Promise(ok=>{const child=spawn(process.execPath,[join(HERE,'monitor.mjs'),...args],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('exit',code=>ok({code,out}));});}
test('authenticated writes, validation, host/origin boundaries and no exposed credentials',async t=>{
 const m=await fixture(t);
 assert.equal((await fetch(m.url+'/api/events',{method:'POST',body:'{}'})).status,401);
 assert.equal((await m.post({type:'run.started',runId:'a',title:'Real run'})).status,201);
 assert.equal((await m.post({type:'run.started',runId:'a',title:'Duplicate'})).status,400);
 assert.equal((await m.post({type:'task.updated',runId:'missing',taskId:'t',status:'running'})).status,400);
 assert.equal((await m.post({type:'task.updated',runId:'a',taskId:'t',status:'imaginary'})).status,400);
 assert.equal((await m.post({type:'command.finished',runId:'a',title:'Spoofed',source:'command-wrapper'})).status,400);
 assert.equal((await m.post({type:'agent.updated',runId:'a',agentId:'a',status:'working'},{Origin:'https://other.example'})).status,403);
 assert.equal(await new Promise(ok=>{http.get(m.url+'/api/state',{headers:{Host:'other.example'}},r=>{r.resume();ok(r.statusCode);});}),403);
 assert.equal((await fetch(m.url+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const response=await fetch(m.url+'/api/state');const body=await response.text();assert.ok(!body.includes(m.c.token));assert.ok(!body.includes(m.c.captureToken));
 assert.equal((await fetch(m.url+'/.team-monitor/connection.json')).status,404);
 // POSIX mode bits only. Windows reports synthetic modes, so this proves nothing about ACLs there; see README "Monitoring boundaries".
 if(process.platform!=='win32')assert.equal(statSync(m.connection).mode&0o777,0o600);
 const page=await fetch(m.url);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('SSE streams actual events; reconnect snapshots recover missed history',async t=>{
 const m=await fixture(t);const controller=new AbortController();t.after(()=>controller.abort());
 const response=await fetch(m.url+'/api/stream',{signal:controller.signal});const reader=response.body.getReader();const decoder=new TextDecoder();
 const snapshot=decoder.decode((await reader.read()).value);assert.match(snapshot,/event: snapshot/);
 await m.post({type:'run.started',runId:'stream',title:'Stream run'});
 const update=decoder.decode((await reader.read()).value);assert.match(update,/event: update/);assert.match(update,/Stream run/);await reader.cancel();
 await m.post({type:'task.updated',runId:'stream',taskId:'t',status:'review',title:'Missed while offline'});
 const c2=new AbortController();t.after(()=>c2.abort());const s2=await fetch(m.url+'/api/stream',{signal:c2.signal});const r2=s2.body.getReader();const recovered=decoder.decode((await r2.read()).value);assert.match(recovered,/Missed while offline/);await r2.cancel();
});
test('concurrent writes have durable unique sequences; restart preserves history',async t=>{
 const project=mkdtempSync(join(tmpdir(),'team-journal-'));let m=await startMonitor({project,port:0});const c=JSON.parse(readFileSync(m.connection));
 const post=e=>fetch(m.url+'/api/events',{method:'POST',headers:{Authorization:`Bearer ${c.token}`},body:JSON.stringify(e)});
 await post({type:'run.started',runId:'durable',title:'Durable'});
 await Promise.all(Array.from({length:25},(_,i)=>post({type:'task.updated',runId:'durable',taskId:'t'+i,status:'planned',title:'Task '+i})));
 await m.close();m=await startMonitor({project,port:0});t.after(()=>m.close());
 const state=await(await fetch(m.url+'/api/state')).json();assert.equal(state.events.length,26);assert.deepEqual(state.events.map(e=>e.seq),Array.from({length:26},(_,i)=>i+1));
});
test('corrupt journal is rejected without rewriting evidence',async()=>{
 const project=mkdtempSync(join(tmpdir(),'team-corrupt-'));const m=await startMonitor({project,port:0});await m.close();const journal=join(project,'.team-monitor/events.jsonl');writeFileSync(journal,'{"partial":');await assert.rejects(startMonitor({project,port:0}),/journal is invalid/);assert.equal(readFileSync(journal,'utf8'),'{"partial":');
});
test('command wrapper preserves failure and does not collect arguments or output',async t=>{
 const m=await fixture(t);await m.post({type:'run.started',runId:'commands',title:'Command outcomes'});
 const r=await cli(['record','--connection',m.connection,'--run','commands','--label','Expected failing probe','--',process.execPath,'-e','console.log("sensitive-test-marker"); process.exit(7)']);assert.equal(r.code,7);
 const state=await(await fetch(m.url+'/api/state')).json();const e=state.events.at(-1);assert.equal(e.type,'command.finished');assert.equal(e.exitCode,7);assert.equal(e.source,'command-wrapper');assert.ok(!JSON.stringify(state).includes('sensitive-test-marker'));
 const missing=await cli(['record','--connection',m.connection,'--run','commands','--','/does/not/exist']);assert.equal(missing.code,127);
});

test('only one writer may own a project; graceful close releases ownership',async t=>{
 const m=await fixture(t);
 await assert.rejects(startMonitor({project:m.project,port:0}),/already running/);
 assert.equal((await m.post({type:'run.started',runId:'single',title:'Single writer'})).status,201);
});
test('long history retains run, task and agent baseline',async t=>{
 const project=mkdtempSync(join(tmpdir(),'team-long-'));const seed=await startMonitor({project,port:0});await seed.close();
 const data=[{type:'run.started',runId:'long',title:'Long run'},{type:'task.updated',runId:'long',taskId:'original',status:'running'},{type:'agent.updated',runId:'long',agentId:'original',status:'working'},...Array.from({length:5000},(_,i)=>({type:'decision.recorded',runId:'long',title:'Decision '+i}))];
 writeFileSync(join(project,'.team-monitor/events.jsonl'),data.map((e,i)=>JSON.stringify({...e,source:'agent-reported',seq:i+1,at:new Date().toISOString()})).join('\n')+'\n');
 const m=await startMonitor({project,port:0});t.after(()=>m.close());const state=await(await fetch(m.url+'/api/state')).json();
 assert.equal(state.events.length,5003);assert.equal(state.events[0].title,'Long run');assert.equal(state.events[1].taskId,'original');assert.equal(state.events[2].agentId,'original');
});

test('malformed request target returns 400 without crashing the monitor',async t=>{
 const m=await fixture(t);const u=new URL(m.url);
 const response=await new Promise((ok,no)=>{const socket=net.connect(Number(u.port),'127.0.0.1',()=>socket.write(`GET http://[ HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`));let text='';socket.on('data',b=>text+=b);socket.on('end',()=>ok(text));socket.on('error',no);});
 assert.match(response,/400/);assert.equal((await fetch(m.url+'/api/state')).status,200);
});

test('publishes real report links with matching run identity and safe file boundaries',async t=>{
 const m=await fixture(t);await m.post({type:'run.started',runId:'report-run',title:'Report run'});
 const input=JSON.parse(readFileSync(join(HERE,'../../assets/report-input.example.json'),'utf8'));input.jobId='job';input.runId='report-run';
 const generated=generateReport(input,{project:m.project});const dir=generated.directory;
 const event={type:'report.ready',runId:'report-run',title:'Review report',path:'/reports/job/r001/report.html'};
 assert.equal((await m.post(event)).status,201);
 const response=await fetch(m.url+event.path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.match(await response.text(),/report-en/);
 assert.equal((await m.post({...event,path:'https://external.example/report.html'})).status,400);
 assert.equal((await m.post({...event,path:'/reports/job/r002/report.html'})).status,400);
 const record=JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));record.runId='wrong';writeFileSync(join(dir,'report.json'),JSON.stringify(record));assert.equal((await m.post(event)).status,400);
 unlinkSync(join(dir,'report.en.md'));
 record.runId='report-run';writeFileSync(join(dir,'report.json'),JSON.stringify(record));assert.equal((await m.post(event)).status,400);
 const outside=join(m.project,'.team-monitor','connection.json');symlinkSync(outside,join(dir,'report.en.md'));
 assert.equal((await fetch(m.url+'/reports/job/r001/report.en.md')).status,404);
 assert.equal((await fetch(m.url+'/reports/job/r001/connection.json')).status,404);
});
