/* OpenCard DB site: live meta, client-side card search, copy buttons.
 * Data:
 *   - meta:    Worker /v1/meta (CORS *, 5 min cache). The browser's own
 *              User-Agent satisfies the official instance's client-id rule.
 *   - version: jsDelivr's resolver for the latest tag.
 *   - search:  exports/cards-all.json from jsDelivr @main (purged on every
 *              deploy), searched in the browser: instant, and it never
 *              touches the API's per-IP rate limit while someone types.
 */
(function () {
  "use strict";

  var REPO = "thedavidweng/opencard-db";
  var API = "https://opencard-db.davidweng.workers.dev";
  var CARDS_URL = "https://cdn.jsdelivr.net/gh/" + REPO + "@main/exports/cards-all.json";
  var VERSION_URL = "https://data.jsdelivr.com/v1/packages/gh/" + REPO + "/resolved?specifier=latest";
  var PAGE = 20;

  var NETWORKS = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", unionpay: "UnionPay", other: "Other network" };
  var TIERS = { classic: "Classic", standard: "Standard", traditional: "Traditional", signature: "Signature", infinite: "Infinite", platinum: "Platinum", world: "World", world_elite: "World Elite", world_legend: "World Legend", diamond: "Diamond" };
  var COUNTRIES = { us: "United States", ca: "Canada", cn: "China" };
  var COUNTRY_SHORT = { us: "US", ca: "Canada", cn: "China" };
  var STATUS = { active: "Active", discontinued: "Discontinued", invite_only: "Invite only", unknown: "Status unknown" };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- Live meta ---------- */

  var meta = { count: null, countries: null, version: null, built: null };

  function order(c) { var i = ["us", "ca", "cn"].indexOf(c); return i < 0 ? 99 : i; }

  function listCountries(codes) {
    var names = codes.slice().sort(function (a, b) { return order(a) - order(b); }).map(function (c) {
      return c === "us" ? "the US" : (COUNTRIES[c] || c.toUpperCase());
    });
    if (names.length < 2) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function renderMeta() {
    if (meta.version) {
      $all('[data-live="tag"]').forEach(function (n) { n.textContent = "v" + meta.version; });
      $all('[data-live="version"]').forEach(function (n) {
        n.textContent = "v" + meta.version;
        n.setAttribute("aria-label", "Latest release, v" + meta.version);
        n.hidden = false;
      });
    }
    if (meta.count != null) {
      var facts = meta.count.toLocaleString("en-US") + " cards" +
        (meta.countries && meta.countries.length ? " from " + listCountries(meta.countries) : "");
      $all('[data-live="facts"]').forEach(function (n) {
        n.textContent = (meta.version ? "The latest release is v" + meta.version + ". " : "") + "The catalog holds " + facts + ".";
        n.hidden = false;
      });
    }
    if (meta.built) {
      var d = new Date(meta.built);
      if (!isNaN(d)) {
        $all('[data-live="built"]').forEach(function (n) {
          n.textContent = "Catalog built " + d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) + ".";
        });
      }
    }
    if (meta.count != null && input) {
      var narrow = window.matchMedia && window.matchMedia("(max-width: 560px)").matches;
      input.placeholder = "Search " + meta.count.toLocaleString("en-US") + " cards" + (narrow ? "" : " by name, issuer, network or country");
    }
  }

  function loadMeta() {
    getJSON(API + "/v1/meta").then(function (m) {
      if (typeof m.card_count === "number") meta.count = m.card_count;
      if (Array.isArray(m.countries)) meta.countries = m.countries;
      meta.built = m.generated_at || null;
      renderMeta();
    }).catch(function () { /* keep the static fallback text */ });
    getJSON(VERSION_URL).then(function (v) {
      if (v && typeof v.version === "string" && /^\d+\.\d+\.\d+/.test(v.version)) {
        meta.version = v.version;
        renderMeta();
      }
    }).catch(function () {});
  }

  /* ---------- Search ---------- */

  var input = $("#q");
  var list = $("#results");
  var more = $("#results-more");
  var status = $("#search-status");
  var examples = $("#examples");

  var cards = null;      // [{card, hay, name, issuer}]
  var loading = null;    // Promise
  var loadError = false;
  var lastQuery = "";
  var shown = PAGE;
  var timer = 0;

  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[®™©]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function index(card) {
    var tier = card.network_tier && card.network_tier !== "none" ? TIERS[card.network_tier] || card.network_tier : "";
    var fields = {
      name: norm(card.name),
      issuer: norm([card.issuer, card.issuer_id].join(" ")),
      other: norm([
        NETWORKS[card.network] || card.network, card.network, tier,
        card.country, COUNTRIES[card.country], card.country === "us" ? "usa" : "",
        card.id, STATUS[card.status], card.segment, card.type,
        card.rewards && card.rewards.currency_label
      ].join(" "))
    };
    return { card: card, f: fields, words: (" " + fields.name + " " + fields.issuer + " " + fields.other + " ") };
  }

  function loadCards() {
    if (cards) return Promise.resolve(cards);
    if (loading) return loading;
    loadError = false;
    loading = getJSON(CARDS_URL).then(function (data) {
      if (!Array.isArray(data)) throw new Error("Unexpected catalog format");
      cards = data.map(index);
      return cards;
    }).catch(function (e) {
      loadError = true;
      throw e;
    }).finally(function () { loading = null; });
    return loading;
  }

  function hasWordPrefix(text, token) {
    return (" " + text).indexOf(" " + token) !== -1;
  }

  function score(entry, tokens, phrase) {
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (hasWordPrefix(entry.f.name, t)) total += 10;
      else if (hasWordPrefix(entry.f.issuer, t)) total += 6;
      else if (hasWordPrefix(entry.f.other, t)) total += 3;
      else if ((t.length >= 3 || /[^\x00-\x7f]/.test(t)) && entry.words.indexOf(t) !== -1) total += /[^\x00-\x7f]/.test(t) ? 8 : 1;
      else return 0;
    }
    if (entry.f.name.indexOf(phrase) === 0) total += 12;
    else if (hasWordPrefix(entry.f.name, phrase)) total += 6;
    if (entry.card.status === "active") total += 2;
    return total;
  }

  function search(q) {
    var phrase = norm(q);
    if (!phrase) return [];
    var tokens = phrase.split(" ");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var s = score(cards[i], tokens, phrase);
      if (s > 0) out.push({ s: s, e: cards[i] });
    }
    out.sort(function (a, b) { return b.s - a.s || a.e.card.name.localeCompare(b.e.card.name); });
    return out.map(function (x) { return x.e.card; });
  }

  function fee(card) {
    var f = card.annual_fee;
    if (!f || typeof f.amount !== "number") return "Annual fee not listed";
    var fmt = function (n) {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: f.currency || "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
      } catch (e) { return n + " " + (f.currency || ""); }
    };
    if (f.amount === 0) return fmt(0) + " annual fee";
    var s = fmt(f.amount) + " annual fee";
    if (f.first_year === 0) s += ", " + fmt(0) + " in the first year";
    return s;
  }

  function sourcePath(card) {
    var slug = card.id.indexOf(card.country + "-") === 0 ? card.id.slice(card.country.length + 1) : card.id;
    return "https://github.com/" + REPO + "/blob/main/data/" + card.country + "/" + slug + ".json";
  }

  function placeholder(card) {
    var ph = el("div", "ph");
    ph.appendChild(el("span", null, card.network && card.network !== "other" ? (NETWORKS[card.network] || "") : ""));
    return ph;
  }

  function art(card) {
    var box = el("div", "art");
    var url = card.image && typeof card.image.url === "string" ? card.image.url : "";
    // The API substitutes a generic placeholder for cards with no art; the
    // static export leaves url null. Treat both the same.
    if (!url || /\/v1\/assets\/default-card\./.test(url)) {
      box.appendChild(placeholder(card));
      return box;
    }
    var img = new Image();
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.width = 152; img.height = 96;
    img.onload = function () { img.className = "loaded"; };
    img.onerror = function () { img.remove(); };
    img.src = url;
    box.appendChild(img);
    box.appendChild(placeholder(card)); // shown until the image loads, or if it fails
    return box;
  }

  function row(card) {
    var li = el("li", "result");
    li.appendChild(art(card));

    var main = el("div", "r-main");
    var name = el("a", "r-name", card.name);
    name.href = API + "/v1/cards/" + encodeURIComponent(card.id);
    name.target = "_blank";
    name.rel = "noopener";
    name.setAttribute("aria-describedby", "m-" + card.id);
    main.appendChild(name);

    var m = el("div", "r-meta");
    m.id = "m-" + card.id;
    var tier = card.network_tier && card.network_tier !== "none" ? TIERS[card.network_tier] || card.network_tier : "";
    m.appendChild(el("span", null, [card.issuer, COUNTRY_SHORT[card.country] || card.country.toUpperCase()].join(" · ")));
    m.appendChild(el("span", null, [NETWORKS[card.network] || card.network, tier].filter(Boolean).join(" ")));
    m.appendChild(el("span", null, fee(card)));
    // Status only when it's notable; "Active" on every row is noise.
    if (card.status !== "active") m.appendChild(el("span", "status", STATUS[card.status] || card.status));
    main.appendChild(m);
    li.appendChild(main);

    var links = el("div", "r-links");
    var a1 = el("a", null, "JSON");
    a1.href = name.href; a1.target = "_blank"; a1.rel = "noopener";
    a1.setAttribute("aria-label", "API JSON for " + card.name);
    a1.tabIndex = -1; // reachable via the row link; keeps Tab order short
    var a2 = el("a", null, "Source");
    a2.href = sourcePath(card); a2.target = "_blank"; a2.rel = "noopener";
    a2.setAttribute("aria-label", "Source file for " + card.name + " on GitHub");
    links.appendChild(a1);
    links.appendChild(a2);
    li.appendChild(links);
    return li;
  }

  function setStatus(text, srOnly) {
    status.textContent = text || "";
    status.classList.toggle("sr-only", !!srOnly);
  }

  function showSkeleton() {
    list.textContent = "";
    for (var i = 0; i < 3; i++) {
      var li = el("li", "result skeleton");
      li.setAttribute("aria-hidden", "true");
      li.appendChild(el("div", "art"));
      var m = el("div", "r-main");
      m.appendChild(el("span", "bar"));
      m.appendChild(el("span", "bar"));
      li.appendChild(m);
      list.appendChild(li);
    }
    list.hidden = false;
    more.hidden = true;
  }

  function showMessage(html) {
    list.textContent = "";
    var li = el("li", "empty");
    li.appendChild(html);
    list.appendChild(li);
    list.hidden = false;
    more.hidden = true;
  }

  function noResults(q) {
    var f = document.createDocumentFragment();
    var p1 = el("p");
    p1.appendChild(document.createTextNode("Nothing matched "));
    p1.appendChild(el("strong", null, "\u201c" + q + "\u201d"));
    p1.appendChild(document.createTextNode("."));
    var p2 = el("p");
    p2.appendChild(document.createTextNode("Try searching by issuer or network instead. If the card is missing, you can "));
    var a = el("a", null, "request it");
    a.href = "https://github.com/" + REPO + "/issues/new?template=add-card.yml";
    p2.appendChild(a);
    p2.appendChild(document.createTextNode("."));
    f.appendChild(p1); f.appendChild(p2);
    showMessage(f);
  }

  function errorState() {
    var f = document.createDocumentFragment();
    f.appendChild(el("p", null, "The catalog couldn\u2019t be loaded. Check your connection and try again."));
    var b = el("button", "btn", "Retry");
    b.type = "button";
    b.addEventListener("click", function () { run(true); input.focus(); });
    f.appendChild(b);
    showMessage(f);
    setStatus("");
  }

  function render(q) {
    var res = search(q);
    if (!res.length) {
      noResults(q.trim());
      setStatus("0 cards", true);
      return;
    }
    list.textContent = "";
    var n = Math.min(shown, res.length);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) frag.appendChild(row(res[i]));
    list.appendChild(frag);
    list.hidden = false;
    setStatus(res.length === 1 ? "1 card" : res.length.toLocaleString("en-US") + " cards" + (n < res.length ? ", showing " + n : ""));
    if (n < res.length) {
      more.textContent = "";
      var b = el("button", null, "Show all " + res.length.toLocaleString("en-US"));
      b.type = "button";
      b.addEventListener("click", function () {
        shown = Infinity;
        var keep = n;
        render(input.value);
        var next = list.children[keep];
        var link = next && next.querySelector(".r-name");
        if (link) link.focus();
      });
      more.appendChild(b);
      more.hidden = false;
    } else {
      more.hidden = true;
    }
  }

  function syncURL(q) {
    try {
      var u = new URL(location.href);
      if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  function run(force) {
    var q = input.value;
    if (!force && q === lastQuery) return;
    lastQuery = q;
    shown = PAGE;
    syncURL(q.trim());
    if (!q.trim()) {
      list.hidden = true; list.textContent = "";
      more.hidden = true;
      examples.hidden = false;
      setStatus("");
      return;
    }
    examples.hidden = true;
    if (cards) { render(q); return; }
    showSkeleton();
    setStatus("Loading catalog\u2026");
    loadCards().then(function () {
      if (input.value === q) render(q);
    }).catch(function () {
      if (input.value === q) errorState();
    });
  }

  function schedule() {
    clearTimeout(timer);
    // Already-loaded data searches in well under a millisecond; the short
    // debounce only coalesces bursts of keystrokes.
    timer = setTimeout(run, cards ? 60 : 120);
  }

  function rowLinks() { return $all(".result:not(.skeleton) .r-name", list); }

  function focusRow(i) {
    var links = rowLinks();
    if (!links.length) return;
    if (i < 0) { input.focus(); return; }
    links[Math.min(i, links.length - 1)].focus();
  }

  if (input) {
    input.addEventListener("input", schedule);
    // On small screens, bring the field to the top so results have room.
    input.addEventListener("input", function () {
      if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches && input.getBoundingClientRect().top > 120) {
        input.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, { once: true });
    input.addEventListener("focus", function () { loadCards().catch(function () {}); }, { once: true });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); run(); focusRow(0); }
      else if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(timer); run();
        var first = rowLinks()[0];
        if (first && cards) first.click();
      } else if (e.key === "Escape") {
        if (input.value) { input.value = ""; run(); } else { input.blur(); }
      }
    });

    list.addEventListener("keydown", function (e) {
      var links = rowLinks();
      var i = links.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); if (i < links.length - 1) focusRow(i + 1); else if (!more.hidden) more.querySelector("button").focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusRow(i - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusRow(0); }
      else if (e.key === "End") { e.preventDefault(); focusRow(links.length - 1); }
      else if (e.key === "Escape") { e.preventDefault(); input.focus(); input.select(); }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Typing from a result goes back to the input.
        input.focus();
      }
    });
    more.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp") { e.preventDefault(); focusRow(rowLinks().length - 1); }
    });

    $all("a[data-q]", examples).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        input.value = b.getAttribute("data-q");
        input.focus();
        run();
      });
    });

    document.addEventListener("keydown", function (e) {
      var t = e.target;
      var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    var initial = "";
    try { initial = new URLSearchParams(location.search).get("q") || ""; } catch (e) {}
    if (initial) { input.value = initial; run(); }
    else {
      // Warm the catalog once the page is idle so the first keystroke is instant.
      var warm = function () { loadCards().catch(function () {}); };
      if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
      else setTimeout(warm, 2500);
    }
  }

  /* ---------- Copy buttons ---------- */

  $all("[data-copy]").forEach(function (box) {
    var btn = $(".copy", box);
    if (!btn) return;
    btn.setAttribute("aria-label", "Copy to clipboard");
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy-text") || $("pre", box).textContent.trim();
      var done = function () {
        btn.textContent = "Copied";
        btn.setAttribute("data-state", "done");
        setTimeout(function () { btn.textContent = "Copy"; btn.removeAttribute("data-state"); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });

  loadMeta();
})();
