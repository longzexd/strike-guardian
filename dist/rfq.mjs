// Nonbinding liquidity requests only. This module never submits trading orders.
import {dec} from './risk.mjs';
export function validateRfq(method,route,body){
 if(method==='GET'||method==='DELETE'){
  if(!/^\/v2\/rfq\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(route)||body!==undefined)throw Error('Invalid RFQ read/close route');
  return;
 }
 if(method!=='POST'||route!=='/v2/rfq'||!body||typeof body!=='object'||Array.isArray(body))throw Error('RFQ route not allowed');
 const keys=Object.keys(body);if(keys.some(k=>!['client_rfq_id','symbol','requested_size'].includes(k))||keys.length!==3)throw Error('RFQ fields not allowed');
 if(typeof body.client_rfq_id!=='string'||!/^[A-Za-z0-9._:-]{1,64}$/.test(body.client_rfq_id))throw Error('Invalid RFQ client ID');
 if(typeof body.symbol!=='string'||!/^[A-Z0-9]{1,15}-USD$/.test(body.symbol))throw Error('Invalid RFQ symbol');
 if(typeof body.requested_size!=='string'||! /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(body.requested_size)||dec(body.requested_size)<=0n)throw Error('Invalid RFQ size');
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw Error('RFQ body too large');
}
export function createRfqBody(market,size,clientId){
 if(!market||typeof market.symbol!=='string'||!Number.isInteger(market.base_prec))throw Error('Official RFQ market rules unavailable');
 let canonical=String(size);if(canonical.includes('.'))canonical=canonical.replace(/0+$/,'').replace(/\.$/,'');
 const body={client_rfq_id:clientId,symbol:market.symbol,requested_size:canonical};validateRfq('POST','/v2/rfq',body);
 if((canonical.split('.')[1]?.length??0)>market.base_prec)throw Error('RFQ size exceeds official precision');
 if(market.order_limit_max_size===undefined)throw Error('Official RFQ maximum size missing');
 if(dec(market.order_limit_max_size)>0n&&dec(canonical)>dec(market.order_limit_max_size))throw Error('RFQ size exceeds official maximum');
 // Omit side intentionally: request both sides without disclosing the draft direction.
 return Object.freeze(body);
}
export function validateRfqResponse(data,expected){
 if(!data||data._v!==1||!['opened','quoted','closed'].includes(data.status))throw Error('Invalid official RFQ response');
 validateRfq('GET','/v2/rfq/'+data.rfq_id);
 for(const field of ['client_rfq_id','symbol','requested_size'])if(data[field]!==expected[field])throw Error('RFQ response does not match request');
 for(const field of ['revision','created_at_ms','updated_at_ms','expires_at_ms','server_time_ms','total_quoter_count','response_count'])if(!Number.isSafeInteger(data[field])||data[field]<0)throw Error('Invalid RFQ '+field);
 if(!data.response_counts||['acked','quoted','uninterested'].some(k=>!Number.isSafeInteger(data.response_counts[k])||data.response_counts[k]<0))throw Error('Invalid RFQ counts');
 if(data.expires_at_ms<data.created_at_ms)throw Error('Invalid RFQ expiry');
 return data;
}
export function rfqTrigger(analysis){return !!analysis&&(!analysis.opening.complete||analysis.slippageBps>20)}
export class RfqSession{
 constructor({send,clock=()=>Date.now()}){this.send=send;this.clock=clock;this.pending=null;this.record=null;this.receivedAt=0;this.busy=false;this.generation=0;this.autoAttempted=new Set();this.lastAutoAt=-Infinity;}
 get remainingMs(){return this.record?Math.max(0,this.record.expires_at_ms-this.record.server_time_ms-(this.clock()-this.receivedAt)):0}
 get active(){return !!this.record&&this.record.status!=='closed'&&this.remainingMs>0}
 reset(){this.generation++;this.pending=null;this.record=null;this.receivedAt=0;this.autoAttempted.clear();this.lastAutoAt=-Infinity;}
 async run(method,route,body){if(this.busy)throw Error('RFQ request already in progress');this.busy=true;const generation=this.generation;try{const data=await this.send(method,route,body);if(generation!==this.generation)throw Error('RFQ session changed; response discarded');const checked=validateRfqResponse(data,this.pending);if(this.record&&checked.rfq_id!==this.record.rfq_id)throw Error('RFQ identity mismatch');if(this.record&&checked.revision<this.record.revision)throw Error('Stale RFQ revision');this.record=checked;this.receivedAt=this.clock();return checked;}finally{this.busy=false}}
 async create(market,size,{automatic=false}={}){
 const fingerprint=market.symbol+'|'+String(size);
 if(this.active)throw Error('RFQ already active');
 if(automatic&&(this.autoAttempted.has(fingerprint)||this.clock()-this.lastAutoAt<60000))return null;
 // An uncertain create must be retried verbatim, never replaced by a new ID.
 if(this.pending&&!this.record){const candidate=createRfqBody(market,size,this.pending.client_rfq_id);if(JSON.stringify(candidate)!==JSON.stringify(this.pending))throw Error('Retry the pending RFQ before changing size');}
 else {this.pending=createRfqBody(market,size,'guardian-'+crypto.randomUUID());this.record=null;}
 if(automatic){this.autoAttempted.add(fingerprint);this.lastAutoAt=this.clock();}
 return this.run('POST','/v2/rfq',this.pending);
 }
 async refresh(){if(!this.record)return null;return this.run('GET','/v2/rfq/'+this.record.rfq_id)}
 async close(){if(!this.record)return null;return this.run('DELETE','/v2/rfq/'+this.record.rfq_id)}
}
