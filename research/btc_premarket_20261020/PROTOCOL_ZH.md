# BTC ETF 盘前 scaling 研究协议

对象为 Grayscale Bitcoin Mini Trust ETF，NYSE Arca: BTC，不是 GBTC。仅研究目录新增文件；不得运行生产 updater、部署或交易。独立分支基于 2026-10-20 16:30 main 51042f7。归档数据来自官方 https://data.binance.vision/data/spot/，完整原始 zip 放在忽略的 cache/，逐文件 URL、bytes、SHA256 在 input_manifest.json；run.py 每次验证 hash。已搜索本机已有 BTCUSDT 缓存，未发现可复用原始文件。

研究范围 2025-10-20 至 2026-10-19，取共同美股交易日。按 America/New_York 转换 UTC，每天必须完整覆盖 07:00 至 core close 前一分钟。沿用已复现的仓库节假日和半日市日历（范围内半日市 2025-11-28、12-24），周末/假日不挂单；07:00、08:00、09:35 各取该分钟 close，分别从下一分钟起观察，截止 15:59 分钟或半日市 12:59 分钟。官方日历 https://www.nyse.com/trade/hours-calendars 说明 NYSE Arca early session 04:00–09:30，07:00 是本研究比较锚点，不是交易所最早开盘时刻。

先使用生产原始 26 周、下一交易日09:35残量估值口径复现 published buy/sell 参数（baseline.json）。这一步只检查复现，不能把它当作样本外。研究比较改用共同周末最后一分钟 close 估值，以使期限严格一致。

每周目标量归一化为 1，双方同周目标一致；买入预算上限统一为周首交易日07:00 close 的1.2倍，按剩余预算限制被动数量。卖出持有1单位。买入残量仅终点估值，不假装有预算或真实收盘成交；budget_bound_weeks揭示预算限制。小额连续数量、无冲击、无税费/点差/排队、无ETF股数取整。本研究未使用用户持仓或账户资料。

梯子仍为仓库原机制：每档数量 = 剩余目标 /（剩余本周交易日 × 过去lookback平均触达档数）；零历史触达则本日不挂量；同日从浅到深直到目标完成，每日旧单失效且次日重新锚定，最多12档。每个锚点、买/卖、穿透假设分别校准全部720组原网格：lookback 10/15/20/30/45/60；first 10/15/20/25/30/35/40/50bps；spacing 30至100bps步长5。选择沿用paired one-SE稳定性规则：首个训练窗口无先验取raw minimum；后续只沿用该方案上一测试周已选参数作为prior，绝不使用未来发布参数。

60交易日共同热身后，首26个完整周仅训练；其后每个完整周为测试，训练窗口只用之前26周。训练周的残量在该周末估值，因而周一07:00之前已全部可知。CSV training.csv 是训练成绩，oos_weekly.csv 才是后置测试。预计算各候选周成本只是纯函数缓存，选参切片严格早于测试周。

统一事前参考 P0=该周首交易日07:00 close；终点 PT=该周最后交易日core close前一分钟close。买入成本bps = (已成交代理金额 + 剩余量×PT − P0)/P0×10000；卖出取相反数，越低越好。成本=被动成交贡献+未完成机会成本。未完成机会成本=方向符号×剩余量×(PT/P0−1)×10000。被动均价为各周有触达部分的金额/数量，相对共同P0的bps，再按周均值，不能单独当成完整目标执行收益。完成率、残量和价格必须联读；可在周末主动完成只作为另一种未来实盘策略，这里没有模拟真实强制成交。

touch 乐观情景假设 low<=buy limit 或 high>=sell limit 即可按limit成交；5、10bps穿透另要求 low<=limit×(1−p) / high>=limit×(1+p)，仍按原limit记价。每种假设重新训练且训练/测试一致，属于无真实fill校准的敏感性，不是盘口成交概率。每周paired difference为早锚点成本减09:35成本，负值较好；bootstrap仅对测试周配对差重采样5000次、seed20261020，95%百分位区间只作小样本描述，不是多重比较或选择后有效性保证。

BTCUSDT为BTC/USDT，不是BTC/USD，更不是ETF可成交报价。ETF相对NAV溢折价、USDT基差、盘前点差、券商时段权限、最小股数和排队可能改变结果。没有ETF实际fill数据，Yahoo稀疏零volume盘前bar未用于研究。范围均晚于2024-07-31上市及2024-11-19反拆股；没有直接使用ETF价或上市前ETF业绩，全部是underlying proxy情景。

复现：python3 research/btc_premarket_20261020/download.py（需要公共网络，约27MB）；python3 research/btc_premarket_20261020/run.py；cd research/btc_premarket_20261020 && python3 -m unittest -v。最后运行 python3 research/btc_premarket_20261020/report.py 生成中文报告及robustness.csv。冻结参数对照只在首个26周训练一次，其后仍仅以过去lookback更新每日数量；另给配对差的删一周和前6/后7周敏感性，不作为额外独立样本。无需第三方依赖。不要运行生产updater或GitHub Actions。
