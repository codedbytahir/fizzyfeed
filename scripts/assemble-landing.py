#!/usr/bin/env python3
"""assemble-landing.py — inlines the six fx modules into landing/index.html.

Reads   landing/animations/<id>/index.html  (self-contained modules)
Writes  landing/index.html                  (single-file landing page)
Also copies name-agnostic logo/social files into landing/logo/ and landing/social/.

Module contract honored (docs/ANIMATIONS.md §2):
- module CSS: all <style> content minus top-level html/body/:root/* rules (scaffold)
- module HTML: between <!-- FX-MODULE-START --> and <!-- FX-MODULE-END -->
- module JS:  every <script> body, re-emitted in order after the module markup
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANIM = ROOT / "landing" / "animations"
OUT = ROOT / "landing" / "index.html"

MODULES = [  # (id, section slot)
    ("fx-01-hero-deck", "hero"),
    ("fx-04-yearline-draw", "proof"),
    ("fx-02-feed-to-deck", "how"),
    ("fx-03-deck-fan", "chapters"),
    ("fx-05-persona-morph", "persona"),
    ("fx-06-queue-recap", "cta"),
]

def strip_global_rules(css: str) -> str:
    """Drop depth-0 rules whose selector is html/body/:root/* (scaffold remnants)."""
    out, i, n = [], 0, len(css)
    while i < n:
        b = css.find("{", i)
        if b == -1:
            out.append(css[i:])
            break
        sel = css[i:b]
        depth, j = 1, b + 1
        while j < n and depth:
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
            j += 1
        if re.match(
            r"^(html\b|body\b|:root\b|\*)",
            re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip(),
        ):
            out.append("")
        else:
            out.append(css[i:j])
        i = j
    return "".join(out).strip()

def module_css(text: str) -> str:
    blocks = re.findall(r"<style[^>]*>(.*?)</style>", text, re.S)
    return "\n\n".join(strip_global_rules(b) for b in blocks if strip_global_rules(b))

def module_html(text: str) -> str:
    m = re.search(r"<!--\s*FX-MODULE-START\s*-->(.*?)<!--\s*FX-MODULE-END\s*-->", text, re.S)
    if not m:
        raise SystemExit("FX-MODULE markers missing")
    frag = m.group(1).strip("\n")
    lines = frag.splitlines()
    indents = [len(l) - len(l.lstrip()) for l in lines if l.strip()]
    pad = min(indents) if indents else 0
    return "\n".join(l[pad:] if len(l) >= pad else l.lstrip() for l in lines)

def module_js(text: str) -> list[tuple[str, str]]:
    """[(attrs, body)] in document order."""
    out = []
    for m in re.finditer(r"<script([^>]*)>(.*?)</script>", text, re.S):
        attrs, body = m.group(1), m.group(2).strip()
        if body:
            typ = re.search(r'type="([^"]+)"', attrs)
            out.append((typ.group(1) if typ else "", body))
    return out

def load(mid: str):
    p = ANIM / mid / "index.html"
    text = p.read_text(encoding="utf-8")
    return module_css(text), module_html(text), module_js(text)

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fizzyfeed — your year in posts</title>
<meta name="description" content="connect buffer, and twelve months of publishing become a deck of seven story cards, an ai-named alter ego, and a recap post queued to every channel — in one click.">
<meta property="og:title" content="fizzyfeed — your year in posts">
<meta property="og:description" content="twelve months of publishing, carded. seven story cards, an alter ego, one queued recap.">
<meta property="og:image" content="social/og-image.png">
<meta name="theme-color" content="#05070E">
<link rel="icon" type="image/png" href="logo/favicon-48.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<style id="fx-css">
/* ===== inlined fx modules (contract: docs/ANIMATIONS.md §2) ===== */
{FX_CSS}
</style>
</head>
<body>

<header class="nav">
  <div class="wrap">
    <a href="#top" aria-label="fizzyfeed home"><img class="brand" src="logo/lockup-on-dark.svg" alt="fizzyfeed" height="26"></a>
    <nav aria-label="sections">
      <a href="#how">how it works</a>
      <a href="#chapters">chapters</a>
      <a href="#persona">alter ego</a>
    </nav>
    <a class="btn small" data-connect href="/api/auth/buffer/login">connect buffer</a>
  </div>
</header>

