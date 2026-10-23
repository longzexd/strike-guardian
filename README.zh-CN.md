# Strike Guardian — RiskOS

**面向 Strike 的开单前风险助手：先检查当前订单簿能否承接这笔交易，再判断是否值得承担这份风险。**

[English README](README.md) · [完整配置与集成说明](docs/INTEGRATION.md) · [官方 API 核验](API-VERIFICATION.md)

## 主要解决什么问题？

屏幕显示的价格，不一定是整笔订单的实际成交价。订单簿深度有限时，开仓会吃掉多个档位，带来滑点，甚至无法根据当前可见流动性估算完整成交。行情突然变化时，退出可能更困难；设置止损也不代表能按触发价成交。

Guardian 在提交前，把**实时深度、杠杆、止损、账户资金、费用和持仓时长**放在一起评估，帮助用户看清：当前能否开这么大、入场与立即退出的预计成本、突然涨跌时的风险，以及是否需要减小仓位。

**当前版本只读：不下单、不转移资金、不修改账户模式。** 提供独立应用和集成适配层，尚未嵌入 Strike 主应用，也不声称已获官方认可。

![默认英文首页，真实公共行情](docs/screenshots/00-overview-en.jpg)

## 本轮实测结果

验证日期：**2026 年 10 月 23 日**。所有使用截图均为实际浏览器操作截图；价格会变化，不是未来成交承诺。

| 验证项 | 结果 |
|---|---|
| 模块语法检查 | 通过 |
| 自动化测试 | **57 / 57 通过** |
| 真实公共 API | **6 / 6 通过** |
| 中英文切换、金额计划、深度不足、资金费、涨跌情景、导出 | 浏览器实测，见下方逐项截图 |
| 真实私有账户成功读取 | **待用户 API Wallet 授权，尚未实测成功** |
| 实际交易执行 | 不提供交易写入 |

![由本轮真实日志生成的验证报告](docs/screenshots/13-test-results.jpg)

上图是**真实日志生成的报告页面截图**，不是终端截图。可核对[自动化测试原始日志](docs/verification/tests.txt)、[公共 API 原始输出](docs/verification/public-api.txt)、[浏览器记录](docs/verification/browser-checks.json)。账户相关自动化测试使用测试夹具，不等于用户真实账户验收。

## 如何运行？

安装 Node.js 22 或更高版本。本项目零运行时外部依赖，无须执行 `npm install`。

```sh
git clone https://github.com/longzexd/strike-guardian.git
cd strike-guardian
npm start
```

打开 **http://127.0.0.1:4173**。端口占用时可使用 `PORT=4183 npm start`。本轮截图使用独立本地端口，避免影响已有服务。

## 使用示例与截图

### 1. 切换中英文

首次打开默认英文，右上角选择 **中文** 即可切换。选择会保存在本机 `guardian.language`，只保存语言偏好。切换会更新静态标签、动态结果、风控原因、错误与无障碍描述，不会改变输入数量、官方数据或风险判断。

**实测：** 首次英文、切换中文、刷新仍保留中文、切回英文均通过。

![中文界面实测](docs/screenshots/11-chinese-ui.jpg)

### 2. 评估「1 万美元名义仓位、10 倍做多」

选择 Mainnet 只读与 BTC-USD，等待 LIVE · REST。点击 **$10,000 · 10× example / 1 万美元 · 10× 示例**。程序按真实 mark 和数量网格换算数量，并设置距离 mark 约 2%、符合价格网格的示例止损。

**实测：** 出现入场均价、约 1,000 美元的初始保证金假设与价格冲击曲线；未授权账户时，完整评估仍被拦截，不会拿虚拟资金放行。

![一万美元开仓计划](docs/screenshots/01-live-plan.jpg)

注意金额口径：1 万美元**名义金额**、10 倍，约需 1,000 美元保证金；1 万美元**保证金**、10 倍，则约为 10 万美元名义仓位。实际资金预留还取决于真实账户及手续费。这一口径差异有自动化测试覆盖。

### 3. 检查开仓与退出深度

展开 **Order-book depth & execution quality / 当前订单簿与成交质量**。做多开仓逐档吃卖盘，做空吃买盘；再按相反一侧估算当前立即退出。

