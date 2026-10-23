import {validateRfq} from './rfq.mjs';
import {ORIGINS,PRIVATE_ROUTES,assertReadRoute,importApiWallet,signRead,signRfq} from './protocol.mjs';
export class StrikeClient{
 constructor({network='mainnet',fetcher=fetch,clock=()=>Date.now(),authenticatedRead=null}={}){if(!ORIGINS[network])throw Error('Unknown network');this.network=network;this.origin=ORIGINS[network];this.fetcher=(...args)=>fetcher(...args);this.clock=clock;this.offset=null;this.syncedAt=0;this.wallet=null;this.local=false;this.localAvailable=false;this.generation=0;this.status={};this.hostRead=authenticatedRead;}
 now(){if(this.offset===null||this.clock()-this.syncedAt>60000)throw Error('Strike server clock not synchronized');return this.clock()+this.offset}
 get connected(){return !!this.wallet||this.local||typeof this.hostRead==='function'}
 disconnect(){this.hostRead=null;this.wallet=null;this.local=false;this.generation++;this.status={}}
 async detectLocal(){try{const r=await this.fetcher('/api/status',{cache:'no-store',signal:AbortSignal.timeout(1500)});if(!r.ok)return;const s=await r.json();this.localAvailable=s.gateway===true;this.localConfigured=s.authConfigured===true&&s.network===this.network;}catch{}}
 async useLocal(){if(!this.localConfigured)throw Error('Local API wallet is not configured for this network');this.disconnect();this.local=true;await this.syncClock();}
 async importKeys(keys){this.disconnect();this.wallet=await importApiWallet(keys);try{await this.syncClock()}catch(e){this.disconnect();throw e}}
 async request(route,privateRead=false){assertReadRoute(route,privateRead);const generation=this.generation;
 if(privateRead&&!this.connected)throw Error('API Wallet authorization required');
 if(privateRead&&this.hostRead){const reader=this.hostRead;const data=await reader(route,{method:'GET'});if(generation!==this.generation)throw Error('Account session changed; response discarded');return data;}
 let url,headers={};if(this.localAvailable&&(!privateRead||this.local)){url='/api/read?network='+this.network+'&private='+(privateRead?'1':'0')+'&route='+encodeURIComponent(route)}else{url=this.origin+route;if(privateRead)headers=await signRead(route,this.wallet,this.now());}
 if(generation!==this.generation)throw Error('Account session changed; request cancelled');
 let response;try{response=await this.fetcher(url,{method:'GET',headers,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});}catch{throw Error('Network / CORS / timeout: '+route)}
 let data;try{data=await response.json()}catch{throw Error('Non-JSON response: '+route)}
 if(generation!==this.generation)throw Error('Account session changed; response discarded');
 if(!response.ok){if(response.status===401){this.wallet=null;this.local=false}throw Error(`Strike HTTP ${response.status}: ${route}`)}
 return data;
 }
 async rfq(method,route,body){
 validateRfq(method,route,body);if(!this.connected)throw Error('API Wallet authorization required');
 if(this.hostRead&&!this.wallet&&!this.local)throw Error('Host RFQ writer not configured');
 const generation=this.generation;let url,headers={},options={method,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)};
 if(this.local){url='/api/rfq?network='+this.network+'&route='+encodeURIComponent(route);}else{url=this.origin+route;headers=await signRfq(method,route,body,this.wallet,this.now());}
 if(body!==undefined){options.body=JSON.stringify(body);headers['Content-Type']='application/json';}options.headers=headers;
 if(generation!==this.generation)throw Error('Account session changed; request cancelled');
 let r;try{r=await this.fetcher(url,options)}catch{throw Object.assign(Error('RFQ outcome unknown; retry the identical request'),{code:'RFQ_MUTATION_INDETERMINATE'})}
 let data;try{data=await r.json()}catch{throw Object.assign(Error('RFQ response invalid; retry the identical request'),{code:'RFQ_MUTATION_INDETERMINATE'})}
 if(generation!==this.generation)throw Error('Account session changed; response discarded');
 if(!r.ok){if(r.status===401){this.wallet=null;this.local=false;}throw Object.assign(Error('Strike RFQ HTTP '+r.status+': '+(data.error??'Unavailable')),{code:data.code??'HTTP_'+r.status,retryAfter:r.headers.get('Retry-After')})}
 return data;
 }
 async syncClock(){const start=this.clock();const data=await this.request('/v2/time');const end=this.clock();if(!Number.isFinite(data.serverTime))throw Error('Missing official serverTime');this.offset=data.serverTime-(start+end)/2;this.syncedAt=end;return data}
 async collect(symbol){if(!/^[A-Z0-9]{1,15}-USD$/.test(symbol))throw Error('Invalid symbol');const generation=this.generation;
 const packets={},jobs=[['markets','/v2/markets',false],['mark',`/price/v2/markPrice?symbol=${symbol}`,false],['depth',`/price/v2/depth?symbol=${symbol}&limit=20`,false],['klines',`/price/v2/klines?symbol=${symbol}&interval=1m&limit=60&priceType=mark`,false],['feeTiers','/v2/fee-tiers',false]];
 try{await this.syncClock();packets.time={ok:true,data:{serverTime:this.now()},at:this.clock(),route:'/v2/time'}}catch(e){packets.time={ok:false,error:e.message,route:'/v2/time'}}
 if(this.connected)for(const [name,route]of Object.entries(PRIVATE_ROUTES))jobs.push([name,route,true]);else for(const [name,route]of Object.entries(PRIVATE_ROUTES))packets[name]={ok:false,error:'需要 API Wallet 授权',route};
 await Promise.all(jobs.map(async([name,route,priv])=>{try{const data=await this.request(route,priv);packets[name]={ok:true,data,at:this.clock(),route}}catch(e){packets[name]={ok:false,error:e.message,route}}}));
 if(generation!==this.generation)throw Error('Account session changed; response discarded');return {network:this.network,origin:this.origin,symbol,packets,collectedAt:this.clock(),serverNow:packets.time.ok?this.now():null};
 }
}
