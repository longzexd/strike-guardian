import {RfqSession,rfqTrigger} from './rfq.mjs';
export function installRfqUI({document,getContext}){
 const $=id=>document.getElementById(id);let note='',pollAt=0,contextId='',draftId='',draftAt=Date.now();
 const session=new RfqSession({send:(...args)=>getContext().client.rfq(...args)});
 function eligible(){const c=getContext(),p=c.bundle?.packets,now=Date.now();return !!(c.client.connected&&p?.account?.ok&&p.time?.ok&&['account','markets','mark','depth'].every(n=>p[n]?.ok&&now-p[n].at<=15000)&&c.market&&c.analysis);}
 function render(){const c=getContext();const r=session.record;const available=eligible();
 $('rfqRequest').disabled=session.busy||session.active||!available;
 $('rfqClose').disabled=session.busy||!r||!session.active;
 const remaining=Math.ceil(session.remainingMs/1000);
 $('rfqStatus').textContent=note||(!available?'需授权账户和新鲜市场数据，才能申请真实流动性。':rfqTrigger(c.analysis)?'当前深度不足或预计偏差超过 20 bps，可申请更多流动性。':'当前可见深度可覆盖计划；仍可主动申请流动性。');
 if(r){$('rfqState').textContent=(r.status==='closed'||remaining===0?'申请已结束':r.status==='quoted'?'做市商报告已准备流动性；仍须核对订单簿':'申请进行中')+' · '+remaining+' 秒 · '+r.response_count+' 个响应';$('rfqId').textContent=r.rfq_id+' · '+r.symbol+' · '+r.requested_size;$('rfqRaw').textContent=JSON.stringify(r,null,2);}
 else{$('rfqState').textContent='尚未发送 RFQ';$('rfqId').textContent='—';$('rfqRaw').textContent='';}
 }
 function fail(e){const labels={RFQ_PAUSED:'Strike 当前暂停 RFQ，未获得流动性。',RFQ_RATE_LIMITED:'Strike 限制申请频率，请稍后重试。',RFQ_MUTATION_INDETERMINATE:'申请结果尚未确定；重试会使用相同申请编号，避免重复。',RFQ_REDIS_UNAVAILABLE:'Strike RFQ 服务暂不可用，请稍后重试。',RFQ_IDEMPOTENCY_CONFLICT:'申请编号冲突，已停止自动申请。'};
 note=(labels[e.code]??e.message)+(e.retryAfter?' Retry-After: '+e.retryAfter+'s':'');$('rfqAuto').checked=false;render();}
 async function create(automatic=false){if(!eligible()){note='需授权账户和新鲜市场数据，才能申请真实流动性。';render();return;}
 const c=getContext();note='正在申请非约束性流动性；不会下单。';
 const promise=session.create(c.market.market,document.getElementById('quantity').value,{automatic});render();
 try{const r=await promise;if(r){note='RFQ 已发送；正在等待做市商，随后重新评估订单簿。';pollAt=Date.now();await c.reload();}render();}catch(e){fail(e)}}
 $('rfqRequest').onclick=()=>create(false);
 $('rfqClose').onclick=async()=>{try{const promise=session.close();render();await promise;note='已关闭流动性申请；没有发送交易。';render();}catch(e){fail(e)}};
 $('rfqAuto').onchange=()=>{draftAt=Date.now();note=$('rfqAuto').checked?'已启用自动申请：仅在深度不足或预计偏差超过 20 bps 时触发。':'自动申请已关闭。';render()};
 async function tick(){const c=getContext(),id=c.client.network+'|'+c.client.generation+'|'+c.client.connected;
 if(contextId&&id!==contextId){session.reset();$('rfqAuto').checked=false;note='账户或网络已变化；自动申请已关闭。';}contextId=id;
 const draft=c.client.network+'|'+$('symbol').value+'|'+$('quantity').value;
 if(draft!==draftId){draftId=draft;draftAt=Date.now();}
 if(session.record&&!session.active&&session.remainingMs===0)note='申请已到期；不代表流动性仍然可用。';
 if(!session.busy&&session.active&&c.client.connected&&Date.now()-pollAt>=5000){pollAt=Date.now();try{await session.refresh();await c.reload();}catch(e){fail(e)}}
 if($('rfqAuto').checked&&eligible()&&!session.active&&!session.busy&&rfqTrigger(c.analysis)&&!session.autoAttempted.has(c.market.market.symbol+'|'+$('quantity').value)&&Date.now()-session.lastAutoAt>=60000&&Date.now()-draftAt>=1500){await create(true)}
 render();
 }
 render();setInterval(tick,1000);return session;
}
