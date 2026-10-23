import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createPrivateKey,createPublicKey,sign,createHash,randomUUID} from 'node:crypto';
import {ORIGINS,assertReadRoute} from './dist/protocol.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const network=process.env.STRIKE_NETWORK??'mainnet';if(!ORIGINS[network])throw Error('STRIKE_NETWORK must be mainnet or testnet');
const exportedPrivate=process.env.STRIKE_API_PRIVATE_KEY?.replace(/^0x/,''),publicKey=process.env.STRIKE_API_PUBLIC_KEY?.replace(/^0x/,'');const seed=exportedPrivate?.slice(0,64);if(exportedPrivate&&!/^[0-9a-fA-F]{64}([0-9a-fA-F]{64})?$/.test(exportedPrivate))throw Error('Unsupported API-wallet private key format');if(exportedPrivate?.length===128&&exportedPrivate.slice(64).toLowerCase()!==publicKey?.toLowerCase())throw Error('API wallet export public suffix mismatch');let signer=null;
if(seed||publicKey){if(!/^[0-9a-fA-F]{64}$/.test(seed??'')||!/^[0-9a-fA-F]{64}$/.test(publicKey??''))throw Error('Configure both raw 32-byte API-wallet keys; never a funding wallet mnemonic');const key=createPrivateKey({key:Buffer.from('302e020100300506032b657004220420'+seed,'hex'),format:'der',type:'pkcs8'});const derived=createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('hex');if(derived!==publicKey.toLowerCase())throw Error('Configured API wallet public/private keys do not match');signer=key;}
const files=['index.html','i18n.mjs','app.mjs','risk.mjs','style.css','protocol.mjs','strike-client.mjs','account-data.mjs','admission.mjs','market-analysis.mjs','guardian-adapter.mjs'];
export function createServer({fetcher=fetch}={}){return http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host??''))return send(403,{error:'Loopback host required'});
 if(req.method!=='GET')return send(405,{error:'Read-only Guardian: no writes, no simulated orders, no exchange orders'});
 const u=new URL(req.url,'http://'+req.headers.host);
 if(u.pathname.startsWith('/api/')&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Same origin required'});
 if(u.pathname==='/api/status')return send(200,{gateway:true,authConfigured:!!signer,network,mode:'GET_ONLY'});
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
 }catch{send(503,{error:'Official API unavailable or invalid request; no fallback data used'})}
 });}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT??4173);createServer().listen(port,'127.0.0.1',()=>console.log(`Strike Guardian READ ONLY: http://127.0.0.1:${port} · ${network} · API wallet ${signer?'configured':'not configured'}`));}
