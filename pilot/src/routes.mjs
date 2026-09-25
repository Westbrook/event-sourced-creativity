import {parseStillRoute} from '../../src/still/routes.ts';
// Native parsing, then a bounded pilot surface. Media/provider/admin routes remain unavailable.
export function pageEntry(path){
 const r=parseStillRoute(path);
 if(r&&['projects','documents','ideas','document'].includes(r.view)&&['','actions','new-project','new-document','add-context'].includes(r.mode))return 'still.html';
 if(path==='/projects'||/^\/document\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?\/?$/.test(path))return 'index.html';
 return null;
}
export function apiAllowed(path,method){
 if(method==='GET'&&['/api/session','/api/events','/api/document-jobs','/api/still/history'].includes(path))return true;
 if(method==='POST'&&path==='/api/still/decision')return true;
 return /^\/api\/still\/creation(?:\/|$)/.test(path)&&['GET','POST','PUT','DELETE'].includes(method);
}
