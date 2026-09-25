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
  const users=document.createElement('section');users.innerHTML=`<p><strong id="active-user">Loading test user…</strong></p><p>One Google login controls these separate app test users. Each has its own content, consent and sharing permissions. Switching reloads this tab; save your work first.</p><form id="choose-user"><label>App test user <select name="user" required></select></label><button>Switch user</button></form><form id="create-user"><label>New test user name <input name="displayName" maxlength="80" required></label><button>Create test user</button></form>`;
  root.querySelector('details')!.insertBefore(users,root.querySelector('nav'));
  const choose=users.querySelector<HTMLSelectElement>('select')!;
  const home=()=>location.href='/still'+(new URL(location.href).searchParams.has('progress-report')?'?progress-report':'');
  const switchTo=(id:string)=>{sessionStorage.setItem('still-pilot-test-user',id);home();};
  void this.run(async()=>{
   const result=await this.api('/api/pilot/test-users');let selected='primary';try{selected=sessionStorage.getItem('still-pilot-test-user')||'primary';}catch{/* Primary is available without tab storage. */}
   for(const [index,user] of result.users.entries()){const option=document.createElement('option');option.value=index===0?'primary':user.principal_id;option.textContent=user.display_name+' · '+user.email;choose.append(option);}
   choose.value=selected;
   const active=result.users.find((user:{principal_id:string},index:number)=>selected==='primary'?index===0:user.principal_id===selected);
   users.querySelector('#active-user')!.textContent=active?'App test user: '+active.display_name+' · '+active.email:'Selected test user unavailable — choose another';
   root.querySelector('summary')!.textContent='Test release · '+(active?active.display_name:'user unavailable')+' · access and navigation';
  });
  users.querySelector('#choose-user')!.addEventListener('submit',event=>{event.preventDefault();void this.run(async()=>{if(!confirm('Switch this tab’s test user? Save any pending edits first.'))return;switchTo(choose.value);});});
  users.querySelector('#create-user')!.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement);void this.run(async()=>{const result=await this.api('/api/pilot/test-users',{displayName:data.get('displayName')});this.status.textContent='Created '+result.created.display_name+'. Reload to select them after saving your work.';const option=document.createElement('option');option.value=result.created.principal_id;option.textContent=result.created.display_name+' · '+result.created.email;choose.append(option);});});
  const selection=async()=>this.api('/api/pilot/selection?path='+encodeURIComponent(location.pathname));
  root.querySelector('#other')!.addEventListener('click',()=>void this.run(async()=>{const s=await selection();const currentDocument=/\/document\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];if(!s.documentId)s.documentId=currentDocument;if(!s.documentId)throw Error('Open a document first.');const flag=new URL(location.href).searchParams.has('progress-report')?'?progress-report':'';location.href=(location.pathname.startsWith('/still')?'/document/'+s.documentId+'/test-document':'/still/project/'+s.projectId+'/document/'+s.documentId)+flag;}));
  root.querySelector('input[name=email]')!.closest('form')!.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement);void this.run(async()=>{const s=await selection();if(!s.projectId)throw Error('Open a Project first.');await this.api('/api/pilot/share',{projectId:s.projectId,email:data.get('email'),role:data.get('role')});this.status.textContent='Project access updated.';});});
  root.querySelector('#delete')!.addEventListener('click',()=>void this.run(async()=>{const s=await selection();if(!['idea','project'].includes(s.kind))throw Error('Open an Idea or the Project’s document list. Document-only deletion is unavailable.');if(!confirm('Permanently erase this test '+s.kind+' and its private authored content?'))return;await this.api('/api/pilot/source',{id:s.id},'DELETE');location.href='/still'+(new URL(location.href).searchParams.has('progress-report')?'?progress-report':'');}));
 }
 private async run(fn:()=>Promise<void>){try{this.status.textContent='';await fn();}catch(error){this.status.textContent=error instanceof Error?error.message:'Request failed';}}
}
customElements.define('pilot-controls',PilotControls);
const controls=document.createElement('pilot-controls');document.body.prepend(controls);

if(!location.pathname.startsWith('/still')&&new URL(location.href).searchParams.has('progress-report')){
 const link=document.createElement('a');link.href='http://127.0.0.1:4187/';link.textContent='Progress Report';link.style.cssText='position:fixed;bottom:max(14px,env(safe-area-inset-bottom));right:16px;z-index:99999;background:#e6e8db;color:#262b20;border:1px solid #727966;border-radius:6px;padding:9px 12px;font:13px system-ui';document.body.append(link);
}
