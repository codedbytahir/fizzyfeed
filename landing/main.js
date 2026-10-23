/* fizzyfeed landing — page glue (no framework) */
(function () {
  "use strict";

  // single rename point — the brand kit is name-agnostic by design
  var BRAND_NAME = "fizzyfeed";

  // wordmark file swap: the mark never changes, only the wordmark file does
  document.querySelectorAll("img.brand").forEach(function (img) {
    img.src = "logo/lockup-on-dark.svg";
    img.alt = BRAND_NAME;
  });

  // inject the name ONLY into empty text slots — never into module roots (.fx carries
  // data-brand-name as an inert attribute the modules read themselves; setting textContent
  // there would wipe their innerHTML)
  document.querySelectorAll("[data-brand-name]").forEach(function (el) {
    if (el.classList.contains("fx")) return;
    if (el.tagName === "IMG") { el.alt = BRAND_NAME; return; }
    if (el.children.length > 0) return; // text slots are leaf elements by contract
    el.textContent = BRAND_NAME;
  });

  // primary CTAs → connect flow (app ships later; deep-link stays honest)
  document.querySelectorAll("[data-connect]").forEach(function (a) {
    a.setAttribute("href", "/api/auth/buffer/login");
  });

  // CPU guard: pause CSS animation loops for modules scrolled out of view
  var roots = document.querySelectorAll(".fx");
  if ("IntersectionObserver" in window && roots.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        e.target.setAttribute("data-fx-state", e.isIntersecting ? "live" : "idle");
      });
    }, { rootMargin: "120px 0px", threshold: 0.01 });
    roots.forEach(function (r) { r.setAttribute("data-fx-state", "live"); io.observe(r); });
  }

  // footer year — honest, always current
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = String(new Date().getFullYear());
})();
