import {dec,num,S,tierFor,isolatedLP} from './risk.mjs';
const abs=x=>x<0n?-x:x;
export function bookFill(levels,quantity){let remaining=dec(quantity),cost=0n,worst=null;if(remaining<=0n)throw Error('数量必须大于 0');const total=remaining;
 if(!Array.isArray(levels)||!levels.length)throw Error('订单簿为空');
 for(const row of levels){const price=dec(row[0]),size=dec(row[1]);if(price<=0n||size<0n)throw Error('订单簿数据无效');const take=remaining<size?remaining:size;cost+=price*take/S;remaining-=take;if(take>0n)worst=price;if(!remaining)break}
 return {complete:remaining===0n,filled:num(total-remaining),unfilled:num(remaining),vwap:remaining===0n?num(cost*S/total):null,worst:worst===null?null:num(worst),cost:num(cost)};
}
export function quantityForAmount(amount,basis,leverage,market,mark){if(!['margin','notional'].includes(basis))throw Error('请选择明确的金额口径');const value=dec(amount),lev=dec(leverage),price=dec(mark),min=dec(market.order_market_min_size),step=dec(market.order_market_step_size);if(value<=0n||lev<S||price<=0n||min<=0n||step<=0n)throw Error('输入金额、杠杆或市场网格无效');const notional=basis==='margin'?value*lev/S:value;const raw=notional*S/price;if(raw<min)throw Error('金额低于市场最小数量');const q=min+(raw-min)/step*step;return num(q).toFixed(8)}
export function analyzeMarket(snapshot,plan,fees=null,serverNow=Date.now()){
 const {market,mark,depth}=snapshot,price=dec(mark.p),quantity=dec(plan.quantity),lev=dec(plan.leverage);if(quantity<=0n||lev<S||lev%S!==0n||!['long','short'].includes(plan.side))throw Error('请输入有效的方向、数量和整数杠杆');
 const opening=bookFill(plan.side==='long'?depth.asks:depth.bids,plan.quantity),closing=bookFill(plan.side==='long'?depth.bids:depth.asks,plan.quantity);
 const q=num(quantity),p=num(price),entry=opening.vwap;
 const depthBands=[.001,.005,.01].map(band=>({band,bid:depth.bids.filter(r=>Number(r[0])>=p*(1-band)).reduce((a,r)=>a+Number(r[0])*Number(r[1]),0),ask:depth.asks.filter(r=>Number(r[0])<=p*(1+band)).reduce((a,r)=>a+Number(r[0])*Number(r[1]),0)}));
 const hours=Number(plan.holdingHours);if(!Number.isFinite(hours)||hours<=0||hours>720)throw Error('持仓时长须在 0 至 720 小时之间');
 const rate=Number(mark.r),next=mark.T;let funding=null;if(mark.r!==undefined&&Number.isFinite(rate)&&Number.isFinite(next)&&next>serverNow-3600000){const periods=Math.max(0,Math.floor((serverNow+hours*3600000-next)/3600000)+1);funding={periods,rate,next,estimate:(plan.side==='long'?-1:1)*q*p*rate*periods,hours};}
 if(entry===null)return {opening,closing,depthBands,funding,scenarios:[],entry:null,notional:null,margin:null,liquidation:null,stopLoss:null,openingFee:null,roundTripSpread:null};
 const n=entry*q,margin=n/Number(plan.leverage),tier=tierFor(market,price*quantity/S),lp=num(isolatedLP(dec(entry.toFixed(8)),quantity,dec(margin.toFixed(8)),tier,plan.side));const dir=plan.side==='long'?1:-1;
 const taker=fees?Number(fees.takerRate):null,stop=Number(plan.stop);
 const stopLoss=Number.isFinite(stop)&&stop>0?Math.abs(entry-stop)*q+(taker===null?0:(entry+stop)*q*taker):null;
 const scenarios=[-20,-10,-5,5,10,20].map(change=>{const shockPrice=p*(1+change/100),gross=(shockPrice-entry)*q*dir,t=tierFor(market,dec((shockPrice*q).toFixed(8))),mm=shockPrice*q*Number(t.maintenance_margin_rate)-Number(t.maintenance_amount);return {change,price:shockPrice,gross,marginBalance:margin+gross,maintenance:mm,liquidatable:margin+gross<=mm,exitFee:taker===null?null:shockPrice*q*taker,estimatedNet:taker===null?null:gross-(entry+shockPrice)*q*taker};});
 return {opening,closing,depthBands,funding,entry,notional:n,margin,liquidation:lp,stopLoss,stopFeesKnown:taker!==null,openingFee:taker===null?null:n*taker,slippageBps:Math.abs(entry-p)/p*10000,priceBoundExceeded:opening.worst!==null&&Math.abs(opening.worst-p)/p>Number(market.order_market_price_bound),roundTripSpread:closing.complete?(closing.vwap-entry)*q*dir:null,scenarios};
}
