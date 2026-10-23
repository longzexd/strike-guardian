# Strike API 核对与验证记录 · v2

核对日期 2026-10-23。目标为 Strike Finance 永续合约平台 strikefinance.org，不是 strike.me 支付 API。

## 一手来源

- 官方文档索引：https://docs.strikefinance.org/llms.txt
- 官方 builder reference：https://github.com/strike-finance/strike-builder-reference
- 请求签名：https://github.com/strike-finance/strike-builder-reference/blob/main/src/api/auth.ts
- 账户读取：https://github.com/strike-finance/strike-builder-reference/blob/main/src/api/account.ts
- 账户与 symbols 类型：https://github.com/strike-finance/strike-builder-reference/blob/main/src/types/account.ts
- 仓位字段：https://github.com/strike-finance/strike-builder-reference/blob/main/src/types/position.ts
- 保证金与强平公式：https://github.com/strike-finance/strike-builder-reference/blob/main/src/math/positionCalculations.ts
- 账户有效费率：https://github.com/strike-finance/strike-builder-reference/blob/main/src/math/fees.ts
- 保证金、挂单和手续费预留：https://github.com/strike-finance/strike-builder-reference/blob/main/src/math/balanceCalculations.ts
- 真实订单/成交历史：https://docs.strikefinance.org/api/trade/history.md
- 隔离与全仓：https://docs.strikefinance.org/perpetuals/margin-modes.md
- 条件单与成交边界：https://docs.strikefinance.org/perpetuals/order-types.md
- 资金费：https://docs.strikefinance.org/perpetuals/funding-rates.md

本代码独立实现，不包含官方 React 组件或 TradingView charting_library。

## 现场真实公开 API 验证

`node scripts/smoke-public.mjs` 已以主网公开接口运行成功，6 项全部有效：time、markets、markPrice、depth、klines、fee-tiers。该脚本不读取用户密钥，私有数据均保持未授权，并验证完整评估不能通过。

一次现场样例（2026-10-23 09:13 UTC / Asia Nicosia 12:13，之后价格会变化）：BTC mark 81648 USD；1 万美元名义金额换算 0.12247000 BTC；20 档预计均价约 81649.10，最差档位 81651；预计计划初始保证金约 999.96 USD。按该时刻费率不变估计 8 小时资金费支出约 0.75 USD。没有个人费率时，不生成含费止损或完整账户通过结论。此样例不是用户真实交易或持仓。

测试网存在，曾验证 GET /v2/markets。v2 当前应用只提供读取和评估，不包含任何交易写入，不以测试网作为理由执行订单。

## 自动测试

52 项测试通过，语法检查通过。

- 官方账户字段、权益推导、有效市场设置与账户 ID 一致性。
- 缺少账户、symbols、positions、openOrders、portfolio、服务器时钟、费用或资金费时阻断。
- 不用默认模式、默认杠杆、默认手续费或演示余额替代缺失数据。
- 官方模式优先于草稿中的人工声明；杠杆不一致时拦截。
- 固定金额、官方 tick、数量网格、预算、资金占用、过期行情、深度及价格保护。
- 1 万名义金额 / 1 万保证金的区分，VWAP、未满深度、不假设跳价后止损成交。
- 持仓时间结算边界、多空资金费方向、推荐按候选数量重算资金费。
- Browser WebCrypto / Node Ed25519：用仅存在测试进程的临时密钥验证密钥对、官方签名消息、GET 空 body hash、nonce 与时间单位；不调用外部私有账户。
- 本机代理限定官方网络和 GET 白名单，拒绝写方法、跨来源、未知 Host 及非法路径；不暴露密钥。
- Strike 宿主适配层复用认证 GET，无需重复导入密钥；断开后丢弃迟到响应。

旧模拟账户测试辅助仅留在 tests/ 作为计算回归夹具；生产 dist 不导出虚拟账户生成或模拟成交函数。旧模拟 API 和 fixture 路径不再提供。

## 浏览器验收

本机真实公共数据可以正常显示，原有深色双栏、压力曲线和滑杆保留。1 万美元示例换算数量、情景结果与账户未授权拦截已现场验证。账户权益和模式显示缺失，而非模拟值。

## 尚未完成的真实环境验收

用户确认已有已注册 API Wallet，但未在本会话中交给代理，也不应在聊天中发送。**尚未使用该用户的真实 API Wallet 成功读取私有账户，不能声称私有集成已生产验收。** 需要用户在应用内连接，或在本机 .env 配置后验收。若账户范围、字段、权限、CORS 或实际接口结构不同，会明确失败并显示来源，待根据该真实响应修复。

当前仅支持 API Wallet 默认绑定账户，不实现跨子账户切换。官方返回字段不完整时，不以“空仓”或零费率替代。历史查询最多读取一页 20 条，仅用作上下文展示，不影响当前快照准入；不是完整账单。

## 估计与保护边界

账户字段来自 API，不代表所有衍生值都是交易所保证。有效费用存在官方折扣字段精度限制；新仓强平价为当前阶梯的模型估计；额外费用预留采用保守美分舍入。未来资金费、订单簿和止损成交不可保证。隔离模式概览与详细接管文档对极端负余额有不同层次描述，本应用不承诺绝对负余额保护或损失硬封顶。

工具没有实际嵌入 Strike 主应用，也不声称能在独立页面强制拦截用户从其他入口提交的订单。要成为真正的强制门槛，需在 Strike 可信提交路径接入并由订单引擎复核。

发布前补充检查：纯静态本地托管模式下，浏览器直接读取 6 个官方公共接口成功；1/8/24 小时资金费估算正常，未授权费率显示缺失。390px 手机布局未出现横向页面溢出。截图为真实公共数据与未授权账户状态，不包含用户私有账户数据。
