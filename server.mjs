import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createPrivateKey,createPublicKey,sign,createHash,randomUUID} from 'node:crypto';
import {validateRfq} from './dist/rfq.mjs';
import {ORIGINS,assertReadRoute} from './dist/protocol.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const network=process.env.STRIKE_NETWORK??'mainnet';if(!ORIGINS[network])throw Error('STRIKE_NETWORK must be mainnet or testnet');
const exportedPrivate=process.env.STRIKE_API_PRIVATE_KEY?.replace(/^0x/,''),publicKey=process.env.STRIKE_API_PUBLIC_KEY?.replace(/^0x/,'');const seed=exportedPrivate?.slice(0,64);if(exportedPrivate&&!/^[0-9a-fA-F]{64}([0-9a-fA-F]{64})?$/.test(exportedPrivate))throw Error('Unsupported API-wallet private key format');if(exportedPrivate?.length===128&&exportedPrivate.slice(64).toLowerCase()!==publicKey?.toLowerCase())throw Error('API wallet export public suffix mismatch');let signer=null;
if(seed||publicKey){if(!/^[0-9a-fA-F]{64}$/.test(seed??'')||!/^[0-9a-fA-F]{64}$/.test(publicKey??''))throw Error('Configure both raw 32-byte API-wallet keys; never a funding wallet mnemonic');const key=createPrivateKey({key:Buffer.from('302e020100300506032b657004220420'+seed,'hex'),format:'der',type:'pkcs8'});const derived=createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('hex');if(derived!==publicKey.toLowerCase())throw Error('Configured API wallet public/private keys do not match');signer=key;}
const files=['index.html','execution.mjs','execution-ui.mjs','cardano-wallet.mjs','cardano-ui.mjs','rfq.mjs','rfq-ui.mjs','i18n.mjs','app.mjs','risk.mjs','style.css','protocol.mjs','strike-client.mjs','account-data.mjs','admission.mjs','market-analysis.mjs','guardian-adapter.mjs'];
export function createServer({fetcher=fetch}={}){return http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host??''))return send(403,{error:'Loopback host required'});
 if(req.method!=='GET'&&!['POST','DELETE'].includes(req.method))return send(405,{error:'Guardian: no trading writes'});
 const u=new URL(req.url,'http://'+req.headers.host);
 if(u.pathname.startsWith('/api/')&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Same origin required'});
 if(req.method!=='GET'&&u.pathname!=='/api/rfq')return send(405,{error:'Guardian: no trading writes'});
 if(u.pathname==='/api/status')return send(200,{gateway:true,authConfigured:!!signer,network,mode:'NO_TRADING_RFQ_OPTIONAL'});
 if(u.pathname==='/api/rfq'){
 if(req.method!=='GET'&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Same-origin RFQ request required'});
 const env=u.searchParams.get('network'),route=u.searchParams.get('route');if(!ORIGINS[env])return send(400,{error:'Unknown network'});
 let body,serialized='';if(req.method==='POST'){
 if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
 let bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>4096)return send(413,{error:'RFQ body too large'});serialized+=chunk.toString()}
 try{body=JSON.parse(serialized)}catch{return send(400,{error:'Invalid RFQ JSON'})}
 // Require exact canonical serialization; rejects duplicate keys before forwarding.
 if(JSON.stringify(body)!==serialized)return send(400,{error:'Canonical RFQ JSON required'});
 }
 try{validateRfq(req.method,route,body)}catch{return send(400,{error:'Invalid RFQ route or body'})}
 if(!signer)return send(401,{error:'Local API wallet not configured'});if(env!==network)return send(403,{error:'API wallet network mismatch'});
 const cr=await fetcher(ORIGINS[env]+'/v2/time',{signal:AbortSignal.timeout(7000)});if(!cr.ok)throw Error('Clock unavailable');const clock=await cr.json();if(!Number.isFinite(clock.serverTime))throw Error('Clock missing');
 const timestamp=String(Math.floor((clock.serverTime-1000)/1000)),nonce=randomUUID();
 const msg=`${req.method}:${route}:${timestamp}:${nonce}:${createHash('sha256').update(serialized).digest('hex')}`;
 const headers={'X-API-Wallet-Public-Key':publicKey.toLowerCase(),'X-API-Wallet-Signature':sign(null,Buffer.from(msg),signer).toString('hex'),'X-API-Wallet-Timestamp':timestamp,'X-API-Wallet-Nonce':nonce};if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetcher(ORIGINS[env]+route,{method:req.method,headers,...(body===undefined?{}:{body:serialized}),signal:AbortSignal.timeout(8000)});
 if(r.headers?.get('Retry-After'))res.setHeader('Retry-After',r.headers.get('Retry-After'));
 let data;try{data=await r.json()}catch{return send(503,{error:'RFQ outcome unknown; retry identical request',code:'RFQ_MUTATION_INDETERMINATE'})}
 return send(r.status,data);
 }
 if(u.pathname==='/api/read'){
 const env=u.searchParams.get('network'),priv=u.searchParams.get('private')==='1',route=u.searchParams.get('route');if(!ORIGINS[env])return send(400,{error:'Unknown network'});assertReadRoute(route,priv);const headers={};
 if(priv){if(!signer)return send(401,{error:'Local API wallet not configured'});if(env!==network)return send(403,{error:'API wallet network mismatch'});
 const clockResponse=await fetcher(ORIGINS[env]+'/v2/time',{signal:AbortSignal.timeout(7000)});if(!clockResponse.ok)throw Error('Official clock unavailable');const clock=await clockResponse.json();if(!Number.isFinite(clock.serverTime))throw Error('Official server time missing');const timestamp=String(Math.floor((clock.serverTime-1000)/1000)),nonce=randomUUID();const message=`GET:${route}:${timestamp}:${nonce}:${createHash('sha256').update('').digest('hex')}`;
 headers['X-API-Wallet-Public-Key']=publicKey.toLowerCase();headers['X-API-Wallet-Signature']=sign(null,Buffer.from(message),signer).toString('hex');headers['X-API-Wallet-Timestamp']=timestamp;headers['X-API-Wallet-Nonce']=nonce;
 }
 const r=await fetcher(ORIGINS[env]+route,{method:'GET',headers,signal:AbortSignal.timeout(8000)});let data;try{data=await r.json()}catch{throw Error('Official API returned non-JSON data')}
 return send(r.status,r.ok?data:{error:`Strike HTTP ${r.status}`});
 }
 if(u.pathname.startsWith('/api/'))return send(404,{error:'Unknown read-only endpoint'});
 const file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!files.includes(file))return send(404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(path.join(root,file)));
 }catch{send(503,{error:'Official API unavailable or invalid request; no fallback data used',...(req.url?.startsWith('/api/rfq')?{code:'RFQ_MUTATION_INDETERMINATE'}:{})})}
 });}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT??4173);createServer().listen(port,'127.0.0.1',()=>console.log(`Strike Guardian NO TRADING: http://127.0.0.1:${port} · ${network} · API wallet ${signer?'configured':'not configured'}`));}
