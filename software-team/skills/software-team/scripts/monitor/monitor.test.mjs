import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { protectPaths } from './credentials.mjs';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,statSync, renameSync, rmdirSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startMonitor, emit } from './monitor.mjs';
import { generateReport } from '../reports/report.mjs';
const read=(m,path,options={})=>fetch(m.url+path,{...options,headers:{Authorization:`Bearer ${JSON.parse(readFileSync(m.connection)).readToken}`,...options.headers}});
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
 const response=await read(m,'/api/state');const body=await response.text();assert.ok(!body.includes(m.c.token));assert.ok(!body.includes(m.c.captureToken));assert.ok(!body.includes(m.c.readToken));
 assert.equal((await fetch(m.url+'/.team-monitor/connection.json')).status,404);
 // Windows ACLs are checked separately in the credential protection regression.
 if(process.platform!=='win32')assert.equal(statSync(m.connection).mode&0o777,0o600);
 const page=await fetch(m.url);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('SSE streams actual events; reconnect snapshots recover missed history',async t=>{
 const m=await fixture(t);const controller=new AbortController();t.after(()=>controller.abort());
 const response=await read(m,'/api/stream',{signal:controller.signal});const reader=response.body.getReader();const decoder=new TextDecoder();
 const snapshot=decoder.decode((await reader.read()).value);assert.match(snapshot,/event: snapshot/);
 await m.post({type:'run.started',runId:'stream',title:'Stream run'});
 const update=decoder.decode((await reader.read()).value);assert.match(update,/event: update/);assert.match(update,/Stream run/);await reader.cancel();
 await m.post({type:'task.updated',runId:'stream',taskId:'t',status:'review',title:'Missed while offline'});
 const c2=new AbortController();t.after(()=>c2.abort());const s2=await read(m,'/api/stream',{signal:c2.signal});const r2=s2.body.getReader();const recovered=decoder.decode((await r2.read()).value);assert.match(recovered,/Missed while offline/);await r2.cancel();
});
test('concurrent writes have durable unique sequences; restart preserves history',async t=>{
 const project=mkdtempSync(join(tmpdir(),'team-journal-'));let m=await startMonitor({project,port:0});const c=JSON.parse(readFileSync(m.connection));
 const post=e=>fetch(m.url+'/api/events',{method:'POST',headers:{Authorization:`Bearer ${c.token}`},body:JSON.stringify(e)});
 await post({type:'run.started',runId:'durable',title:'Durable'});
 await Promise.all(Array.from({length:25},(_,i)=>post({type:'task.updated',runId:'durable',taskId:'t'+i,status:'planned',title:'Task '+i})));
 await m.close();m=await startMonitor({project,port:0});t.after(()=>m.close());
 const state=await(await read(m,'/api/state')).json();assert.equal(state.events.length,26);assert.deepEqual(state.events.map(e=>e.seq),Array.from({length:26},(_,i)=>i+1));
});
test('corrupt journal is rejected without rewriting evidence',async()=>{
 const project=mkdtempSync(join(tmpdir(),'team-corrupt-'));const m=await startMonitor({project,port:0});await m.close();const journal=join(project,'.team-monitor/events.jsonl');writeFileSync(journal,'{"partial":');await assert.rejects(startMonitor({project,port:0}),/journal is invalid/);assert.equal(readFileSync(journal,'utf8'),'{"partial":');
});
test('command wrapper preserves failure and does not collect arguments or output',async t=>{
 const m=await fixture(t);await m.post({type:'run.started',runId:'commands',title:'Command outcomes'});
 const r=await cli(['record','--connection',m.connection,'--run','commands','--label','Expected failing probe','--',process.execPath,'-e','console.log("sensitive-test-marker"); process.exit(7)']);assert.equal(r.code,7);
 const state=await(await read(m,'/api/state')).json();const e=state.events.at(-1);assert.equal(e.type,'command.finished');assert.equal(e.exitCode,7);assert.equal(e.source,'command-wrapper');assert.ok(!JSON.stringify(state).includes('sensitive-test-marker'));
 const commands=state.events.filter(e=>e.type.startsWith('command.'));assert.equal(commands[0].commandId,commands[1].commandId);assert.notEqual(commands[0].eventId,commands[1].eventId);
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
 const m=await startMonitor({project,port:0});t.after(()=>m.close());const state=await(await read(m,'/api/state')).json();
 assert.equal(state.events.length,5003);assert.equal(state.events[0].title,'Long run');assert.equal(state.events[1].taskId,'original');assert.equal(state.events[2].agentId,'original');
});

