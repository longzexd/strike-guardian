import {captureExecution,compareExecution,historicalFunding,strategyConflicts} from './execution.mjs';
const stageLabels={'healthy':'正常','margin-call':'保证金警告 ≥70%','reduce-only':'仅减仓 ≥90%','liquidate':'触及强平条件 ≥100%','bankrupt':'破产条件：余额非正','unknown':'无法确定'};
export const riskStageLabel=r=>stageLabels[r?.stage]??'无法确定';
export function installExecutionUI({document,getContext}){
 const $=id=>document.getElementById(id),usd=n=>Number.isFinite(n)?n.toLocaleString('en-US',{style:'currency',currency:'USD'}):'—';let baseline=null,source='manual',identity='';
 const row=(table,values)=>{const r=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=String(v);r.append(td)}table.append(r)};
 function current(){const c=getContext();if(!c.market||!c.analysis)return null;return captureExecution(c.market,c.plan,c.analysis,c.market.depth.T??c.market.depth.E)}
 function captureBaseline(kind='manual'){try{const c=current();if(!c)throw Error('需新鲜行情，不能保存基线。');baseline=c;source=kind;render();return c}catch(e){$('comparisonStatus').textContent=e.message;return null}}
 function render(){const c=getContext(),a=c.analysis,e=a?.execution;const id=c.client.network+'|'+c.client.generation;if(identity&&id!==identity)baseline=null;identity=id;
 $('captureBaseline').disabled=!e;$('compareNow').disabled=!e;
 $('coverage').textContent=e?e.observed.bids+' / '+e.observed.asks+' 档 · 请求上限 1000':'需新鲜市场数据';
 $('boundedCapacity').textContent=e?usd(c.plan.side==='long'?e.buyCapacity.notional:e.sellCapacity.notional):'—';
 $('executableQuantity').textContent=e?(c.plan.side==='long'?e.buyCapacity.quantity:e.sellCapacity.quantity).toFixed(8):'—';
 $('priceLimitValue').textContent=e?usd(c.plan.side==='long'?e.buyCeiling:e.sellFloor):'—';
 $('executionVerdict').textContent=e?(e.opening.complete?'当前价格范围可完整覆盖计划':'当前价格范围不足；缩小数量、调整计划或申请 RFQ'):'等待有效计划与实时深度';
 const body=$('executionOptions');body.replaceChildren();if(e){row(body,['市价评估',e.opening.complete?'当前范围可覆盖':'当前范围不足',e.opening.vwap===null?'无法完整估算':usd(e.opening.vwap),'仍需完整账户风控']);
 row(body,['限价 IOC 计划','最多 '+Math.min(Number(c.plan.quantity),e.opening.filled).toFixed(8),'价格边界 '+usd(c.plan.side==='long'?e.buyCeiling:e.sellFloor),'未成交部分取消；无成交保证']);
 row(body,['限价 FOK 计划',e.opening.complete?'快照内可覆盖':'快照内不可全成','价格边界 '+usd(c.plan.side==='long'?e.buyCeiling:e.sellFloor),'全成或全撤；提交时复核']);
 const duration=Number($('twapDuration').value),n=Math.floor(duration/30),avg=Number(c.plan.quantity)/n,min=Number(c.market.market.order_market_min_size);
 row(body,['TWAP 计划示意',n+' 个名义分片 · 平均 '+avg.toFixed(8),avg<min?'平均分片低于官方最小数量':'未来成本未知','30 秒间隔为展示假设；不创建策略']);}
 const comparisons=$('comparisonRows');comparisons.replaceChildren();if(!baseline)$('comparisonStatus').textContent='尚未保存基线；可先保存，再刷新比较。';else{const after=current(),diff=after?compareExecution(baseline,after):null;
 $('comparisonStatus').textContent=source==='rfq'?'RFQ 申请前基线；变化仅作观察，不归因或保证流动性。':'手动快照基线；变化仅作观察，不归因或保证流动性。';
 if(!diff?.compatible){$('comparisonStatus').textContent+=' '+(diff?.reason==='Plan changed; capture a new baseline'?'计划已变化，请重新保存基线。':'等待较新的官方订单簿快照。');}
 else{row(comparisons,['时间',new Date(baseline.at).toISOString(),new Date(after.at).toISOString(),(diff.elapsedMs/1000).toFixed(1)+' 秒']);row(comparisons,['价格范围内深度',usd(baseline.eligibleNotional),usd(after.eligibleNotional),usd(diff.eligibleNotionalDelta)]);row(comparisons,['预计成交均价',usd(baseline.entry),usd(after.entry),usd(diff.entryDelta)]);row(comparisons,['吃单冲击（相对最优档）',baseline.impactBps===null?'—':baseline.impactBps.toFixed(2)+' bps',after.impactBps===null?'—':after.impactBps.toFixed(2)+' bps',diff.impactDeltaBps===null?'—':diff.impactDeltaBps.toFixed(2)+' bps']);}}
 const funding=$('historicalFundingRows');funding.replaceChildren();if(a)for(const h of [1,8,24]){const f=historicalFunding(c.bundle?.packets?.fundingHistory,Number(c.plan.quantity)*Number(c.market.mark.p),c.plan.side,h);if(f)row(funding,[h+' 小时',f.windows,usd(f.medianCost),usd(f.p95Cost),usd(f.worstObservedCost)])}
 $('historicalFundingHint').textContent=funding.children.length?'真实过去 7 天的连续小时窗口，假设名义金额不变；正数为支出，负数为收入。历史分位数不是未来概率，分钟级缓存不用于实时准入。':'历史资金费不可用或样本不足；不生成替代数据。';
 const strategy=$('strategySummary');if(!c.account)strategy.textContent='需授权并成功读取 TWAP / Grid；未知不等于没有策略。';else try{const conflicts=strategyConflicts(c.bundle,c.account.accountId);strategy.textContent=conflicts.length?'同市场存在活跃算法策略；完整评估已拦截。':'已核验：当前市场没有活跃 TWAP / Grid。'}catch(e){strategy.textContent=e.message}
 const profiles=$('riskProfileRows');profiles.replaceChildren();for(const p of c.account?.riskProfiles??[])row(profiles,[p.symbol,p.mode,riskStageLabel(p.risk),p.risk.ratio===null?'—':(p.risk.ratio*100).toFixed(2)+'%']);
 if(!profiles.children.length)row(profiles,['—','—',c.account?'官方当前无持仓':'需真实账户授权','—']);
 }
 $('captureBaseline').onclick=()=>captureBaseline();$('compareNow').onclick=async()=>{await getContext().reload();render()};$('twapDuration').onchange=render;
 render();return {render,captureBaseline,getBaseline:()=>baseline};
}
