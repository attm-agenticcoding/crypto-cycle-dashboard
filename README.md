# Crypto Cycle Dashboard

A public, auto-updating snapshot of a BTC / ETH **cycle-bottom detection** model:
regime + verdict, bottom / top scores (0–100), a reconciled bottom estimate with
its derivation, deployment guidance (as **percentages**), a historical DCA track
record, and the analysis charts.

**Live:** https://attm-agenticcoding.github.io/crypto-cycle-dashboard/

Absolute dollar capital figures are intentionally omitted — only model outputs,
market prices, and percentages are shown. Research / educational only, **not
investment advice**.

---

This repo holds only the **rendered static site** (`index.html` + `reports/*.png`).
It is generated from a private pipeline and redeployed to GitHub Pages on every
push (see `.github/workflows/deploy.yml`). To refresh, regenerate from the source
project with `dashboard.py --export <dir> --mask` and push.
