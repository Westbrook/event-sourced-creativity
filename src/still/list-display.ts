export type ListType='projects'|'documents'|'ideas'|'results';
export const LIST_PAGE_SIZE=3;
const types:ListType[]=['projects','documents','ideas','results'];
export function listType(view:string,mode='',blockId=''):ListType|undefined{
 if(mode||blockId)return;
 return view==='document'&&!blockId?'ideas':types.includes(view as ListType)?view as ListType:undefined;
}
export class ListDisplay {
 all=false;remember=false;private key='';private type?:ListType;private cached:Partial<Record<ListType,boolean>>={};
 constructor(private storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  try{this.remember=storage?.getItem('still:flag:remember-lists')==='true';if(this.remember){const raw=JSON.parse(storage?.getItem('still:list-display')??'{}');for(const type of types)if(typeof raw?.[type]==='boolean')this.cached[type]=raw[type];}}catch{}
 }
 enter(key:string,type?:ListType){if(key===this.key&&type===this.type)return;this.key=key;this.type=type;this.all=type ? (this.remember ? this.cached[type] : undefined) ?? (type==='ideas') : false;}
 leave(){this.key='';this.type=undefined;this.all=false;}
 set(all:boolean){this.all=all;if(this.remember&&this.type){this.cached[this.type]=all;this.save();}}
 setRemember(value:boolean){this.remember=value;if(value&&this.type)this.cached[this.type]=this.all;if(!value)this.cached={};try{this.storage?.setItem('still:flag:remember-lists',String(value));}catch{}this.save();}
 private save(){try{if(this.remember)this.storage?.setItem('still:list-display',JSON.stringify(this.cached));else this.storage?.removeItem('still:list-display');}catch{}}
}
export function listControls(type:ListType|undefined,all:boolean,page:number,count:number){
 if(!type)return [];
 return [...(!all&&page>0?[{id:'ui:previous-page',label:'Previous page'}]:[]),...(!all&&(page+1)*LIST_PAGE_SIZE<count?[{id:'ui:next-page',label:'Next page'}]:[]),...(count>LIST_PAGE_SIZE?[{id:all?'ui:show-less':'ui:show-all',label:all?'Show less':'Show all'}]:[])];
}
