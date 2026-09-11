"""Public Binance Spot identity and order-filter adapter. No account access."""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone

from execution_registry import RegistryError, validate_instrument

MARKET_DATA_API = "https://data-api.binance.vision/api/v3"


def crypto_instrument(symbol: str, reference: float, exchange_info: dict | None = None) -> dict:
    symbol = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,25}", symbol):
        raise RegistryError("Spot pair must be the exact Binance pair, for example BTCUSDT (no slash)")
    if exchange_info is None:
        request = urllib.request.Request(f"{MARKET_DATA_API}/exchangeInfo?symbol={symbol}", headers={"User-Agent": "execution-calculator/4.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            exchange_info = json.load(response)
    matches = [item for item in exchange_info.get("symbols", []) if item.get("symbol") == symbol]
    if len(matches) != 1:
        raise RegistryError(f"Binance Spot did not uniquely identify {symbol}")
    info = matches[0]
    if info.get("status") != "TRADING" or not info.get("isSpotTradingAllowed") or "LIMIT" not in info.get("orderTypes", []):
        raise RegistryError(f"{symbol} is not currently enabled for Binance Spot limit trading")
    filters = {item["filterType"]: item for item in info.get("filters", [])}
    try:
        price, quantity = filters["PRICE_FILTER"], filters["LOT_SIZE"]
        notional = filters.get("NOTIONAL", filters.get("MIN_NOTIONAL"))
        if notional is None:
            raise KeyError("NOTIONAL")
        rules = dict(price_tick=price["tickSize"], min_price=price["minPrice"], max_price=price["maxPrice"],
                     quantity_step=quantity["stepSize"], min_quantity=quantity["minQty"], max_quantity=quantity["maxQty"],
                     min_notional=notional["minNotional"], max_notional=notional.get("maxNotional", 0))
    except KeyError as exc:
        raise RegistryError(f"{symbol} is missing required exchange filters: {exc}") from exc
    return validate_instrument({
        "instrument_type": "crypto_spot", "instrument_id": f"BINANCE:SPOT:{symbol}",
        "symbol": symbol, "venue_code": "BINANCE", "exchange": "Binance Spot", "exchange_mic": None,
        "name": f"{info['baseAsset']} / {info['quoteAsset']} spot", "asset_class": "Crypto spot",
        "base_asset": info["baseAsset"], "currency": info["quoteAsset"], "market_calendar": "24X7",
        "timezone": "UTC", "reference_time": "00:00", "fill_start_time": "00:01", "session_end_time": "24:00",
        "default_reference_price": reference, **rules,
        "exchange_rules_checked_at": datetime.now(timezone.utc).isoformat(),
        "scaling_source": {"provider": "binance_vision", "symbol": symbol, "interval": "1m", "rationale": "The execution pair and minute-data pair are identical on Binance Spot."},
        "enabled": True,
    })
