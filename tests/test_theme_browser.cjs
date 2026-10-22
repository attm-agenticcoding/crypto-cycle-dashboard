/* Optional real-browser theme coverage; uses only local public fixtures.
 * RUN_EXECUTION_BROWSER_TESTS=1 node --test tests/test_theme_browser.cjs
 * Optional THEME_DASHBOARD_HTML: a preview from the private source renderer.
 * Other browser/artifact environment variables match test_execution_browser.cjs.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
if (process.env.RUN_EXECUTION_BROWSER_TESTS !== "1") {
  test("dashboard theme browser checks (opt-in)", { skip: true }, () => {});
} else {
  const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
  const { chromium } = require("playwright");
  const root = path.resolve(__dirname, "..");
  const preview = process.env.THEME_DASHBOARD_HTML;
  const artifacts = process.env.EXECUTION_BROWSER_ARTIFACTS;
  const routes = ["/execution/", "/execution/selector.html", ...(preview ? ["/"] : [])];
  let browser, server, origin;
  test.before(async () => {
    if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const relative = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const file = path.resolve(root, `.${relative}`);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
      const mime = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": mime || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(pathname === "/" && preview ? preview : file));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  });
  test.after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });
  async function open(t, route, options = {}) {
    const context = await browser.newContext({ colorScheme: "light", viewport: { width: 1440, height: 1000 }, ...options });
    t.after(() => context.close());
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.firstVisibleThemes = [];
      function frame() {
        if (document.body && document.body.children.length) window.firstVisibleThemes.push(document.documentElement.dataset.theme);
        if (window.firstVisibleThemes.length < 3) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    t.after(() => assert.deepEqual(errors, [], "no uncaught page errors"));
    await page.goto(origin + route);
    await page.waitForFunction(() => document.querySelector("[data-theme-select]") && document.documentElement.dataset.theme);
    return { page, context };
  }
  async function theme(page) { return page.locator("html").getAttribute("data-theme"); }
  async function screenshot(page, name) {
    if (artifacts) await page.screenshot({ path: path.join(artifacts, name + ".png") });
  }
  for (const route of routes) {
    const name = route === "/" ? "dashboard" : route.includes("selector") ? "selection" : "execution";
    test(`${name}: system preference, explicit choice, reload, first paint and keyboard`, async t => {
      const { page } = await open(t, route);
      const select = page.getByLabel("Theme", { exact: true });
      assert.equal(await theme(page), "light");
      assert.equal(await select.inputValue(), "system");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.bringToFront();
      await select.focus();
      await select.press("l");
      await select.press("Enter");
      assert.equal(await select.inputValue(), "light", "keyboard can choose Light");
      assert.equal(await theme(page), "light");
      const outline = await select.evaluate(el => getComputedStyle(el).outlineWidth);
      assert.notEqual(outline, "0px", "keyboard focus remains visible");
      await select.selectOption("dark");
      await page.emulateMedia({ colorScheme: "light" });
      assert.equal(await theme(page), "dark", "explicit choice overrides system");
      await page.reload();
      await page.waitForFunction(() => window.firstVisibleThemes.length >= 3);
      assert.equal(await select.inputValue(), "dark");
      assert.deepEqual(await page.evaluate(() => window.firstVisibleThemes), ["dark", "dark", "dark"], "no wrong-theme visible frame after reload");
      assert.equal(await page.evaluate(() => localStorage.getItem("dashboard-theme")), "dark");
      await select.selectOption("system");
      assert.equal(await theme(page), "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    });
    for (const width of [1440, 390]) {
      test(`${name}: both themes at ${width}px retain content and fit the viewport`, async t => {
        const { page } = await open(t, route, { viewport: { width, height: width === 390 ? 844 : 1000 } });
        if (name === "execution") await page.waitForFunction(() => !document.getElementById("instrument-select").disabled);
        if (name === "selection") await page.waitForFunction(() => document.querySelector("#instrument option"));
        if (name === "dashboard") await page.waitForFunction(() => !document.getElementById("hist-trig").disabled);
        const before = await page.locator("body").innerText();
        for (const selected of ["light", "dark"]) {
          await page.getByLabel("Theme", { exact: true }).selectOption(selected);
          assert.equal(await theme(page), selected);
          assert.equal(await page.locator("body").innerText(), before, "changing appearance preserves content");
          const layout = await page.evaluate(() => {
            const r = document.querySelector("[data-theme-select]").getBoundingClientRect();
            return { overflow: document.documentElement.scrollWidth - innerWidth, left: r.left, right: r.right, height: r.height };
          });
          assert.ok(layout.overflow <= 1, `no page overflow: ${JSON.stringify(layout)}`);
          assert.ok(layout.left >= 0 && layout.right <= width && layout.height >= 44, "control is visible with a 44px target");
          if (name === "dashboard") {
            assert.ok(await page.locator(".gallery img").count() > 0);
            assert.equal(await page.locator(".gallery img").first().evaluate(el => getComputedStyle(el).filter), "none", "chart pixels are never inverted");
          }
          await screenshot(page, `${name}-${selected}-${width}`);
        }
      });
    }
  }
  test("preference follows calculator navigation and synchronizes tabs", async t => {
    const { page, context } = await open(t, "/execution/");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    const other = await context.newPage();
    await other.goto(origin + "/execution/selector.html");
    assert.equal(await theme(other), "dark");
    await other.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    assert.equal(await page.getByLabel("Theme", { exact: true }).inputValue(), "light");
  });
  test("storage-disabled browsers can still select a theme and use the calculator", async t => {
    const { page, context } = await open(t, "/execution/");
    await context.addInitScript(() => {
      Storage.prototype.getItem = Storage.prototype.setItem = function () { throw new DOMException("Storage disabled", "SecurityError"); };
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("instrument-select").disabled);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    assert.equal(await theme(page), "dark");
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    assert.equal(await page.locator("#side-sell").getAttribute("aria-pressed"), "true");
  });
  if (preview) test("root planner, history calendar and chart links work in both themes", async t => {
    const { page } = await open(t, "/", { viewport: { width: 390, height: 844 } });
    await page.waitForFunction(() => !document.getElementById("hist-trig").disabled);
    for (const selected of ["light", "dark"]) {
      await page.getByLabel("Theme", { exact: true }).selectOption(selected);
      await page.locator("#pool-BTC").fill("100000");
      await page.locator("#dep-BTC").fill("10000");
      assert.match(await page.locator("#pout").innerText(), /Buy this week/);
      await page.locator("#hist-trig").click();
      assert.equal(await page.locator("#hist-trig").getAttribute("aria-expanded"), "true");
      const box = await page.locator("#hist-pop").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 391, "calendar overlay fits phone");
      await screenshot(page, `dashboard-calendar-${selected}-390`);
      await page.getByRole("button", { name: "7d", exact: true }).click();
      assert.equal(await page.locator("#hist-trig").getAttribute("aria-expanded"), "false", "preset closes the calendar");
      assert.ok(await page.locator(".histtable tbody tr").count() > 0);
      const shot = page.locator(".gallery a.shot").first();
      assert.equal(await shot.getAttribute("target"), "_blank");
      await shot.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const chart = document.querySelector(".gallery img");
        return chart.complete && chart.naturalWidth > 0;
      });
      await screenshot(page, `dashboard-chart-${selected}-390`);
    }
  });
}
