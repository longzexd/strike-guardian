import {marginStage} from './execution.mjs';
import {dec,num,S} from './risk.mjs';
const required=(obj,key)=>{if(obj?.[key]===undefined||obj?.[key]===null)throw Error('缺失官方字段：'+key);return obj[key]};
const money=(obj,key)=>{const v=required(obj,key);dec(v);return String(v)};
const finite=(obj,key)=>{const v=required(obj,key);if(typeof v!=='number'||!Number.isFinite(v))throw Error('无效官方字段：'+key);return v};
export function resolveFees(portfolio){
 const tiers=required(portfolio,'fee_tiers'),id=required(portfolio,'fee_tier');if(!Array.isArray(tiers))throw Error('账户费率阶梯缺失');const tier=tiers.find(t=>t.Tier===id);if(!tier)throw Error('账户费率阶梯未匹配，禁止回退默认费率');
 const taker=finite(tier,'TakerRate'),maker=finite(tier,'MakerRate'),referral=finite(portfolio,'fee_discount_rate')/100,staking=Number(money(portfolio,'staking_fee_discount_rate'));
 if(taker<0||taker>1||referral<0||referral>1||staking<0||staking>1)throw Error('账户费率或折扣超出有效范围');
 const rate=taker*(1-referral)*(1-staking),makerOverride=portfolio.maker_fee_rate_override;
 if(makerOverride!==undefined&&makerOverride!==null&&!Number.isFinite(Number(makerOverride)))throw Error('账户 maker 费率覆盖值无效');
 return {takerRate:(Math.ceil(rate*1e8)/1e8).toFixed(8),makerRate:makerOverride==null?maker*(maker>0?(1-referral)*(1-staking):1):Number(makerOverride),tier:id,referral,staking,estimated:true};
}
export function normalizeAccount(bundle,now=Date.now()){
 const p=bundle?.packets;if(!p)throw Error('尚无官方数据');
 for(const name of ['time','account','symbols','positions','openOrders','portfolio']){const packet=p[name];if(!packet?.ok)throw Error(`${name} 不可用：${packet?.error??'未读取'}`);if(!Number.isFinite(packet.at)||now-packet.at>15000||packet.at>now+2000)throw Error(name+' 数据已过期');}
 const raw=p.account.data,settings=p.symbols.data,portfolio=p.portfolio.data;const accountId=required(raw,'account_id');if(typeof accountId!=='string'||!accountId)throw Error('账户 ID 缺失');
 const wallet=money(raw,'wallet_balance'),upnl=money(raw,'unrealized_pnl'),available=money(raw,'available_balance');
 const positionList=required(p.positions.data,'positions'),openOrders=required(p.openOrders.data,'orders');if(!Array.isArray(positionList)||!Array.isArray(openOrders))throw Error('仓位或挂单响应结构不完整');
 const effective=required(settings,'symbol_settings')?.[bundle.symbol];if(!effective||!['cross','isolated'].includes(effective.margin_mode)||!Number.isInteger(effective.leverage)||effective.leverage<1)throw Error('当前市场生效模式 / 杠杆缺失；不使用账户默认值代替');
 const positions=positionList.filter(row=>dec(required(row,'size'))!==0n).map(row=>{
  if(required(row,'account_id')!==accountId)throw Error('仓位与账户身份不一致');const size=dec(row.size),entry=dec(required(row,'entry_price')),pnl=dec(required(row,'upnl'));const lev=dec(required(row,'leverage'));if(lev<S)throw Error('仓位杠杆无效');
  const mode=required(row,'margin_mode');if(!['cross','isolated'].includes(mode))throw Error('仓位保证金模式无效');
  const margin=mode==='isolated'?dec(required(row,'iso_balance')):((size<0n?-size:size)*(entry+pnl*S/size)/S)*S/lev;
  return {...row,margin:num(margin).toFixed(8)};
 });
 for(const o of openOrders){if(required(o,'AccountID')!==accountId)throw Error('挂单与账户身份不一致');required(o,'Symbol');}
 const riskProfiles=[];let crossBase=dec(wallet),crossPnl=0n,crossMaintenance=0n,crossCount=0;
 for(const row of positions){const mm=dec(required(row,'maintenance_margin'));if(mm<0n)throw Error('Invalid official maintenance margin');const pnl=dec(row.upnl);
 if(row.margin_mode==='isolated'){const reserve=dec(row.iso_balance);crossBase-=reserve;riskProfiles.push({symbol:row.symbol,mode:'isolated',risk:marginStage(num(reserve+pnl),num(mm),num(reserve))});}
 else{crossPnl+=pnl;crossMaintenance+=mm;crossCount++;}}
 if(crossCount)riskProfiles.push({symbol:'CROSS',mode:'cross',risk:marginStage(num(crossBase+crossPnl),num(crossMaintenance),num(crossBase))});
 const fees=resolveFees(portfolio);if(typeof portfolio.is_trading_enabled!=='boolean')throw Error('账户交易状态缺失');
 return {live:true,riskProfiles,accountId,network:bundle.network,symbol:bundle.symbol,equity:num(dec(wallet)+dec(upnl)).toFixed(8),wallet,upnl,available,positions,openOrders,marginMode:effective.margin_mode,leverage:effective.leverage,fees,tradingEnabled:portfolio.is_trading_enabled,fetchedAt:Math.min(...['account','symbols','positions','openOrders','portfolio'].map(k=>p[k].at)),raw};
}
export function marketSnapshot(bundle){const p=bundle?.packets;for(const n of ['markets','mark','depth'])if(!p?.[n]?.ok)throw Error(`${n} 不可用：${p?.[n]?.error??'尚未读取'}`);const market=p.markets.data?.markets?.[bundle.symbol];if(!market)throw Error('官方未返回当前市场');for(const field of ['order_market_min_size','order_market_step_size','order_market_max_size','order_min_notional','order_min_price','order_tick_price','order_market_price_bound'])dec(required(market,field));if(!Array.isArray(market.margin_tiers)||!market.margin_tiers.length)throw Error('官方保证金阶梯缺失');if(p.mark.data?.s!==bundle.symbol||dec(p.mark.data?.p)<=0n||!Number.isFinite(p.mark.data.E))throw Error('官方标记价或交易对字段无效');if(!Array.isArray(p.depth.data?.bids)||!Array.isArray(p.depth.data?.asks)||!p.depth.data.bids.length||!p.depth.data.asks.length)throw Error('官方订单簿结构不完整');return {market,mark:p.mark.data,depth:p.depth.data,rulesAt:p.markets.at,depthLimit:p.depth.route?.endsWith('limit=1000')?1000:p.depth.route?.endsWith('limit=20')?20:null,source:bundle.origin,network:bundle.network,offline:false}}
