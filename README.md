<p align="center">
  <img src="logo.jpg" alt="Humaniser" width="120" />
</p>

<h1 align="center">Humaniser</h1>

<p align="center">
  <strong>Make AI-generated text sound like a real person wrote it.</strong><br/>
  A zero-dependency, privacy-first web app that detects robotic AI writing patterns and rewrites them into plainer, more natural prose.
</p>

<p align="center">
  <a href="https://github.com/ModernOps888/humaniser/releases/tag/v1.2.0"><img src="https://img.shields.io/badge/release-v1.2.0-10b981" alt="Release v1.2.0" /></a>
  <img src="https://img.shields.io/badge/tests-18%2F18_passed-brightgreen" alt="Tests 18/18 Passed" />
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/voice_modes-6-00f0ff" alt="6 Voice Modes" />
  <img src="https://img.shields.io/badge/API-optional-blue" alt="API Optional" />
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="MIT License" />
  <a href="https://infinitytechstack.uk/humaniser"><img src="https://img.shields.io/badge/Live_Workbench-infinitytechstack.uk-10b981" alt="Live Workbench" /></a>
  <a href="https://infinitytechstack.uk/consulting"><img src="https://img.shields.io/badge/Enterprise-Security_Audits-ff00e5" alt="Enterprise Audits" /></a>
</p>