**实测：** 一万美元计划可被当时返回的订单簿完整覆盖，显示最差开仓价、反向退出均价及未计费的往返价差盈亏。没有账户费率时，手续费明确显示不可用。

![订单簿成交质量](docs/screenshots/02-order-book.jpg)

仅包含 API 返回的每侧 20 档，不代表全市场流动性，更不代表未来止损时还有这些挂单。

### 4. 检查「计划过大、深度不足」

把计划金额改为 `1000000`，金额口径保留名义金额，点击 **Convert amount to quantity / 按金额换算数量**。

**实测：** 当前返回的深度无法承接，页面显示 **No · Unfilled / 否 · 剩余数量**，完整成交与退出均价留空，没有补造流动性。剩余量随行情变化；此结论只针对可见 20 档。

![真实深度不足的结果](docs/screenshots/03-insufficient-depth.jpg)

### 5. 比较持仓时间与资金费

恢复一万美元示例，展开 **Holding time & funding estimates / 持仓时间与资金费估算**，比较 1、8、24 小时，或输入自己的计划时长。

**实测：** 结算次数与预计支出随时长变化。本轮截图约为 0.11 / 0.89 / 2.68 美元；这是当时费率恒定的估算，不是未来固定收费。账户手续费仍显示待授权。

![持仓资金费比较](docs/screenshots/04-holding-funding.jpg)

结算基于官方下一次结算时间和每小时边界；正数为收入、负数为支出。不预测未来费率，也不推荐「最佳持仓时长」。

### 6. 检查价格突然涨跌

拖动价格冲击滑杆，再查看 **What happens in a sudden price move? / 突然涨跌，损失会怎样？** 的 ±5%、±10%、±20% 情景。

**实测：** 约一万美元多仓在 −5% 时毛亏约 500 美元、−10% 时约 1,000 美元；更深下跌触及模型强平条件。没有账户费率时，含费结果不填默认值。

![突然涨跌情景](docs/screenshots/05-shock-scenarios.jpg)

这里假设一直持有到情景价，**不会假设止损已成交**。超过强平条件后的毛盈亏也是假设值，不能当成最终强平结算；逐仓模式和固定预算都不保证止损成交或绝对损失封顶。

### 7. 固定金额止损，必须核验逐仓

把止损设置切换为 **Fixed-dollar stop budget / 固定金额止损预算**，例如填 `100`。模式必须来自 `/v2/symbols` 的当前市场生效配置，不能手动声明已逐仓。

**本轮实测：** 未授权时模式未知，明确提示模式未核验，完整评估不会放行。

![逐仓模式未核验时阻断](docs/screenshots/06-isolated-required.jpg)

**自动化测试覆盖：** 官方 cross、未知模式、缺少生效配置均拦截；人工写 isolated 不能覆盖官方 cross。未提供真实 cross 账户截图，这些是测试夹具验证。需在 Strike 主应用调整模式后重新读取；本应用不会替用户修改。本版所有新增仓位完整评估目前均要求逐仓。

### 8. 推荐更小仓位

设置方向、止损、持仓时长后点击 **Recommend size / 推荐合规仓位**。真实关键数据完整时，按官方数量网格搜索满足相同准入规则的仓位，保留 5% 模型预算余量，并按候选数量重算资金费。

**本轮实测：** 未授权账户时正确拒绝推荐，不编造余额或仓位。正向推荐与预算符合性有合成数据测试覆盖；真实授权账户的推荐结果仍待验证。

![账户缺失时拒绝推荐](docs/screenshots/10-recommendation-blocked.jpg)

### 9. 连接已有 API Wallet

点击 **Connect account / 连接真实账户**。推荐本机配置：

```sh
cp .env.example .env
# 在自己电脑编辑 .env，不要把密钥发送到聊天或提交 GitHub。
npm run start:env
```

配置 `STRIKE_NETWORK`、`STRIKE_API_PUBLIC_KEY`、`STRIKE_API_PRIVATE_KEY`，再点击「连接本机已配置 API Wallet」。仅使用 API Wallet 的 Ed25519 seed，禁止填写资金钱包助记词。支持 64 hex 字符 seed 或 128 hex 字符 seed+public，必须密钥对匹配、网络匹配。

**实测：** 授权入口、未配置提示正常，字段没有假余额。**未使用用户真实密钥连接，因此没有私有账户成功截图。**

