/* Run synchronously in <head>, before styles, so the first paint uses the choice. */
(function () {
  "use strict";
  var key = "dashboard-theme";
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var choice = read();

  function valid(value) {
    return value === "light" || value === "dark" || value === "system";
  }
  function read() {
    try {
      var saved = localStorage.getItem(key);
      return valid(saved) ? saved : "system";
    } catch (_) {
      return "system";
    }
  }
  function apply() {
    var theme = choice === "system" ? (media.matches ? "dark" : "light") : choice;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0d1117" : "#f5f7fa";
    document.querySelectorAll("[data-theme-select]").forEach(function (select) {
      select.value = choice;
    });
  }
  apply();
  document.addEventListener("DOMContentLoaded", function () {
    apply();
    document.querySelectorAll("[data-theme-select]").forEach(function (select) {
      select.addEventListener("change", function () {
        if (!valid(select.value)) return;
        choice = select.value;
        try { localStorage.setItem(key, choice); } catch (_) { /* Still usable this session. */ }
        apply();
      });
    });
  });
  media.addEventListener("change", function () {
    if (choice === "system") apply();
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null) {
      choice = read();
      apply();
    }
  });
}());
