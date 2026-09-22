export class IdeaEditCanceled extends Error { constructor(){super('Edit canceled. Your draft is still here.');} }
/** No write occurs until the user chooses; Escape and lost ownership cancel. */
export function chooseSharedIdeaEdit(titles:string[], documentTitle:string, current:()=>boolean, translate=(s:string)=>s):Promise<'all'|'new'> {
  if(document.querySelector('dialog.shared-idea-choice[open]'))return Promise.reject(new IdeaEditCanceled());
  return new Promise((resolve,reject)=>{
    const focus=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');
    dialog.className='shared-idea-choice';dialog.setAttribute('aria-labelledby','shared-idea-choice-title');
    Object.assign(dialog.style,{maxWidth:'34rem',width:'calc(100% - 2rem)',border:'1px solid var(--border, #888)',borderRadius:'16px',padding:'24px',background:'var(--surface, Canvas)',color:'var(--text, CanvasText)',boxShadow:'0 16px 60px #0004'});
    const heading=document.createElement('h2');heading.id='shared-idea-choice-title';heading.textContent=translate('Where should these changes apply?');
    const description=document.createElement('p');description.textContent=translate('This idea is used in multiple documents:')+' '+titles.join(', ')+'.';
    const detail=document.createElement('p');detail.textContent=documentTitle?translate('Apply changes everywhere, or create a new idea for this document. Other documents will keep the original.')+' '+documentTitle:translate('Apply changes everywhere, or create a new project idea. Existing documents will keep the original.');
    const actions=document.createElement('div');Object.assign(actions.style,{display:'flex',gap:'12px',flexWrap:'wrap',marginTop:'24px'});
    let settled=false;const finish=(choice?:'all'|'new')=>{if(settled)return;settled=true;clearInterval(timer);dialog.close();dialog.remove();if(focus?.isConnected)focus.focus();if(choice&&current())resolve(choice);else reject(new IdeaEditCanceled());};
    const timer=setInterval(()=>{if(!current())finish();},250);
    for(const [label,value] of [['Cancel',''],['Create new idea','new'],['Apply to all documents','all']] as const){const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=translate(label);button.addEventListener('click',()=>finish(value||undefined));actions.append(button);}
    dialog.append(heading,description,detail,actions);dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});document.body.append(dialog);dialog.showModal();actions.querySelector('button')?.focus();
  });
}
