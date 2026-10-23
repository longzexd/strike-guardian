import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,generateKeyPairSync,verify,createHash} from 'node:crypto';
import {validateRfq,createRfqBody,validateRfqResponse,RfqSession,rfqTrigger} from '../dist/rfq.mjs';
import {importApiWallet,signRfq} from '../dist/protocol.mjs';import {StrikeClient} from '../dist/strike-client.mjs';
const market={symbol:'BTC-USD',base_prec:8,order_limit_max_size:'100'};
const uuid='019c0000-0000-7000-8000-000000000001';
const response=(body,time=100000,overrides={})=>({_v:1,rfq_id:uuid,...body,status:'opened',revision:1,total_quoter_count:2,response_count:0,response_counts:{acked:0,quoted:0,uninterested:0},created_at_ms:time,updated_at_ms:time,expires_at_ms:time+60000,server_time_ms:time,...overrides});
test('RFQ uses base size, official precision and max, and never discloses direction',()=>{
 assert.deepEqual(createRfqBody(market,'2.50000000','guardian-id'),{symbol:'BTC-USD',requested_size:'2.5',client_rfq_id:'guardian-id'});
 for(const q of ['0','-1','1e2','01','NaN','101','0.000000001'])assert.throws(()=>createRfqBody(market,q,'id'));
 assert.throws(()=>createRfqBody({...market,base_prec:2},'0.001','id'));
 assert.throws(()=>createRfqBody({...market,order_limit_max_size:undefined},'1','id'));
});
test('RFQ allowlist cannot sign trading writes, response writes, extra fields or scope selectors',()=>{
 const body=createRfqBody(market,'1','id');
 for(const [method,route,data]of [['POST','/v2/order',body],['PUT','/v2/rfq/'+uuid+'/response',{}],['POST','/v2/rfq',{...body,side:'buy'}],['POST','/v2/rfq',{...body,sub_account_id:'other'}],['GET','/v2/rfq/'+uuid+'?vault_id=x'],['GET','/v2/rfq'],['DELETE','/v2/order']])assert.throws(()=>validateRfq(method,route,data));
 validateRfq('GET','/v2/rfq/'+uuid);validateRfq('DELETE','/v2/rfq/'+uuid);
});
test('RFQ signature covers exact POST body and method with fresh nonce',async()=>{
 const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('hex');
 const wallet=await importApiWallet({publicKey,privateKey},webcrypto.subtle),body=createRfqBody(market,'2.5','id');
 const headers=await signRfq('POST','/v2/rfq',body,wallet,1800000000000,webcrypto.subtle);
 const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 assert.equal(verify(null,Buffer.from(`POST:/v2/rfq:${headers['X-API-Wallet-Timestamp']}:${headers['X-API-Wallet-Nonce']}:${hash}`),pair.publicKey,Buffer.from(headers['X-API-Wallet-Signature'],'hex')),true);
 const next=await signRfq('POST','/v2/rfq',body,wallet,1800000000000,webcrypto.subtle);assert.notEqual(next['X-API-Wallet-Nonce'],headers['X-API-Wallet-Nonce']);
 await assert.rejects(signRfq('POST','/v2/order',body,wallet,1800000000000,webcrypto.subtle));
});
test('uncertain RFQ creation retries exact body and client ID, not a second request',async()=>{
 const seen=[];let attempt=0;const session=new RfqSession({send:async(m,p,b)=>{seen.push(JSON.stringify(b));if(!attempt++)throw Error('timeout');return response(b)}});
 await assert.rejects(session.create(market,'2.5'));
 await assert.rejects(session.create(market,'3'),/pending RFQ/);
 await session.create(market,'2.5');assert.equal(seen[0],seen[1]);assert.equal(seen.length,2);
 await assert.rejects(session.create(market,'2.5'),/already active/);
});
test('automatic RFQ runs once per plan and observes 60-second backoff',async()=>{
 let now=100000,calls=0;const session=new RfqSession({clock:()=>now,send:async(m,p,b)=>{calls++;return response(b,now)}});
 await session.create(market,'2.5',{automatic:true});now+=60001;
 assert.equal(await session.create(market,'2.5',{automatic:true}),null);assert.equal(calls,1);
 const r=await session.create(market,'3',{automatic:true});assert.ok(r);assert.equal(calls,2);
});
test('RFQ expiry uses server-relative countdown and polling validates identity and revision',async()=>{
 let now=100000,body;const session=new RfqSession({clock:()=>now,send:async(m,p,b)=>{if(b)body=b;return response(body,100000,{status:m==='DELETE'?'closed':'quoted',revision:m==='POST'?1:2})}});
 await session.create(market,'1');now+=1000;assert.equal(session.remainingMs,59000);assert.equal(session.active,true);await session.refresh();assert.equal(session.record.status,'quoted');await session.close();assert.equal(session.active,false);
 const newRecord=await session.create(market,'2');assert.equal(newRecord.requested_size,'2');
});
test('RFQ rejects malformed/mismatched official responses and late account-session results',async()=>{
 const body=createRfqBody(market,'1','id');for(const overrides of [{symbol:'ETH-USD'},{requested_size:'2'},{status:'filled'},{revision:-1},{expires_at_ms:1}])assert.throws(()=>validateRfqResponse(response(body,100000,overrides),body));
 let resolve;const session=new RfqSession({send:(m,p,b)=>new Promise(r=>resolve=()=>r(response(b)))});const pending=session.create(market,'1');session.reset();resolve();await assert.rejects(pending,/session changed/);assert.equal(session.record,null);
});
test('depth shortage and excessive VWAP deviation trigger RFQ, ordinary depth does not',()=>{
 assert.equal(rfqTrigger(null),false);assert.equal(rfqTrigger({opening:{complete:true},slippageBps:1}),false);assert.equal(rfqTrigger({opening:{complete:false},slippageBps:null}),true);assert.equal(rfqTrigger({opening:{complete:true},slippageBps:21}),true);
});
test('RFQ client requires authorization and preserves paused/rate-limit errors',async()=>{
 let calls=0;const client=new StrikeClient({fetcher:async(url,options)=>{calls++;assert.match(url,/^\/api\/rfq/);assert.equal(options.method,'POST');return new Response(JSON.stringify({error:'RFQ is paused',code:'RFQ_PAUSED'}),{status:503})}});
 const body=createRfqBody(market,'1','id');await assert.rejects(client.rfq('POST','/v2/rfq',body),/authorization/);assert.equal(calls,0);client.local=true;
 await assert.rejects(client.rfq('POST','/v2/rfq',body),e=>e.code==='RFQ_PAUSED');assert.equal(calls,1);
 await assert.rejects(client.rfq('POST','/v2/order',body));assert.equal(calls,1);
});
