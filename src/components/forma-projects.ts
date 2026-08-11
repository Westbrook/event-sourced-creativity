import { html } from "lit";
import { FormaElement, icon } from "./forma-element";

export class FormaProjects extends FormaElement {
  #creating=false;#name="";
  protected override updated(){const dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");if(dialog&&!dialog.open)dialog.showModal();}
  #openCreate(){this.#creating=true;this.#name="";this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLInputElement>(".project-create-dialog input")?.focus());}
  #close(){this.querySelector<HTMLDialogElement>(".project-create-dialog")?.close();this.#creating=false;this.requestUpdate();}
  async #create(event:SubmitEvent){event.preventDefault();const name=this.#name.trim();if(!name)return;const projectId=crypto.randomUUID();const documentId=crypto.randomUUID();const appended=await this.store.appendBatch([
    {type:"ProjectCreated",payload:{project_id:projectId,name,state:"active"}},
    {type:"DocumentCreated",payload:{project_id:projectId,document_id:documentId,handle:"untitled",title:"Untitled document"}},
    {type:"EmptyCanvasChosen",payload:{project_id:projectId,document_id:documentId,source_surface:"projects"}},
  ]);if(appended.length){this.#close();this.store.setRoute("/");this.store.toast(`${name} created with a blank document.`);}}
  override render(){const p=this.store.projection.get();return html`<section class="projects-page page-pad">
    <header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Your creative workspaces</span><h1>Projects</h1><p>Each project is a replayable boundary for its documents, collections, context, outputs, and creative memory.</p></div><div class="page-header-actions"><button class="button primary" @click=${this.#openCreate}>${icon("plus")} New project</button></div></header>
    <div class="projects-grid">${p.projects.map((project)=>html`<article class="project-card ${project.id===p.projectId?"current":""}"><header><span class=${`project-status ${project.state}`}>${project.state}</span><small>${project.id===p.projectId?"Currently open":`Created at event #${project.createdSequence}`}</small></header><h2>${project.name}</h2><div class="project-card-metrics"><span><b>${project.documentCount}</b> documents</span><span><b>${project.collectionCount}</b> collections</span><span><b>${project.blockCount}</b> context blocks</span><span><b>${project.outputCount}</b> outputs</span></div><footer><button class="button ${project.id===p.projectId?"secondary":"primary"}" @click=${()=>this.store.openProject(project.id,"/")}>Open ${icon("arrow")}</button><button class="button ghost" @click=${async()=>{await this.store.openProject(project.id,"/studio/project");}}>Project contents</button></footer></article>`)}</div>
    ${this.#creating?html`<dialog class="modal project-create-dialog" closedby="any" aria-labelledby="new-project-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}} @close=${()=>{if(this.#creating){this.#creating=false;this.requestUpdate();}}}><form class="modal-card" @submit=${this.#create}><button type="button" class="icon-button modal-close" aria-label="Close" @click=${this.#close}>${icon("close")}</button><span class="eyebrow">New replayable workspace</span><h2 id="new-project-title">Name your project</h2><p>Forma will create one genuinely blank document. Context appears only after you add it.</p><label>Project name<input required maxlength="80" placeholder="e.g. Autumn campaign" .value=${this.#name} @input=${(event:InputEvent)=>{this.#name=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><footer><button type="button" class="button ghost" @click=${this.#close}>Cancel</button><button class="button primary" ?disabled=${!this.#name.trim()}>Create project</button></footer></form></dialog>`:""}
  </section>`;}
}
customElements.define("forma-projects",FormaProjects);
