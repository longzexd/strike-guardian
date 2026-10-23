import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {translateText,normalizeLanguage} from '../dist/i18n.mjs';
test('language defaults to English and only accepts supported locales',()=>{
 for(const value of [undefined,null,'fr','zh','EN',''])assert.equal(normalizeLanguage(value),'en');
 assert.equal(normalizeLanguage('zh-CN'),'zh-CN');
});
test('English covers static Chinese copy and accessible placeholders',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 const texts=[...html.matchAll(/>([^<>]+)</g)].map(m=>m[1]);
 texts.push(...[...html.matchAll(/(?:placeholder|aria-label)="([^"]+)"/g)].map(m=>m[1]));
 for(const text of texts.filter(t=>/[\u4e00-\u9fff]/.test(t)&&!['中文','Language / 语言'].includes(t)))
  assert.doesNotMatch(translateText(text),/[\u4e00-\u9fff]/,text);
});
test('dynamic account errors, depth and funding preserve values in English',()=>{
 const samples=['account 不可用：需要 API Wallet 授权','否 · 剩余 7.41472','标记价 ±0.1% 内：可见买盘 $350,000 / 卖盘 $300,000。仅覆盖返回的 20 档，不代表全市场深度。','8 小时计划内预计 8 次结算，按当前费率恒定估计资金费 -$0.89。下一次官方结算 2026/10/23 14:00:00。'];
 for(const sample of samples)assert.doesNotMatch(translateText(sample),/[\u4e00-\u9fff]/);
 assert.match(translateText(samples[1]),/7\.41472/);
 assert.match(translateText(samples[3]),/-\$0\.89/);
});
test('Chinese source remains lossless and technical payload text is unchanged',()=>{
 const source='固定金额止损要求隔离模式；Strike 返回当前为全仓，完整评估已拦截。';
 assert.equal(translateText(source,'zh-CN'),source);
 for(const text of ['BTC-USD','/price/v2/depth?symbol=BTC-USD&limit=20','0.12254000','READ_ONLY_REAL_DATA'])assert.equal(translateText(text),text);
});
test('risk failures stay explicit in both languages',()=>{
 for(const text of ['保证金模式尚未从 Strike 核验，完整评估不会放行。','可见 20 档深度不足，无法估算完整成交','账户费率阶梯未匹配，禁止回退默认费率']){
  assert.doesNotMatch(translateText(text),/[\u4e00-\u9fff]/);
  assert.equal(translateText(text,'zh-CN'),text);
 }
});
