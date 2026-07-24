#!/usr/bin/env python3
"""
Scaffold + lightly scrape an official issuer page into a schema-valid Card JSON,
then commit on an isolated branch and push.

Clues are NEVER written into sources — only the official URL(s) passed in.
"""
from __future__ import annotations

import argparse
import time
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

_here = Path(__file__).resolve()
ROOT = Path("/workspace") if Path("/workspace/data").is_dir() else _here.parents[2]
UA = "OpenCardDB-Ingest/1.0 (+https://github.com/thedavidweng/opencard-db; research)"

ISSUER_MAP = {
    "AMERICAN_EXPRESS": ("American Express", "amex", "amex", "none"),
    "AMERICAN EXPRESS": ("American Express", "amex", "amex", "none"),
    "AMEX": ("American Express", "amex", "amex", "none"),
    "CHASE": ("Chase", "chase", "visa", "signature"),
    "CAPITAL ONE": ("Capital One", "capital-one", "visa", "none"),
    "CAPITAL_ONE": ("Capital One", "capital-one", "visa", "none"),
    "CITI": ("Citi", "citi", "mastercard", "world"),
    "CITIBANK": ("Citi", "citi", "mastercard", "world"),
    "DISCOVER": ("Discover", "discover", "discover", "none"),
    "WELLS FARGO": ("Wells Fargo", "wells-fargo", "visa", "signature"),
    "WELLS_FARGO": ("Wells Fargo", "wells-fargo", "visa", "signature"),
    "BANK OF AMERICA": ("Bank of America", "bank-of-america", "visa", "signature"),
    "BANK_OF_AMERICA": ("Bank of America", "bank-of-america", "visa", "signature"),
    "US BANK": ("U.S. Bank", "us-bank", "visa", "signature"),
    "U.S. BANK": ("U.S. Bank", "us-bank", "visa", "signature"),
    "US_BANK": ("U.S. Bank", "us-bank", "visa", "signature"),
    "BARCLAYS": ("Barclays", "barclays", "mastercard", "world_elite"),
    "SYNCHRONY": ("Synchrony", "synchrony", "mastercard", "world"),
    "APPLE": ("Goldman Sachs", "goldman-sachs", "mastercard", "world"),
    "BREX": ("Brex", "brex", "other", "none"),
    "SOFI": ("SoFi", "sofi", "mastercard", "world"),
    "FNBO": ("FNBO", "fnbo", "visa", "signature"),
    "PENFED": ("PenFed", "penfed", "visa", "signature"),
    "COMENITY": ("Comenity", "comenity", "mastercard", "world"),
    "BILT": ("Wells Fargo", "wells-fargo", "mastercard", "world_elite"),
    "GOLDMAN_SACHS": ("Goldman Sachs", "goldman-sachs", "mastercard", "world"),
    "GOLDMAN SACHS": ("Goldman Sachs", "goldman-sachs", "mastercard", "world"),
    "PNC": ("PNC", "pnc", "visa", "signature"),
    "WEB_BANK": ("WebBank", "webbank", "visa", "signature"),
    "FIRST": ("First Bankcard", "first-bankcard", "visa", "signature"),
    "AMAZON.COM": ("Chase", "chase", "visa", "signature"),
    "DELTA": ("American Express", "amex", "amex", "none"),
    "AMERICAN AIRLINES": ("Barclays", "barclays", "mastercard", "world_elite"),
    "TILT": ("Tilt", "tilt", "visa", "signature"),
}

NETWORK_OVERRIDE = [
    (r"mastercard|world\s*elite|world\s*mastercard", "mastercard"),
    (r"\bvisa\b|signature|infinite", "visa"),
    (r"american\s*express|\bamex\b", "amex"),
    (r"\bdiscover\b", "discover"),
]


def fetch(url: str, timeout: int = 90) -> tuple[str, str]:
    # Known broken / hub URLs → better product URLs
    FIXUPS = {
        "https://cards.barclaycardus.com/banking/cards/aadvantage-aviator-red-w": "https://cards.barclaycardus.com/banking/cards/aadvantage-aviator-red-world-elite-mastercard/",
        "https://wwws.airfrance.us/information/flyingblue/carte-bancaire-parten": "https://wwws.airfrance.us/information/flyingblue/credit-cards",
    }
    for prefix, repl in FIXUPS.items():
        if url.startswith(prefix):
            url = repl
            break
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        final = resp.geturl()
        raw = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
        try:
            text = raw.decode(charset, errors="replace")
        except LookupError:
            text = raw.decode("utf-8", errors="replace")
        return final, text


