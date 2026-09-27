<p align="center">
  <img src="logo.jpg" alt="Humaniser" width="120" />
</p>

<h1 align="center">Humaniser</h1>

<p align="center">
  <strong>Make AI-generated text sound like a real person wrote it.</strong><br/>
  A zero-dependency, privacy-first web app that detects and transforms robotic AI writing patterns into natural, human prose.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/API-optional-blue" alt="API Optional" />
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="MIT License" />
</p>

---

## Why Humaniser?

AI writing tools are everywhere. But they all sound the same — *"In today's fast-paced world, it is crucial to leverage cutting-edge technology..."* — and AI detectors are getting better at flagging this.

Humaniser sits between you and your audience. Paste any text, and it instantly detects 180+ AI writing patterns, scores how robotic it sounds, and transforms it into something a real person would actually write.

**No account. No server. No data leaves your browser** (unless you opt into Deep Rewrite with your own API key).

---

## Features

### 🔍 Detection Engine (10-Pass Analysis)

| Pass | What It Detects | Example |
|------|----------------|---------|
| **Vocabulary** | 180+ AI-overused words | *delve, crucial, leverage, utilize, landscape, paradigm* |
| **Phrases** | 80+ cliché AI phrases | *"In today's fast-paced world", "It is worth noting that"* |
| **Transitions** | Overused sentence starters | *However, Moreover, Furthermore, Additionally* |
| **Contractions** | Missing natural contractions | *"do not" → "don't", "it is" → "it's"* |
| **Hedging** | Excessive qualifying language | *"It is important to note that", "one could argue"* |
| **Fillers** | Redundant sentence starters | *"That being said,", "Simply put,"* |
| **Structure** | Repetitive sentence openers | 3+ sentences starting with the same word |
| **Uniformity** | AI-like sentence length patterns | Coefficient of variation < 0.3 |
| **Passive Voice** | Excessive passive construction | *"was implemented" → "we implemented"* |
| **Em-dashes** | Overuse of dashes | More than 2 per 500 words |

### ⚡ Quick Fix (No API Required)

A 10-pass transformation pipeline that runs entirely in your browser:

1. **Filler Removal** — Strips hedging phrases and redundant starters
2. **Phrase Simplification** — 67+ wordy constructions simplified (*"in order to" → "to"*, *"due to the fact that" → "because"*)
3. **Vocabulary Swap** — Replaces AI buzzwords with natural alternatives, with deduplication to avoid repetition
4. **Contraction Insertion** — Adds natural contractions based on writing style
5. **Transition Replacement** — Swaps robotic transitions with natural connectors
6. **Sentence Restructuring** — 21 patterns that transform AI sentence constructions
7. **Starter Variation** — Breaks up repetitive sentence beginnings
8. **Length Variation** — Splits overly long sentences at natural break points
9. **Natural Imperfections** — Adds subtle human touches (dashes, parentheticals)
10. **Final Cleanup** — Fixes spacing, capitalisation, and punctuation

### ✨ Deep Rewrite (Multi-Provider AI API)

Bring your own API key for context-aware rewriting across 4 major frontier and open model providers:
- **OpenAI** (`gpt-4o-mini`)
- **Google Gemini** (`gemini-2.5-flash`)
- **Anthropic** (`claude-3-5-haiku`)
- **DeepSeek** (`deepseek-chat` / DeepSeek-V3)

Your keys stay in your browser's `localStorage` only — never sent to any intermediary server, only directly to the chosen AI provider.

### 🎨 Four Writing Styles

| Style | Contractions | Vocabulary | Tone |
|-------|-------------|-----------|------|
| **Casual** | Aggressive (90%) | Most informal alternatives | Relaxed, direct |
| **Conversational** | Aggressive (90%) | Natural-sounding picks | Engaging, warm |
| **Professional** | Moderate (60%) | Balanced alternatives | Clean, confident |
| **Academic** | Minimal (20%) | Formal but natural | Precise, measured |

### 📊 Real-Time Dashboard

- **Animated SVG gauge** — colour-coded score from 0 (AI) to 100 (Human)
- **Live stats** — word count, sentences, reading level, passive voice %
- **Pattern highlighting** — inline marks with hover tooltips showing what was detected
- **Category breakdown** — see exactly how many vocabulary, phrase, structure issues found

### 🕐 History & Privacy