test('malformed request target returns 400 without crashing the monitor',async t=>{
 const m=await fixture(t);const u=new URL(m.url);
 const response=await new Promise((ok,no)=>{const socket=net.connect(Number(u.port),'127.0.0.1',()=>socket.write(`GET http://[ HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`));let text='';socket.on('data',b=>text+=b);socket.on('end',()=>ok(text));socket.on('error',no);});
 assert.match(response,/400/);assert.equal((await read(m,'/api/state')).status,200);
});

test('publishes real report links with matching run identity and safe file boundaries',async t=>{
 const m=await fixture(t);await m.post({type:'run.started',runId:'report-run',title:'Report run'});
 const input=JSON.parse(readFileSync(join(HERE,'../../assets/report-input.example.json'),'utf8'));input.jobId='job';input.runId='report-run';
 const generated=generateReport(input,{project:m.project});const dir=generated.directory;
 const event={type:'report.ready',runId:'report-run',title:'Review report',path:'/reports/job/r001/report.html'};
 assert.equal((await m.post(event)).status,201);
 const response=await read(m,event.path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.match(await response.text(),/report-en/);
 assert.equal((await m.post({...event,path:'https://external.example/report.html'})).status,400);
 assert.equal((await m.post({...event,path:'/reports/job/r002/report.html'})).status,400);
 const record=JSON.parse(readFileSync(join(dir,'report.json'),'utf8'));record.runId='wrong';writeFileSync(join(dir,'report.json'),JSON.stringify(record));assert.equal((await m.post(event)).status,400);
 unlinkSync(join(dir,'report.en.md'));
 record.runId='report-run';writeFileSync(join(dir,'report.json'),JSON.stringify(record));assert.equal((await m.post(event)).status,400);
 const outside=join(m.project,'.team-monitor','connection.json');symlinkSync(outside,join(dir,'report.en.md'));
 assert.equal((await read(m,'/reports/job/r001/report.en.md')).status,404);
 assert.equal((await read(m,'/reports/job/r001/connection.json')).status,404);
});

async function chunkedPost(m, chunks) {
 return new Promise((ok,no)=>{
  const req=http.request(m.url+'/api/events',{method:'POST',headers:{Authorization:`Bearer ${m.c.token}`}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>ok({status:res.statusCode,body}));});
  req.on('error',no);
  (async()=>{for(const chunk of chunks){req.write(chunk);await new Promise(r=>setTimeout(r,10));}req.end();})().catch(no);
 });
}
test('HTTP ingestion preserves split UTF-8 and rejects invalid bytes without persistence',async t=>{
 const m=await fixture(t);
 const event={type:'run.started',runId:'unicode',title:'سلام 🌍',summary:'آزمایش 日本語',details:'é فارسی'};
 const bytes=Buffer.from(JSON.stringify(event)), split=bytes.indexOf(Buffer.from('س'))+1;
 const r=await chunkedPost(m,[bytes.subarray(0,split),bytes.subarray(split,split+2),bytes.subarray(split+2)]);
 assert.equal(r.status,201);const accepted=JSON.parse(r.body);
 for(const key of ['title','summary','details'])assert.equal(accepted[key],event[key]);
 const bad=Buffer.concat([Buffer.from('{"type":"run.started","runId":"bad","title":"'),Buffer.from([0xc3,0x28]),Buffer.from('"}')]);
 assert.equal((await chunkedPost(m,[bad])).status,400);
 assert.equal((await chunkedPost(m,[Buffer.from('{broken')])).status,400);
 assert.equal((await chunkedPost(m,[Buffer.from(' '.repeat(65537))])).status,400);
 assert.equal((await m.post({...event,runId:'complete'})).status,201);
 const lines=readFileSync(join(m.project,'.team-monitor/events.jsonl'),'utf8').trim().split('\n');
 assert.equal(lines.length,2);assert.equal(JSON.parse(lines[0]).title,event.title);
});

