# 补充验证记录

本次补充不增加策略，不改变参数网格，不运行大规模拟合，不写生产文件。

运行：`python3 -m unittest discover -s research/btc_premarket_20261020 -p 'test*.py' -v`。本地17项测试全部通过；逐项输出见test_results.txt。原始ZIP测试要求先使用download.py下载官方原始输入，cache不入库，缺文件会明确失败而非跳过。

|验证目标|证据与已知答案|
|---|---|
|锚点及截止之后不能成交|test_boundaries.py::test_anchor_extremes_and_after_close_excluded，对三锚点设置anchor low=1/high=1000，下一分钟99/102，截止后1/1000；实际仅得1% drawdown、2% runup，3%限价不触达；再放大anchor极值，结果不变。调用的是load实际使用的session_excursions。|
|未来测试成本不能改变过去选参|test_future_cost_perturbation_cannot_change_past_selection，把第26周及以后的候选成本改为正负1e9，过去26周选择参数和成本切片完全不变；含无prior及已有prior。调用的是main实际使用的select_training_window。|
|未来路径不能改变过去数量|test_future_path_perturbation_cannot_change_past_quantity，追加极端未来session，既有测试周结果与完整数量trace不变；另把同测试周最后一天路径/价格极端化，之前每一天expected、每档价格、实际每档数量保持逐项一致。前两次非零买/卖数量手算为0.2、0.8/3。|
|预算触发|共同参考100，预算120，测试锚价200，买入首档198；实际数量恰为120/198，budget_bound=True，标记残量后成本与手算一致。|
|零历史/零完成|过去触达为0，即使测试日极端触达也不挂量；买/卖完成率0，被动均价None，终点110时机会成本为+1000/−1000bps。历史非零但测试全不触达，同样零完成。|
|部分完成及买卖答案|历史触达1档，测试2天仅第一天触达，完成0.5；参考100/终点110，buy limit99，mark成本+450bps；sell limit101，mark成本−550bps。|
|完全完成及买卖答案|1天目标全部在buy99/sell101触达，完成1、残量0，终点改为500仍不影响成本，两侧成本均−100bps。|
|周初expected固定|原测试test_expected_fixed_at_week_start_matches_calibrator：周初expected=1，首日不触达，次日挂量0.25；若错误每日滚动会是1/(4×0.9)，测试能区分；与生产校准器buy/sell完成率相同。|
|三锚点共同条件|251个日期各有且仅有三锚点，common_reference/terminal/close_minute相同；每个方向×阈值×OOS周均有三锚点，终点相对共同参考收益相同，完成量+残量=同目标1。|
|原始ZIP端到端抽样|独立zipfile/csv/时间戳/OHLC解析，不调用生产parse_zip或研究session_excursions；SHA256匹配manifest后，对2025-10-31、11-03、11-28、12-24及2026-03-06、03-09、10-19共7日×3锚点，重算完整分钟窗口的reference/drawdown/runup/common_reference/terminal/anchor_utc，与sessions.csv逐项一致（浮点12位）。覆盖两次DST切换两侧及两次半日市。这是抽样独立核验，不声称独立重解析全部31个ZIP。|

代码仅作等价可测性抽取（session_excursions、select_training_window）及可选内存数量trace；默认不写trace，不更改计算公式。追加验证将保存sessions重建为Session，重算全部234条现有OOS的cost/completion/残量及分解，与保存CSV相符；见verification_evidence.json。全部既有CSV与baseline.json相对9475a08字节不变，未重跑拟合。

解释边界：07:00买入touch的13周差值+28.8908824496bps是本样本均值；描述性bootstrap 95%区间[-10.83,74.54]bps跨零，不能说统计证明07:00更差，结论是本证据不足以支持更改生产。cost_bps包含未成交残量按共同周末价格mark的机会成本，不是实盘交易费用、真实强制成交或ETF滑点；proxy触价也不等于ETF fill。