def resolve_clue_url(url: str) -> str:
    """Follow redirects for affiliate/nerdwallet links when possible."""
    if not url:
        return url
    if "nerdwallet" not in url and "redirect" not in url:
        return url
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": UA, "Accept": "text/html"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.geturl()
    except Exception:
        return url



def strip_html(html: str) -> str:
    html = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    html = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", html)
    html = re.sub(r"(?is)<[^>]+>", " ", html)
    html = unescape(html)
    html = re.sub(r"\s+", " ", html)
    return html


def extract_title(html: str, fallback: str) -> str:
    m = re.search(r"(?is)<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)", html)
    if m:
        return unescape(m.group(1)).split("|")[0].split(" - ")[0].strip()
    m = re.search(r"(?is)<title[^>]*>([^<]+)</title>", html)
    if m:
        t = unescape(m.group(1))
        t = re.split(r"\s*[|\-–—]\s*", t)[0].strip()
        if 3 < len(t) < 120:
            return t
    return fallback


def extract_fee(text: str) -> tuple[float | None, float | None, str | None]:
    """Return amount, first_year, waiver note."""
    # $0 intro annual fee ... then $95
    m = re.search(
        r"\$\s*0[^\d]{0,40}(?:intro|introductory)[^\d]{0,40}annual\s*fee[^\d]{0,80}\$\s*([\d,]+)",
        text,
        re.I,
    )
    if m:
        amt = float(m.group(1).replace(",", ""))
        return amt, 0.0, "$0 intro annual fee for the first year, then regular annual fee"

    m = re.search(r"(?:annual\s*fee|yearly\s*fee)[^\d$]{0,40}\$\s*([\d,]+)", text, re.I)
    if m:
        amt = float(m.group(1).replace(",", ""))
        return amt, amt, None

    m = re.search(r"\$\s*([\d,]+)[^\d]{0,20}annual\s*fee", text, re.I)
    if m:
        amt = float(m.group(1).replace(",", ""))
        return amt, amt, None

    if re.search(r"(?:no|\$\s*0)\s+annual\s+fee", text, re.I):
        return 0.0, 0.0, None
    return None, None, None


