# Strike Guardian / RiskOS v2

面向 Strike 主应用集成的**只读订单前风控评估层**。保留深色双栏工作台；账户事实全部从 Strike API 读取，用户仅输入交易计划和情景假设。

本版替换了最初的演示账户：没有虚拟 $10,000 账户、模拟成交入口或“手动声明隔离”的通行证。缺少 API Wallet 授权、关键字段缺失、接口失败或数据过期时，完整评估不会通过。公共行情可用于明确标注的市场预评估。

## 本机运行与真实账户授权

要求 Node.js 22+，零依赖，无须 npm install。

```sh
npm start
# http://127.0.0.1:4173
```

先只显示官方公共行情和需要授权的数据项。要读取已有 API Wallet 的真实账户：

1. 把 `.env.example` 复制为本目录 `.env`，在自己电脑的编辑器中填写 `STRIKE_API_PUBLIC_KEY` 与 `STRIKE_API_PRIVATE_KEY`。
2. `STRIKE_NETWORK=mainnet` 或 `testnet` 必须对应密钥注册的环境。只使用 API Wallet 密钥，绝不要填写资金钱包助记词。
3. 私钥支持 32 字节原始 Ed25519 seed（64 hex），或 seed+public 导出（128 hex，后 64 hex 必须匹配公钥）；可带 0x 前缀。不支持 SSH/PEM/助记词。
4. 运行 `npm run start:env`，在网页右上角「连接真实账户」中点击「连接本机已配置 API Wallet」。
5. 查看「数据来源」：账户、symbols、仓位、挂单、portfolio 应成功返回，顶部权益和当前市场模式才有真实值。

本机签名在 Node 内完成，浏览器不接触私钥；本机服务只绑定 loopback，拒绝跨来源 API 读取与非 loopback Host。`.env` 不入 Git、不加入发布压缩包；不要在聊天、截图或 GitHub 中分享它。

**在线静态版**：也可在「连接真实账户」中导入 API Wallet 公私钥。WebCrypto 验证密钥对，私钥导入为不可导出的内存签名对象，输入框立即清空。密钥不写 localStorage、sessionStorage、日志、源码或远端本应用服务器。刷新或断开后需重新连接。静态版需要浏览器支持 Ed25519 WebCrypto，并且 Strike 允许对应 CORS 请求；失败会明确显示，不回退演示数据。已有 API Wallet 本身可能有交易权限，但本应用的签名器和代理均仅允许特定 GET 路径；没有订单、转账、提款或模式修改请求。

## 已接入的官方数据

所有路径在所选官方 origin 下：mainnet `https://api.strikefinance.org`；testnet `https://api-v2-testnet.strikefinance.org`。

| 接口 | 用途 | 授权 |
|---|---|---|
| GET /v2/time | 官方服务器校时、签名时间、行情过期判断 | 公共 |
| GET /v2/markets | 市场状态、数量与价格网格、保证金阶梯、官方价格保护边界 | 公共 |
| GET /price/v2/markPrice?symbol=… | 真实标记价、当前资金费率、下一次资金费结算时间 | 公共 |
| GET /price/v2/depth?symbol=…&limit=20 | 真实买卖各 20 档，开仓 VWAP、立即反向退出估算、可见深度 | 公共 |
| GET /price/v2/klines?symbol=…&interval=1m&limit=60&priceType=mark | 最近 60 根真实标记价 K 线 | 公共 |
| GET /v2/fee-tiers | 展示并核验公开费率阶梯；不代替个人实际费率 | 公共 |
| GET /v2/account | 钱包余额、未实现盈亏、可用余额、真实账户 ID | API Wallet |
| GET /v2/symbols | **当前市场实际生效**的保证金模式和杠杆；不拿默认值代替 | API Wallet |
| GET /v2/positions | 真实仓位、隔离资金、未实现盈亏、官方强平参考价 | API Wallet |
| GET /v2/openOrders | 真实挂单及状态，避免评估时忽略潜在同市场敞口 | API Wallet |
| GET /v2/portfolio | 真实个人手续费阶梯、返佣与质押折扣、交易启用状态 | API Wallet |
| GET /v2/history/order?limit=20 | 最近真实订单状态 | API Wallet |
| GET /v2/history/fill?limit=20 | 最近真实成交记录 | API Wallet |

当前以 API Wallet 默认绑定账户为范围，不会把主账户默认模式当成所有市场的模式，也不会合并不同子账户。尚未提供跨子账户选择；可使用绑定目标账户的独立 API Wallet。这里的“全部真实”指产品所使用的每项账户/行情事实均来自官方，并非抓取与风控无关的全部平台接口。

## 如何评估「1 万美元、10 倍做多」