- Last 20 analyses saved in localStorage
- Compare before/after scores
- One-click restore of any previous text
- **Everything stays on your machine**

---

## Quick Start

### Option 1: Just Open It

```bash
# Clone and serve
git clone https://github.com/ModernOps888/humaniser.git
cd humaniser
npx serve . -l 3000
```

Then open [http://localhost:3000](http://localhost:3000)

### Option 2: Any Static Server

Drop the files on any web server. No build step, no npm install, no bundler. It's just HTML, CSS, and ES modules.

```bash
# Python
python -m http.server 3000

# PHP
php -S localhost:3000

# Or just drag index.html into your browser
# (Note: ES modules require a server, file:// won't work)
```

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Presentation Layer                  │
│  index.html  │  index.css  │  app.js                │
│  gauge.js    │  highlighter.js                       │
├─────────────────────────────────────────────────────┤
│                 Business Logic Layer                 │
│  detector.js (10-pass analysis engine)              │
│  humaniser.js (10-pass transformation pipeline)     │
├─────────────────────────────────────────────────────┤
│                    Data Layer                        │
│  patterns.js (180+ words, 80+ phrases, 67 rewrites) │
│  history.js (localStorage CRUD)                     │
└─────────────────────────────────────────────────────┘
```

### Scoring Algorithm

- Starts at **100** (perfect human score)
- Each detected pattern subtracts: `severity × category_weight`
- **Diminishing returns**: repeated patterns in the same category have progressively less impact
- **Bonus points**: +5 for natural contraction use, +5 for varied sentence length
- Calibrated so typical ChatGPT output scores **15–30** and well-written human text scores **75–95**

### Detection Categories

| Category | Weight | Colour |
|----------|--------|--------|
| Vocabulary | 1.5× | 🔴 Terracotta |
| AI Phrases | 2.5× | 🟣 Purple |
| Structure | 2.0× | 🔵 Blue |
| Tone | 1.0× | 🟠 Orange |
| Flow | 1.5× | 🟢 Teal |
| Hedging | 1.5× | 🟡 Amber |

---

## Example

**Before** (Score: 14/100)
> In today's fast-paced world, it is crucial to leverage cutting-edge technology in order to facilitate seamless digital transformation. Furthermore, organizations must navigate the ever-evolving landscape of innovation. It is important to note that a comprehensive, holistic approach is paramount.

**After Quick Fix** (Score: 72/100)
> In today's fast-paced world, it's important to use the latest technology to help with smooth digital transformation. Also, organizations must handle the ever-evolving field of innovation. It's important to note that a complete, whole approach is essential.

**35 changes** applied across 5 passes — no API call needed.

---

## File Structure

```
humaniser/
├── index.html          # App shell — semantic HTML, inline SVG icons, modals
├── index.css           # Design system — 2 themes, responsive, animations
├── app.js              # Controller — events, state, orchestration
├── js/
│   ├── patterns.js     # 180+ AI words, 80+ phrases, 67 phrase rewrites
│   ├── detector.js     # 10-pass analysis engine with weighted scoring
│   ├── humaniser.js    # 10-pass transformation pipeline
│   ├── history.js      # localStorage history CRUD
│   ├── gauge.js        # Animated SVG semicircular score gauge
│   └── highlighter.js  # Inline pattern highlighting with tooltips
├── logo.jpg
├── LICENSE
└── README.md
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Enter` | Run Quick Fix |
| `Ctrl + Shift + Enter` | Run Deep Rewrite |
| `Escape` | Close modals/panels |

---

## Browser Support

Works in all modern browsers that support ES modules:
- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 16+

---

## Privacy

- **Zero tracking** — no analytics, no cookies, no fingerprinting
- **Zero network requests** — Quick Fix runs 100% client-side
- **API keys stored locally** — in your browser's localStorage, never transmitted elsewhere
- **Deep Rewrite** — only sends text to OpenAI/Gemini if you explicitly choose to, using YOUR API key

---

## Contributing

Contributions are welcome! Some ideas:

- Add more AI patterns to `patterns.js`
- Improve sentence restructuring rules
- Add new writing styles
- Add browser extension support
- Add more LLM providers to Deep Rewrite

---

## License

MIT — do whatever you want with it.

---

<p align="center">
  <strong>Humaniser</strong> — Your text, your voice.<br/>
  Built with vanilla HTML, CSS, and JavaScript. No frameworks. No build tools. No nonsense.
</p>
