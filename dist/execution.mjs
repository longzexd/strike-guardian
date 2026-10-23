import {dec,num,S} from './risk.mjs';
const abs=x=>x<0n?-x:x;
export function priceWindow(snapshot,maxImpactBps='20'){
 const mark=dec(snapshot.mark.p),cap=dec(maxImpactBps),bound=dec(snapshot.market.order_market_price_bound);
 if(mark<=0n||cap<0n||cap>dec('1000')||bound<=0n||bound>=S)throw Error('Invalid execution price limits');
 const {bids,asks}=snapshot.depth;
 if(!Array.isArray(bids)||!Array.isArray(asks)||!bids.length||!asks.length)throw Error('Missing executable order book');
 for(const[levels,ascending]of [[bids,false],[asks,true]]){let previous=null;for(const row of levels){const p=dec(row[0]),q=dec(row[1]);if(p<=0n||q<0n||(previous!==null&&(ascending?p<=previous:p>=previous)))throw Error('Unsorted or invalid order book');previous=p;}}
 const bid=dec(bids[0][0]),ask=dec(asks[0][0]);if(bid>=ask)throw Error('Invalid or crossed order book');
 // Use integer comparisons; do not round a boundary outward into worse executable prices.
 const inside=(p,anchor,long)=>abs(p-mark)*S<=mark*bound&&(long?(p-anchor)*dec('10000')<=anchor*cap:(anchor-p)*dec('10000')<=anchor*cap);
 const eligibleBids=bids.filter(r=>inside(dec(r[0]),bid,false)),eligibleAsks=asks.filter(r=>inside(dec(r[0]),ask,true));
 const totals=levels=>{const q=levels.reduce((a,r)=>a+dec(r[1]),0n);const notional=levels.reduce((a,r)=>a+dec(r[0])*dec(r[1])/S,0n);return {quantity:num(q),notional:num(notional)};};
 return {maxImpactBps:Number(maxImpactBps),officialBoundBps:num(bound)*10000,bid:num(bid),ask:num(ask),spread:num(ask-bid),spreadBps:num(ask-bid)/num((ask+bid)/2n)*10000,
 bids:eligibleBids,asks:eligibleAsks,buyCapacity:totals(eligibleAsks),sellCapacity:totals(eligibleBids),
 buyCeiling:Math.min(num(mark*(S+bound)/S),num(ask)+num(ask)*Number(maxImpactBps)/10000),sellFloor:Math.max(num(mark*(S-bound)/S),num(bid)-num(bid)*Number(maxImpactBps)/10000),
 observed:{bids:bids.length,asks:asks.length,at:snapshot.depth.T??snapshot.depth.E,requestedLimit:snapshot.depthLimit??null,possiblyTruncated:bids.length>=1000||asks.length>=1000}};
}
export function marginStage(balance,maintenance,baseBalance=balance){
 if(!Number.isFinite(balance)||!Number.isFinite(maintenance)||!Number.isFinite(baseBalance)||maintenance<0)return {stage:'unknown',ratio:null};
 if(baseBalance<=0||balance<=0)return {stage:'bankrupt',ratio:null};
 const ratio=maintenance/balance;return {stage:ratio>=1?'liquidate':ratio>=.9?'reduce-only':ratio>=.7?'margin-call':'healthy',ratio};
}
export function strategyConflicts(bundle,accountId,now=Date.now()){
 const result=[];for(const[name,key]of [['twap','strategies'],['grid','bots']]){
  const p=bundle?.packets?.[name];if(!p?.ok||!Number.isFinite(p.at)||now-p.at>15000||p.at>now+2000)throw Error('Active strategy data missing or stale: '+name);
  const rows=Array.isArray(p.data)?p.data:p.data?.[key];if(!Array.isArray(rows))throw Error('Invalid active strategy response: '+name);
  for(const row of rows){if(row.account_id!==accountId)throw Error('Strategy account ID mismatch');const symbol=row.market??row.symbol;if(typeof symbol!=='string'||typeof row.status!=='string')throw Error('Strategy state missing');
   if(!['completed','cancelled','expired','failed','liquidated','stopped'].includes(row.status.toLowerCase())&&symbol===bundle.symbol)result.push({kind:name,id:row.strategy_id??row.id,symbol,status:row.status});
  }
 }
 return result;
}
export function captureExecution(snapshot,plan,analysis,at){
 if(!analysis?.execution||!Number.isFinite(at))throw Error('Fresh execution assessment required');
 return {network:snapshot.network,symbol:plan.symbol,side:plan.side,quantity:String(plan.quantity),maxImpactBps:String(plan.maxImpactBps??'20'),mark:Number(snapshot.mark.p),at,
 eligibleNotional:plan.side==='long'?analysis.execution.buyCapacity.notional:analysis.execution.sellCapacity.notional,eligibleQuantity:plan.side==='long'?analysis.execution.buyCapacity.quantity:analysis.execution.sellCapacity.quantity,
 entry:analysis.execution.opening.vwap,impactBps:analysis.entryImpactBps??null,complete:analysis.execution.opening.complete};
}
export function compareExecution(before,after){
 for(const field of ['network','symbol','side','quantity','maxImpactBps'])if(before?.[field]!==after?.[field])return {compatible:false,reason:'Plan changed; capture a new baseline'};
 if(!Number.isFinite(before.at)||!Number.isFinite(after.at)||after.at<=before.at)return {compatible:false,reason:'A newer snapshot is required'};
 return {compatible:true,before,after,elapsedMs:after.at-before.at,eligibleNotionalDelta:after.eligibleNotional-before.eligibleNotional,eligibleQuantityDelta:after.eligibleQuantity-before.eligibleQuantity,
 entryDelta:before.entry===null||after.entry===null?null:after.entry-before.entry,impactDeltaBps:before.impactBps===null||after.impactBps===null?null:after.impactBps-before.impactBps,
 // Observable change, never causal attribution to RFQ or a reservation.
 attribution:'OBSERVED_CHANGE_ONLY'};
}
export function historicalFunding(packet,notional,side,hours,now=Date.now()){
 if(!packet?.ok||!Number.isFinite(packet.at)||now-packet.at>300000||packet.at>now+2000)return null;
 const {columns,data}=packet.data??{};if(!Array.isArray(columns)||!Array.isArray(data))return null;
 const ri=columns.indexOf('funding_rate'),ti=columns.indexOf('ts');if(ri<0||ti<0)return null;
 const rows=data.filter(r=>Number.isFinite(r[ti])&&typeof r[ri]==='number'&&Number.isFinite(r[ri])).sort((a,b)=>a[ti]-b[ti]);
 if(rows.length<2||!Number.isFinite(notional)||notional<=0||!['long','short'].includes(side))return null;
 // Empirical consecutive hourly windows, not independent rate percentiles multiplied by hours.
 const count=Math.ceil(Number(hours));if(!Number.isInteger(count)||count<1||count>rows.length)return null;
 const costs=[];for(let i=0;i+count<=rows.length;i++){const group=rows.slice(i,i+count);if(group.some((r,k)=>k&&r[ti]-group[k-1][ti]!==3600000))continue;costs.push(group.reduce((a,r)=>a+(side==='long'?1:-1)*r[ri]*notional,0));}
 if(!costs.length)return null;costs.sort((a,b)=>a-b);const at=p=>costs[Math.ceil(p*(costs.length-1))];
 return {hours:count,windows:costs.length,observations:rows.length,medianCost:at(.5),p95Cost:at(.95),worstObservedCost:costs.at(-1),from:rows[0][ti],to:rows.at(-1)[ti],assumption:'CONSTANT_NOTIONAL_HISTORICAL_WINDOWS_NOT_FORECAST'};
}