test('terminal lifecycle rejects state mutation and preserves late evidence',async t=>{
 const m=await fixture(t);const send=e=>m.post({runId:'life',...e});
 assert.equal((await send({type:'run.started',title:'Lifecycle'})).status,201);
 assert.equal((await send({type:'run.finished',status:'running'})).status,400);
 assert.equal((await send({type:'run.updated',status:'verified'})).status,400);
 await send({type:'task.updated',taskId:'t',status:'review'});
 await send({type:'run.finished',status:'verified'});
 for(const e of [{type:'run.finished',status:'verified'},{type:'run.finished',status:'failed'},{type:'run.updated',status:'running'},{type:'task.updated',taskId:'t',status:'running'},{type:'agent.updated',agentId:'a',status:'working'}])assert.equal((await send(e)).status,400);
 assert.equal((await send({type:'evidence.recorded',title:'Late verification details'})).status,201);
});

test('run lookup does not scan long history on ingestion',async t=>{
 const m=await fixture(t);await m.post({type:'run.started',runId:'indexed',title:'Indexed'});
 for(let i=0;i<20;i++)await m.post({type:'decision.recorded',runId:'indexed',title:'History'});
 const original=Array.prototype.some;let visits=0;
 Array.prototype.some=function(fn,...args){return original.call(this,(e,...rest)=>{if(e?.runId==='indexed' && e?.seq)visits++;return fn(e,...rest);},...args);};
 try {assert.equal((await m.post({type:'decision.recorded',runId:'indexed',title:'Lookup'})).status,201);}finally{Array.prototype.some=original;}
 assert.equal(visits,0,'run existence must use the index');
});


test('failed persistence leaves run index, sequence and published history unchanged',async t=>{
 const m=await fixture(t),file=join(m.project,'.team-monitor/events.jsonl');
 await m.post({type:'run.started',runId:'existing',title:'Existing'});
 renameSync(file,file+'.saved');mkdirSync(file);
 const event={type:'run.started',runId:'retry',title:'Retry after storage recovery'};
 assert.equal((await m.post(event)).status,400);
 rmdirSync(file);renameSync(file+'.saved',file);
 assert.equal((await m.post(event)).status,503);
 const state=await(await read(m,'/api/state')).json();assert.equal(state.events.length,1);
 await m.close();const restarted=await startMonitor({project:m.project,port:0});t.after(()=>restarted.close());
 const c=JSON.parse(readFileSync(restarted.connection));const response=await fetch(restarted.url+'/api/events',{method:'POST',headers:{Authorization:`Bearer ${c.token}`},body:JSON.stringify(event)});assert.equal(response.status,201);assert.equal((await response.json()).seq,2);

});

test('event identities deduplicate delivery, conflicts and concurrent retries',async t=>{
 const m=await fixture(t);const start={type:'run.started',runId:'ids',title:'Identities',eventId:'global-start'};
 const first=await m.post(start);assert.equal(first.status,201);const accepted=await first.json();
 const retry=await m.post(start);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),accepted);
 assert.equal((await m.post({...start,title:'Conflict'})).status,409);
 const event={type:'decision.recorded',runId:'ids',title:'Once',eventId:'one-decision'};
 const responses=await Promise.all(Array.from({length:12},()=>m.post(event)));
 assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===200).length,11);
 const journal=readFileSync(join(m.project,'.team-monitor/events.jsonl'),'utf8');assert.equal(journal.trim().split('\n').length,2);
 const next=await m.post({type:'evidence.recorded',runId:'ids',title:'Next',eventId:'next'});assert.equal((await next.json()).seq,3);
});


test('idempotency recovers on restart and legacy records remain readable',async t=>{
 const project=mkdtempSync(join(tmpdir(),'team-ids-'));let m=await startMonitor({project,port:0});
 let c=JSON.parse(readFileSync(m.connection));
 await emit(c,{type:'run.started',runId:'replay',title:'Replay',eventId:'start'});
 // Legacy clients have no event identity.
 await fetch(m.url+'/api/events',{method:'POST',headers:{Authorization:`Bearer ${c.token}`},body:JSON.stringify({type:'decision.recorded',runId:'replay',title:'Legacy'})});
 const end={type:'run.finished',runId:'replay',status:'finished',eventId:'end'};const accepted=await emit(c,end);
 await m.close();m=await startMonitor({project,port:0});t.after(()=>m.close());c=JSON.parse(readFileSync(m.connection));
 assert.deepEqual(await emit(c,end),accepted);
 assert.equal(readFileSync(join(project,'.team-monitor/events.jsonl'),'utf8').trim().split('\n').length,3);
});
test('client retries a lost response with the same generated identity',async t=>{
 const m=await fixture(t),original=globalThis.fetch;let calls=0;const ids=[];
 globalThis.fetch=async(url,options)=>{ids.push(JSON.parse(options.body).eventId);const response=await original(url,options);if(calls++===0){await response.arrayBuffer();throw new TypeError('Simulated lost response');}return response;};
 try{const event=await emit(m.c,{type:'run.started',runId:'lost',title:'Lost reply'});assert.equal(event.seq,1);}finally{globalThis.fetch=original;}
 assert.equal(calls,2);assert.equal(ids[0],ids[1]);assert.ok(ids[0]);
 assert.equal(readFileSync(join(m.project,'.team-monitor/events.jsonl'),'utf8').trim().split('\n').length,1);
});

