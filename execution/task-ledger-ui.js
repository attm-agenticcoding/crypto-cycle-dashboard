/* Optional device-local records. No network IO, automatic creation or order submission. */
(function (root) {
  "use strict";
  const KEY = "execution-progress-v1", LOCK = "execution-progress-write-v1";
  let host, api, enabled = false, envelope = {storageVersion: 1, revision: 0, tasks: []};
  let baseline = null, stale = false, storageError = false, busy = false, confirmation = null;
  let bindings = new Map(), lastWeek = "";
  const unsaved = new Map(); // Same-page knowledge survives local-record reload, not a full page reload.
  const unsavedCaution = "Keep this page open until the entry is saved or manually reconciled. A full page refresh or closing this tab/browser can lose the unsaved draft. Reload local records keeps it on this page.";
  const $ = id => document.getElementById(id);
  const now = () => new Date().toISOString();
  const uid = () => root.crypto.randomUUID();
  const number = value => Number(value).toLocaleString("en-US", {maximumFractionDigits: 10});
  const account = () => $("progress-account").value;
  const identity = () => ({...host.context(), accountId: account()});
  const identityKey = (context, id) => JSON.stringify([context.instrumentId, context.side, id]);
  const task = () => envelope.tasks.find(item => item.key === identityKey(host.context(), account()));
  const metric = (value, context = host.context()) => `${number(value)} ${context.side === "buy" ? context.params.currency || "USD" : context.params.base_asset || "shares"}`;
  const quantity = value => `${number(value)} ${host.context().params.base_asset || "shares"}`;
  function announce(message) { $("progress-message").textContent = message; }
  function error(problem) {
    $("progress-error").textContent = problem.message || String(problem);
    $("progress-error").hidden = false;
  }
  function clearError() { $("progress-error").hidden = true; $("progress-error").textContent = ""; }
  function decode(raw) {
    if (raw === null) return {storageVersion: 1, revision: 0, tasks: []};
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error("Local progress is corrupt. Nothing was changed. Export an existing backup or confirm clearing local progress below; the manual calculator still works."); }
    if (!value || Object.keys(value).sort().join(",") !== "revision,storageVersion,tasks" || value.storageVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.tasks) || value.tasks.length > 500)
      throw new Error("Unsupported or corrupt local progress version. Nothing was changed. The manual calculator still works.");
    const tasks = value.tasks.map(saved => api.decode(saved));
    if (new Set(tasks.map(item => item.key)).size !== tasks.length) throw new Error("Local progress contains duplicate task identities. Nothing was changed.");
    return {...value, tasks};
  }
  function bindingMessage(message) {
    $("progress-binding").textContent = message;
    $("progress-binding").hidden = !message;
  }
  function invalidate(message, requireReuse = true) {
    if (bindings.size) {
      if (requireReuse) for (const binding of bindings.values()) binding.invalid = true;
      else bindings.clear();
      host.clearResults();
      bindingMessage(message);
    }
  }
  function markStale() {
    stale = true;
    invalidate("Local records changed in another tab. Reload records, then use available remaining again, or edit the amounts to continue in manual mode.");
    error(new Error("Another tab changed local progress. Reload local records before recording anything else."));
    render();
  }
  function checkCurrent() {
    let raw;
    try { raw = localStorage.getItem(KEY); }
    catch (_) { storageError = true; invalidate("Browser storage became unavailable. The previous bound plan was cleared. Reload records or edit amounts for manual mode."); throw new Error("Browser storage is unavailable. No changes were saved. The manual calculator still works."); }
    if (raw !== baseline) { markStale(); throw new Error("Local records changed. Reload them before continuing."); }
  }
  async function commit(change, success) {
    if (busy) return false;
    busy = true; clearError(); announce("Saving local change…"); render();
    try {
      if (stale) throw new Error("Reload local records before changing them.");
      if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate local record writes between tabs. Recording is unavailable here; the manual calculator still works.");
      await navigator.locks.request(LOCK, {mode: "exclusive"}, async () => {
        checkCurrent();
        const next = change(envelope);
        const raw = next === null ? null : JSON.stringify(next);
        if (raw !== null) decode(raw); // Validate envelope limits/version before committing, too.
        try {
          if (raw === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, raw);
          if (localStorage.getItem(KEY) !== raw) throw new Error("The saved value could not be verified.");
        } catch (_) {
          storageError = true;
          throw new Error("Browser storage could not save this change (it may be disabled or full). This change was not confirmed saved. The manual calculator still works; reload records before retrying.");
        }
        baseline = raw;
        envelope = next === null ? {storageVersion: 1, revision: 0, tasks: []} : next;
        storageError = false;
      });
      invalidate("Local progress changed. Use available remaining again before calculating, or edit the amounts for manual mode.");
      announce(success + " Saved in this browser only.");
      return true;
    } catch (problem) {
      if (storageError) invalidate("A progress change could not be saved. Reload local records and re-enter any missing actual fills or order changes before using balances again, or edit amounts for manual mode.");
      error(problem); announce("This change was not confirmed saved. Reload records and re-enter any missing changes before using balances."); return false;
    }
    finally { busy = false; render(); }
  }
  function replaceTask(next) {
    return {...envelope, revision: envelope.revision + 1, tasks: [...envelope.tasks.filter(item => item.key !== next.key), next]};
  }
  async function mutate(method, extra, message) {
    const current = task();
    if (!current) return false;
    const pending = unsaved.get(current.key);
    if (pending && ["recordWorkingOrder", "recordFill"].includes(method)) {
      const reference = method === "recordFill" ? "tradeId" : "orderId";
      if (pending.method !== method || pending.extra[reference] !== extra[reference]) {
        error(new Error("An earlier actual-event entry is still unsaved. Correct and save that same fill/order reference first, or edit calculator amounts for manual mode."));
        invalidate("An actual event remains unrecorded. Correct its unsaved entry before using balances, or edit amounts for manual mode.");
        return false;
      }
    }
    const samePending = pending?.method === method && Object.keys(pending.extra).every(key => pending.extra[key] === extra[key]);
    const alreadyStored = samePending && pending.event && current.events.some(item => item.eventId === pending.event.eventId);
    const event = alreadyStored ? {...pending.event, expectedRevision: current.revision}
      : {eventId: uid(), at: now(), expectedRevision: current.revision, ...extra};
    const saved = await commit(() => replaceTask(api[method](current, event)), message);
    if (["recordWorkingOrder", "recordFill"].includes(method)) {
      if (saved) { if (unsaved.get(current.key)?.method === method) unsaved.delete(current.key); }
      else {
        unsaved.set(current.key, {method, event, extra: {...extra, ...(method === "recordFill" ? {executedAt: extra.executedAt || event.at} : {})}});
        invalidate("An actual fill or working order was not recorded. Correct and save that entry before using local balances; editing amounts lets you continue manually.");
        error(new Error(`${$("progress-error").textContent} ${unsavedCaution}`));
        restoreUnsaved();
      }
      render();
    }
    return saved;
  }
  function load() {
    enabled = true; clearError(); $("progress-fill-form").reset(); $("progress-order-form").reset(); $("progress-enable").hidden = true; $("progress-workspace").hidden = false;
    invalidate("Records reloaded. Use available remaining again to refresh the calculator, or edit amounts for manual mode.");
    try {
      baseline = localStorage.getItem(KEY);
      envelope = decode(baseline); stale = false; storageError = false;
      announce(envelope.tasks.length ? "Local records loaded. Nothing has been copied into the calculator." : "No local records yet. Nothing is saved until you confirm a starting point.");
    } catch (problem) {
      storageError = true; envelope = {storageVersion: 1, revision: 0, tasks: []};
      error(problem); announce("Local records could not be loaded. Manual calculation is still available.");
    }
    render(); restoreUnsaved();
  }
  function stat(label, value, id) {
    const box = document.createElement("div"); box.className = "metric";
    const title = document.createElement("div"); title.className = "metric-label"; title.textContent = label;
    const content = document.createElement("div"); content.className = "metric-value"; content.textContent = value;
    if (id) content.id = id;
    box.append(title, content); return box;
  }
  function render() {
    if (!host || !enabled) return;
    const context = identity(), current = task(), fields = host.amountFields(account());
    const title = `${context.params.symbol || context.instrumentId} · ${context.side.toUpperCase()} · Account ${account() === "one" ? "1" : "2"}`;
    $("progress-create").hidden = !!current || storageError || stale;
    $("progress-task").hidden = !current;
    $("progress-export").disabled = !envelope.tasks.length || storageError || stale || busy;
    $("progress-reload").disabled = busy;
    $("progress-account").disabled = busy;
    $("progress-reset").disabled = busy;
    $("progress-create-title").textContent = `Start ${title}`;
    $("progress-create-summary").textContent = `Entered this week: ${fields.weekly.value === "" ? "not entered" : metric(+fields.weekly.value)}. Total remaining: ${fields.total.value === "" ? "not entered" : metric(+fields.total.value)}.`;
    $("progress-create-button").disabled = busy || fields.weekly.value === "" || fields.total.value === "";
    if (!current) return;
    let snapshot;
    try { snapshot = api.snapshot(current, now()); }
    catch (problem) { error(problem); $("progress-task").hidden = true; return; }
    $("progress-task-title").textContent = title;
    $("progress-task-period").textContent = `Progress since recording began ${current.createdAt.slice(0, 10)}. Current week: ${snapshot.weekKey} (${current.marketCalendar === "24X7" ? "UTC" : "New York"}). Only recorded fills contribute; earlier fills and whole-position cost basis are unknown.`;
    $("progress-stats").replaceChildren(
      stat("Recorded progress", `${metric(snapshot.totalFilled)} of ${metric(current.initialTotalRemaining)}`, "progress-total-filled"),
      stat("Total remaining before orders", metric(snapshot.totalRemaining), "progress-total-remaining"),
      stat("Reserved in working orders", metric(snapshot.reservedMetric), "progress-reserved"),
      stat("Available this week", snapshot.needsWeekConfirmation ? "Confirm new week" : metric(snapshot.freeWeekly), "progress-free-weekly"),
      stat("Available total after orders", metric(snapshot.freeTotal), "progress-free-total"),
      stat("Recorded fills weighted average", snapshot.averageFillPrice === null ? "No fills recorded" : `${number(snapshot.averageFillPrice)} ${context.params.currency || "USD"} / unit`, "progress-average")
    );
    const pending = unsaved.get(current.key);
    let warning = pending ? `An actual ${pending.method === "recordFill" ? "fill" : "working order"} could not be recorded. Correct/re-enter that same entry below and save it again before using balances. Reload local records alone does not resolve it. You can edit calculator amounts to continue manually. ${unsavedCaution} ` : "";
    warning += snapshot.planningBlocked && !snapshot.needsWeekConfirmation ? "Planning is blocked: recorded fills or working reservations exceed a confirmed limit. Check your records and actual broker state. Actual fills, already-working orders and confirmed cancellations can still be recorded." : "";
    if (snapshot.completed) warning += " Recorded fills have reached the starting target; this does not confirm broker settlement or completion of a whole position.";
    $("progress-warning").textContent = warning; $("progress-warning").hidden = !warning;
    $("progress-week").hidden = !snapshot.needsWeekConfirmation;
    $("progress-week-label").textContent = "A new week needs your confirmation. Last week’s remainder is not automatically reused. Carried working orders still reserve capacity.";
    $("progress-use").disabled = busy || stale || storageError || snapshot.planningBlocked || !!pending;
    $("progress-confirm-week").disabled = busy || stale || storageError;
    $("progress-fill-save").disabled = busy || stale || storageError || pending?.method === "recordWorkingOrder";
    $("progress-order-save").disabled = busy || stale || storageError || pending?.method === "recordFill";
    $("progress-delete").disabled = busy || stale || storageError;
    $("progress-use-note").textContent = context.side === "buy"
      ? "Use copies free cash after recorded fills and open orders. Calculate separately with your reference price. Confirmed weekly and total limits are hard caps even when deadline pacing asks for more. Fees are assumed zero."
      : "Use copies remaining target quantities before open orders. Keep current holdings and ALL existing sell-order quantities accurate above, including orders recorded here. The calculator deducts that total once. Recorded weekly and total limits still hard-cap new orders. No portfolio holdings are inferred.";
    const orderSelect = $("progress-fill-order"), selectedOrder = orderSelect.value;
    orderSelect.replaceChildren(new Option("Unlinked actual fill", ""));
    $("progress-orders").replaceChildren();
    for (const order of snapshot.orders) {
      const label = `${order.orderId} · ${order.status} · ${quantity(order.remainingQuantity)} unfilled at ${number(order.limitPrice)}`;
      if (order.remainingQuantity > 0) orderSelect.add(new Option(label, order.orderId));
      const item = document.createElement("li"); item.className = "progress-order"; item.dataset.orderId = order.orderId;
      const text = document.createElement("p"); text.className = "progress-copy"; text.textContent = label; item.append(text);
      const controls = document.createElement("div"); controls.className = "progress-toolbar";
      if (order.status === "working") {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary";
        button.textContent = "Record cancel requested"; button.disabled = busy || stale || storageError;
        button.addEventListener("click", () => mutate("requestCancel", {orderId: order.orderId}, "Cancellation request recorded; the unfilled amount is still reserved.")); controls.append(button);
      }
      if (["working", "cancel-pending"].includes(order.status)) {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary";
        button.textContent = "Record broker-confirmed cancellation"; button.disabled = busy || stale || storageError;
        button.addEventListener("click", () => askConfirm("cancel", `Confirm that your broker or exchange has cancelled the unfilled remainder of ${order.orderId}. This records its status locally; it does not cancel the actual order.`, order.orderId)); controls.append(button);
      }
      item.append(controls); $("progress-orders").append(item);
    }
    if ([...orderSelect.options].some(option => option.value === selectedOrder)) orderSelect.value = selectedOrder;
    if (!snapshot.orders.length) {
      const empty = document.createElement("li"); empty.className = "progress-copy"; empty.textContent = "No working orders recorded."; $("progress-orders").append(empty);
    }
  }
  function askConfirm(type, message, orderId) {
    confirmation = {type, taskKey: task()?.key, orderId};
    $("progress-confirm-text").textContent = message;
    $("progress-confirm-yes").textContent = type === "cancel" ? "Confirm broker cancellation" : "Confirm deletion";
    $("progress-confirm").hidden = false; $("progress-confirm-no").focus();
  }
  function hideConfirm() { confirmation = null; $("progress-confirm").hidden = true; }
  function rejectActualEntry(method, problem) {
    const current = task();
    if (current) {
      const fill = method === "recordFill", prefix = fill ? "progress-fill" : "progress-order";
      const extra = fill
        ? {tradeId: $("progress-fill-id").value.trim() || uid(), quantity: +$("progress-fill-qty").value, price: +$("progress-fill-price").value, orderId: $("progress-fill-order").value || null}
        : {orderId: $("progress-order-id").value.trim() || uid(), quantity: +$("progress-order-qty").value, limitPrice: +$("progress-order-price").value};
      if (!unsaved.has(current.key)) unsaved.set(current.key, {method, extra});
      invalidate("The actual-event entry was rejected. Correct and save it before using local balances, or edit calculator amounts for manual mode.");
      render(); restoreUnsaved();
    }
    error(new Error(`${problem.message || problem} ${unsavedCaution}`));
  }
  function positive(id) {
    const value = +$(id).value;
    if (!$(id).value || !(value > 0) || !Number.isFinite(value)) throw new Error("Enter a positive quantity and price.");
    return value;
  }
  function apply() {
    clearError();
    try {
      if (storageError) throw new Error("Browser storage failed. Reload local records and re-enter missing changes before using balances.");
      checkCurrent();
      const current = task(), context = host.context(), snapshot = api.snapshot(current, now()), id = account();
      if (unsaved.has(current.key)) throw new Error("Correct and save the previously unsaved actual fill or working order before using local balances, or edit amounts for manual mode.");
      if (snapshot.planningBlocked) throw new Error("Confirm the new week and resolve any limit or reservation issues first.");
      if (context.side === "sell") {
        const held = $(`sell-held-${id}`).value, reserved = $(`sell-reserved-${id}`).value;
        if (held === "" || reserved === "" || !Number.isFinite(+held) || !Number.isFinite(+reserved) || +held < 0 || +reserved < snapshot.reservedQuantity || +reserved > +held)
          throw new Error("Before using sell progress, enter current holdings and ALL existing sell orders above. Existing orders must include at least the working quantity recorded here, and must not exceed holdings.");
      }
      const fields = host.amountFields(id);
      fields.weekly.value = context.side === "buy" ? snapshot.freeWeekly : snapshot.weeklyRemaining;
      fields.total.value = context.side === "buy" ? snapshot.freeTotal : snapshot.totalRemaining;
      bindings.set(id, {key: current.key, revision: current.revision, week: snapshot.weekKey,
        weekly: fields.weekly.value, total: fields.total.value, invalid: false});
      host.clearResults();
      bindingMessage(`Local progress hard caps active for ${[...bindings.keys()].map(value => `Account ${value === "one" ? "1" : "2"}`).join(" and ")}. Deadline pacing cannot exceed confirmed weekly or total availability. Editing target amounts or sell holdings/orders returns that account to manual mode.`);
      announce("Remaining amounts copied. Your reference price and deadline were kept. Click Calculate when ready.");
    } catch (problem) { error(problem); }
    render();
  }
  function capPlan(id, plan) {
    if (!host || !bindings.has(id)) return plan;
    const binding = bindings.get(id), context = host.context();
    if (storageError) throw new Error("Browser storage failed. Reload local records before using balances, or edit amounts for manual mode.");
    checkCurrent();
    const fields = host.amountFields(id), current = envelope.tasks.find(item => item.key === binding.key);
    if (binding.invalid || !current || binding.key !== identityKey(context, id) || binding.revision !== current.revision || binding.weekly !== fields.weekly.value || binding.total !== fields.total.value)
      throw new Error("Local progress is no longer bound to these inputs. Use available remaining again, or edit the amounts to continue manually.");
    if (unsaved.has(current.key)) throw new Error("A reported actual event was not saved. Correct and save it or edit amounts for manual mode.");
    const snapshot = api.snapshot(current, now());
    if (snapshot.planningBlocked || snapshot.weekKey !== binding.week) throw new Error("Local progress needs a confirmed current week and valid limits before calculating. Confirm the week, then use available remaining again.");
    if (context.side === "sell" && +$(`sell-reserved-${id}`).value < snapshot.reservedQuantity)
      throw new Error("Existing sell orders must include all recorded working quantity. Check holdings and reservations before using local progress again.");
    const manualReserved = context.side === "sell" ? +$(`sell-reserved-${id}`).value : 0;
    const capacity = Math.min(snapshot.freeWeekly, snapshot.freeTotal, ...(context.side === "sell" ? [Math.max(0, snapshot.weeklyRemaining - manualReserved), Math.max(0, snapshot.totalRemaining - manualReserved), plan.available] : []));
    const step = context.params.quantity_step || 1;
    const clipped = {...plan, orders: []}; let left = capacity;
    for (const order of plan.orders) {
      const max = context.side === "buy" ? left / order.price : left;
      let shares = ExecutionCore.quantize(Math.min(order.shares, max), step);
      // Strict final guards: floating-point quantization may round near a step.
      while (shares > 0 && (context.side === "buy" ? shares * order.price : shares) > left) shares = ExecutionCore.quantize(Math.max(0, shares - step), step);
      const notional = shares * order.price;
      if (!(shares > 0) || shares < (context.params.min_quantity || step) || notional < (context.params.min_notional || 0)) continue;
      clipped.orders.push({...order, shares, notional});
      left = Math.max(0, left - (context.side === "buy" ? notional : shares));
    }
    clipped.orderQuantity = ExecutionCore.quantize(clipped.orders.reduce((sum, order) => sum + order.shares, 0), step);
    clipped.perRung = clipped.orders.length ? Math.max(...clipped.orders.map(order => order.shares)) : 0;
    const removed = Math.max(0, (plan.orderQuantity ?? plan.targetShares) - clipped.orderQuantity);
    clipped.unallocated = (plan.unallocated || 0) + removed;
    clipped.progressCapped = removed > 0;
    if (context.side === "sell") clipped.available = Math.min(plan.available, capacity);
    clipped.progressNote = `Local progress hard cap: ${metric(capacity)} available for new orders. ${plan.controller.weekly > (context.side === "buy" ? snapshot.freeWeekly : snapshot.weeklyRemaining) ? "Deadline pace exceeds the confirmed weekly limit; completion is not guaranteed. " : ""}${removed > 0 ? "Displayed orders have been reduced to stay within that cap. " : ""}`;
    return clipped;
  }
  function refresh() {
    if (!host || !enabled) return;
    const week = api.weekKey(host.context().params.market_calendar === "24X7" ? "24X7" : "XNYS", now());
    if (lastWeek && lastWeek !== week) {
      invalidate("A new week needs confirmation. Confirm its cap and use available remaining again, or edit amounts for manual mode.");
      $("progress-week-cap").value = "";
    }
    lastWeek = week; render();
  }
  function restoreUnsaved() {
    const pending = unsaved.get(task()?.key);
    if (!pending) return;
    const fill = pending.method === "recordFill", prefix = fill ? "progress-fill" : "progress-order", extra = pending.extra;
    $(`${prefix}-qty`).value = extra.quantity;
    $(`${prefix}-price`).value = fill ? extra.price : extra.limitPrice;
    $(`${prefix}-id`).value = fill ? extra.tradeId : extra.orderId;
    if (fill) { $("progress-fill-order").value = extra.orderId || ""; $("progress-fill-at").value = extra.executedAt?.replace(/Z$/, "") || ""; }
    $(`${prefix}-form`).closest("details").open = true;
  }
  function contextChanged() {
    if (!host) return;
    if (bindings.size) { bindings.clear(); host.clearResults(); bindingMessage("Manual mode: instrument or direction changed. Each local record is separate; use available remaining to bind this selection."); }
    hideConfirm(); $("progress-fill-form").reset(); $("progress-order-form").reset(); lastWeek = ""; render(); restoreUnsaved();
  }
  function init(adapter) {
    host = adapter; api = root.ExecutionTaskLedger;
    if (!api) { $("progress-enable").disabled = true; error(new Error("Optional progress could not load. Manual calculation remains available.")); return; }
    $("progress-enable").addEventListener("click", load);
    $("progress-reload").addEventListener("click", load);
    $("progress-account").addEventListener("change", () => { hideConfirm(); $("progress-fill-form").reset(); $("progress-order-form").reset(); clearError(); render(); restoreUnsaved(); });
    $("progress-create-button").addEventListener("click", async () => {
      const context = identity(), fields = host.amountFields(account());
      try {
        if (storageError) throw new Error("Reload or explicitly clear corrupt local data before creating a record.");
        if (fields.weekly.value === "" || fields.total.value === "") throw new Error("Enter this week’s target and total remaining in the calculator first.");
        const current = api.createTask({instrumentId: context.instrumentId, side: context.side, accountId: account(),
          marketCalendar: context.params.market_calendar === "24X7" ? "24X7" : "XNYS", totalRemaining: +fields.total.value, weeklyRemaining: +fields.weekly.value, at: now()});
        await commit(() => {
          if (task()) throw new Error("A record already exists for this instrument, direction and account.");
          return replaceTask(current);
        }, "Starting amounts confirmed; earlier fills were not imported.");
      } catch (problem) { error(problem); }
    });
    $("progress-use").addEventListener("click", apply);
    $("progress-confirm-week").addEventListener("click", async () => {
      const raw = $("progress-week-cap").value;
      if (raw === "" || !Number.isFinite(+raw) || +raw < 0) { error(new Error("Enter an explicit nonnegative cap for the new week.")); return; }
      if (await mutate("beginWeek", {weeklyCap: +raw}, "New week confirmed.")) $("progress-week-cap").value = "";
    });
    $("progress-fill-form").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const enteredAt = $("progress-fill-at").value;
        const extra = {tradeId: $("progress-fill-id").value.trim() || uid(), quantity: positive("progress-fill-qty"), price: positive("progress-fill-price"), orderId: $("progress-fill-order").value || null};
        if (enteredAt) extra.executedAt = new Date(enteredAt + "Z").toISOString();
        if (await mutate("recordFill", extra, "Actual fill recorded.")) { event.target.reset(); render(); }
      } catch (problem) { rejectActualEntry("recordFill", problem); }
    });
    $("progress-order-form").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const extra = {orderId: $("progress-order-id").value.trim() || uid(), quantity: positive("progress-order-qty"), limitPrice: positive("progress-order-price")};
        if (await mutate("recordWorkingOrder", extra, "Already-working order recorded; its unfilled amount is reserved.")) event.target.reset();
      } catch (problem) { rejectActualEntry("recordWorkingOrder", problem); }
    });
    $("progress-delete").addEventListener("click", () => askConfirm("delete", "Delete this instrument/direction/account’s local progress and all its recorded fills and orders? This cannot be undone here. Actual broker orders will not change."));
    $("progress-reset").addEventListener("click", () => askConfirm("reset", "Clear ALL local progress for every instrument, direction and account in this browser? This cannot be undone here. Export a backup first if needed. Actual broker orders will not change."));
    $("progress-confirm-no").addEventListener("click", hideConfirm);
    $("progress-confirm-yes").addEventListener("click", async () => {
      if (!confirmation) return;
      const choice = confirmation; hideConfirm();
      if (choice.type === "cancel") {
        if (task()?.key === choice.taskKey) await mutate("confirmCancel", {orderId: choice.orderId}, "Broker-confirmed cancellation recorded; the unfilled reservation was released.");
      } else if (choice.type === "delete") {
        if (await commit(() => ({...envelope, revision: envelope.revision + 1, tasks: envelope.tasks.filter(item => item.key !== choice.taskKey)}), "Local record deleted.")) { unsaved.delete(choice.taskKey); $("progress-fill-form").reset(); $("progress-order-form").reset(); render(); }
      } else if (await commit(() => null, "All local progress cleared.")) { unsaved.clear(); $("progress-fill-form").reset(); $("progress-order-form").reset(); render(); }
    });
    $("progress-export").addEventListener("click", () => {
      clearError();
      try {
        checkCurrent();
        const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], {type: "application/json"}));
        const link = document.createElement("a"); link.href = url; link.download = "execution-progress-local.json";
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        announce("Local JSON download requested. It contains your recorded amounts; store it privately.");
      } catch (problem) { error(problem); }
    });
    $("calculator-form").addEventListener("input", event => {
      const matched = event.target.id.match(/^(?:weekly|capital|sell-(?:weekly|total|held|reserved))-(one|two)$/);
      if (matched && bindings.has(matched[1])) {
        bindings.delete(matched[1]);
        bindingMessage(`Manual mode for Account ${matched[1] === "one" ? "1" : "2"}: edited amounts are no longer linked to saved progress. ${bindings.size ? "The other account retains its local hard caps." : "Manual deadline pacing may increase the weekly target; total remaining still caps it."}`);
      }
      render();
    });
    root.addEventListener("beforeunload", event => {
      if (unsaved.size === 0) return;
      event.preventDefault();
      event.returnValue = ""; // Browsers show their own generic leave-page warning.
    });
    root.addEventListener("storage", event => { if (enabled && (event.key === KEY || event.key === null)) markStale(); });
    root.addEventListener("focus", () => { if (enabled) { try { checkCurrent(); refresh(); } catch (problem) { error(problem); } } });
  }
  root.ExecutionProgressUI = Object.freeze({init, capPlan, refresh, contextChanged});
})(window);
