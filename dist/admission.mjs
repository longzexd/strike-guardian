import {evaluate,recommend,dec} from './risk.mjs';
import {normalizeAccount,marketSnapshot} from './account-data.mjs';
export function prepare(bundle,draft,localNow=Date.now()){
 const account=normalizeAccount(bundle,localNow),snapshot=marketSnapshot(bundle);
 const offset=bundle.serverNow-bundle.collectedAt;if(!Number.isFinite(offset))throw Error('Strike server time unavailable');snapshot.rulesAt+=offset;
 if(dec(draft.leverage)!==dec(account.leverage))throw Error('计划杠杆与 Strike 当前生效杠杆不一致；请先在主应用调整并刷新');
 if(!account.tradingEnabled)throw Error('Strike 账户当前未启用交易');
 if(account.openOrders.some(o=>o.Symbol===bundle.symbol))throw Error('当前市场已有真实挂单；为避免重复或冲突，本版暂不评估追加订单');
 if(!bundle.packets.feeTiers?.ok)throw Error('官方公开费率接口不可用');
 const hours=Number(draft.holdingHours);if(!Number.isFinite(hours)||hours<=0||hours>720)throw Error('持仓时长必须在 0 至 720 小时之间');
 const stop=dec(draft.stop),min=dec(snapshot.market.order_min_price),tick=dec(snapshot.market.order_tick_price);if(tick<=0n||stop<min||(stop-min)%tick!==0n)throw Error('止损价不符合官方价格最小值或 tick 网格');
 if(snapshot.mark.r===undefined||!Number.isFinite(Number(snapshot.mark.r))||!Number.isFinite(snapshot.mark.T))throw Error('官方资金费率或下一次结算时间缺失');
 const periods=Math.max(0,Math.floor((localNow+offset+hours*3600000-snapshot.mark.T)/3600000)+1);
 const funding=(draft.side==='long'?1:-1)*Number(draft.quantity)*Number(snapshot.mark.p)*Number(snapshot.mark.r)*periods;
 account.fundingReserve=Math.max(0,funding).toFixed(8);account.fundingReserveRate=(Math.ceil(Math.max(0,(draft.side==='long'?1:-1)*Number(snapshot.mark.r)*periods)*1e8)/1e8).toFixed(8);
 const levels=draft.side==='long'?snapshot.depth.asks:snapshot.depth.bids;let left=Number(draft.quantity),worst=null;for(const row of levels){const take=Math.min(left,Number(row[1]));if(take>0)worst=Number(row[0]);left-=take;if(left<=0)break}
 if(worst!==null&&Math.abs(worst-Number(snapshot.mark.p))/Number(snapshot.mark.p)>Number(snapshot.market.order_market_price_bound))throw Error('预计最差成交档位超出 Strike 官方市价保护边界');
 const order={...draft,symbol:bundle.symbol,marginMode:account.marginMode,leverage:String(account.leverage)};
 return {account,snapshot,order,now:localNow+offset};
}
export function assess(bundle,draft,localNow=Date.now()){
 try{const ctx=prepare(bundle,draft,localNow);return {...evaluate(ctx.order,ctx.snapshot,ctx.account,ctx.now),provenance:{network:bundle.network,accountId:ctx.account.accountId,source:bundle.origin,accountAt:ctx.account.fetchedAt,markAt:ctx.snapshot.mark.E,mode:'OFFICIAL ACCOUNT SETTINGS',fee:'OFFICIAL ACCOUNT TIER AND DISCOUNTS — ESTIMATE',execution:'NONE'},context:ctx};}
 catch(e){return {ok:false,reasons:[e.message],metrics:null,context:null}}
}
export function recommendLive(bundle,draft,localNow=Date.now()){
 try{const c=prepare(bundle,draft,localNow);return recommend(c.order,c.snapshot,c.account,c.now)}catch{return null}
}
