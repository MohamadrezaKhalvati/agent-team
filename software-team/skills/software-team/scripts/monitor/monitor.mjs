#!/usr/bin/env node
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, openSync, closeSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateReport } from '../reports/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = new Set(['run.started','run.updated','run.finished','agent.updated','task.updated','message.sent','decision.recorded','evidence.recorded','report.ready','command.started','command.finished']);
const TASK_STATES = new Set(['planned','running','blocked','review','verified','released']);
const AGENT_STATES = new Set(['working','waiting','done','blocked']);
const RUN_STATES = new Set(['running','blocked','review','verified','failed','finished']);
const fields = ['runId','agentId','taskId','to','title','summary','details','role','status','path','result','command','commandId','exitCode','signal','durationMs'];
const fail = message => { throw new Error(message); };
function equal(a,b) { const x=Buffer.from(a||''), y=Buffer.from(b||''); return x.length===y.length && timingSafeEqual(x,y); }
export function validate(input, source='agent-reported') {
  if (!input || typeof input!=='object' || Array.isArray(input) || !TYPES.has(input.type)) fail('Unknown event type');
  if (source!=='command-wrapper' && input.type.startsWith('command.')) fail('Command events require the record command');
  const out={type:input.type,source};
  for (const k of fields) if (input[k]!==undefined) {
    const v=input[k];
    if (['exitCode','durationMs'].includes(k)) {
      if (v!==null && (!Number.isFinite(v) || (k==='durationMs' && v<0))) fail(`Invalid ${k}`);
    } else if (typeof v!=='string' || v.length>12000) fail(`Invalid ${k}`);
    out[k]=v;
  }
  if (!out.runId || !/^[\w.-]{1,100}$/.test(out.runId)) fail('Valid runId required');
  for (const k of ['agentId','taskId','to','commandId']) if (out[k] && !/^[\w./-]{1,160}$/.test(out[k])) fail(`Invalid ${k}`);
  if (out.type==='run.started' && !out.title) fail('Run title required');
  if (out.type==='task.updated' && (!out.taskId || !TASK_STATES.has(out.status))) fail('Task id and valid status required');
  if (out.type==='agent.updated' && (!out.agentId || !AGENT_STATES.has(out.status))) fail('Agent id and valid status required');
  if (out.type==='message.sent' && (!out.agentId || !out.to || !out.summary)) fail('Message sender, recipient and summary required');
  if (out.type==='run.updated' && !RUN_STATES.has(out.status)) fail('Valid run status required');
  if (out.type==='run.finished' && !RUN_STATES.has(out.status)) fail('Final run status required');
  if (['decision.recorded','evidence.recorded'].includes(out.type) && !out.title) fail('Title required');
  if (out.type==='report.ready' && (!out.title || !/^\/reports\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/r[0-9]{3,4}\/report\.html$/.test(out.path || ''))) fail('Report title and safe report path required');
  return out;
}
function reportFile(project, reportPath) {
  if(!/^\/reports\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/r[0-9]{3,4}\/(report\.html|report\.en\.md|report\.fa\.md|report\.json|diagram\.en\.svg|diagram\.fa\.svg)$/.test(reportPath)) fail('Invalid report path');
  const projectRoot=realpathSync(project), root=realpathSync(join(projectRoot,'docs','team-reports'));
  const target=realpathSync(join(root,reportPath.slice('/reports/'.length)));
  if(!root.startsWith(projectRoot+sep) || !target.startsWith(root+sep)) fail('Report path outside project');
  return target;
}
export async function startMonitor({project=process.cwd(),port=4317}={}) {
  project=resolve(project);
  const dir=join(project,'.team-monitor'); mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700);
  const lock=join(dir,'writer.lock');
  function acquire(){const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid}));}finally{closeSync(fd);}}
  try{acquire();}catch(error){
    if(error.code!=='EEXIST')throw error;
    let pid;try{pid=JSON.parse(readFileSync(lock,'utf8')).pid;}catch{fail('Invalid writer lock; preserve and inspect it before restarting.');}
    if(!Number.isInteger(pid)||pid<=0)fail('Invalid writer lock process id');
    try{process.kill(pid,0);fail('A monitor writer is already running for this project. Reuse connection.json.');}
    catch(check){if(check.code!=='ESRCH')throw check;}
    fail('Stale writer lock found. Confirm the recorded process is gone, then remove only .team-monitor/writer.lock before restarting.');
  }
  try {
    const monitor=await startUnlocked({project,port});
    const close=monitor.close;
    monitor.close=async()=>{await close();if(existsSync(lock))unlinkSync(lock);};
    return monitor;
  }catch(error){if(existsSync(lock))unlinkSync(lock);throw error;}
}
async function startUnlocked({project,port}) {
  project=resolve(project);
  const dir=join(project,'.team-monitor'); mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700);
  const journal=join(dir,'events.jsonl'), connection=join(dir,'connection.json');
  let events=[];
  if(existsSync(journal)) {
    const lines=readFileSync(journal,'utf8').split('\n').filter(Boolean);
    try { events=lines.map((line,i)=>{const e=JSON.parse(line); if(e.seq!==i+1 || typeof e.at!=='string') fail('Invalid sequence'); validate(e,e.source); return e;}); }
    catch { fail('Event journal is invalid. Preserve it and repair or archive it before restarting.'); }
  }
  const token=randomBytes(32).toString('hex'), captureToken=randomBytes(32).toString('hex');
  const clients=new Set();
  let url='';
  const snapshot=()=>({version:1,serverTime:new Date().toISOString(),project,events,totalEvents:events.length,coverage:'Agent-reported coordination and wrapped commands only. No hidden reasoning or automatic host-wide interception.'});
  function send(res,event,data){ if(res.writableLength>1024*1024){res.destroy();return;}res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const expected=new URL(url);
    if(![expected.host,`localhost:${expected.port}`].includes(req.headers.host)) {res.writeHead(403).end('Invalid host');return;}
    const origin=req.headers.origin;
    if((origin && ![url,`http://localhost:${expected.port}`].includes(origin)) || req.headers['sec-fetch-site']==='cross-site') {res.writeHead(403).end('Invalid origin');return;}
    let path;try{path=new URL(req.url,url).pathname;}catch{res.writeHead(400).end('Invalid URL');return;}
    if(req.method==='GET' && path==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;}
    if(req.method==='GET' && path==='/api/stream'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});clients.add(res);send(res,'snapshot',snapshot());
      req.on('close',()=>clients.delete(res));return;
    }
    if(req.method==='POST' && path==='/api/events'){
      if(!equal(req.headers.authorization,`Bearer ${token}`)){res.writeHead(401).end('Unauthorized');return;}
      let text='';
      try {
        for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536) fail('Event too large');}
        const source=equal(req.headers['x-capture-token'],captureToken)?'command-wrapper':'agent-reported';
        const value=validate(JSON.parse(text),source);
        if(value.type==='run.started' && events.some(e=>e.runId===value.runId)) fail('Run already exists');
        if(value.type!=='run.started' && !events.some(e=>e.type==='run.started' && e.runId===value.runId)) fail('Run does not exist');
        if(value.type==='report.ready') {
          for(const name of ['report.html','report.json','report.en.md','report.fa.md','diagram.en.svg','diagram.fa.svg']) reportFile(project,value.path.replace('report.html',name));
          const record=JSON.parse(readFileSync(reportFile(project,value.path.replace('report.html','report.json')),'utf8'));
          validateReport(record);
          const parts=value.path.split('/');
          if(record.runId!==value.runId || record.jobId!==parts[2] || `r${String(record.revision).padStart(3,'0')}`!==parts[3]) fail('Report identity does not match event');
        }
        const event={...value,seq:events.length+1,at:new Date().toISOString()};
        appendFileSync(journal,JSON.stringify(event)+'\n',{mode:0o600}); events.push(event);
        for(const client of clients)send(client,'update',event);
        res.writeHead(201,{'Content-Type':'application/json'}).end(JSON.stringify(event));
      } catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
      return;
    }
    const reportMatch=path.match(/^\/reports\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/(r[0-9]{3,4})\/(report\.html|report\.en\.md|report\.fa\.md|report\.json|diagram\.en\.svg|diagram\.fa\.svg)$/);
    if(req.method==='GET' && reportMatch){
      try {
        const target=reportFile(project,path);
        const filename=reportMatch[3];
        const type=filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.json')?'application/json':'text/plain; charset=utf-8';
        res.setHeader('Content-Type',type);
        res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        res.end(readFileSync(target));
      }catch{res.writeHead(404).end('Report not found');}return;
    }
    const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
    if(req.method==='GET' && files[path]){ const [name,type]=files[path];res.setHeader('Content-Type',type);res.end(readFileSync(join(HERE,'public',name)));return; }
    res.writeHead(404).end('Not found');
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
  url=`http://127.0.0.1:${server.address().port}`;
  writeFileSync(connection,JSON.stringify({url,token,captureToken,pid:process.pid},null,2),{mode:0o600});chmodSync(connection,0o600);
  const beat=setInterval(()=>{for(const client of clients)send(client,'heartbeat',{serverTime:new Date().toISOString()});},5000);beat.unref();
  return {url,connection,server,close:async()=>{clearInterval(beat);for(const client of clients)client.end();await new Promise(ok=>server.close(ok));}};
}
function options(args){const out={};for(let i=0;i<args.length;i++){if(args[i]==='--'){out.command=args.slice(i+1);break;}if(!args[i].startsWith('--') || !args[i+1]) fail('Expected --option value');out[args[i].slice(2)]=args[++i];}return out;}
async function loadConnection(file){const c=JSON.parse(readFileSync(resolve(file),'utf8'));const u=new URL(c.url);if(u.protocol!=='http:' || u.hostname!=='127.0.0.1')fail('Connection must use loopback HTTP');return c;}
async function emit(c,event,captured=false){const res=await fetch(c.url+'/api/events',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${c.token}`,...(captured?{'X-Capture-Token':c.captureToken}:{})},body:JSON.stringify(event)});if(!res.ok)fail(`Monitor rejected event: ${await res.text()}`);return res.json();}
async function main(){
  const [action,...args]=process.argv.slice(2), opt=options(args);
  if(action==='start'){
    const p=opt.port===undefined?4317:Number(opt.port); if(!Number.isInteger(p)||p<0||p>65535)fail('Invalid port');
    const monitor=await startMonitor({project:opt.project,port:p});
    console.log(JSON.stringify({url:monitor.url,connection:monitor.connection,pid:process.pid}));
    let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await monitor.close();process.exit(0);});return;
  }
  if(!opt.connection)fail('--connection is required'); const c=await loadConnection(opt.connection);
  if(action==='emit'){let input=opt.json;if(opt.file)input=readFileSync(opt.file,'utf8');if(!input)fail('--json or --file required');console.log(JSON.stringify(await emit(c,JSON.parse(input))));return;}
  if(action==='record'){
    if(!opt.run || !opt.command?.length)fail('record requires --run id -- command args');
    const commandId=randomBytes(8).toString('hex'), started=Date.now();
    const base={runId:opt.run,agentId:opt.agent||'coordinator',taskId:opt.task,commandId};
    // Arguments and output are deliberately excluded: they may contain secrets.
    await emit(c,{...base,type:'command.started',command:opt.command[0],title:opt.label||'Command execution'},true);
    const result=await new Promise(ok=>{const child=spawn(opt.command[0],opt.command.slice(1),{cwd:opt.cwd?resolve(opt.cwd):process.cwd(),stdio:'inherit',shell:false});child.once('error',error=>ok({code:127,signal:null,error:error.message}));child.once('exit',(code,signal)=>ok({code,signal}));});
    try{await emit(c,{...base,type:'command.finished',title:opt.label||'Command execution',exitCode:result.code,signal:result.signal||'',durationMs:Date.now()-started,result:result.error|| (result.code===0?'passed':'failed')},true);}catch(error){console.error('COMMAND FINISHED BUT TELEMETRY FAILED:',error.message);process.exitCode=result.code||1;return;}
    process.exitCode=result.code??1;return;
  }
  fail('Use start, emit, or record');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
