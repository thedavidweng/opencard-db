/* Guilloché engraving, live stats, copy buttons, scroll reveals. */

(function () {
  "use strict";

  /* ---------- Guilloché rosettes ---------- */

  var NS = "http://www.w3.org/2000/svg";

  function rosette(el, o) {
    if (!el) return;
    var frag = document.createDocumentFragment();
    var steps = 420;
    for (var i = 0; i < o.rings; i++) {
      var r0 = o.base + i * o.gap;
      var d = "";
      for (var s = 0; s <= steps; s++) {
        var t = (s / steps) * Math.PI * 2;
        var r =
          r0 +
          o.a1 * Math.sin(o.k1 * t + i * 0.35) +
          o.a2 * Math.cos(o.k2 * t - i * 0.22);
        var x = o.cx + r * Math.cos(t);
        var y = o.cy + r * Math.sin(t);
        d += (s ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", d + "Z");
      frag.appendChild(p);
    }
    el.appendChild(frag);
  }

  rosette(document.getElementById("rosette-large"), {
    cx: 450, cy: 450, base: 150, gap: 6, rings: 42,
    a1: 42, k1: 6, a2: 18, k2: 13
  });

  rosette(document.getElementById("rosette-small"), {
    cx: 250, cy: 250, base: 82, gap: 5, rings: 26,
    a1: 26, k1: 8, a2: 10, k2: 17
  });

  var card = document.getElementById("rosette-card");
  rosette(card, {
    cx: 520, cy: 190, base: 55, gap: 6.5, rings: 26,
    a1: 24, k1: 7, a2: 9, k2: 15
  });
  rosette(card, {
    cx: 40, cy: 400, base: 40, gap: 7, rings: 16,
    a1: 16, k1: 9, a2: 7, k2: 4
  });

  /* ---------- Live catalog stats ---------- */

  var META_URL =
    "https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/meta.json";

  if (window.fetch) {
    fetch(META_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (!meta || !meta.card_count) return;
        var n = meta.card_count;
        var stat = document.getElementById("stat-cards");
        if (stat) stat.textContent = String(n);
        var last4 = document.getElementById("stat-cards-card");
        if (last4) last4.textContent = String(n).padStart(4, "0");
      })
      .catch(function () { /* static values remain */ });
  }

  /* ---------- Copy buttons ---------- */

  document.querySelectorAll("[data-copy]").forEach(function (panel) {
    var btn = panel.querySelector(".copy-btn");
    var code = panel.querySelector("code");
    if (!btn || !code || !navigator.clipboard) return;
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(code.textContent.trim()).then(function () {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1600);
      });
    });
  });

  /* ---------- Scroll reveals ---------- */

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reduced && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );

    var armed = [];
    document.querySelectorAll(".reveal").forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) {
        el.classList.add("reveal-pre");
        io.observe(el);
        armed.push(el);
      }
    });

    /* Safety net: never leave content hidden. */
    setTimeout(function () {
      armed.forEach(function (el) { el.classList.add("in"); });
    }, 4000);
  }
})();
