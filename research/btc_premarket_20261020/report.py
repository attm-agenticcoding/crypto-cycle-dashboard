"""Render Chinese report from saved research CSVs; no new fitting."""
import csv,io,json,statistics
from pathlib import Path
R=Path(__file__).resolve().parent
read=lambda name:list(csv.DictReader(io.StringIO((R/name).read_text())))
sumrows=read('summary.csv'); paired=read('paired.csv'); meta=json.loads((R/'run_metadata.json').read_text())
lines=['# BTC ETF 盘前 scaling 首份比较（2026-10-20）','','结论：本轮 proxy 样本不支持直接把生产起点改成07:00。提前买入明显提高目标完成度，却没有提高完整目标的执行成本；卖出的小幅优势依赖触价假设。08:00值得继续影子观察，但目前未建立稳定改善。没有修改任何生产参数、调度、部署或订单。','','## 数据与复现','','最新代码基点 main 51042f7（2026-10-20 16:30），研究分支 research/btc-premarket-scaling-20261020。官方31份Binance BTCUSDT 1m zip均已下载并记录SHA256，07:00至收盘所需分钟无缺口/重复。251个共同美股交易日，2025-10-20至2026-10-19；完整热身后39周，前26周训练，其后13周（2026-07-20至10-16）逐周向前测试。10-19用于基线复现但未把未完成周纳入测试。DST、假日与范围内两次13:00半日市已处理。','','09:35生产基线复现成功：买入 lookback10 / first0.30% / spacing0.95%；卖出20 / 0.50% / 0.80%。其26周历史评分分别−22.77、+38.65bps，是历史训练/选择成绩，并非下表OOS。研究采用共同周末截止，不能与生产下一09:35参考估值评分直接对比。','','## 样本外完整目标比较','','每周同目标1单位，同预算上限，统一周首07:00事前参考与周末core close估值。成本越低越好；残量按终点价格计价只为机会成本核算，不代表真实强制成交。穿透阈值分别重新训练。','','|方向|穿透bps|锚点|成本bps|完成率|未完成量|被动均价相对共同参考bps|未完成机会成本bps|','|---|---:|---|---:|---:|---:|---:|---:|']
for r in sumrows:
    lines.append(f"|{r['side']}|{float(r['penetration_bps']):.0f}|{r['anchor']}|{float(r['cost_bps']):.2f}|{float(r['completion'])*100:.2f}%|{float(r['uncompleted']):.4f}|{float(r['passive_price_bps']):.2f}|{float(r['opportunity_bps']):.2f}|")
lines+=['','被动均价按每周有触达部分计算后取均值；各周数量权重不同，不能用此均价单独排序。完整成本的精确分解见summary.csv：被动金额贡献+未完成机会成本。全部预算约束触发周数为0。','','07:00 touch买入完成率98.11%较09:35的92.06%高6.05个百分点，残量由0.0794降至0.0189。但总成本从80.65升至109.54bps，代价是+28.89bps；相同资金/目标条件下不能把更多触达自动解释为更优执行。','','## 成本配对差与敏感性','','早锚点减09:35，负值为改善。括号为周配对bootstrap描述性95%区间，小样本、重叠训练和多重比较使其不宜用作正式显著性检验。','','|方向|穿透bps|锚点|成本差bps|bootstrap区间|改善周/13|','|---|---:|---|---:|---|---:|']
for r in paired:
    lines.append(f"|{r['side']}|{float(r['penetration_bps']):.0f}|{r['anchor']}|{float(r['delta_cost_bps']):+.2f}|[{float(r['bootstrap_low']):.2f}, {float(r['bootstrap_high']):.2f}]|{r['win_weeks']}/13|")
lines+=['','买入07:00在0/5/10bps假设下均多付约28–29bps；08:00约多付1–11bps。卖出07:00为−4.95/+12.05/+0.98bps，08:00为−8.72/+3.10/−7.61bps，缺少跨假设一致性。穿透后完成率有时反增，是各假设独立重训和数量分配变化的结果，不能解释为真实成交率上升。']
if (R/'frozen_oos_weekly.csv').exists():
    robust=[]; fr=read('frozen_oos_weekly.csv'); rolling=read('oos_weekly.csv')
    lines+=['','## 稳健性补充','','冻结首个26周训练选出的参数，后续13周不再改参数（每周数量仍只用过去lookback），与逐周重选对照。此检查复用同一测试集，是敏感性分析，未创造新的OOS。','','|方向|穿透bps|锚点|逐周重训成本差|冻结参数成本差|逐周差删一周范围|','|---|---:|---|---:|---:|---|']
    for p in paired:
        def group(rows,a):return [x for x in rows if x['side']==p['side'] and float(x['penetration_bps'])==float(p['penetration_bps']) and x['anchor']==a]
        f=group(fr,p['anchor']); b=group(fr,'09:35'); diff=[float(x['cost_bps'])-float(y['cost_bps']) for x,y in zip(f,b)]
        x=group(rolling,p['anchor']); y=group(rolling,'09:35'); ds=[float(u['cost_bps'])-float(v['cost_bps']) for u,v in zip(x,y)]
        loo=[statistics.fmean(ds[:i]+ds[i+1:]) for i in range(len(ds))]
        row=dict(side=p['side'],penetration_bps=p['penetration_bps'],anchor=p['anchor'],rolling_delta_bps=p['delta_cost_bps'],frozen_delta_bps=statistics.fmean(diff),leave_one_out_min=min(loo),leave_one_out_max=max(loo),first_half_delta=statistics.fmean(ds[:6]),second_half_delta=statistics.fmean(ds[6:]))
        robust.append(row)
        lines.append(f"|{p['side']}|{float(p['penetration_bps']):.0f}|{p['anchor']}|{float(p['delta_cost_bps']):+.2f}|{statistics.fmean(diff):+.2f}|[{min(loo):.2f}, {max(loo):.2f}]|")
    with (R/'robustness.csv').open('w') as out:
        w=csv.DictWriter(out,fieldnames=list(robust[0]));w.writeheader();w.writerows(robust)
lines+=['','## 使用边界与下一步','','这里研究的是indexed spot proxy，不是ETF成交实证。BTCUSDT的USDT/USD基差、ETF溢折价、盘前点差和挂单队列均未观测；即使账户小额无冲击，也不能据proxy low/high证明ETF限价单成交。0/5/10bps阈值是人为敏感性。Yahoo盘前稀疏且volume为0，因此未使用，也未借此声称fill验证。范围晚于ETF上市与反拆股，但无ETF原始报价参与，不能直接作为ETF收益。','','暂保留09:35生产设置；可在独立研究中继续记录07:00与08:00的ETF实际可见bid/ask、限价位置和可用券商时段，在不下真实订单前提下扩大样本。这里并未实施任何生产调整或持续任务。训练内完整记录见training.csv，逐周OOS与当周参数见oos_weekly.csv，输入范围见sessions.csv与input_manifest.json。','','## 验证与交付','','离线Python标准库测试覆盖DST转换、节假日/半日市、锚点后一分钟窗口、穿透阈值、基线参数复现、训练早于测试以及成本分解与数量守恒。运行方式与全部模型假设见PROTOCOL_ZH.md。研究脚本只写本目录，无生产updater调用、付费接口、密钥或账户访问。']
(R/'REPORT_ZH.md').write_text('\n'.join(lines)+'\n')
