// Synthetic accounts exist only in unit tests, never the production UI or gateway.
import {evaluate,dec,num} from '../dist/risk.mjs';
export function newAccount(){return {equity:'10000',available:'10000',positions:[],receipts:[],fees:{takerRate:'0.0006'},fundingReserveRate:'0.00000000'}}
export function paperFill(input,snapshot,account,now=Date.now()){
 const result=evaluate(input,snapshot,account,now);if(!result.ok)return {result,account};
 const m=result.metrics;const position={symbol:input.symbol,side:input.side,quantity:input.quantity,stop:input.stop,leverage:input.leverage,marginMode:input.marginMode,stopMode:input.stopMode??'price',stopAmount:input.stopMode==='fixed-amount'?input.stopAmount:null,entry:m.entry,margin:m.margin.toFixed(8)};
 const receipt={id:globalThis.crypto.randomUUID(),time:now,type:'PAPER_FILL',...position,fee:m.fee,loss:m.loss,quoteTime:snapshot.mark.E};
 return {result,receipt,account:{equity:num(dec(account.equity)-dec(m.fee.toFixed(8))).toFixed(8),available:num(dec(account.available)-dec(m.margin.toFixed(8))-dec(m.fee.toFixed(8))).toFixed(8),positions:[...account.positions,position],receipts:[receipt,...account.receipts].slice(0,100)}};
}
