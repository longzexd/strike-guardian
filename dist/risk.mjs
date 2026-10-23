// Deterministic fixed-point arithmetic: 8 decimal places, no floating-point risk decisions.
export const S=100000000n;
export function dec(x){const t=String(x).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');if(!/^-?\d+(\.\d{1,8})?$/.test(t))throw Error('Use plain decimals with at most 8 places');const neg=t[0]==='-';const [a,b='']=t.replace('-','').split('.');return (BigInt(a)*S+BigInt(b.padEnd(8,'0')))*(neg?-1n:1n)}
export const num=x=>Number(x)/Number(S);
const mul=(a,b)=>a*b/S, div=(a,b)=>a*S/b, abs=x=>x<0n?-x:x;
const ceilCent=x=>(x+999999n)/1000000n*1000000n;
export const POLICY=Object.freeze({riskBps:100,maxLeverage:10,maxMarginBps:2500,maxAgeMs:15000,maxSlippageBps:20,bufferBps:10,maxPositions:3});
export function tierFor(m,n){const ts=m.margin_tiers;if(!Array.isArray(ts)||!ts.length)throw Error('Missing official margin tiers');return ts.find(t=>n<=dec(t.max_notional))??ts.at(-1)}
export function isolatedLP(entry,qty,margin,tier,side){const dir=side==='long'?1n:-1n;const lp=div(entry-div((margin+dec(tier.maintenance_amount))*dir,qty),S-dir*dec(tier.maintenance_margin_rate));return lp>0n?lp:0n}
export function marginModeIssues(input){
 if(input.marginMode!=='isolated')return [input.stopMode==='fixed-amount'?'Fixed-amount stop requires isolated margin; cross or unconfirmed mode is blocked':'Confirm isolated margin; cross margin is unsupported in this MVP'];
 return [];
}
export function evaluate(input,snapshot,account,now=Date.now()){
 const reasons=[];const fail=message=>({ok:false,reasons:[message],metrics:null});
 try{
  if(!account||!Array.isArray(account.positions)||!account.fees)return fail('Account inputs and actual fee rate required');
  const issues=marginModeIssues(input);if(issues.length)return fail(issues[0]);
  if(!['price','fixed-amount'].includes(input.stopMode??'price'))return fail('Invalid stop mode');
  let fixedBudget=null;if(input.stopMode==='fixed-amount'){fixedBudget=dec(input.stopAmount);if(fixedBudget<=0n)return fail('Fixed stop amount must be positive');}
  const {market:m,mark,depth}=snapshot;if(!m||mark.s!==m.symbol||input.symbol!==m.symbol) return fail('Market / price symbol mismatch');
  const q=dec(input.quantity), stop=dec(input.stop), lev=dec(input.leverage), price=dec(mark.p),equity=dec(account.equity),available=dec(account.available);
  if(!['long','short'].includes(input.side)||q<=0n||stop<=0n||price<=0n||lev<S||lev%S!==0n||equity<=0n||available<0n)return fail('Invalid order or account values');
  if(snapshot.offline)reasons.push('Offline fixture: paper execution disabled');
  for(const [label,ts] of [['mark',mark.E],['depth',depth.T??depth.E],['rules',snapshot.rulesAt]])if(!Number.isFinite(ts)||now-ts>POLICY.maxAgeMs||ts>now+2000)reasons.push(`Stale or invalid ${label} timestamp`);
  if(m.status!=='trading'||m.reduce_only)reasons.push('Market is not open for new exposure');
  const min=dec(m.order_market_min_size),step=dec(m.order_market_step_size),max=dec(m.order_market_max_size);
  if(step<=0n||q<min||q>max||(q-min)%step!==0n)reasons.push('Quantity violates official min / max / step');
  const n=mul(price,q),tier=tierFor(m,n);
  if(n<dec(m.order_min_notional))reasons.push('Below official minimum notional');
  if(n>dec(m.margin_tiers.at(-1).max_notional))reasons.push('Above supported margin tier ceiling');
  if(lev>dec(Math.min(POLICY.maxLeverage,tier.max_leverage)))reasons.push('Leverage exceeds Guardian or market tier cap');
  const levels=input.side==='long'?depth.asks:depth.bids;
  if(!Array.isArray(levels)||!levels.length)return fail('Missing executable order book');
  const bid=dec(depth.bids?.[0]?.[0]??0),ask=dec(depth.asks?.[0]?.[0]??0);if(bid<=0n||ask<=bid)return fail('Invalid or crossed order book');
  let left=q,cost=0n;for(const row of levels){const px=dec(row[0]),size=dec(row[1]);if(px<=0n||size<0n)return fail('Malformed depth');const take=left<size?left:size;cost+=mul(px,take);left-=take;if(left===0n)break;}
  if(left>0n)reasons.push('Insufficient visible depth for full fill');
  const entry=left===0n?div(cost,q):price;
  const slip=div(abs(entry-price),price),margin=ceilCent(div(mul(entry,q),lev));
  const feeRate=dec(account.fees.takerRate);const fee=ceilCent(mul(mul(entry,q),feeRate));
  const dir=input.side==='long'?1n:-1n;
  if((entry-stop)*dir<=0n)reasons.push('Stop must be on the loss side of estimated entry');
  if(slip>dec('0.002'))reasons.push('Estimated slippage exceeds 20 bps');
  const loss=ceilCent(mul(abs(entry-stop),q)+mul(mul(entry+stop,q),feeRate)+mul(mul(entry,q),dec('0.001'))+mul(n,dec(account.fundingReserveRate)));
  const budget=mul(equity,dec('0.01'));if(fixedBudget!==null&&loss>fixedBudget)reasons.push('Estimated stop risk exceeds fixed amount');if(loss>budget)reasons.push('Stop-loss risk exceeds 1% equity budget');
  const locked=(account.positions??[]).reduce((a,p)=>a+dec(p.margin),0n);
  if(margin+locked>mul(equity,dec('0.25')))reasons.push('Total isolated margin exceeds 25% equity');
  const reserveRate=account.live?dec(Math.max(Number(account.fees.takerRate),Number(account.fees.makerRate),0).toFixed(8)):feeRate;const orderReserve=margin+2n*ceilCent(mul(mul(entry,q),reserveRate));
  if(orderReserve>available)reasons.push('Insufficient account buying power');
  if((account.positions??[]).length>=POLICY.maxPositions)reasons.push('Guardian maximum 3 open positions');
  if((account.positions??[]).some(p=>p.symbol===m.symbol))reasons.push('Existing position on this market; net-position changes are unsupported');
  const lp=isolatedLP(entry,q,margin,tier,input.side);
  if(lp>0n&&((stop-lp)*dir<=mul(price,dec('0.005'))))reasons.push('Stop must clear estimated liquidation by 0.5% of mark');
  const mm=mul(n,dec(tier.maintenance_margin_rate))-dec(tier.maintenance_amount);
  return {ok:reasons.length===0,reasons,metrics:{entry:num(entry),notional:num(n),margin:num(margin),fee:num(fee),requiredBuyingPower:num(orderReserve),loss:num(loss),budget:num(budget),liquidation:num(lp),maintenance:num(mm),slippageBps:num(slip)*10000,utilization:num(div(loss,budget))*100,fixedBudget:fixedBudget===null?null:num(fixedBudget)},policy:POLICY};
 }catch(e){return fail(`Invalid data: ${e.message}`)}
}
export function recommend(input,snapshot,account,now=Date.now()){
 // Search valid grid for the largest passing order. No recommendation bypasses admission.
 try{if(marginModeIssues(input).length)return null;const m=snapshot.market,min=dec(m.order_market_min_size),step=dec(m.order_market_step_size),max=dec(m.order_market_max_size);if(min<=0n||step<=0n||max<min)return null;
 let lo=0n,hi=(max-min)/step,best=null;while(lo<=hi){const mid=(lo+hi)/2n,q=min+mid*step;const quantity=(Number(q)/1e8).toFixed(8);const r=evaluate({...input,quantity},snapshot,account,now);
 if(r.ok&&dec(r.metrics.loss.toFixed(8))<=dec(Math.min(r.metrics.budget,r.metrics.fixedBudget??r.metrics.budget).toFixed(8))*95n/100n){best={quantity,result:r};lo=mid+1n}else if(r.reasons.length===1&&r.reasons[0]==='Below official minimum notional')lo=mid+1n;else hi=mid-1n;}return best;
 }catch{return null}
}