test('sensitive reads require separate read authorization and session authority cannot write',async t=>{
 const m=await fixture(t);
 for(const path of ['/api/state','/api/stream','/reports/job/r001/report.html'])assert.equal((await fetch(m.url+path)).status,401);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${m.c.token}`}})).status,401);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:'Bearer invalid'}})).status,401);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${m.c.readToken}`}})).status,200);
 const login=await fetch(m.url+'/api/session',{method:'POST',headers:{Authorization:`Bearer ${m.c.readToken}`}});
 assert.equal(login.status,201);const session=await login.json();assert.ok(session.sessionToken);assert.ok(session.expiresAt);
 assert.equal(login.headers.get('set-cookie'),null);
 assert.equal((await m.post({type:'run.started',runId:'forbidden',title:'Forbidden'},{Authorization:`Bearer ${session.sessionToken}`})).status,401);
 assert.equal((await m.post({type:'run.started',runId:'forbidden',title:'Forbidden'},{Authorization:`Bearer ${m.c.readToken}`})).status,401);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${session.sessionToken}`}})).status,200);
 assert.equal((await fetch(m.url+'/api/session',{method:'DELETE',headers:{Authorization:`Bearer ${session.sessionToken}`}})).status,204);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${session.sessionToken}`}})).status,401);
});


test('partial append failure stops all writes and preserves evidence for inspection',async t=>{
 const m=await fixture(t),original=fs.appendFileSync;
 fs.appendFileSync=(file,data,options)=>{original(file,data.slice(0,20),options);throw Object.assign(new Error('Simulated partial write'),{code:'ENOSPC'});};syncBuiltinESMExports();
 try{assert.equal((await m.post({type:'run.started',runId:'partial',title:'Partial'})).status,400);}finally{fs.appendFileSync=original;syncBuiltinESMExports();}
 const file=join(m.project,'.team-monitor/events.jsonl'),before=readFileSync(file,'utf8');
 assert.equal((await m.post({type:'run.started',runId:'later',title:'Must not append'})).status,503);
 assert.equal(readFileSync(file,'utf8'),before);assert.equal((await(await read(m,'/api/state')).json()).events.length,0);
 await m.close();await assert.rejects(startMonitor({project:m.project,port:0}),/journal is invalid/);
 assert.equal(readFileSync(file,'utf8'),before);
});
test('credential protection verifies platform permissions and fails closed',async t=>{
 const m=await fixture(t),dir=join(m.project,'.team-monitor');
 if(process.platform==='win32'){
  const script=`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;foreach($p in @($env:TEAM_TEST_DIR,$env:TEAM_TEST_FILE)){$acl=Get-Acl -LiteralPath $p;$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));if(!$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].FileSystemRights -ne 'FullControl' -or $rules[0].AccessControlType -ne 'Allow'){exit 1}}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,TEAM_TEST_DIR:dir,TEAM_TEST_FILE:m.connection}});assert.equal(result.status,0,String(result.stderr));
 }else{assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(m.connection).mode&0o777,0o600);}
 assert.throws(()=>protectPaths([dir],{platform:'win32',execute:()=>({status:1})}),/Cannot establish/);
 assert.throws(()=>protectPaths([dir],{platform:'win32',execute:()=>({error:new Error('Missing ACL utility')})}),/Cannot establish/);
 const project=mkdtempSync(join(tmpdir(),'team-unsafe-')),outside=mkdtempSync(join(tmpdir(),'team-outside-'));
 symlinkSync(outside,join(project,'.team-monitor'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(startMonitor({project,port:0}),/private paths/);
});

test('browser session stream revokes on lock, expires and rejects cross-origin login',async t=>{
 const m=await fixture(t),login=()=>fetch(m.url+'/api/session',{method:'POST',headers:{Authorization:`Bearer ${m.c.readToken}`}});
 assert.equal((await fetch(m.url+'/api/session',{method:'POST',headers:{Authorization:`Bearer ${m.c.token}`}})).status,401);
 assert.equal((await fetch(m.url+'/api/session',{method:'POST',headers:{Authorization:`Bearer ${m.c.readToken}`,Origin:'https://malicious.example'}})).status,403);
 const session=await(await login()).json(),headers={Authorization:`Bearer ${session.sessionToken}`};
 const stream=await fetch(m.url+'/api/stream',{headers});const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/snapshot/);
 assert.equal((await fetch(m.url+'/api/session',{method:'DELETE',headers})).status,204);
 assert.equal((await reader.read()).done,true);
 const next=await(await login()).json(),original=Date.now;
 Date.now=()=>next.expiresAt+1;
 try{assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${next.sessionToken}`}})).status,401);}finally{Date.now=original;}
 const shell=await(await fetch(m.url)).text();
 for(const credential of [m.c.token,m.c.captureToken,m.c.readToken,next.sessionToken])assert.ok(!shell.includes(credential));
});
test('browser stream parser handles split Unicode frames and reconnect snapshots',async()=>{
 const {readStream}=await import('./public/stream.js');
 const bytes=Buffer.from('event: snapshot\ndata: {"title":"فارسی 🌍"}\n\nevent: heartbeat\ndata: {}\n\n');
 const chunks=Array.from(bytes,b=>Uint8Array.of(b)),frames=[];
 await readStream(new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}})),(type,data)=>frames.push({type,data}));
 assert.deepEqual(frames,[{type:'snapshot',data:{title:'فارسی 🌍'}},{type:'heartbeat',data:{}}]);
});