> 🌐 **Live Interactive Workbench (Free, Zero Sign-Up)**: The Quick Fix engine in this repo is a vanilla-JS port of the engine behind [**infinitytechstack.uk/humaniser →**](https://infinitytechstack.uk/humaniser) (same six voice modes, chat-wrapper / em-dash / watermark cleaner, variation reroll and "Highlight changes" view).
>
> 🛡️ **Enterprise AI Production Audits & Systems Advisory**: Deploying LLM-driven content pipelines, autonomous agents, or customer-facing AI where synthetic phrasing, hallucinations, or prompt leakage compromise your brand? We deliver **fixed-scope, 3-day enterprise AI audits** (£4,500 with runnable remediation PRs) and **principal systems advisory** (£650–£7,500). [**Explore Packages & Book a Call →**](https://infinitytechstack.uk/consulting)

---

## Why Humaniser?

AI writing tools all tend to sound the same: *"In today's fast-paced world, it is crucial to leverage cutting-edge technology..."*

Paste any text and Humaniser highlights the AI-style patterns it finds, gives the text a 0–100 score, and rewrites it with a deterministic, rule-based engine that runs entirely in your browser.

**No account. No server. Quick Fix makes no network requests.** Text only leaves your browser if you opt into Deep Rewrite with your own API key.

---

## Features

### 🔍 Detection (`js/detector.js` → `analyse()`)

| Check | What it flags | Data |
|------|----------------|------|
| **Vocabulary** | AI-overused words (*delve, crucial, leverage, landscape*) | 217 words (`AI_WORDS`) |
| **Phrases** | Cliché AI phrases (*"It is worth noting that"*) | 104 patterns (`AI_PHRASES`) |
| **Transitions** | Sentences opening with *However, Moreover, Furthermore…* | 25 words (`TRANSITION_WORDS`) |
| **Contractions** | Uncontracted forms (*"do not"*, *"it is"*) | 45 pairs (`CONTRACTION_MAP`) |
| **Hedging** | Qualifying filler (*"It is important to note that"*) | 22 patterns (`HEDGING_PHRASES`) |
| **Fillers** | Redundant sentence starters (*"That being said,"*) | 20 patterns (`FILLER_STARTERS`) |
| **Repetitive starters** | 3+ sentences starting with the same word | — |
| **Uniformity** | Sentence-length coefficient of variation < 0.3 (4+ sentences) | — |
| **Passive voice** | Passive constructions in more than 30% of sentences | — |
| **Em-dashes** | More than 2 dashes per 500 words | — |

### ⚡ Quick Fix — deterministic rewrite, no API (`js/workbench.js` → `transformHumaniser()`)

Ported from the live workbench. Stages run in this order:

1. **Watermark cleaner** — strips zero-width characters (U+200B, U+200C, U+200D, U+FEFF, U+2060), turns non-breaking spaces into spaces and curly quotes into straight quotes.
2. **Code & URL protection** — fenced code blocks, inline `code` and `http(s)://` URLs are swapped out for placeholders and restored byte-for-byte at the end (`protectBlocks()` / `restoreBlocks()`).
3. **Chat-wrapper stripper** (toggle) — removes *"Certainly! Here is…:"* preambles and *"Let me know if you'd like…"* sign-offs; in Chat, Casual and Email modes it also rewrites `- **Point:** text` bullets as `- Point — text`.
4. **Template rewrites** — *"It's not just about X, it's about Y"*, *"Not only does X…, but it also…"*, *"Whether you're a X or a Y,"*.
5. **Transition orchestrator** — replaces *Furthermore / Moreover / However / Therefore / In conclusion…* with a voice-specific pool, before word-level swaps so they never collide.
6. **Phrase replacements** — 93 multi-word phrases, matched with punctuation-safe boundaries (`buildPhraseRegex()`).
7. **Vocabulary replacements** — 308 AI words; the **Depth** setting picks which severities are replaced (Light ≥ 4, Balanced ≥ 3, Deep: all).
8. **Anti-repetition ledger** — every choice in stages 4–7 goes through `pickUniqueAlternative()`, which tracks used alternatives across the whole document so the same replacement isn't reused while unused options remain.
9. **Em-dash normaliser** (toggle) — `—`, `–` and `--` become commas, alternating with ` - ` (Chat/Casual) or `; ` (other modes).
10. **Cadence splitter** (Balanced/Deep only) — splits *", thereby …ing"*, *", ensuring that"*, *", which in turn"* clauses and breaks sentences of 24+ words at *", and" / ", while"*, working paragraph by paragraph so `\n\n` breaks are preserved; also drops a paragraph opener that repeats an earlier paragraph's opener.
11. **Contractions** (toggle) — inserts contractions; Academic mode never inserts them and expands *n't* forms instead.
12. **a/an self-healer** — `fixEnglishArticlesAndGrammar()` fixes articles by sound (*an hour, a unique, a user, a one-time, a URL, an LLM, an API*) and removes doubled words left by adjacent swaps (*"to to"*).

> [!NOTE]
> The port fixes a few bugs found in the site source while porting (listed at the top of `js/workbench.js`), e.g. template rewrites leaking a literal `$3` into the output and `"a URL"` being turned into `"an URL"`.

### 🎛️ Workbench controls (`index.html`, `app.js`)

- **Six voice modes** (table below) and a **Depth** selector (Light Polish / Balanced / Deep).
- **Toggles**: strip chat intros & sign-offs, fix em-dashes, natural contractions.
- **Auto-humanise as you type** — re-runs Quick Fix ~350 ms after you stop typing or change an option.
- **↻ Variation** — cycles four alternative phrasings (`variationSeed` 0–3).
- **Highlight changes** — marks every term Quick Fix inserted in the output panel (`highlightChangedTerms()`). This highlights inserted terms; it is not a line-by-line diff.
- **Metrics line** under the output — AI-risk %, burstiness CV and dash/watermark counts, before → after (`analyzeAIProbabilities()`, the live site's scorer).

### 🎨 Six Voice Modes (`VOICE_MODES` in `js/workbench.js`)

All six share the same pipeline; they differ in the rules below (checked by `tests/regression.mjs`, which asserts every pair of modes gives different output).

| Voice Mode | Transition pool | Em-dash replacement | Bold-bullet cleanup | Contractions |
|------------|-----------------|---------------------|---------------------|--------------|
| **Chat / Everyday** | chat (*Beyond that, Plus, On top of that…*) | `, ` / ` - ` | yes | inserted |
| **Casual & Natural** | casual (*Plus, Still, At the end of the day…*) | `, ` / ` - ` | yes | inserted |
| **Email & Outreach** | email (*Along with that, That said…*) | `, ` / `; ` | yes | inserted |
| **Executive & Pitch** | executive (*Equally important, Bottom line:…*) | `, ` / `; ` | no | inserted |
| **Academic & Formal** | academic (*In parallel, Accordingly, In sum…*) | `, ` / `; ` | no | expanded (*do not, cannot*) |
| **Technical & Direct** | technical (*Separately, Summary:…*) | `, ` / `; ` | no | inserted |

Each mode also starts the alternative rotation at a different offset, and long-sentence connectors differ (*Plus / At the same time* for Chat & Casual, *Meanwhile / In parallel* for the others).

### ✨ Deep Rewrite — bring your own key (`js/humaniser.js` → `deepRewrite()`)

| Provider | Model ID (`DEEP_REWRITE_MODELS`) |
|----------|----------------------------------|
| OpenAI | `gpt-4o-mini` |
| Google Gemini | `gemini-2.5-flash` |
| Anthropic | `claude-haiku-5-5` |
| DeepSeek | `deepseek-chat` |

Requests go straight from your browser to the provider (Anthropic calls send the `anthropic-dangerous-direct-browser-access` header that browser access requires). Your key is stored in `localStorage` only.

### 📊 Dashboard (`js/gauge.js`, `js/highlighter.js`, `app.js`)

- **Animated SVG gauge** — colour-coded score from 0 (AI) to 100 (human)
- **Live stats** — word count, sentences, reading level, passive voice %
- **Pattern highlighting** — detected spans are colour-coded by category behind the input text
- **Category legend** — count of vocabulary, phrase, structure, tone, flow and hedging findings

### 🕐 History (`js/history.js`)

- Last 20 Quick Fix / Deep Rewrite runs saved in `localStorage`
- Shows before → after score for each entry
- Click an entry to restore its input and output

---

## Quick Start

```bash
git clone https://github.com/ModernOps888/humaniser.git
cd humaniser
python -m http.server 3000   # or: npx serve . -l 3000 / php -S localhost:3000
```

Then open [http://localhost:3000](http://localhost:3000). There's no build step and no `npm install`: it's HTML, CSS and ES modules. (ES modules need a server; opening `index.html` via `file://` won't work.)

## Tests

```bash
node tests/regression.mjs
```

Zero-dependency (`node:assert`). It covers: no `(that is` / `(which is` artefacts or leaked `$1`–`$9` on the sample corpus in every mode × depth × variation; `\n\n` paragraph preservation; a/an cases; zero-width character stripping; every voice mode producing non-empty, mutually different output; fenced code, inline code and URLs passing through byte-identical; and README/code agreement on model IDs and voice modes.

---

## How It Works

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Presentation   index.html · index.css · app.js           │
│                js/gauge.js · js/highlighter.js           │
├──────────────────────────────────────────────────────────┤
│ Logic          js/detector.js   analyse() → score/patterns│
│                js/workbench.js  transformHumaniser(),     │
│                                 analyzeAIProbabilities()  │
│                js/humaniser.js  quickFix(), deepRewrite() │
├──────────────────────────────────────────────────────────┤
│ Data           js/patterns.js       detector tables       │
│                js/workbench-data.js Quick Fix tables      │
│                js/history.js        localStorage history  │
└──────────────────────────────────────────────────────────┘
```

### Scoring (`analyse()` in `js/detector.js`)

- Starts at **100**
- Each detected pattern subtracts `severity × category_weight`
- **Diminishing returns** within a category (100%, 80%, 60% … floor 20%)
- **Bonuses**: +5 if contraction rate > 50%, +5 if sentence-length CV > 0.4

| Category | Weight |
|----------|--------|
| Vocabulary | 1.5× |
| AI Phrases | 2.5× |
| Structure | 2.0× |
| Tone | 1.0× |
| Flow | 1.5× |
| Hedging | 1.5× |

> [!IMPORTANT]
> The score is Humaniser's own heuristic. It is **not** an external AI detector, and a high score doesn't mean third-party detectors will pass the text.

---

## Example

Input: the three-paragraph sample corpus in `tests/regression.mjs`. Output from Quick Fix, **Chat / Everyday**, Balanced, Variation v1:

> In today's technological field, artificial intelligence has emerged as a truly revolutionary force that's at core reshaping how organizations operate. Make sure to understand that applying these new innovations requires a thorough and end-to-end approach. The frictionless integration of machine learning into existing workflows highlights the creative spirit that drives modern enterprises forward.
>
> Along with that, note that the many-sided nature of this life-changing technology shows the need for careful planning and reliable system. Stakeholders must manage the detailed challenges that arise when embarking on such never before seen endeavors. The key role of data can't be overstated, it's the basis upon which all meaningful insights are built.
>
> On top of that, organizations that make use of the full potential of artificial intelligence are poised to gain a significant competitive advantage. This pioneering pattern shift has the potential to remake everything from customer engagement to operational efficiency. Taken together, you should build a culture of continuous learning and adaptability to help thrive in this ever-changing space of technological advancement. Without a doubt, the future belongs to those who embrace innovation completely.

`analyse()` score: **11 → 75**. It's rule-based, so expect rough spots: here *"paradigm shift"* became *"pattern shift"*, *"robust infrastructure"* became *"reliable system"*, and an em-dash became a comma splice. Read the output before you use it.

---

## File Structure

```
humaniser/
├── index.html            # App shell: dashboard, options strip, editor panels, modals
├── index.css             # Design system: light/dark themes, responsive layout
├── app.js                # Controller: events, state, Quick Fix / Deep Rewrite orchestration
├── js/
│   ├── workbench.js      # Quick Fix engine (port of the live workbench) + site scorer
│   ├── workbench-data.js # 308 AI words, 93 phrases, contraction maps (from the site)
│   ├── humaniser.js      # quickFix() wrapper + deepRewrite() providers
│   ├── detector.js       # analyse(): 10 checks, weighted score
│   ├── patterns.js       # Detector tables (words, phrases, transitions, hedges, fillers)
│   ├── history.js        # localStorage history (20 entries)
│   ├── gauge.js          # Animated SVG score gauge
│   └── highlighter.js    # Category-coloured highlighting of detected patterns
├── tests/
│   └── regression.mjs    # node tests/regression.mjs
├── logo.jpg
├── LICENSE
└── README.md
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Enter` | Analyse |
| `Ctrl + Shift + Enter` | Quick Fix |
| `Escape` | Close modals/panels |

---

## Browser Support

Needs ES modules, top-level `await` and RegExp lookbehind: Chrome/Edge 89+, Firefox 89+, Safari 16.4+.

---

## Privacy

- **No analytics, no cookies.** The page does load web fonts from Google Fonts.
- **Quick Fix and Analyse run 100% client-side** and make no network requests.
- **API keys** are stored in your browser's `localStorage` and only sent to the provider you choose.
- **Deep Rewrite** sends your text to OpenAI, Google, Anthropic or DeepSeek only when you click it, using your key.

---

## Contributing

Contributions are welcome! Some ideas:

- Add patterns to `js/workbench-data.js` (Quick Fix) or `js/patterns.js` (detector)
- Add cases to `tests/regression.mjs`
- Add browser extension support
- Add more LLM providers to Deep Rewrite

---

## License

MIT — do whatever you want with it.

---

<p align="center">
  <strong>Humaniser</strong> — Your text, your voice.<br/>
  Built with vanilla HTML, CSS, and JavaScript. No frameworks. No build tools.
</p>