<main id="top">

  <section class="hero" aria-labelledby="hero-h">
    <div class="wrap hero-copy">
      <span class="overline">built for buffer commit 2026</span>
      <h1 id="hero-h">your year in posts.</h1>
      <p class="sub">connect buffer, and twelve months of publishing become a deck of seven story
      cards, an ai-named posting alter ego, and a recap post queued to every channel — in one click.</p>
      <div class="hero-cta">
        <a class="btn" data-connect href="/api/auth/buffer/login">connect buffer</a>
        <a class="btn ghost" href="#chapters">see the deck</a>
      </div>
      <p class="hero-note"><b>read-only</b> oauth by default · one-click revoke · honest numbers only</p>
    </div>
    <div class="wrap hero-fx">
{FX_fx-01-hero-deck_HTML}
    </div>
{FX_fx-01-hero-deck_JS}
  </section>

  <section class="proof" aria-labelledby="proof-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="overline">the proof</span>
        <h2 id="proof-h">your rhythm, honestly.</h2>
        <p class="sub">the chart is the aesthetic. we draw your actual year — real days, real
        streaks, real quiet months. nothing inflated, nothing invented.</p>
      </div>
{FX_fx-04-yearline-draw_HTML}
    </div>
{FX_fx-04-yearline-draw_JS}
  </section>

  <section id="how" aria-labelledby="how-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="overline">how it works</span>
        <h2 id="how-h">posts in, deck out.</h2>
      </div>
      <div class="how-grid">
        <div class="steps">
          <div class="step"><span class="n">01</span><div><h3>connect</h3><p>sign in with buffer. read-only by default, tokens encrypted, one-click revoke.</p></div></div>
          <div class="step"><span class="n">02</span><div><h3>yearize</h3><p>we pull your past 12 months and compute the story — cadence, streaks, channel mix, peaks.</p></div></div>
          <div class="step"><span class="n">03</span><div><h3>your deck</h3><p>seven story cards render as shareable images in the recap-card palette. screenshot bait, earned.</p></div></div>
        </div>
{FX_fx-02-feed-to-deck_HTML}
      </div>
    </div>
{FX_fx-02-feed-to-deck_JS}
  </section>

  <section id="chapters" aria-labelledby="ch-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="overline">the deck</span>
        <h2 id="ch-h">seven chapters.</h2>
        <p class="sub">one card per moment, led by the brand gradients. feelable in one sitting — not a dashboard with a party hat.</p>
      </div>
{FX_fx-03-deck-fan_HTML}
      <div class="chapters-grid">
        <div class="chapter"><span class="cn">01</span><b>kickoff</b><span>where the year started</span></div>
        <div class="chapter"><span class="cn">02</span><b>rhythm</b><span>best day, favorite hour</span></div>
        <div class="chapter"><span class="cn">03</span><b>streaks</b><span>the grind you forgot</span></div>
        <div class="chapter"><span class="cn">04</span><b>the mix</b><span>channels &amp; topics</span></div>
        <div class="chapter"><span class="cn">05</span><b>peaks</b><span>biggest month, busiest week</span></div>
        <div class="chapter"><span class="cn">06</span><b>alter ego</b><span>ai-named, data-derived</span></div>
        <div class="chapter"><span class="cn">07</span><b>the recap</b><span>queue your recap post</span></div>
        <div class="chapter"><span class="cn">+</span><b>greatest hits</b><span>opt-in real top posts</span></div>
      </div>
    </div>
{FX_fx-03-deck-fan_JS}
  </section>

  <section id="persona" aria-labelledby="pe-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="overline">workers ai</span>
        <h2 id="pe-h">an alter ego, earned.</h2>
        <p class="sub">ai studies your real patterns — the hours, the streaks, the channels you fed —
        and names the posting persona you became this year. cross-check it: the numbers agree.</p>
      </div>
{FX_fx-05-persona-morph_HTML}
    </div>
{FX_fx-05-persona-morph_JS}
  </section>

  <section id="cta" aria-labelledby="cta-h">
    <div class="wrap">
      <div class="sec-head" style="align-items:center;text-align:center;margin-left:auto;margin-right:auto">
        <span class="overline">the real action</span>
        <h2 id="cta-h">one click, queued everywhere.</h2>
        <p class="sub" style="margin:0 auto">this is what makes it a tool instead of a toy: the recap post is
        composed from your year, previewed, and queued through buffer to all your channels. you approve; it publishes.</p>
      </div>
      <div class="cta-box">
{FX_fx-06-queue-recap_HTML}
        <a class="btn" data-connect href="/api/auth/buffer/login">connect buffer</a>
        <p class="cta-micro">free during buffer commit 2026 · your tokens stay encrypted · revoke anytime</p>
      </div>
    </div>
{FX_fx-06-queue-recap_JS}
  </section>

</main>

<footer>
  <div class="wrap">
    <div class="f-brand">
      <img src="logo/lockup-on-dark.svg" alt="fizzyfeed" data-brand-name-img height="20">
      <span>your year in posts.</span>
    </div>
    <p>built for buffer commit 2026 (oct 28 – nov 13) · brand kit v0.1 · © <span data-year>2026</span></p>
    <p class="legal">buffer is a trademark of buffer inc.; this page references the contest but grants no
    rights to buffer's name or logo. no engagement is faked anywhere in this product — if a number is
    shown, it happened.</p>
    <p><a href="../preview/index.html">brand board</a> · <a href="../docs/specs/00-PRODUCT.md">build specs</a> ·
    <a href="../IDEA.md">the idea</a></p>
  </div>
</footer>

<script src="main.js"></script>
</body>
</html>
"""

def main():
    css_all, replacements = [], {}
    for mid, _slot in MODULES:
        css, html, scripts = load(mid)
        css_all.append(f"/* ---- {mid} ---- */\n{css}")
        js_blocks = []
        for typ, body in scripts:
            attr = f' type="{typ}"' if typ else ""
            js_blocks.append(f"<script{attr}>\n{body}\n</script>")
        replacements[f"{{FX_{mid}_HTML}}"] = html
        replacements[f"{{FX_{mid}_JS}}"] = "\n".join(js_blocks)

    page = TEMPLATE.replace("{FX_CSS}", "\n\n".join(css_all))
    for mid, _ in MODULES:  # JS placeholders must resolve even when empty
        replacements.setdefault(f"{{FX_{mid}_JS}}", "")
    for k, v in replacements.items():
        page = page.replace(k, v)

    # name-agnostic asset copies (rename = file swap, per brand law)
    (ROOT / "landing" / "logo").mkdir(exist_ok=True)
    (ROOT / "landing" / "social").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "logo/svg/lockup-fizzyfeed-on-dark.svg", ROOT / "landing/logo/lockup-on-dark.svg")
    shutil.copy2(ROOT / "logo/png/favicon-48.png", ROOT / "landing/logo/favicon-48.png")
    shutil.copy2(ROOT / "social/og-image-fizzyfeed.png", ROOT / "landing/social/og-image.png")

    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT} ({len(page)/1024:.0f} KB)")

if __name__ == "__main__":
    main()
