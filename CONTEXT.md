# OpenCard DB

Shared language for credit card **product metadata**: what a product is, who issues it, which network it rides, and how benefits and rewards are attributed. Not account data, not transactions, not approvals.

## Language

### Identity

**Card**:
A single currently marketed credit product from an Issuer (e.g. Chase Sapphire Preferred). One Card has one stable id; material changes (fees, rewards, bonuses) update the same record in place; history lives in git.
_Avoid_: account, plastic, BIN product, version snapshot, offer (unless meaning Signup Bonus)

**Card Id**:
Stable public identifier `{country}-{slug}` (e.g. `us-chase-sapphire-preferred`). Never reused for a different product; never renamed once published.
_Avoid_: UUID, SKU, product code (issuer-internal)

**Country**:
The consumer market where the Card is offered (`us`, `ca`, `cn`, …). Same brand name in two markets = two Cards. Files live under `data/{country}/`.
_Avoid_: currency country alone, residency rule as the only definition, region

**Card Status**:
Lifecycle of the product offering: `active` (open for application), `invite_only`, `discontinued` (no longer offered; record kept so Card Ids stay valid. Discontinued products are first-class records, not leftovers: grandfathered cardholders still hold them, so completeness includes yesterday's cards), or `unknown`.
_Avoid_: deleted, archived as the only model, is_active boolean alone

### Parties

**Issuer**:
The bank or lender brand that extends credit and markets the Card (Chase, Amex, Scotiabank, 招商银行, RBC). Display name in `issuer`; stable slug in `issuer_id`. **Independent of Network.** When Amex both issues and runs the network, both fields are Amex. When a bank issues an Amex Card, Issuer is the bank and Network is Amex (e.g. Scotiabank + Amex).
_Avoid_: co-brand partner; conflating Issuer with Network; legal entity name as primary identity

**Co-brand Partner**:
A non-issuer brand attached to the product (airline, hotel, retailer). Not an Issuer; perks from them use Benefit Source `co-brand`.
_Avoid_: second issuer, co-issuer (unless legally true and still modeled as partner)

### Network

**Network**:
The card network / 发卡组织 that carries the product (`visa`, `mastercard`, `amex`, `discover`, `unionpay`, …). Always a separate field from Issuer — never assumed equal for Amex or Discover. Dual-network Cards have one primary Network plus zero or more Additional Networks.
_Avoid_: scheme (except when quoting external docs); treating Network as “same as Issuer”

**Network Tier**:
A free-form lowercase slug for the **network product package** (e.g. Visa `infinite` / `signature`, Mastercard `world_elite` / `world`, UnionPay `diamond` / `platinum`, or `none` when there is no network package). First-class and **global**. Not a closed schema enum. **Product marketing names** (Cobalt, Gold, Platinum, Sapphire Preferred, etc.) live in the Card **name**, never as Network Tier.
_Avoid_: product line names as tiers; card level; embedding network inside the tier string (`visa:infinite`)

**Additional Network**:
A secondary Network + Network Tier pair on the same Card (common for dual-brand 双标 products). Does not create a second Card.
_Avoid_: secondary card, dual card, co-network product

### Money & fees

**Annual Fee**:
Structured ongoing fee for holding the Card (amount, currency, first-year amount if different, optional waiver conditions text). Consumption-based waivers may also appear as Benefits with category `waiver`.
_Avoid_: burying the only fee number in free-text notes when known

**Rewards**:
The ongoing earn structure: rewards currency, base rate, category multipliers, structure type (`single` / `multi` / `choice`). Not the welcome offer.
_Avoid_: using “bonus” when you mean Signup Bonus

**Signup Bonus**:
The time-limited welcome offer (amount, unit, spend requirement, window, `as_of`). Distinct from Rewards and from Benefits.
_Avoid_: welcome benefit, earn category, ongoing rewards

### Benefits

**Benefit**:
One named, independently describable perk (insurance, lounge, fee waiver, statement credit, free night, phone protection, etc.). All Benefits live in a single `benefits` inventory. Prefer structured `details` for insurance (coverage, deductible, duration, conditions).
_Avoid_: feature (vague), notes-only perks when a Benefit entry is possible

**Benefit Source**:
Who provides the Benefit: `network` | `issuer` | `co-brand`.
_Avoid_: origin, provider without these three values

**Benefit Category**:
Coarse filter class: e.g. `insurance`, `lounge`, `credit`, `waiver`, `acceleration`, `other`. Insurance always uses `insurance`.
_Avoid_: type (when you mean Category)

**Travel Perks**:
Convenience projection of high-frequency travel fields for queries. Not a second inventory — Benefits remain authoritative; Travel Perks may mirror a subset.
_Avoid_: treating travel_perks as the only place travel Benefits exist

### Provenance

**Source**:
An official issuer (or network) URL supporting facts on the Card (product page, terms/benefits). Required. Third-party databases are discovery clues only, never Sources.
_Avoid_: blog as sole authority; confusing with Benefit Source

**Last Verified**:
Date a human last checked the Card against its Sources. Required; signals staleness, not automatic truth.
_Avoid_: git commit time alone, scraped_at
