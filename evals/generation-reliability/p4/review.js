const $=id=>document.getElementById(id);let review,command;
if(new URLSearchParams(location.search).has('progress-report'))$('report').hidden=false;
async function post(path,value){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
const show=(id,value)=>{$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
async function run(fn){$('load').disabled=true;$('approve').disabled=true;$('status').disabled=true;try{await fn();}catch(error){show('state',error.message);}finally{$('load').disabled=false;$('approve').disabled=!review?.committable;$('status').disabled=!review?.display;}}
$('load').onclick=()=>run(async()=>{
 if($('missing').value==='treatment:bound')$('mode').value='bounded-proof';
 review=await post('/api/reset',{mode:$('mode').value,missing:$('missing').value});
 command={action:'commit',proposalId:review.display?.proposalId,previewId:review.previewId,displayHash:review.displayHash,intentId:review.display?.intentId,decision:review.display?.expectedDecision};
 show('state',review.committable?'Complete synthetic evidence · explicit simulated decision required':'Cannot commit · '+(review.display?.issues?.join('; ')??review.error));
 show('risk',review.display?.financialMeaning??'');show('display',review.display??review);show('command',command);show('result',{counts:review.counts,actualGrant:false,realProviderCalls:0});
 show('facts',review.display?`Two arms · Complete financial policies: ${review.display.financialPolicies.length} · ${review.display.expiresAt} expiry`:'Unavailable');
});
$('approve').onclick=()=>run(async()=>{const r=await post('/api/command',command);show('result',r);show('state',r.status==='committed'?'Simulated decision committed · original receipt retained':r.error);});
$('status').onclick=()=>run(async()=>show('result',await post('/api/command',{action:'status',proposalId:review.display.proposalId})));
