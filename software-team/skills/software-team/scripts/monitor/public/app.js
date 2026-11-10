import { readStream } from './stream.js';
import { applyProjection } from './lifecycle.js';
const projections=new Map(), runEvents=new Map(), sequences=new Set();
function indexEvent(event){if(sequences.has(event.seq))return false;sequences.add(event.seq);let list=runEvents.get(event.runId);if(!list){list=[];runEvents.set(event.runId,list);}list.push(event);applyProjection(projections,event);return true;}
'use strict';
let events=[],total=0,runId='',online=false,lastHeartbeat=0,view='overview',openerKey='';
const $=id=>document.getElementById(id);
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function badge(status){return el('span','badge '+status,status.replaceAll('_',' '));}
function time(value){return value?new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';}
function restoreFocus(key){if(!key)return;const n=[...document.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===key);if(n)n.focus();else if(key.startsWith('event:latest:'))$('all-activity').focus();}
function detail(item,opener){openerKey=opener?.dataset.focusKey||'';$('detail-title').textContent=item.title||item.type||item.taskId;$('detail-content').textContent=JSON.stringify(item,null,2);$('detail').showModal();}
function current(){return runEvents.get(runId)||[];}
function row(e,target){const r=el('div','event-row');r.append(el('span','event-time',time(e.at)),el('span','event-icon',e.type==='message.sent'?'↗':e.type.startsWith('command.')?'⌘':e.type==='decision.recorded'?'◇':'·'));const button=el('button','event-action');button.dataset.focusKey=`event:${target}:${e.seq}`;const content=el('div','event-content');content.append(el('strong','',e.title||e.type.replaceAll('.',' / ')));if(e.summary)content.append(el('p','',e.summary));if(e.result)content.append(el('p','',e.result+(e.exitCode!==undefined?` · exit ${e.exitCode??'signal'}`:'')));content.append(el('small','',[e.agentId,e.taskId,e.type].filter(Boolean).join(' · ')));button.append(content);button.onclick=()=>detail(e,button);r.append(button,el('span','source'+(e.source==='command-wrapper'?' captured':''),e.source==='command-wrapper'?'Captured command':'Agent report'));return r;}
function list(target,items,empty){const root=$(target);root.replaceChildren();if(!items.length){root.append(el('div','empty',empty));return;}for(const e of items)root.append(row(e,target));}
function drawEdges(){const svg=$('edges');svg.replaceChildren();if(view!=='overview')return;const map=$('team-map').getBoundingClientRect();for(const e of current().filter(e=>e.type==='message.sent').slice(-20)){const from=[...document.querySelectorAll('.agent')].find(n=>n.dataset.id===e.agentId),to=[...document.querySelectorAll('.agent')].find(n=>n.dataset.id===e.to);if(!from||!to||from===to)continue;const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();const x1=a.left+a.width/2-map.left,y1=a.top+a.height/2-map.top,x2=b.left+b.width/2-map.left,y2=b.top+b.height/2-map.top;const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${x1} ${y1} Q ${(x1+x2)/2} ${Math.min(y1,y2)-35} ${x2} ${y2}`);path.setAttribute('stroke','#b2c9ba');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.append(path);}}
function render(){
 const focusKey=document.activeElement?.dataset?.focusKey;
 const runs=[...projections.values()];if(!runs.some(e=>e.runId===runId))runId=runs.at(-1)?.runId||'';
 const select=$('runs');select.replaceChildren();if(!runs.length)select.append(new Option('No runs yet',''));for(const r of [...runs].reverse())select.append(new Option(r.title,r.runId));select.value=runId;
 const listEvents=current(),run=projections.get(runId)||{},agents=[...(run.agents?.values()||[])],tasks=[...(run.tasks?.values()||[])];
 $('run-title').textContent=run.title||'Your next build starts here.';$('run-summary').textContent=run.warnings?.length?`Journal warnings: ${run.warnings.map(w=>w.message).join('; ')}`:run.summary||'Start a run from Codex to see your team, tasks, and decisions arrive live.';const status=run.status||(runId?'running':'Awaiting work');$('run-status').className='badge '+status;$('run-status').textContent=status;
 $('metric-agents').textContent=agents.filter(a=>a.status==='working').length;$('metric-tasks').textContent=tasks.filter(t=>['verified','released'].includes(t.status)).length+' / '+tasks.length;$('metric-blockers').textContent=tasks.filter(t=>t.status==='blocked').length;$('metric-events').textContent=listEvents.length;$('nav-count').textContent=listEvents.length;
 $('agents').replaceChildren();$('team-empty').hidden=!!agents.length;for(const a of agents){const n=el('article','agent');n.dataset.id=a.agentId;const top=el('div','agent-top');top.append(el('span','avatar',(a.title||a.agentId).split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase()),badge(a.status));n.append(top,el('h3','',a.title||a.agentId),el('p','',a.role||a.summary||'Assigned specialist'),el('p','agent-id',a.agentId));$('agents').append(n);}
 const messages=listEvents.filter(e=>e.type==='message.sent').slice(-3).reverse();$('messages').replaceChildren();for(const m of messages){const n=el('div','message');n.append(el('strong','',`${m.agentId} → ${m.to}`),el('span','',m.summary));$('messages').append(n);}$('messages').hidden=!messages.length;
 const columns=[['planned','Planned'],['running','In progress'],['review','In review'],['blocked','Blocked'],['verified','Verified / released']];$('board').replaceChildren();for(const [key,name]of columns){const col=el('section','column'),items=tasks.filter(t=>t.status===key||(key==='verified'&&t.status==='released'));const head=el('div','column-title');head.append(el('span','',name),el('span','',String(items.length)));col.append(head);if(!items.length)col.append(el('div','column-empty','No tasks'));for(const t of items){const n=el('button','task');n.dataset.focusKey=`task:${t.taskId}`;n.append(el('small','',t.taskId),el('strong','',t.title||t.taskId),el('span','owner',t.agentId||'Unassigned'));if(t.status==='blocked'&&t.summary)n.append(el('p','blocked-label',t.summary));n.onclick=()=>detail(t,n);col.append(n);}$('board').append(col);}
 list('latest',[...listEvents].reverse().slice(0,6),'Activity will appear here as work is recorded.');renderActivity();list('evidence-list',[...listEvents].reverse().filter(e=>['evidence.recorded','decision.recorded','command.finished','report.ready'].includes(e.type)),'No evidence or decisions recorded for this run.');$('window-note').textContent=total>events.length?`Showing the latest ${events.length} of ${total} recorded events. Full history remains in the local journal.`:'';renderReports(listEvents);if(!$('detail').open)restoreFocus(focusKey);requestAnimationFrame(drawEdges);updateHealth();
}
function renderReports(items){
 const root=$('reports-list');root.replaceChildren();const reports=items.filter(e=>e.type==='report.ready').reverse();
 if(!reports.length){root.append(el('div','empty','No reports published for this run yet. Reports appear when the team hands off its work.'));return;}
 for(const e of reports){const card=el('article','report-card');card.append(el('h3','',e.title),el('p','quiet',e.summary||'Bilingual technical report'));
 const links=el('div','report-links');for(const [file,label]of [['report.html','Open bilingual report ↗'],['report.en.md','English Markdown'],['report.fa.md','گزارش فارسی']]){const a=el('a','',label);a.href=e.path.replace('report.html',file);a.target='_blank';a.rel='noopener noreferrer';a.onclick=event=>openReport(event,a.href);a.dataset.focusKey=`report:${e.seq}:${file}`;links.append(a);}card.append(links,el('p','quiet',`${time(e.at)} · ${e.source}`));root.append(card);}
}
function renderActivity(){const q=$('search').value.toLowerCase();list('activity-list',[...current()].reverse().filter(e=>!q||JSON.stringify(e).toLowerCase().includes(q)),'No matching events.');}
function updateHealth(){const connected=online&&Date.now()-lastHeartbeat<15000;$('connection').textContent=connected?'● Live connection':'○ Disconnected · reconnecting';$('connection').className='connection '+(connected?'live':'offline');$('side-dot').className='dot'+(connected?' online':'');$('side-status').textContent=connected?'Monitor connected':'Monitor disconnected';const e=current().at(-1);$('last-activity').textContent=time(e?.at);if(!e){$('activity-age').textContent='No activity recorded';return;}const seconds=Math.max(0,Math.floor((Date.now()-new Date(e.at).getTime())/1000));const ended=projections.get(runId)?.finished;$('activity-age').textContent=ended?'Run ended · historical activity':seconds>60?`No team update for ${Math.floor(seconds/60)}m · activity stale`:`${seconds}s ago · reported activity`;}
function setView(next){view=next;for(const name of ['overview','activity','evidence','reports'])$(name+'-view').hidden=name!==view;for(const button of document.querySelectorAll('[data-view]')){const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}requestAnimationFrame(drawEdges);}
for(const n of document.querySelectorAll('[data-view]'))n.onclick=()=>setView(n.dataset.view);$('all-activity').onclick=()=>setView('activity');$('runs').onchange=e=>{runId=e.target.value;render();};$('search').oninput=renderActivity;$('close-detail').onclick=()=>$('detail').close();$('detail').addEventListener('close',()=>restoreFocus(openerKey));window.addEventListener('resize',drawEdges);setInterval(updateHealth,1000);
let sessionToken='',streamController;
function receive(type,data){
 if(type==='snapshot'){events=data.events;projections.clear();runEvents.clear();sequences.clear();for(const event of events)indexEvent(event);total=data.totalEvents;$('project-path').textContent=data.project;}
 if(type==='update'){if(!indexEvent(data))return;events.push(data);total=data.seq;}
 online=true;lastHeartbeat=Date.now();if(type==='heartbeat')updateHealth();else render();
}
function lock(message=''){
 sessionToken='';streamController?.abort();for(const target of reportWindows)target.close();reportWindows.clear();online=false;events=[];total=0;projections.clear();runEvents.clear();sequences.clear();
 $('detail').close();$('detail-content').textContent='';$('detail-title').textContent='';$('project-path').textContent='Monitor locked';$('dashboard').hidden=true;$('login').hidden=false;$('login-error').textContent=message;render();$('read-credential').focus();
}
async function connect(){
 const credential=sessionToken,controller=new AbortController();streamController=controller;
 while(sessionToken===credential && !controller.signal.aborted){
  try{
   const response=await fetch('/api/stream',{headers:{Authorization:`Bearer ${credential}`},signal:controller.signal});
   if(response.status===401){lock('Session expired or monitor restarted. Connect again.');return;}
   if(!response.ok)throw new Error('Stream unavailable');
   await readStream(response,receive);
  }catch{online=false;updateHealth();}
  if(controller.signal.aborted)return;
  await new Promise(resolve=>{const abort=()=>{clearTimeout(timer);resolve();},timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},1000);controller.signal.addEventListener('abort',abort,{once:true});});
 }
}
$('login-form').onsubmit=async event=>{
 event.preventDefault();let credential=$('read-credential').value;$('read-credential').value='';
 try{
  const request=fetch('/api/session',{method:'POST',headers:{Authorization:`Bearer ${credential}`}});credential='';
  const response=await request;if(!response.ok)throw new Error('Unable to unlock. Check the current read credential.');
  const session=await response.json();sessionToken=session.sessionToken;$('login').hidden=true;$('dashboard').hidden=false;$('login-error').textContent='';connect();
 }catch(error){$('login-error').textContent=error.message;}
};
$('logout').onclick=async()=>{const credential=sessionToken;lock();try{await fetch('/api/session',{method:'DELETE',headers:{Authorization:`Bearer ${credential}`}});}catch{}};
const reportWindows=new Set();
function validReportPath(path){return typeof path==='string'&&/^\/reports\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/r[0-9]{3,4}\/(?:report\.html|report\.en\.md|report\.fa\.md)$/.test(path);}
function reportContent(text,path,html){
 if(!html)return {content:text,type:'text/plain;charset=utf-8'};
 if(!/<head>/i.test(text))throw new Error('Invalid report document');
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
 const job=path.split('/')[2];
 const script=`(()=>{const job=${JSON.stringify(job)};function note(text){const item=document.createElement('p');item.textContent=text;document.body.prepend(item);}document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const href=link.getAttribute('href')||'';if(href==='#report-en'||href==='#report-fa')return;const previous=/^\\.\\.\\/(r[0-9]{3,4})\\/report\\.html$/.exec(href);if(!previous){event.preventDefault();note('Invalid report link.');return;}event.preventDefault();if(window.opener)window.opener.postMessage({type:'report-navigation',path:'/reports/'+job+'/'+previous[1]+'/report.html'},location.origin);else note('Return to the dashboard to open this revision.');});window.addEventListener('message',event=>{if(event.source!==window.opener||event.origin!==location.origin||event.data?.type!=='report-navigation-error')return;note('Report unavailable or session expired. Return to the dashboard and unlock again.');});})();`;
 const policy=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">${script}</script>`;
 return {content:text.replace(/<head>/i,`<head>${policy}`),type:'text/html;charset=utf-8'};
}
async function showReport(target,path,credential){
 if(!validReportPath(path)||!credential)throw new Error('Report unavailable or session expired');
 const response=await fetch(path,{headers:{Authorization:`Bearer ${credential}`}});
 if(!response.ok||sessionToken!==credential)throw new Error('Report unavailable or session expired');
 const html=path.endsWith('.html'),{content,type}=reportContent(await response.text(),path,html);
 const blob=URL.createObjectURL(new Blob([content],{type}));target.location.replace(blob);setTimeout(()=>URL.revokeObjectURL(blob),60000);
}
window.addEventListener('message',async event=>{
 if(event.origin!==location.origin||!reportWindows.has(event.source)||event.data?.type!=='report-navigation')return;
 const path=event.data.path;if(!validReportPath(path))return;
 try{await showReport(event.source,path,sessionToken);}catch{event.source.postMessage({type:'report-navigation-error'},location.origin);}
});
async function openReport(event,url){
 event.preventDefault();let parsed;try{parsed=new URL(url,location.href);}catch{return;}if(parsed.origin!==location.origin||!validReportPath(parsed.pathname))return;
 const target=window.open('about:blank','_blank');if(!target){$('login-error').textContent='Allow a new tab to open this report.';return;}reportWindows.add(target);
 try{await showReport(target,parsed.pathname,sessionToken);}catch(error){reportWindows.delete(target);target.close();$('login-error').textContent=error.message;}
}
render();
