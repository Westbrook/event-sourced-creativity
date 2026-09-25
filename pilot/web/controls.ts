import './core.css';
document.documentElement.dataset.pilotCore='true';
class PilotControls extends HTMLElement {
 private status!:HTMLElement;
 private async api(path:string,body?:unknown,method=body?'POST':'GET'){
  const r=await fetch(path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error??'Request failed');return result;
 }
 connectedCallback(){
  const root=this.attachShadow({mode:'open'});root.innerHTML=`<style>:host{display:block;background:#e6e8db;color:#262b20;font:13px/1.5 system-ui;padding:8px 20px}summary{cursor:pointer}nav{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 0}a{color:inherit}input,select,button{font:inherit;padding:7px;border:1px solid #727966;border-radius:4px;background:#fff}form{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}p{margin:4px 0}</style><details><summary>Test release · access and navigation</summary><nav><a href="/still">Still projects</a><a href="/projects">Forma projects</a><button id="other">Open this document in the other app</button></nav><p>Manual creation and shared editing. Models, uploads, semantic search and Memory are unavailable.</p><form><label>Share Project with <input type="email" name="email" placeholder="Admitted test account" required></label><select name="role" aria-label="Project access"><option value="viewer">Read</option><option value="editor">Read and edit</option><option value="revoked">Revoke access</option></select><button type="submit">Update access</button></form><button id="delete">Delete selected Idea or Project</button><p role="status"></p></details>`;
  for(const link of root.querySelectorAll<HTMLAnchorElement>('a'))if(new URL(location.href).searchParams.has('progress-report'))link.href+='?progress-report';
  this.status=root.querySelector('[role=status]')!;
  const selection=async()=>this.api('/api/pilot/selection?path='+encodeURIComponent(location.pathname));
  root.querySelector('#other')!.addEventListener('click',()=>void this.run(async()=>{const s=await selection();const currentDocument=/\/document\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];if(!s.documentId)s.documentId=currentDocument;if(!s.documentId)throw Error('Open a document first.');const flag=new URL(location.href).searchParams.has('progress-report')?'?progress-report':'';location.href=(location.pathname.startsWith('/still')?'/document/'+s.documentId+'/test-document':'/still/project/'+s.projectId+'/document/'+s.documentId)+flag;}));
  root.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();void this.run(async()=>{const s=await selection();if(!s.projectId)throw Error('Open a Project first.');const data=new FormData(event.currentTarget as HTMLFormElement);await this.api('/api/pilot/share',{projectId:s.projectId,email:data.get('email'),role:data.get('role')});this.status.textContent='Project access updated.';});});
  root.querySelector('#delete')!.addEventListener('click',()=>void this.run(async()=>{const s=await selection();if(!['idea','project'].includes(s.kind))throw Error('Open an Idea or the Project’s document list. Document-only deletion is unavailable.');if(!confirm('Permanently erase this test '+s.kind+' and its private authored content?'))return;await this.api('/api/pilot/source',{id:s.id},'DELETE');location.href='/still'+(new URL(location.href).searchParams.has('progress-report')?'?progress-report':'');}));
 }
 private async run(fn:()=>Promise<void>){try{this.status.textContent='';await fn();}catch(error){this.status.textContent=error instanceof Error?error.message:'Request failed';}}
}
customElements.define('pilot-controls',PilotControls);
const controls=document.createElement('pilot-controls');document.body.prepend(controls);

if(!location.pathname.startsWith('/still')&&new URL(location.href).searchParams.has('progress-report')){
 const link=document.createElement('a');link.href='http://127.0.0.1:4187/';link.textContent='Progress Report';link.style.cssText='position:fixed;bottom:max(14px,env(safe-area-inset-bottom));right:16px;z-index:99999;background:#e6e8db;color:#262b20;border:1px solid #727966;border-radius:6px;padding:9px 12px;font:13px system-ui';document.body.append(link);
}
