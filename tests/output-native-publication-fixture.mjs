import assert from 'node:assert/strict';
function splitTop(text,op){
  let depth=0,quoted=false,between=false,start=0;const parts=[];
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==="'"){if(quoted&&text[i+1]==="'"){i++;continue;}quoted=!quoted;continue;}
    if(quoted)continue;
    if(c==='('){depth++;continue;}if(c===')'){depth--;continue;}
    if(depth!==0)continue;
    if(/[A-Za-z_]/u.test(c)&&(i===0||!/[A-Za-z_]/u.test(text[i-1]))){
      const word=text.slice(i).match(/^[A-Za-z_]+/u)[0],upper=word.toUpperCase();
      if(upper==='BETWEEN')between=true;
      else if(upper==='AND'&&between)between=false;
      else if(upper===op){parts.push(text.slice(start,i).trim());start=i+word.length;}
      i+=word.length-1;
    }
  }
  parts.push(text.slice(start).trim());return parts;
}
function unwrap(text){
  text=text.trim();
  while(text[0]==='('){
    let depth=0,quoted=false,end=-1;
    for(let i=0;i<text.length;i++){
      if(text[i]==="'"){if(quoted&&text[i+1]==="'"){i++;continue;}quoted=!quoted;continue;}
      if(quoted)continue;
      if(text[i]==='(')depth++;else if(text[i]===')'&&--depth===0){end=i;break;}
    }
    if(end!==text.length-1)break;text=text.slice(1,-1).trim();
  }
  return text;
}
export function predicateTree(text){
  text=unwrap(text);
  for(const op of ['OR','AND']){
    const parts=splitTop(text,op);if(parts.length<2)continue;
    return {op,terms:parts.flatMap(part=>{const node=predicateTree(part);return node.op===op?node.terms:[node];})};
  }
  return {atom:text.replace(/\s+/gu,' ')};
}
export function publicationParts(source){
  const sql=source.match(/env\.DB\.prepare\(`(UPDATE output_native_storage_writes SET publication_event_id=[\s\S]+?)`\)/u)?.[1];assert.ok(sql);
  const prefix="AND body.redacted_at IS NULL\n       AND ",start=sql.indexOf(prefix)+prefix.length,end=sql.indexOf('\n      ORDER BY completed.sequence',start);
  assert.ok(start>=prefix.length&&end>start);
  return {sql,predicate:sql.slice(start,end),before:sql.slice(0,start),after:sql.slice(end)};
}