test('CLI explicit event identity survives reinvocation and propagates conflicts',async t=>{
 const m=await fixture(t),event={type:'run.started',runId:'cli-retry',title:'CLI retry'};
 const args=['emit','--connection',m.connection,'--event-id','cli-stable','--json',JSON.stringify(event)];
 const first=await cli(args),second=await cli(args);assert.equal(first.code,0);assert.equal(second.code,0);assert.deepEqual(JSON.parse(first.out),JSON.parse(second.out));
 const conflict=await cli([...args.slice(0,-1),JSON.stringify({...event,title:'Conflict'})]);assert.equal(conflict.code,1);assert.match(conflict.out,/Conflicting eventId/);
 for(const eventId of ['', 'bad id', 'x'.repeat(161)])assert.equal((await m.post({type:'decision.recorded',runId:'cli-retry',title:'Bad id',eventId})).status,400);
});
test('session bound revokes oldest session without preventing fresh login',async t=>{
 const m=await fixture(t),tokens=[];
 for(let i=0;i<33;i++){
  const response=await fetch(m.url+'/api/session',{method:'POST',headers:{Authorization:`Bearer ${m.c.readToken}`}});assert.equal(response.status,201);tokens.push((await response.json()).sessionToken);
 }
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${tokens[0]}`}})).status,401);
 assert.equal((await fetch(m.url+'/api/state',{headers:{Authorization:`Bearer ${tokens.at(-1)}`}})).status,200);
});

test('Windows ACL helper isolates inherited PowerShell modules', {skip:process.platform!=='win32'},async t=>{
 const modules=mkdtempSync(join(tmpdir(),'team-module-shadow-')),security=join(modules,'Microsoft.PowerShell.Security');mkdirSync(security);
 writeFileSync(join(security,'Microsoft.PowerShell.Security.psd1'),"@{RootModule='shadow.psm1';ModuleVersion='99.0.0';FunctionsToExport=@('Get-Acl');CmdletsToExport=@()}");
 writeFileSync(join(security,'shadow.psm1'),"function Get-Acl { throw 'Simulated incompatible parent module' };Export-ModuleMember -Function Get-Acl");
 const original=process.env.PSModulePath;
 process.env.PSModulePath=modules+';'+join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
 try{const m=await fixture(t);assert.equal((await read(m,'/api/state')).status,200);}finally{if(original===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=original;}
});