1. 选择市场、方向。金额口径区分：1 万美元**名义仓位**约需 1,000 美元保证金；1 万美元**保证金**对应约 10 万美元名义仓位。点「按金额换算数量」，数量向下对齐官方网格。
2. 输入计划杠杆、止损价及持仓小时数。示例按钮设置 1 万名义金额、10 倍、距当前价约 2% 的示例止损；这是显式计划参数，不是 API 事实或投资建议。
3. 左侧预评估当前可见订单簿的完整成交能力、VWAP、最差档位、相对 mark 偏差、立即反向退出的当前价差及不同深度带。
4. 1/8/24 小时及自定义持仓计划，按官方下一次结算时间、每小时结算及当前费率不变假设估计资金费。用户选择时长，程序不预测“应该持有多久”。
5. −20%、−10%、−5%、+5%、+10%、+20% 情景展示计划毛盈亏、可获得账户费率时的含双边费估计、维持保证金条件。压力图保留原布局。不会假设越过止损后已经成交，也不会把强平参考价当成无滑点结算价。
6. 完整评估需真实账户；计划杠杆必须匹配官方生效值。固定金额止损时官方模式必须为 isolated；未知或 cross 时拦截。按钮仅重新读取并评估，不交易。
7. 页面提供具体修正方向、基于真实配置的推荐数量，以及含原始官方响应、时间和估计条件的 JSON 导出。

## 数据、推导、政策和未知项

- **直接官方事实**：钱包余额、可用余额、未实现盈亏、市场配置、账户模式/杠杆、仓位、挂单、费率与资金费时间。
- **由官方数据推导**：总权益 = wallet_balance + 全部 unrealized_pnl；VWAP；计划初始保证金；新仓强平价估计；折扣后有效费率估计；持仓资金费情景。
- **Guardian 政策**：单笔止损模型风险 ≤ 权益 1%；总保证金占用 ≤ 权益 25%；最大计划杠杆 10 倍；相对标记价偏差 ≤20 bps；额外风险缓冲 10 bps；止损距估计强平至少 mark×0.5%；最多 3 个已有/新增独立仓位，每市场一个。推荐保留较小风险预算的 5% 余量。这些不是 Strike 官方策略阈值。
- **未知**：未来价格、未来订单簿、未来资金费、实际退出价、策略收益和最佳持仓时长。不给这些字段编造“真实值”。

准入使用 BigInt 8 位定点数；超过可支持精度的非零小数会提示而不是静默近似，末尾多余零可规范化。金额风险、保证金与手续费按美分向上取整，和 Strike 后端 quote_prec half-even 存在保守舍入差异。情景图和统计展示使用普通数值计算，不能替代强平或订单执行引擎。

个人 taker 费率由 `/v2/portfolio` 对应阶梯及官方折扣推导，不再默认 6 bps。返佣折扣字段精度有限，因此有效费用仍标为估计。isolated 下单资金预留采用保证金加双边费预留的保守估计；不声称精确复刻所有后端资金锁定语义。

止损风险 = 价差损失 + 估计双边 taker 费 + 10 bps 缓冲 + 计划时长的预计资金费支出（当前 rate 恒定假设；预计资金费收入不抵消风险预算）。固定金额预算不是隔离保证金金额，不保证实际亏损封顶；预计隔离投入高于预算时显示额外提示。

每 10 秒 REST 轮询；账户关键数据、mark、depth、规则 15 秒过期。规则/账户时间为本地成功读取时间；行情时间取官方消息，使用官方时间校准。多接口快照不是原子账户事务。历史/K 线缺失会标记，但不伪造；其缺失不影响仅依赖当前账户和订单簿的准入。

## 集成到 Strike 主应用

`dist/guardian-adapter.mjs` 导出 `createStrikeRiskGate`，复用主 App 已有的认证 GET，不需要用户再次向本工具提供私钥：

```js
import { createStrikeRiskGate } from './dist/guardian-adapter.mjs';

const gate = createStrikeRiskGate({
  network: 'mainnet',
  readPrivate: async (path) => {
    const response = await existingStrikeAuthenticatedFetch('https://api.strikefinance.org' + path, 'GET');
    if (!response.ok) throw new Error(`Strike HTTP ${response.status}`);
    return response.json();
  },
});

const report = await gate.evaluate({
  symbol: 'BTC-USD', side: 'long', quantity: '0.01', leverage: '10',
  stop: '78000', stopMode: 'fixed-amount', stopAmount: '100', holdingHours: '8',
});
if (!report.decision.ok) {
  showBlockingReasons(report.decision.reasons);
  // Stop the host's submission flow here.
}
```

集成宿主需要提供真实的 authenticated reader、选对 API Wallet 的账户范围，并把返回结果接在现有提交路径前。适配器每次重新取快照；连接清除时拒绝迟到响应。仅浏览器可编辑的判断不是不可绕过的交易安全边界；若要作为强制准入，需在 Strike 可信后端/订单引擎复核，防止评估和提交之间的状态变化。

**尚未实际嵌入 Strike 主应用，也没有声称已经获得官方集成或审批。** 本仓库交付独立评估应用和适配层。真实账户验收需用户在自己的应用会话或本机配置 API Wallet；尚未读取用户真实私有账户，不能把契约测试当成生产账户实测。

## 测试与现场验证

```sh
npm run check
npm test
npm run test:public
```

52 项测试覆盖真实数据规范化、无默认费率、有效市场模式、杠杆一致性、数据过期、账户 ID 关联、持仓/挂单冲突、资金费时长、推荐随数量重算、订单簿深度、跳价、官方签名格式、浏览器与本机 Ed25519 密钥验证、只读路由白名单、拒绝所有写入、网络绑定，以及宿主认证适配。测试夹具只在 `tests/` 中，不供生产 UI 或代理返回。

6 个公共接口已现场读取验证；真实账户端到端验证等待用户在应用中授权。来源与边界见 `API-VERIFICATION.md`，约 90 秒脚本见 `DEMO.md`。
