// Account reads and explicitly scoped nonbinding RFQs only. No trading writes.
import {validateRfq} from './rfq.mjs';
export const ORIGINS=Object.freeze({mainnet:'https://api.strikefinance.org',testnet:'https://api-v2-testnet.strikefinance.org'});
export const PRIVATE_ROUTES=Object.freeze({account:'/v2/account',symbols:'/v2/symbols',positions:'/v2/positions',openOrders:'/v2/openOrders',portfolio:'/v2/portfolio',orderHistory:'/v2/history/order?limit=20',fillHistory:'/v2/history/fill?limit=20',twap:'/v2/algo/twap',grid:'/v2/grid/bot'});
export function assertReadRoute(route,isPrivate){
 if(typeof route!=='string')throw Error('Invalid route');
 if(isPrivate){if(!Object.values(PRIVATE_ROUTES).includes(route))throw Error('Private route not allowed');return route}
 if(/^\/stat\/v1\/stats\/coin\/history\/funding\?symbol=[A-Z0-9]{1,15}-USD&days=7$/.test(route))return route;
 if(['/v2/time','/v2/markets','/v2/fee-tiers'].includes(route))return route;
 if(/^\/price\/v2\/markPrice\?symbol=[A-Z0-9]{1,15}-USD$/.test(route)||/^\/price\/v2\/depth\?symbol=[A-Z0-9]{1,15}-USD&limit=(?:20|1000)$/.test(route)||/^\/price\/v2\/klines\?symbol=[A-Z0-9]{1,15}-USD&interval=1m&limit=60&priceType=mark$/.test(route))return route;
 throw Error('Public route not allowed');
}
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export function unhex(value,length){if(typeof value!=='string'||!new RegExp(`^[0-9a-fA-F]{${length*2}}$`).test(value))throw Error('Invalid raw Ed25519 hex key');return Uint8Array.from(value.match(/../g),b=>parseInt(b,16))}
export async function importApiWallet({publicKey,privateKey},subtle=crypto.subtle){
 // Raw API-wallet seed only; never a funding-wallet mnemonic. Imported private key is nonextractable.
 const pubHex=String(publicKey).replace(/^0x/,'').toLowerCase(),privateHex=String(privateKey).replace(/^0x/,'').toLowerCase();if(!/^[0-9a-f]{64}([0-9a-f]{64})?$/.test(privateHex))throw Error('API wallet private key must be a 32-byte seed or seed+public-key export');if(privateHex.length===128&&privateHex.slice(64)!==pubHex)throw Error('64-byte API wallet export does not match public key');const pub=unhex(pubHex,32),seed=unhex(privateHex.slice(0,64),32);const prefix=unhex('302e020100300506032b657004220420',16);const pkcs8=new Uint8Array(48);pkcs8.set(prefix);pkcs8.set(seed,16);
 let key;try{key=await subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},false,['sign'])}finally{seed.fill(0);pkcs8.fill(0)}
 const verifyKey=await subtle.importKey('raw',pub,{name:'Ed25519'},false,['verify']);const challenge=new TextEncoder().encode('Guardian API wallet key-pair verification');const signature=await subtle.sign('Ed25519',key,challenge);if(!await subtle.verify('Ed25519',verifyKey,signature,challenge))throw Error('API wallet public/private keys do not match');
 return {publicKey:pubHex,sign:async bytes=>new Uint8Array(await subtle.sign('Ed25519',key,bytes))};
}
export async function signRead(route,wallet,serverNow,subtle=crypto.subtle){
 assertReadRoute(route,true);if(!Number.isFinite(serverNow))throw Error('Strike server clock unavailable');
 const timestamp=String(Math.floor((serverNow-1000)/1000)),nonce=crypto.randomUUID();const bodyHash=hex(await subtle.digest('SHA-256',new Uint8Array()));
 const signature=hex(await wallet.sign(new TextEncoder().encode(`GET:${route}:${timestamp}:${nonce}:${bodyHash}`)));
 return {'X-API-Wallet-Public-Key':wallet.publicKey,'X-API-Wallet-Signature':signature,'X-API-Wallet-Timestamp':timestamp,'X-API-Wallet-Nonce':nonce};
}

export async function signRfq(method,route,body,wallet,serverNow,subtle=crypto.subtle){
 validateRfq(method,route,body);if(!Number.isFinite(serverNow))throw Error('Strike server clock unavailable');
 const serialized=body===undefined?'':JSON.stringify(body),timestamp=String(Math.floor((serverNow-1000)/1000)),nonce=crypto.randomUUID();
 const hash=hex(await subtle.digest('SHA-256',new TextEncoder().encode(serialized)));
 const signature=hex(await wallet.sign(new TextEncoder().encode(`${method}:${route}:${timestamp}:${nonce}:${hash}`)));
 return {'X-API-Wallet-Public-Key':wallet.publicKey,'X-API-Wallet-Signature':signature,'X-API-Wallet-Timestamp':timestamp,'X-API-Wallet-Nonce':nonce};
}
