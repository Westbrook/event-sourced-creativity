/** A workflow owns its commands; Still owns their placement and responsive overflow. */
export type WorkflowAction={id:string;label:string;run:()=>void;variant:'primary'|'secondary'|'ghost';disabled?:boolean};
export type WorkflowToolbar={actions:WorkflowAction[];status?:string};
