# Nerige Story — brand, as it actually is

Everything below was read off the live storefront, not designed here. Each value
carries the URL and the declaration it came from, so anyone can re-check it when
the shop's theme changes.

Captured **18 September 2026** from `https://nerigestory.com` (Shopify, theme
`/cdn/shop/t/36/`). The theme id `t/36` appears in every asset URL and is the
thing most likely to move: if these values stop matching the shop, re-read the
inline `<style>` block in the storefront's `<head>` first.

This is an operations tool, not the shop. The brand arrives through **accent,
type and detail**. The ground stays white, the tables stay plain, and the only
loud thing on any screen is still the photograph of the saree.

---

## 1. The logo

| | |
|---|---|
| Master asset | `https://nerigestory.com/cdn/shop/files/NS_black_logo_1.png?v=1754380259` |
| Format | PNG, RGBA, **raster — Shopify publishes no SVG of it** |
| Native size | 945 × 630 (the CDN will not serve larger; `?width=` only scales down) |
| Aspect ratio | **3 : 2** exactly |
| Ink | `#000000` — pure black, measured from the file |
| Floral colour | `#F9AA8F` — measured, the single most common chromatic pixel value |
| Content bounds | x 4–939, y 16–614 — effectively full-bleed, no built-in padding |
| Favicon on the site | `NS_black_logo_0207fa3a-09b6-448c-8d71-20d92aefad14.png?v=1754307070`, served at `width=96` (`rel="shortcut icon"`) and `width=180` (`rel="apple-touch-icon"`) — the same artwork, a slightly different crop (966 × 623) |

Where the site uses it, verbatim from the rendered header:

```html
<h1 class="header__logo">
  <a href="/"><span class="sr-only">NerigeStory</span>
  <img src="//nerigestory.com/cdn/shop/files/NS_black_logo_1.png?v=1754380259&width=945"
       alt="NerigeStory" width="945" height="630" sizes="105px" class="header__logo-image"></a>
</h1>
```

**Shape.** A two-line script wordmark — *Nerige* over *Story* — flanked by two
coral floral sprigs, one top-left and one bottom-right. The script alone is
604 × 599, i.e. **square**; the 3:2 of the full lockup comes entirely from the
two sprigs. There is **no monogram or icon variant** anywhere on the site.

### What we shipped

| File | Size | What it is |
|---|---|---|
| `public/brand/nerige-story-wordmark.png` | 504 × 336 | The master, resampled. 3× the largest size anything renders it at. |
| `public/brand/nerige-story-wordmark-inverse.png` | 504 × 336 | **Derived, not from the site.** Achromatic pixels below 140 luma mapped to white; the coral untouched. For the one dark bar in the app. The storefront ships no light variant. |
| `public/brand/nerige-story-mark.png` | 256 × 256 | The left floral sprig alone, padded square. Transparent. |
| `src/app/icon.png` | 64 × 64 | The sprig on `#1C1C1C`. |
| `src/app/apple-icon.png` | 180 × 180 | Same. |

**Why the favicon is not the site's favicon.** The site's own favicon is the
whole two-line wordmark scaled to 96px, which at a browser tab's 16–32px is an
illegible smudge. We used the element of the same master file that survives that
size — the floral sprig — on the brand's own ink, where it reads as a coral
flower at 32px and is still identifiable at 16px. It is the same artwork, just
the part of it that works at that scale.

### Measured legibility

Rendered at 1:1 in Chrome against the real compiled stylesheet:

| Rendered | Verdict |
|---|---|
| 168 × 112 | Comfortable. Sign-in, sign-up, `/auth/error`, `/not-authorised`. |
| 120 × 80 | Comfortable. |
| 96 × 64 | Clearly legible. |
| **72 × 48** | **The floor.** Both words still resolve. This is the header size. |
| below 72 × 48 | *Story* collapses into a texture. Do not. |

---

## 2. Palette

Every value is `rgb()` in the storefront's inline `<style>`, converted to hex.
`color-scheme--scheme-1` is its default scheme.

| Token in `globals.css` | Hex | Source declaration |
|---|---|---|
| `--color-brand` | `#1C1C1C` | `.color-scheme--scheme-1 { --accent: 28 28 28; --text-color: 28 28 28; --button-background: 28 28 28 }` |
| `--color-brand-hover` | `#3E3E3E` | `.color-scheme--scheme-3 { --border-color: 62 62 62 }` — the site's own next step off its ink |
| `--color-brand-on` | `#FFFFFF` | `--button-text-color: 255 255 255` |
| `--color-brand-muted` | `#5C5C5C` | `.color-scheme--scheme-2 { --text-color: 92 92 92 }` — its secondary text |
| `--color-brand-accent` | `#F9AA8F` | Sampled from the logo's floral sprigs. Not declared in CSS anywhere — the flowers are the only place the shop has a colour. |
| `--color-brand-accent-soft` | `#FFEFEB` | `.color-scheme--scheme-1a73ff2d… { --background: 255 239 235 }` — the blush section ground, and the scheme the site's own header runs in |
| `--color-brand-line` | `#DDDDDD` | `.color-scheme--scheme-1 { --border-color: 221 221 221 }` (scheme-2 uses `#E7E7E7`) |