def extract_signup(text: str) -> dict | None:
    # Earn 60,000 ... after spending $4,000 ... 3 months
    patterns = [
        r"(?:earn|get|receive)\s+([\d,]+)\s*(?:bonus\s+)?(?:points|miles|Membership Rewards|Ultimate Rewards|ThankYou|cash back|cash)?[^\d]{0,80}(?:spend(?:ing)?|after)\s+\$\s*([\d,]+)[^\d]{0,60}(\d+)\s*(?:months?|mos?|days?)",
        r"([\d,]+)\s*(?:bonus\s+)?(?:points|miles)[^\d]{0,40}\$\s*([\d,]+)[^\d]{0,40}(\d+)\s*(?:months?|mos?)",
        r"\$\s*([\d,]+)\s*(?:cash|bonus)[^\d]{0,60}\$\s*([\d,]+)[^\d]{0,40}(\d+)\s*(?:months?|mos?|days?)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if not m:
            continue
        a, spend, window = m.groups()
        amount = float(a.replace(",", ""))
        spend_f = float(spend.replace(",", ""))
        months = int(window)
        if "day" in m.group(0).lower():
            months = max(1, round(months / 30))
        unit = "points"
        low = m.group(0).lower()
        if "mile" in low:
            unit = "miles"
        elif "cash" in low or amount < 1000 and "$" in m.group(0):
            unit = "USD"
        return {
            "amount": amount,
            "unit": unit,
            "spend_required": spend_f,
            "spend_currency": "USD",
            "months": months,
            "description": re.sub(r"\s+", " ", m.group(0)).strip()[:240],
            "as_of": "2026-07-24",
        }
    return None


def extract_image(html: str, issuer_id: str) -> str | None:
    cands = re.findall(
        r"(?:https?:)?//[^\"'\s>]+\.(?:png|jpg|jpeg|webp)",
        html,
        re.I,
    )
    prefer = []
    for u in cands:
        if u.startswith("//"):
            u = "https:" + u
        ul = u.lower()
        if any(x in ul for x in ("cardart", "card-art", "card_art", "cardface", "products/")):
            prefer.append(u)
        elif issuer_id in ul and "card" in ul:
            prefer.append(u)
    if prefer:
        return prefer[0]
    # og:image
    m = re.search(r"(?is)<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)", html)
    if m:
        u = unescape(m.group(1))
        if u.startswith("//"):
            u = "https:" + u
        return u
    return None


def detect_network(text: str, default: str) -> tuple[str, str]:
    for pat, net in NETWORK_OVERRIDE:
        if re.search(pat, text, re.I):
            tier = "none"
            if net == "visa":
                if re.search(r"infinite", text, re.I):
                    tier = "infinite"
                elif re.search(r"signature", text, re.I):
                    tier = "signature"
                else:
                    tier = "signature" if default == "visa" else "none"
            elif net == "mastercard":
                if re.search(r"world\s*elite", text, re.I):
                    tier = "world_elite"
                elif re.search(r"\bworld\b", text, re.I):
                    tier = "world"
                else:
                    tier = "world"
            elif net == "amex":
                tier = "none"
            return net, tier
    # defaults from issuer map
    if default == "amex":
        return "amex", "none"
    return default, "signature" if default == "visa" else ("world" if default == "mastercard" else "none")


def rewards_stub(network: str, issuer_id: str) -> dict:
    if issuer_id == "amex":
        return {
            "currency": "membership_rewards",
            "currency_label": "Membership Rewards points / cash back (see product)",
            "structure": "multi",
            "base_rate": {
                "points_per_dollar": None,
                "description": "Earn rates — confirm on official product page; not copied from third-party clues.",
            },
            "categories": [],
            "redemption_notes": "See official American Express product page for current earn and redemption.",
        }
    if issuer_id == "chase":
        return {
            "currency": "ultimate_rewards",
            "currency_label": "Ultimate Rewards points / cash back (see product)",
            "structure": "multi",
            "base_rate": {
                "points_per_dollar": None,
                "description": "Earn rates — confirm on official Chase product page.",
            },
            "categories": [],
            "redemption_notes": "See official Chase product page.",
        }
    if issuer_id == "capital-one":
        return {
            "currency": "miles",
            "currency_label": "Capital One miles / cash back (see product)",
            "structure": "single",
            "base_rate": {
                "points_per_dollar": None,
                "description": "Earn rates — confirm on official Capital One product page.",
            },
            "categories": [],
            "redemption_notes": "See official Capital One product page.",
        }
    return {
        "currency": "points",
        "currency_label": "Rewards currency (see official product page)",
        "structure": "single",
        "base_rate": {
            "points_per_dollar": None,
            "description": "Earn rates left unset pending structured extract from official page.",
        },
        "categories": [],
        "redemption_notes": "Confirm earn/redeem details on the official issuer page.",
    }


def issuer_fields(issuer_raw: str, name: str, text: str) -> tuple[str, str, str, str]:
    key = issuer_raw.upper()
    if key in ISSUER_MAP:
        display, iid, net, tier = ISSUER_MAP[key]
    else:
        display = issuer_raw.replace("_", " ").title()
        iid = re.sub(r"[^a-z0-9]+", "-", display.lower()).strip("-")
        net, tier = "visa", "signature"
    # co-brand name hints
    low = (name + " " + text[:2000]).lower()
    if "american express" in low or "amex" in low or iid == "amex":
        net, tier = detect_network(low, "amex")
    else:
        net2, tier2 = detect_network(low, net)
        net, tier = net2, tier2
    return display, iid, net, tier


def build_card(clue: dict, official_url: str, html: str, final_url: str) -> dict:
    text = strip_html(html)
    name = extract_title(html, clue["name"])
    issuer_display, issuer_id, network, network_tier = issuer_fields(
        clue.get("issuer", ""), name, text
    )
    fee_amt, fee_fy, waiver = extract_fee(text)
    # if page didn't yield fee but clue has numeric fee, still DO NOT copy blindly —
    # leave null unless we found it on page. Exception: clue annual_fee only as note.
    signup = extract_signup(text)
    image = extract_image(html, issuer_id)
    card_id = clue["proposed_id"]
    path_slug = card_id.split("-", 1)[1]
    attribution = f"© {issuer_display}"
    notes = (
        "Scaffolded from official product page HTML with conservative nulls for "
        "earn categories when not cleanly extractable. Third-party clue DBs were "
        "not used as sources. Re-check rewards/benefits on the issuer site before relying on figures."
    )
    if fee_amt is None and clue.get("annual_fee") not in (None, ""):
        notes += f" Clue listed annual_fee={clue.get('annual_fee')} but value not confirmed in page text."

    sources = [final_url or official_url]
    if official_url not in sources and official_url != final_url:
        sources.insert(0, official_url)

    return {
        "id": card_id,
        "schema_version": "1.0.0",
        "name": name,
        "localized_names": {"en": name},
        "country": "us",
        "issuer": issuer_display,
        "issuer_id": issuer_id,
        "network": network,
        "network_tier": network_tier,
        "type": "credit",
        "status": "active",
        "annual_fee": {
            "amount": fee_amt,
            "currency": "USD",
            "first_year": fee_fy,
            "waiver_conditions": waiver,
        },
        "apr": {
            "purchase": {"min": None, "max": None, "type": "variable"},
            "notes": f"See {issuer_display} for current APR; terms vary by applicant/offer.",
        },
        "fx_fee": {"percent": None, "notes": "Confirm foreign transaction fee on official terms."},
        "credit_required": {"score_band": None, "notes": None},
        "rewards": rewards_stub(network, issuer_id),
        "signup_bonus": signup,
        "benefits": [],
        "travel_perks": {
            "lounge_access": None,
            "tsa_precheck_credit": None,
            "global_entry_credit": None,
            "free_checked_bags": None,
            "hotel_status": None,
            "other": [],
        },
        "official_url": sources[0],
        "image": {
            "url": image,
            "attribution": attribution,
            "local_path": None,
        },
        "bin_hints": [],
        "last_verified": "2026-07-24",
        "sources": sources,
        "notes": notes,
    }


def run_validate() -> None:
    subprocess.check_call(
        ["npm", "run", "validate"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def ingest_one(clue: dict, push: bool, dry_run: bool) -> dict:
    card_id = clue["proposed_id"]
    url = clue.get("url") or ""
    url = resolve_clue_url(url)
    if not url:
        raise RuntimeError(f"Need official URL for {card_id}, got empty")
    # After redirect, still reject pure nerdwallet destinations
    if "nerdwallet.com" in url and "/redirect/" not in (clue.get("url") or ""):
        # landed on nerdwallet article — not acceptable as sole source
        raise RuntimeError(f"Resolved URL still on NerdWallet for {card_id}: {url}")
    if "nerdwallet.com/redirect" in (clue.get("url") or "") and "nerdwallet.com" in url:
        raise RuntimeError(f"Could not resolve affiliate redirect for {card_id}")


    # Branch slug: strip country prefix once only (us-us-bank-x → us-bank-x)
    slug = card_id.split("-", 1)[1] if card_id.startswith("us-") else card_id
    slug = slug.replace("_", "-")
    branch = f"cursor/add-{slug}-60dd"
    # shorten branch if too long
    if len(branch) > 80:
        branch = f"cursor/add-{slug[-40:]}-60dd"

    final_url, html = fetch(url)
    card = build_card(clue, url, html, final_url)
    rel = Path("data/us") / f"{card_id[3:]}.json"
    # id is us-foo -> file foo.json where foo = id without us-
    # proposed_id us-amex-gold -> amex-gold.json = id.split('-',1)[1]
    rel = Path("data/us") / f"{card_id.split('-', 1)[1]}.json"
    # Fix: us-bank-of-america-x -> bank-of-america-x = everything after first hyphen... 
    # Actually id format is country-slug where slug can have hyphens.
    # File should be data/us/{slug}.json where id = us-{slug}
    assert card_id.startswith("us-")
    rel = Path("data/us") / f"{card_id[3:]}.json"

    if dry_run:
        print(json.dumps({"branch": branch, "path": str(rel), "fee": card["annual_fee"], "signup": card["signup_bonus"], "image": card["image"]["url"]}, indent=2))
        return card

    git("fetch", "origin", "main")
    # ensure clean-ish: stash not needed if we force checkout
    subprocess.check_call(["git", "checkout", "-B", branch, "origin/main"], cwd=ROOT)
    rel.parent.mkdir(parents=True, exist_ok=True)
    rel.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n")
    run_validate()
    git("add", str(rel))
    msg = f"Add {card['name']} card\n\nOfficial page verification scaffold for {card_id}."
    subprocess.check_call(["git", "commit", "-m", msg], cwd=ROOT)
    if push:
        subprocess.check_call(["git", "push", "-u", "origin", branch, "--force-with-lease"], cwd=ROOT)
    print(json.dumps({"ok": True, "branch": branch, "path": str(rel), "id": card_id}, indent=2))
    return card


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clue-json", required=True, help="Path to single clue object or queue array")
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("--limit", type=int, default=1)
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    data = json.loads(Path(args.clue_json).read_text())
    if isinstance(data, dict) and "proposed_id" in data:
        items = [data]
    elif isinstance(data, list):
        items = data
    else:
        items = data.get("cards") or data.get("queue_official") or []
    items = items[args.index : args.index + args.limit]
    errors = []
    for clue in items:
        try:
            ingest_one(clue, push=args.push, dry_run=args.dry_run)
            time.sleep(3)
        except Exception as e:
            errors.append({"id": clue.get("proposed_id"), "error": str(e)})
            print(f"ERROR {clue.get('proposed_id')}: {e}", file=sys.stderr)
            # return to main to avoid dirty state
            try:
                subprocess.check_call(["git", "checkout", "-f", "main"], cwd=ROOT)
            except Exception:
                pass
    if errors:
        print(json.dumps({"errors": errors}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
