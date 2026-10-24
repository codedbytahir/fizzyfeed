/* fizzyfeed landing — page glue (no framework) */
(function () {
  "use strict";

  // single rename point — the brand kit is name-agnostic by design
  var BRAND_NAME = "fizzyfeed";

  // JS is on: reveal entrances may hide content until observed (see bottom)
  document.documentElement.classList.remove("no-js");

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
  // on GitHub Pages there is no backend — route the CTA to the repo where the app lives
  var ON_PAGES = /(^|\.)github\.io$/.test(location.hostname);
  var REPO = "https://github.com/codedbytahir/fizzyfeed";
  if (ON_PAGES) {
    document.querySelectorAll('[data-connect]').forEach(function (a) { a.href = REPO; });
    // repo-relative docs links (../…) only resolve when served from the app;
    // on Pages they would 404 — point them at the sources instead
    document.querySelectorAll('a[href^="../"]').forEach(function (a) {
      a.href = REPO + "/blob/main/" + a.getAttribute("href").replace(/^\.\.\//, "");
    });
  } else {
    document.querySelectorAll("[data-connect]").forEach(function (a) {
      a.setAttribute("href", "/api/auth/buffer/login");
    });
  }

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

  // entrance reveals — benchmark (vibrant.design): 500ms ease-out-expo,
  // 64ms stagger via --i per section, revealed at 15% visibility, unobserved after
  var reveals = [].slice.call(document.querySelectorAll(".reveal"));
  var reducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    document.querySelectorAll("section, footer").forEach(function (sec) {
      var items = sec.querySelectorAll(".reveal");
      for (var i = 0; i < items.length; i++) {
        // stagger the first 8 items (benchmark cap), the rest land together
        items[i].style.setProperty("--i", String(Math.min(i, 8)));
      }
    });
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          rio.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { rio.observe(el); });
  }
})();
