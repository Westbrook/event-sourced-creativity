import {LitElement,html} from 'lit';
import {guard} from 'lit/directives/guard.js';
import './vendor/elements/define/rich-text-editor.js';
import type {EnRichTextEditor} from './vendor/elements/rich-text-editor.js';
import type {CreativeBlock} from '../model/events.ts';
import {canAttachProjectIdea} from '../model/project-ideas.ts';
import type {IdeaBodyV1} from '../model/idea-body.ts';
import type {RichDocument} from './vendor/elements/rich-document.js';
/** Saved Idea editing uses exactly the same portable document as creation. */
export class StillIdeaBodyEditor extends LitElement {
  static properties={body:{attribute:false},blocks:{attribute:false},projectId:{},blockId:{},disabled:{type:Boolean}};
  body!:IdeaBodyV1;blocks:CreativeBlock[]=[];projectId='';blockId='';disabled=false;
  private editor?:EnRichTextEditor;private disposers:Array<()=>void>=[];
  createRenderRoot(){return this;}
  disconnectedCallback(){this.dispose();super.disconnectedCallback();}
  private dispose(){this.disposers.forEach(fn=>fn());this.disposers=[];this.editor=undefined;}
  protected updated(){
    const editor=this.querySelector<EnRichTextEditor>('en-rich-text-editor');if(!editor||editor===this.editor)return;this.dispose();this.editor=editor;
    this.disposers.push(editor.registerExtension({id:'saved-idea-references',trigger:'@',label:'Reference an Idea',provide:({query,signal})=>signal.aborted?[]:this.blocks.filter(block=>canAttachProjectIdea(block)&&block.id!==this.blockId&&block.projectId===this.projectId&&block.handle.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,20).map(block=>({id:block.id,label:block.handle,insert:[{kind:'token' as const,id:crypto.randomUUID(),type:'still-idea-reference',text:`@${block.handle}`,label:block.handle,data:{schemaVersion:1,kind:'idea-reference',projectId:block.projectId,blockId:block.id}}]}))}));
    this.disposers.push(editor.registerToken('still-idea-reference',token=>document.createTextNode(token.text),{extension:'saved-idea-references',deleteBehavior:'edit'}));
  }
  render(){return html`<en-rich-text-editor label="Idea" .document=${guard([this.blockId],()=>this.body.document)} .disabled=${this.disabled} @en-change=${(event:CustomEvent<{proposed:RichDocument}>)=>this.dispatchEvent(new CustomEvent('idea-body-change',{detail:{schemaVersion:1,document:event.detail.proposed},bubbles:true}))}></en-rich-text-editor><p>Use @ to choose an Idea from this Project. Save preserves each reference’s identity.</p>`;}
}
if(!customElements.get('still-idea-body-editor'))customElements.define('still-idea-body-editor',StillIdeaBodyEditor);
