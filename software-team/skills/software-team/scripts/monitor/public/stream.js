// Fetch streaming permits header authorization; credentials never enter EventSource URLs.
export async function readStream(response, receive) {
 const reader=response.body.getReader(), decoder=new TextDecoder();let pending='';
 try {
  while(true) {
   const {value,done}=await reader.read();if(done)break;
   pending+=decoder.decode(value,{stream:true});
   let boundary;
   while((boundary=pending.indexOf('\n\n'))>=0){
    const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
    const lines=frame.split('\n'), type=lines.find(l=>l.startsWith('event: '))?.slice(7);
    const data=lines.filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n');
    if(type && data)receive(type,JSON.parse(data));
   }
  }
 } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