![真实账户授权入口，密钥为空](docs/screenshots/08-account-authorization.jpg)

本机模式由 Node 签名，浏览器不接触私钥。可选页面内导入使用不可导出的内存签名对象，清空输入，刷新需要重连；要求浏览器支持 Ed25519 与官方 CORS。密钥不持久化。API Wallet 自身可能有交易权限，但本应用只签名白名单 GET。

连接后，需确认账户、symbols、positions、openOrders、portfolio 均成功。计划杠杆必须匹配官方生效值；同市场已有仓位或挂单时，本版不支持加仓/反手评估。详见[完整配置](docs/INTEGRATION.md)。

### 10. 核对来源并导出

打开 **Data sources / 数据来源** 检查每条接口状态，点 View 查看原始响应。点 **Export assessment JSON / 导出评估 JSON**，下载内容与页面「导出内容预览」使用同一份序列化数据。

**实测：** 六条公共来源成功，七条私有来源显示待授权。导出结果包含 `READ_ONLY_REAL_DATA`、`uiLanguage: en`、`accountId: null`、`assessment.ok: false` 与有效公共行情分析。

![数据来源成功与待授权状态](docs/screenshots/07-data-sources.jpg)

![实际导出内容预览](docs/screenshots/12-export.jpg)

可查阅[本次仅公共数据的导出](docs/verification/public-assessment.json)。**真实账户授权后，导出可能包含私有账户数据，分享前请检查。** 原始接口响应、机器可读计划与判断原因保持源格式，不随界面翻译。

### 11. 查看真实历史轨迹

展开 **Live price history / 真实价格轨迹**。

**实测：** 读取并绘制最近 60 根官方 1 分钟标记价 K 线收盘价，注明来源；不是生成的行情，不代表未来趋势。

![官方标记价历史](docs/screenshots/09-price-history.jpg)

## 数据与计算边界

公共接口：`/v2/time`、`/v2/markets`、`/price/v2/markPrice`、`/price/v2/depth?limit=20`、`/price/v2/klines`、`/v2/fee-tiers`。

需 API Wallet 的接口：`/v2/account`、`/v2/symbols`、`/v2/positions`、`/v2/openOrders`、`/v2/portfolio`、`/v2/history/order?limit=20`、`/v2/history/fill?limit=20`。完整路径参数与用途见 [English README](README.md#data-sources-and-calculation-boundaries)。

- 官方事实：行情、规则、余额、生效模式、杠杆、仓位、挂单、账户费率。缺失就提示，不拿样例替代。
- 模型推导：VWAP、初始保证金、新仓强平参考价、折扣后费率、持仓资金费和压力盈亏。
- Guardian 策略：单笔风险不超过权益 1%、总保证金占用不超过 25%、最大 10 倍、VWAP 相对 mark 偏差不超过 20 bps、额外 10 bps 缓冲、止损距估计强平至少 mark 的 0.5%、最多三个独立仓位。这些不是交易所保证。
- 未知项：未来价格、未来深度、未来资金费、真实退出价、最终强平损失与最佳持仓时间。

准入使用 8 位 BigInt 定点计算并保守向上取美分；止损模型风险包含价差损失、双边 taker 手续费、缓冲和预计资金费支出，预计收入不抵消预算。图表使用浮点数展示。

每 10 秒轮询；关键当前数据 15 秒过期，多接口不是原子快照。仅支持 API Wallet 绑定的默认账户，不支持跨子账户选择；历史每接口最多一页 20 条。

## 集成到 Strike

`dist/guardian-adapter.mjs` 的 `createStrikeRiskGate` 可复用主应用已有认证 GET，评估不通过时由宿主阻止其提交路径。详见[集成代码](docs/INTEGRATION.md#集成到-strike-主应用)。

独立网页不能阻止用户从其他入口下单。要成为真正强制门槛，应在 Strike 可信后端/订单引擎提交前再次验证，避免快照与执行之间状态变化。

## 自行重跑测试

```sh
npm run check
npm test
npm run test:public
```

前两项无须钱包或网络；公共实测需要访问官方服务，网络失败会明确失败。提交的日志和截图只作验收证据，生产 UI 不会回放它们。

[90 秒演示脚本](DEMO.md) · [API 核验边界](API-VERIFICATION.md) · [MIT 许可](LICENSE)
