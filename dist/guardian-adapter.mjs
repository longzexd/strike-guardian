// Integration boundary for Strike's own app: reuse its existing authenticated GET reader.
// No API keys, simulated accounts or trading writes are created by this adapter.
import {StrikeClient} from './strike-client.mjs';import {assess,recommendLive} from './admission.mjs';import {analyzeMarket} from './market-analysis.mjs';
export function createStrikeRiskGate({readPrivate,network='mainnet',fetchPublic=fetch,clock=()=>Date.now()}={}){
 if(typeof readPrivate!=='function')throw Error('Provide Strike app authenticated GET reader returning official JSON; no default account');
 const client=new StrikeClient({network,fetcher:fetchPublic,authenticatedRead:readPrivate,clock});
 return {
 async evaluate(draft){const bundle=await client.collect(draft.symbol);const decision=assess(bundle,draft,clock());let marketAnalysis=null;if(decision.context)marketAnalysis=analyzeMarket(decision.context.snapshot,draft,decision.context.account.fees,decision.context.now);return {decision:{ok:decision.ok,reasons:decision.reasons,metrics:decision.metrics,provenance:decision.provenance},marketAnalysis,unavailable:Object.entries(bundle.packets).filter(([,v])=>!v.ok).map(([name,v])=>({name,route:v.route,error:v.error})),snapshot:bundle};},
 async recommend(draft){const bundle=await client.collect(draft.symbol);return recommendLive(bundle,draft,clock());},
 disconnect(){client.disconnect();}
 };
}
