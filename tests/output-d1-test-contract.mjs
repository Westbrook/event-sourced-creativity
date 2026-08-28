import assert from 'node:assert/strict';
const nonFunctions=new Set(['IN','EXISTS','VALUES','CHECK','KEY','UNIQUE','ON','AS','OVER','FILTER','TABLE','TRIGGER','INDEX','SELECT','WITH']);
const builtinFunctions=new Set('ABS AVG CAST CEIL CEILING CHANGES CHAR COALESCE CONCAT CONCAT_WS COUNT DATE DATETIME FLOOR FORMAT GLOB GROUP_CONCAT HEX IF IFNULL IIF INSTR JULIANDAY LAST_INSERT_ROWID LENGTH LIKELIHOOD LIKELY LOAD_EXTENSION LOWER LTRIM MAX MIN MOD NULLIF OCTET_LENGTH POW POWER PRINTF QUOTE RANDOM RANDOMBLOB REPLACE ROUND RTRIM SIGN SOUNDEX SQLITE_VERSION STRFTIME STRING_AGG SUBSTR SUBSTRING SUM TIME TIMEDIFF TOTAL TOTAL_CHANGES TRIM TRUNC TYPEOF UNHEX UNICODE UNLIKELY UNIXEPOCH UPPER ZEROBLOB'.split(' '));

// Count SQL function arguments without treating commas in strings, identifiers,
// comments, nested expressions or IN lists as arguments to the outer function.
export function sqlFunctionArities(sql){
  const tokens=[];
  for(let i=0;i<sql.length;){
    const c=sql[i];
    if(/\s/u.test(c)){i++;continue;}
    if(c==='-'&&sql[i+1]==='-'){while(i<sql.length&&sql[i]!=='\n')i++;continue;}
    if(c==='/'&&sql[i+1]==='*'){const end=sql.indexOf('*/',i+2);i=end<0?sql.length:end+2;continue;}
    if(c==="'"||c==='"'||c==='`'||c==='['){const end=c==='['?']':c;i++;while(i<sql.length){if(sql[i]===end){if(sql[i+1]===end){i+=2;continue;}i++;break;}i++;}tokens.push({kind:'literal',value:'literal'});continue;}
    const identifier=/^[A-Za-z_][A-Za-z0-9_]*/u.exec(sql.slice(i));
    if(identifier){tokens.push({kind:'identifier',value:identifier[0]});i+=identifier[0].length;continue;}
    tokens.push({kind:'punctuation',value:c});i++;
  }
  const stack=[],calls=[];
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i];
    if(token.value==='('){
      if(stack.length)stack.at(-1).content=true;
      const previous=tokens[i-1],name=previous?.kind==='identifier'?previous.value.toUpperCase():null;
      stack.push({name:name&&!nonFunctions.has(name)&&(name.startsWith('JSON_')||name.startsWith('JSONB_')||builtinFunctions.has(name))?name:null,commas:0,content:false});
    }else if(token.value===')'){
      const current=stack.pop();if(current?.name)calls.push({name:current.name,args:current.content?current.commas+1:0});
    }else if(token.value===','){
      if(stack.length)stack.at(-1).commas++;
    }else if(stack.length)stack.at(-1).content=true;
  }
  return calls;
}

export function instrumentD1Contract(f){
  const contract={maximumFunctionArguments:0,maximumBindings:0,maximumSqlBytes:0,maximumRowBytes:0,maximumRowEnvelopeBytes:0,violations:[]};
  const known=new Set(),wrapped=new WeakMap(),db=f.env.DB;
  const fail=(kind,actual,maximum,context)=>{const value={kind,actual,maximum,context};contract.violations.push(value);assert.fail(JSON.stringify(value));};
  const inspectSql=sql=>{
    if(known.has(sql))return;known.add(sql);
    const size=Buffer.byteLength(sql,'utf8');contract.maximumSqlBytes=Math.max(contract.maximumSqlBytes,size);
    if(size>100_000)fail('sql_bytes',size,100_000,sql.slice(0,90));
    for(const call of sqlFunctionArities(sql)){
      contract.maximumFunctionArguments=Math.max(contract.maximumFunctionArguments,call.args);
      if(call.args>32)fail('function_arguments',call.args,32,call.name);
    }
  };
  const inspectRow=row=>{
    if(!row||typeof row!=='object')return;
    const size=Object.values(row).reduce((sum,value)=>sum+(typeof value==='string'?Buffer.byteLength(value,'utf8'):value===null?0:value instanceof Uint8Array?value.byteLength:8),0);
    contract.maximumRowBytes=Math.max(contract.maximumRowBytes,size);
    contract.maximumRowEnvelopeBytes=Math.max(contract.maximumRowEnvelopeBytes,Buffer.byteLength(JSON.stringify(row),'utf8'));
    if(size>2_000_000)fail('row_value_bytes',size,2_000_000,'row values');
    for(const value of Object.values(row))if(typeof value==='string'){
      const bytes=Buffer.byteLength(value,'utf8');if(bytes>2_000_000)fail('string_bytes',bytes,2_000_000,'retained string');
    }
  };
  const inspectResult=result=>{if(result&&Array.isArray(result.results))result.results.forEach(inspectRow);else inspectRow(result);return result;};
  const statement=(raw,sql)=>{
    const proxy=new Proxy(raw,{get(target,key){
      if(key==='bind')return(...values)=>{contract.maximumBindings=Math.max(contract.maximumBindings,values.length);if(values.length>100)fail('bound_parameters',values.length,100,sql.slice(0,90));return statement(target.bind(...values),sql);};
      if(['first','all','run'].includes(key))return async(...args)=>inspectResult(await target[key](...args));
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});wrapped.set(proxy,raw);return proxy;
  };
  f.env.DB={
    prepare(sql){inspectSql(sql);return statement(db.prepare(sql),sql);},
    async batch(statements){const results=await db.batch(statements.map(value=>wrapped.get(value)??value));results.forEach(inspectResult);return results;},
  };
  return contract;
}

assert.deepEqual(sqlFunctionArities("SELECT json_object('a,b',coalesce(?,0),'x',json_set('{}','$.a',NULL)) WHERE id IN(1,2,3)"),[
  {name:'COALESCE',args:2},{name:'JSON_SET',args:3},{name:'JSON_OBJECT',args:4},
]);
