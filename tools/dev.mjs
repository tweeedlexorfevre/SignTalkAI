// Start the API proxy alongside Vite. Reuse an existing local proxy if present.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const web=fileURLToPath(new URL('../web/',import.meta.url));
const children=[];
try {
  const r=await fetch('http://127.0.0.1:5331/api/health',{signal:AbortSignal.timeout(1000)});
  if(!r.ok)throw Error('Port 5331 is occupied by a server without the SignTalk API.');
} catch(e) {
  if(e.message?.includes('occupied'))throw e;
  children.push(spawn(process.execPath,[fileURLToPath(new URL('./serve.mjs',import.meta.url))],{stdio:'inherit',windowsHide:true}));
}
const vite=spawn(process.execPath,[fileURLToPath(new URL('../web/node_modules/vite/bin/vite.js',import.meta.url)),'--port','5330','--strictPort'],{cwd:web,stdio:'inherit',windowsHide:true});
children.push(vite);
const stop=()=>{for(const child of children)child.kill();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',stop);
vite.on('exit',code=>{stop();process.exitCode=code??0;});