Not adopted: `--on-sale-text: 227 44 43`, `--success-text: 48 122 7` and the rest
of the storefront's status colours. This app already has a status vocabulary
(amber waiting / blue moving / green settled / red stopped, `primitives.tsx`) and
a second one would make a colour mean two things.

**`#108474` is not a Nerige colour.** It appears 13 times in the page source and
is Judge.me's own brand colour, from the reviews app's embedded config.

### Contrast, measured (WCAG 2.1 relative luminance)

| Foreground | Background | Ratio | |
|---|---|---|---|
| `#1C1C1C` brand ink | `#FFFFFF` | **17.04:1** | ✅ |
| `#FFFFFF` | `#1C1C1C` primary button | **17.04:1** | ✅ |
| `#1C1C1C` | `#FFEFEB` active nav fill | **15.26:1** | ✅ |
| `#3E3E3E` button hover | `#FFFFFF` | **10.70:1** | ✅ |
| `#1C1C1C` | `#F9AA8F` accent fill | **9.07:1** | ✅ |
| `#5C5C5C` muted | `#FFFFFF` | **6.69:1** | ✅ |
| `#5C5C5C` muted | `#FFEFEB` | **5.99:1** | ✅ |
| **`#F9AA8F`** | **`#FFFFFF`** | **1.88:1** | ❌ |
| `#F9AA8F` | `#FFEFEB` | 1.68:1 | ❌ |
| `#DDDDDD` hairline | `#FFFFFF` | 1.36:1 | decorative only |

**The compromise, stated plainly.** The brand coral fails against white by a
wide margin — 1.88:1 against a 4.5:1 floor. It is therefore **never** used for
text and **never** as the only signal of anything. It appears as:

- a **fill** (with near-black text on it, 9.07:1), and
- a **1px inset ring** on the active navigation item, where the blush fill, the
  font weight and `aria-current="page"` already carry the state three other ways.

The focus ring is `--color-brand` (near-black), not the coral: a focus indicator
has to clear 3:1 against what is behind it and the coral does not.

`#DDDDDD` is below the 3:1 that WCAG 1.4.11 wants of a meaningful control
boundary, so it is not used as one. Input and card borders keep `stone-300` /
`stone-200`; the token exists for decorative rules only.

---

## 3. Typography

Both faces are served by the storefront from its own CDN, and **both are Google
Fonts under the OFL** — so unlike a paid Shopify face there is nothing stopping
us self-hosting them. No substitute was needed.

Verbatim from the storefront's inline `:root`:

```css
--heading-font-family: Montserrat, sans-serif;
--heading-font-weight: 500;
--heading-text-transform: normal;
--heading-letter-spacing: 0.05em;
--text-font-family: "Nunito Sans", sans-serif;
--text-font-weight: 400;
--text-letter-spacing: 0.0em;
--button-font: var(--text-font-style) var(--text-font-weight) var(--text-sm) / 1.65 var(--text-font-family);
--button-text-transform: normal;
--button-letter-spacing: 0.18em;
```

Font files actually loaded (`//nerigestory.com/cdn/fonts/…`, woff2 + woff):
`montserrat_n5`, `montserrat_i5`; `nunitosans_n4`, `nunitosans_i4`,
`nunitosans_n7`, `nunitosans_i7`.

Loaded here by `src/lib/fonts.ts` through `next/font/google`, as variable fonts —
one file each instead of six — so no screen makes a request to `fonts.gstatic.com`.

### The site's type scale

| | Declared | Renders |
|---|---|---|
| `--text-h1` | `clamp(1.375rem, …, 2rem)` | 22 → 32px, line-height **1.5** |
| `--text-h2` | `clamp(1.25rem, …, 1.75rem)` | 20 → 28px, line-height 1.5 |
| `--text-h3` | `clamp(1.125rem, …, 1.375rem)` | 18 → 22px, line-height 1.6 |
| `--text-h4` | `clamp(1rem, …, 1.125rem)` | 16 → 18px |
| `.h6` (its nav links) | `0.6875rem` | 11px |
| body | `--text-base` | 15px / **1.65** (`body{font: … var(--text-base)/1.65 …}`) |
| small | `--text-sm` / `--text-xs` | 14px / 13px |

### What we took, and what we did not

| | Site | Here | Why |
|---|---|---|---|
| Headings | Montserrat 500, 0.05em | **same** | Applied to `h1–h4` in `globals.css` by element selector, so every heading already written picks it up. |
| Page title size | 22 → 32px / 1.5 | **22px / 1.5** (`--text-page-title`) | We take the **floor** of the site's own h1 clamp, not its ceiling. The hierarchy is worth importing; 32px on a 1024px tablet costs a row of whatever queue is under it. Up from 18px. |
| Prose / body | Nunito Sans 400 | **same**, on `body` | |
| Navigation | Montserrat, 11px | Montserrat, 0.05em, **14px** | 11px is below this app's text floor and below what is readable at arm's length on a warehouse tablet. Face and tracking adopted, size not. |
| **Data tables** | Nunito Sans | **platform UI stack, tabular figures** | `:where(table)` in `globals.css` pins it. A column of figures read across a warehouse is scanned, not read. This is a deliberate refusal of the site's face, per the brief. |
| **SKUs** | — | `--font-mono`, unchanged | They are read character by character and copied onto fabric by hand. |
| Button tracking | 0.18em | **0.06em** | 0.18em on a 14px label is ~2.5px between letters. On a storefront's one call-to-action that reads as luxury; on a control a warehouse manager hits forty times a shift it is just slower to read. Conflict recorded — raise it to `0.18em` in `primitives.tsx` if you disagree. |

---

## 4. Shape, placement and detail

From the storefront's own declarations:

| | Site | Here |
|---|---|---|
| Button radius | `--button-border-radius: 1.875rem` (30px) on a ~44px control = a full pill | **Adopted.** `rounded-full` on `Button` and `LinkButton`, padding `px-4` → `px-5` to give the pill shoulders. Costs no contrast, no density, no reading speed. |
| Input radius | `--input-border-radius: 1.875rem` — also a pill | **Not adopted.** Inputs stay `rounded-lg`. A pill-shaped text field reads as a search box and pushes the caret in from the edge; this app is full of dense typed entry. Conflict recorded. |
| Header logo width | `--header-logo-width: 90px` (105px ≥ 700px) | 72px. Our header is 69px tall against the site's ~108px. |
| Header padding | `--header-padding-block: 1rem` (1.2rem ≥ 700px) | `py-2.5`. Against a 48px-tall mark this holds the header at **exactly the 69px it was** before the logo existed. |
| Header grid | `"primary-nav logo secondary-nav"` — **mark centred**, nav left, actions right | **Not adopted.** Mark stays left. A five-section workspace nav does not split evenly around a centre, and the house rule fixes the workspace switcher top right. |
| Header column gap | `1.25rem`, `2.5rem` ≥ 1000px | `gap-3`, `lg:gap-5` (12px / 20px) |
| Header rule | `--header-separation-border-color: 0 0 0 / 0.15` — a hairline | Unchanged: `border-b border-stone-200` |
| Shadows | `--shadow-sm: 0 2px 8px rgb(0 0 0 / 0.05)` | **Not adopted.** House rule: nothing beyond a hairline border. |
| Section rhythm | `--section-vertical-spacing: 2.25rem` → `3.5rem` | **Not adopted.** Storefront air on a dense queue is rows lost. |

Wordmark letter-spacing: not applicable — the mark is artwork, not set type.
Nothing in this app should ever attempt to typeset "Nerige Story" as a
substitute for it.

---

## 5. Where the brand now appears

The logo replaces the **word "Nerige" only where it stood for the brand mark**:

- `src/app/(app)/layout.tsx` — internal header, weaver portal header, developer
  header (inverse, on the dark bar)
- `src/app/login/page.tsx`, `src/app/signup/page.tsx`
- `src/app/auth/error/page.tsx`, `src/app/not-authorised/page.tsx`
- `src/app/icon.png`, `src/app/apple-icon.png`

It does **not** replace "Nerige" in prose — "Ask the Nerige team", "What Nerige
calls her", "Nobody at Nerige can look one up", "`/invite @Nerige` in that
channel". Those are the company being talked about, not the mark.

`alt` text: `"Nerige Story"` everywhere the mark is the only naming (all of the
above). `<Logo decorative />` sets `alt=""` for the case where a visible label
already says the name — currently unused, and deliberately kept available so
nobody solves that case by deleting the alt attribute.

### Left to do

`src/app/(app)/warehouse/day/page.tsx` line 19 still reads
`title: 'Day sheet · Nerige'`. Every other page title had its ` · Nerige` suffix
removed, because the root layout now appends ` · Nerige Story` via a Metadata
template. That file was being edited elsewhere and was left alone, so its tab
currently reads **"Day sheet · Nerige · Nerige Story"**. Change it to
`title: 'Day sheet'`.

---

## 6. Re-fetching

```bash
curl -sL "https://nerigestory.com/cdn/shop/files/NS_black_logo_1.png?v=1754380259" -o logo.png
curl -sL "https://nerigestory.com/" | grep -o -- '--heading-font-family:[^;]*;'
curl -sL "https://nerigestory.com/cdn/shop/t/36/assets/theme.css"
```

The palette and typography live in an inline `<style>` in the storefront's
`<head>`, not in `theme.css` — `theme.css` holds the rules, the `<head>` holds
the merchant's settings.
