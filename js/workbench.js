/**
 * Workbench engine v2.5 — vanilla-JS port of the live Humaniser v2.5 workbench
 * (https://infinitytechstack.uk/humaniser, Next.js source src/app/humaniser/page.tsx).
 *
 * Ported functions (same algorithm, same stage order, same data tables):
 *   protectBlocks / restoreBlocks, buildPhraseRegex, matchCase, pickUniqueAlternative,
 *   fixEnglishArticlesAndGrammar, applyEnglishDialect, isAbbreviationBoundary,
 *   splitSentencesSafely, capitalizeSentenceStartsSafely, conjugateParticipleToPresent3rd,
 *   conjugateParticipleToInfinitive, transformHumaniser, analyzeAIProbabilities,
 *   highlightChangedTerms, computeWordLevelDiff, analyzeSentenceHeatmap,
 *   computeReadabilityAndDetectors.
 *
 * Deliberate deviations / safeguards covered by tests/regression.mjs:
 *   1. Stage 3 / Stage 7 templates containing `$1`/`$3` back-references are expanded
 *      explicitly (expandTemplate) inside replacer functions so literal "$3" never leaks.
 *   2. restoreBlocks restores in reverse index order using a replacer function callback
 *      so code or LaTeX containing `$&`, `$$`, `$1`, `$'` is restored byte-identical.
 *   3. a/an healer: "URL", "URI", "UUID" take "a" ("an URL" -> "a URL"), vowel-sound
 *      acronyms after "a" are corrected ("a LLM" -> "an LLM"), "an" + numeral is left
 *      alone ("an 8-hour shift", "an 11-step plan"), and "euphoria" is handled cleanly.
 *   4. Stage 7 sentence splitter only capitalises the next word when the connector ends
 *      with a full stop.
 *   5. analyzeAIProbabilities looks words up with Object.prototype.hasOwnProperty.call,
 *      so words such as "constructor" or "toString" never resolve to Object.prototype.
 *   6. CLAUSE_EM_DASH_REGEX uses horizontal whitespace ([ \t]) so poetic verse stanzas
 *      or bullet lines ending in an em-dash never lose their \n line breaks.
 */

import {
  AI_WORDS_MAP,
  PHRASE_REPLACEMENTS,
  ACADEMIC_AI_OVERRIDES,
  ACADEMIC_METHODOLOGY_TERMS,
  CONTEXTUAL_COLLOCATION_SHIELD,
  CONTRACTION_MAP,
  REVERSE_CONTRACTION_MAP,
  US_TO_UK_SPELLING,
  SCHOLARLY_ABBREVIATIONS,
} from './workbench-data.js';

/** The six voice modes of the live workbench (PRESETS in page.tsx). */
export const VOICE_MODES = [
  {
    id: 'chat',
    label: 'Chat / Everyday',
    desc: "Strips ChatGPT wrappers ('Certainly!'), em-dashes & stiff transitions for natural chat/paste",
  },
  {
    id: 'casual',
    label: 'Casual & Natural',
    desc: 'Conversational cadence, active voice, natural contractions enabled',
  },
  {
    id: 'email',
    label: 'Email & Outreach',
    desc: "Warm, direct human messages without 'I hope this email finds you well'",
  },
  {
    id: 'executive',
    label: 'Executive & Pitch',
    desc: 'Direct, punchy business tone, zero fluff, high signal',
  },
  {
    id: 'academic',
    label: 'Academic & Formal',
    desc: 'Scholarly register, protects APA/IEEE citations & page ranges (pp. 142–158), zero colloquialisms',
  },
  {
    id: 'technical',
    label: 'Technical & Direct',
    desc: 'Crisp engineering writing, zero buzzwords, preserves ```code``` & URLs',
  },
];

export const INTENSITIES = ['light', 'balanced', 'deep'];

/** Interactive sample presets matching the live workbench at https://infinitytechstack.uk/humaniser */
export const PRESETS = [
  {
    name: 'Chat / Everyday',
    badge: 'MOST POPULAR',
    style: 'chat',
    sample:
      "Certainly! Here is a comprehensive multi-paragraph breakdown for your team:\n\nIn today's fast-paced world, it is worth noting that our deployment pipeline plays a pivotal role in engineering velocity — ensuring that every release is seamless. It is not just about speed, it is about building a robust foundation that empowers developers across the entire organization.\n\nFurthermore, we must leverage automated testing to delve into complex edge cases before they impact production. By utilizing continuous integration workflows, teams can streamline code reviews, mitigate regressions, and foster a culture of unwavering reliability.\n\nMoreover, when it comes to observability, having a holistic view of system metrics acts as a catalyst for rapid incident resolution. In conclusion, these interconnected practices serve as a testament to modern engineering excellence.\n\nLet me know if you'd like any further adjustments!",
  },
  {
    name: 'Casual & Natural',
    badge: 'GENERAL',
    style: 'casual',
    sample:
      'In conclusion, it is worth noting that artificial intelligence plays a vital role in modern software development. Furthermore, developers must leverage cutting-edge tools to delve into complex codebases seamlessly. This is a testament to technological progress.',
  },
  {
    name: 'Email & Outreach',
    badge: 'WORK & DMs',
    style: 'email',
    sample:
      'I hope this email finds you well. I wanted to reach out and shed light on how our team can streamline your onboarding workflow. Moreover, by leveraging our comprehensive platform, you can unlock significant time savings across a wide range of tasks.',
  },
  {
    name: 'Executive & Pitch',
    badge: 'BUSINESS',
    style: 'executive',
    sample:
      'Moreover, leveraging state-of-the-art cloud infrastructure underscores the importance of scalability. It is important to remember that harnessing the power of automation acts as a game-changer for enterprise velocity.',
  },
  {
    name: 'Academic & Formal',
    badge: 'ESSAYS & RESEARCH',
    style: 'academic',
    sample:
      'In the contemporary academic landscape, a growing body of literature suggests that the rich tapestry of neural architecture design serves as a pivotal role in computational efficiency (Vaswani et al., 2017, pp. 142–158). This essay will delve into transformer mechanics — thereby reducing memory bottlenecks and amplifying long-context recall across multi-modal benchmarks [1–3].\n\nFurthermore, it is widely acknowledged that sparse mixture-of-experts models play an instrumental role in scaling parameter capacity without commensurate latency penalties (Fedus et al., 2022; Jiang et al., 2024). By utilizing dynamic routing gates, researchers can streamline token allocation, mitigate representational collapse, and foster a holistic understanding of emergent reasoning.\n\nMoreover, when examining alignment through the lens of epistemic verification, prior work sheds new light on how post-training calibration undermines sycophantic drift (cf. Section 4.2, e.g. reward modelling vs. direct preference optimization). In conclusion, these empirical findings serve as a testament to architectural efficiency and pave the way for future research.',
  },
  {
    name: 'Technical & Direct',
    badge: 'DOCS & CODE',
    style: 'technical',
    sample:
      'It is worth noting that compiling CUDA kernels seamlessly reduces latency. Furthermore, developers must leverage `torch.compile()` to maximize hardware throughput across `https://infinitytechstack.uk`.',
  },
];

// ── Punctuation-safe phrase regex builder (handles trailing commas/colons where \b fails) ──
export function buildPhraseRegex(phrase, flags = 'gi') {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWithWord = /^\w/.test(phrase);
  const endsWithWord = /\w$/.test(phrase);
  const prefix = startsWithWord ? '\\b' : "(?:^|(?<=\\s|[([{\"']))";
  const suffix = endsWithWord ? '\\b' : "(?=\\s|[.!?;:)\\]}\"']|$)";
  return new RegExp(`${prefix}${escaped}${suffix}`, flags);
}

// ── Code block, URL, LaTeX, Academic Citation & Semantic Collocation Shield ──
export function protectBlocks(text, protectAcademicCitations = true) {
  const blocks = [];
  let processedText = text;
  let index = 0;

  const stash = (match) => {
    const placeholder = `__PROTECTED_BLOCK_${index}__`;
    blocks[index++] = match;
    return placeholder;
  };

  // 0. Escape any literal placeholder tokens already present in user input to prevent sentinel collision
  processedText = processedText.replace(/__PROTECTED_BLOCK_\d+__/g, stash);

  // 1. Fenced Markdown code blocks
  processedText = processedText.replace(/```[\s\S]*?```/g, stash);

  // 2. Inline Markdown code spans
  processedText = processedText.replace(/`[^`\n]*`/g, stash);

  // 3. LaTeX Display & Inline Math ($$...$$, \[...\], \(...\), $...$) — currency-safe ($20 ... $50 never mistaken for math)
  processedText = processedText.replace(/\$\$[\s\S]*?\$\$/g, stash);
  processedText = processedText.replace(/\\\[[\s\S]*?\\\]/g, stash);
  processedText = processedText.replace(/\\\([\s\S]*?\\\)/g, stash);
  processedText = processedText.replace(
    /(?<![\\$A-Za-z0-9])\$(?!\s)(?![0-9]+(?:[.,][0-9]+)*(?:[kmbKMB]|bn)?(?:[\s).,;:!?—–/-]|$))[^$\n]{1,120}?(?<!\s)\$(?![0-9$A-Za-z])/g,
    stash
  );

  // 4. URLs, DOIs & arXiv identifiers
  processedText = processedText.replace(/https?:\/\/[^\s)]+/g, stash);
  processedText = processedText.replace(/\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gi, stash);
  processedText = processedText.replace(/\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\b/gi, stash);

  // 5. Academic Citations & Verbatim Attributed Quotations (APA, Harvard, MLA, Chicago, IEEE, Nature) — ReDoS-bounded
  if (protectAcademicCitations) {
    // Direct quote immediately followed by an academic citation: "..." (Author, 2024, p. 12) or "..." [12]
    processedText = processedText.replace(
      /"[^"\n]{8,280}"[ \t]*(?:\([A-Z][A-Za-z'’\s&.,;–-]{0,140}\b(?:18|19|20)\d{2}[a-z]?[^)\n]{0,80}\)|\[\d+(?:[ \t]*[,–-][ \t]*\d+)*\])/g,
      stash
    );
    // Parenthetical author-year / page citations: (Vaswani et al., 2017; Smith & Jones, 2024, pp. 142–158) or (p. 42) or (pp. 12–19)
    processedText = processedText.replace(
      /\([ \t]*(?:(?:see|cf\.|e\.g\.|i\.e\.)[,\s]+)?[A-Z][A-Za-z'’\s&.,;–-]{0,140}\b(?:18|19|20)\d{2}[a-z]?(?:[,;:\s]+(?:p|pp|vol|no|ch|sec|fig)s?\.?[ \t]*\d[\d–-]*)*[ \t]*\)/g,
      stash
    );
    processedText = processedText.replace(/\((?:p|pp|vol|no|ch|sec|fig|eq)s?\.\s*\d+(?:[–-]\d+)?\)/gi, stash);
    // IEEE / Vancouver bracketed numeric citations: [1], [12, 15], [3–7]
    processedText = processedText.replace(/\[\d+(?:[ \t]*[,–-][ \t]*\d+)*\]/g, stash);
  }

  // 6. Context-Aware Semantic Collocation Shield: protect literal technical/scientific/legal compound terms
  // so domain words ("loss landscape", "financial leverage", "platinum catalyst", "Bayeux tapestry", "Last Will and Testament",
  // "Peer of the Realm", "Bluetooth beacon", "test harness", "electromagnetic spectrum", "orbital trajectory", "anchor tenant")
  // are NEVER replaced with out-of-context synonyms!
  for (const collocationRegex of CONTEXTUAL_COLLOCATION_SHIELD) {
    processedText = processedText.replace(collocationRegex, stash);
  }

  return { text: processedText, blocks };
}

export function restoreBlocks(text, blocks) {
  let restoredText = text;
  // Restore in reverse order using a function callback so $$ or $& inside LaTeX/code is never corrupted by String.replace
  for (let i = blocks.length - 1; i >= 0; i--) {
    restoredText = restoredText.replace(`__PROTECTED_BLOCK_${i}__`, () => blocks[i]);
  }
  return restoredText;
}

// ── Abbreviation-safe sentence boundary helpers ──
export function isAbbreviationBoundary(prefixText) {
  const m = prefixText.match(/([A-Za-z.]+)\.[ \t]*$/);
  if (!m) return false;
  const token = m[1].toLowerCase().replace(/^\.+|\.+$/g, '');
  if (SCHOLARLY_ABBREVIATIONS.has(token)) return true;
  if (/^[a-z]$/i.test(token) && /[A-Z]\.[ \t]*$/.test(prefixText)) return true;
  return false;
}

export function splitSentencesSafely(text) {
  const rawParts = text.split(/(?<=[.!?])[ \t]+/);
  const merged = [];
  for (const part of rawParts) {
    if (!part.trim()) continue;
    if (merged.length > 0 && isAbbreviationBoundary(merged[merged.length - 1])) {
      merged[merged.length - 1] += ' ' + part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

export function capitalizeSentenceStartsSafely(text) {
  return text.replace(/(^\s*|\n\s*|[.!?][ \t]+)([a-z])/g, (match, p1, p2, offset, fullStr) => {
    if (p1.includes('.') && offset >= 0) {
      const lookback = fullStr.slice(Math.max(0, offset - 18), offset + p1.length);
      if (isAbbreviationBoundary(lookback)) {
        return match;
      }
    }
    return p1 + p2.toUpperCase();
  });
}

// Clause-level AI em-dash matcher: matches em-dashes (—), spaced en-dashes ( – ), or spaced double-hyphens ( -- )
// Uses horizontal whitespace [ \t] so verse/poetry or bullet lines ending in — never lose their \n line break!
// NEVER matches unspaced en-dashes inside numeric ranges (2020–2026, pp. 142–158, 10–15%) or compound names (Navier–Stokes)
export const CLAUSE_EM_DASH_REGEX = /[ \t]*—[ \t]*|[ \t]+–[ \t]+|[ \t]+--[ \t]+/g;

/** Expand `$1`..`$9` in a template using regex capture groups (deviation 1). */
function expandTemplate(template, groups) {
  return template.replace(/\$(\d)/g, (_, n) => (groups[Number(n) - 1] ?? ''));
}

// ── Detector (site's analyzeAIProbabilities v2.5) ──
export function analyzeAIProbabilities(text, style = 'chat', protectAcademicCitations = true, intensity = 'balanced') {
  if (!text || !text.trim()) {
    return {
      rawAIScore: 0,
      humanScore: 100,
      totalWords: 0,
      charCount: 0,
      readingTimeSec: 0,
      detectedPatterns: [],
      sentenceCount: 0,
      burstinessCV: '0.00',
      emDashCount: 0,
      watermarkChars: 0,
      protectedBlocksCount: 0,
      avgSentenceWords: 0,
      lexicalDiversityTTR: 100,
      anaphoraCount: 0,
    };
  }

  const watermarkMatches = text.match(/[\u200B\u200C\u200D\uFEFF\u2060\u00A0]/g) || [];
  const { text: cleanText, blocks } = protectBlocks(text, protectAcademicCitations);
  const emDashMatches = cleanText.match(CLAUSE_EM_DASH_REGEX) || [];

  const words = cleanText.match(/\b[a-zA-Z'-]+\b/g) || [];
  const validWords = words.filter((w) => !w.startsWith('__PROTECTED'));
  const totalWords = validWords.length || 1;
  const charCount = text.length;
  const readingTimeSec = Math.max(1, Math.round((totalWords / 220) * 60));

  let patternScore = 0;
  const detectedPatterns = [];

  const structuralChecks = [
    {
      regex: /\b(it is|it's|this is|this isn't|is) not (just|merely|only) (about )?([^,;—.\n!?]{1,90})[,;—]+\s*(it is|it's|but rather|but)\s+/gi,
      label: "AI 'Not Just X, It's Y' Contrast",
      replacement: 'More than $4, this is ',
      severity: 5,
    },
    {
      regex: /^(certainly|sure|of course|absolutely|great question)[!,.]?\s+(here is|here's|below is|i have|i've)[^\n.]*[.:]\s*/i,
      label: 'ChatGPT/Claude Chat Preamble',
      replacement: '[Stripped Chat Wrapper]',
      severity: 5,
    },
    {
      regex: /\b(let me know if you('d| would) like|feel free to ask if|hope this helps|if you need any further adjustments)[^\n]*$/i,
      label: 'ChatGPT/Claude Sign-off Prompt',
      replacement: '[Stripped Chat Sign-off]',
      severity: 4,
    },
  ];

  structuralChecks.forEach((chk, idx) => {
    const m = cleanText.match(chk.regex);
    if (m) {
      patternScore += chk.severity * 8;
      detectedPatterns.push({
        id: `struct-${idx}`,
        category: 'AI Structure',
        severity: chk.severity,
        matchedText: m[0].slice(0, 42) + (m[0].length > 42 ? '…' : ''),
        message: chk.label,
        replacement: chk.replacement,
      });
    }
  });

  if (emDashMatches.length >= 2) {
    patternScore += emDashMatches.length * 6;
    detectedPatterns.push({
      id: 'em-dash-overuse',
      category: 'Punctuation Tell',
      severity: 4,
      matchedText: `${emDashMatches.length}× Em-Dashes (—)`,
      message: 'Excessive AI em-dash punctuation',
      replacement: 'Natural commas / semicolons',
    });
  }

  PHRASE_REPLACEMENTS.forEach((item, idx) => {
    const regex = buildPhraseRegex(item.phrase, 'gi');
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      patternScore += item.severity * 6;
      detectedPatterns.push({
        id: `phrase-${idx}-${match.index}`,
        category: 'Cliché Phrase',
        severity: item.severity,
        matchedText: match[0],
        message: `AI telltale phrase '${match[0]}'`,
        replacement: item.alternatives[0] || '[removed]',
      });
    }
  });

  const minDetectSeverity = intensity === 'light' ? 4 : intensity === 'balanced' ? 3 : 1;
  validWords.forEach((w, idx) => {
    const lower = w.toLowerCase();
    if ((style === 'academic' || style === 'technical') && ACADEMIC_METHODOLOGY_TERMS.has(lower)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(AI_WORDS_MAP, lower) && AI_WORDS_MAP[lower].severity >= minDetectSeverity) {
      const data = AI_WORDS_MAP[lower];
      patternScore += data.severity * 3;
      const previewAlt =
        style === 'academic' && Object.prototype.hasOwnProperty.call(ACADEMIC_AI_OVERRIDES, lower)
          ? ACADEMIC_AI_OVERRIDES[lower][0]
          : data.alternatives[0];
      if (!detectedPatterns.some((p) => p.matchedText.toLowerCase() === lower)) {
        detectedPatterns.push({
          id: `word-${idx}`,
          category: 'AI Word',
          severity: data.severity,
          matchedText: w,
          message: `Overused AI vocabulary '${w}'`,
          replacement: previewAlt,
        });
      }
    }
  });

  const sentences = cleanText
    .split(/\n+/)
    .flatMap((line) => splitSentencesSafely(line))
    .filter((s) => s.trim().length > 0);
  const sentenceLengths = sentences.map((s) => {
    const sw = s.match(/\b[a-zA-Z'-]+\b/g) || [];
    return sw.filter((w) => !w.startsWith('__PROTECTED')).length;
  });
  const avgLen = sentenceLengths.reduce((a, b) => a + b, 0) / (sentenceLengths.length || 1);
  const variance = sentenceLengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / (sentenceLengths.length || 1);
  const cv = avgLen > 0 ? Math.sqrt(variance) / avgLen : 0;

  // Detect consecutive sentence-starter anaphora ("This...", "This...", "Furthermore...", "Moreover...")
  let anaphoraCount = 0;
  for (let i = 1; i < sentences.length; i++) {
    const prevFirst = (sentences[i - 1].trim().match(/^([A-Za-z']+)/) || [])[1]?.toLowerCase();
    const currFirst = (sentences[i].trim().match(/^([A-Za-z']+)/) || [])[1]?.toLowerCase();
    if (
      prevFirst &&
      currFirst &&
      prevFirst === currFirst &&
      ['this', 'these', 'furthermore', 'moreover', 'additionally', 'consequently', 'however'].includes(currFirst)
    ) {
      anaphoraCount++;
    }
  }

  // Moving-window lexical diversity (TTR %) so 2,000-word essays are evaluated fairly against 100-word snippets
  const windowSize = Math.min(validWords.length, 120);
  let ttrSum = 0;
  let windows = 0;
  if (windowSize > 0) {
    const step = Math.max(1, Math.floor(windowSize / 2));
    for (let start = 0; start <= Math.max(0, validWords.length - windowSize); start += step) {
      const slice = validWords.slice(start, start + windowSize).map((w) => w.toLowerCase());
      const unique = new Set(slice).size;
      ttrSum += (unique / slice.length) * 100;
      windows++;
    }
  }
  const lexicalDiversityTTR = windows > 0 ? Math.round(ttrSum / windows) : 100;

  const targetCV = style === 'academic' || style === 'technical' ? 0.36 : 0.44;
  const burstinessPenalty = sentences.length > 1 ? Math.max(0, (targetCV - Math.min(cv, targetCV)) * 38) : 4;
  const anaphoraPenalty = Math.min(12, anaphoraCount * 3);
  const rawAIScore = Math.min(
    99,
    Math.max(
      0,
      Math.round((patternScore / totalWords) * 112 + burstinessPenalty + anaphoraPenalty + (watermarkMatches.length > 0 ? 8 : 0))
    )
  );
  const humanScore = 100 - rawAIScore;

  return {
    rawAIScore,
    humanScore,
    totalWords: text.trim() ? validWords.length : 0,
    charCount,
    readingTimeSec,
    detectedPatterns,
    sentenceCount: sentences.length,
    burstinessCV: cv.toFixed(2),
    emDashCount: emDashMatches.length,
    watermarkChars: watermarkMatches.length,
    protectedBlocksCount: blocks.length,
    avgSentenceWords: Math.round(avgLen),
    lexicalDiversityTTR,
    anaphoraCount,
  };
}

// ── Transform helpers ──
export function matchCase(source, target) {
  if (!target) return '';
  if (!source) return target;
  if (source === source.toUpperCase() && source.length > 1) {
    return target.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

/** UK (en-GB) <-> US (en-US) Dialect Harmonizer for British vs. American Essays & Copy. */
export function applyEnglishDialect(text, dialect = 'auto') {
  if (dialect === 'auto') return text;
  let out = text;
  for (const [us, uk] of US_TO_UK_SPELLING) {
    const fromWord = dialect === 'uk' ? us : uk;
    const toWord = dialect === 'uk' ? uk : us;
    const re = new RegExp(`\\b${fromWord}\\b`, 'gi');
    if (re.test(out)) {
      out = out.replace(re, (m) => matchCase(m, toWord));
    }
  }
  return out;
}

/** Non-repeating rotation selector (anti-repetition ledger shared across the whole document). */
export function pickUniqueAlternative(alternatives, style, variationSeed, occurrenceIndex, usedSet) {
  const valid = alternatives.filter((a) => a !== undefined);
  if (valid.length === 0) return '';
  const styleOffset =
    style === 'chat'
      ? 2
      : style === 'casual'
      ? 0
      : style === 'email'
      ? 1
      : style === 'executive'
      ? 3
      : style === 'academic'
      ? 1
      : 2;

  const startIdx = (styleOffset + variationSeed + occurrenceIndex) % valid.length;
  for (let offset = 0; offset < valid.length; offset++) {
    const candidate = valid[(startIdx + offset) % valid.length];
    const norm = candidate.trim() ? candidate.trim().toLowerCase().replace(/[.,!?;:]+$/, '') : '__direct_start__';
    if (!usedSet.has(norm)) {
      usedSet.add(norm);
      return candidate;
    }
  }
  return valid[startIdx];
}

// Acronyms pronounced with a leading vowel sound ("an API", "an LLM", "an SQL", "an HTTP").
const VOWEL_SOUND_ACRONYMS =
  /^(?:AI|API|LLM|MCP|SLA|SLO|SDK|SQL|HTML|HTTP|HTTPS|SSR|SEO|AEO|ATS|ROI|SOP|RFP|NDA|IDE|ORM|IAM|AWS|F1|M1|M2|M3|M4|R1|R2)$/;

/** Phonetic English indefinite article ("a" <-> "an") & grammar self-healer. */
export function fixEnglishArticlesAndGrammar(input) {
  // Vowel-letter words with a consonant sound ("yoo" / "w" glide) -> take "a"
  const consonantSoundVowelWords =
    /^(?:user|users|usability|usable|used|useful|usefulness|using|usual|usually|usurp|utensil|utility|utilities|utilize|utilized|utilizing|utilization|utopia|utopian|ubiquitous|ubiquity|unanimous|unanimously|unicorn|uniform|uniformly|unify|unified|unifying|union|unique|uniquely|unison|unit|unite|united|uniting|unity|universal|universally|universe|university|universities|unilateral|url|urls|uri|uris|uuid|uuids|eulogy|euphemism|euphoria|ophoria|europe|european|euro|one|ones|once)(?:$|-)/i;

  // Silent 'h' words -> take "an"
  const vowelSoundHWords =
    /^(?:hour|hours|hourly|honest|honestly|honesty|honor|honors|honorable|honour|honours|honourable|heir|heiress|heirloom|herb|herbal)(?:$|-)/i;

  let out = input;

  // "a" + vowel-sound word -> "an"
  out = out.replace(/\b([Aa])([ \t]+)([a-zA-Z0-9][a-zA-Z0-9-]*)\b/g, (full, article, space, nextWord) => {
    if (nextWord.startsWith('__PROTECTED')) return full;
    const lowerNext = nextWord.toLowerCase();
    const startsWithVowelLetter = /^[aeiou]/i.test(lowerNext);
    const isSilentH = vowelSoundHWords.test(lowerNext);
    const isVowelAcronym = VOWEL_SOUND_ACRONYMS.test(nextWord);
    if ((startsWithVowelLetter && !consonantSoundVowelWords.test(lowerNext)) || isSilentH || isVowelAcronym) {
      return `${article === 'A' ? 'An' : 'an'}${space}${nextWord}`;
    }
    return full;
  });

  // "an" + consonant-sound word -> "a"
  out = out.replace(/\b([Aa]n)([ \t]+)([a-zA-Z0-9][a-zA-Z0-9-]*)\b/g, (full, article, space, nextWord) => {
    if (nextWord.startsWith('__PROTECTED')) return full;
    if (VOWEL_SOUND_ACRONYMS.test(nextWord)) return full;
    const lowerNext = nextWord.toLowerCase();
    if (/^\d/.test(lowerNext)) return full; // "an 8-hour", "an 11" — leave numerals alone
    const startsWithVowelLetter = /^[aeiou]/i.test(lowerNext);
    const isSilentH = vowelSoundHWords.test(lowerNext);
    const needsA = (!startsWithVowelLetter && !isSilentH) || consonantSoundVowelWords.test(lowerNext);
    if (needsA) {
      return `${article[0] === 'A' ? 'A' : 'a'}${space}${nextWord}`;
    }
    return full;
  });

  // Clean up accidental duplicate prepositions or articles caused by adjacent rewrites
  out = out
    .replace(/\b(to|into|of|in|for|with|on|by|from|as|that|the|a|an)[ \t]+\1\b/gi, '$1')
    .replace(/\binto[ \t]+to\b/gi, 'into')
    .replace(/\bas[ \t]+a[ \t]+(proves|shows|demonstrates|reflects|highlights)\b/gi, '$1');

  return out;
}

// ── Morphologically Exact English Present-Participle (-ing) -> 3rd-Person Singular (-s / -es / -ies) & Infinitive Converter ──
export function conjugateParticipleToPresent3rd(ingWord) {
  const lower = ingWord.toLowerCase();
  if (!lower.endsWith('ing') || lower.length <= 4) return ingWord;

  const irregular3rd = {
    being: 'is',
    having: 'has',
    doing: 'does',
    going: 'goes',
    undergoing: 'undergoes',
    foregoing: 'foregoes',
    echoing: 'echoes',
    vetoing: 'vetoes',
    dying: 'dies',
    lying: 'lies',
    tying: 'ties',
    vying: 'vies',
    making: 'makes',
    taking: 'takes',
    giving: 'gives',
    coming: 'comes',
    becoming: 'becomes',
    overcoming: 'overcomes',
    seeing: 'sees',
    overseeing: 'oversees',
    foreseeing: 'foresees',
    agreeing: 'agrees',
    disagreeing: 'disagrees',
    freeing: 'frees',
    fleeing: 'flees',
    guaranteeing: 'guarantees',
    ageing: 'ages',
    eyeing: 'eyes',
    singeing: 'singes',
    tingeing: 'tinges',
    dyeing: 'dyes',
    gluing: 'glues',
    suing: 'sues',
    pursuing: 'pursues',
    ensuing: 'ensues',
    issuing: 'issues',
    valuing: 'values',
    arguing: 'argues',
    rescuing: 'rescues',
    continuing: 'continues',
    accruing: 'accrues',
    construing: 'construes',
    subduing: 'subdues',
    imbuing: 'imbues',
    queueing: 'queues',
    queuing: 'queues',
    creating: 'creates',
    recreating: 'recreates',
    procreating: 'procreates',
    delineating: 'delineates',
    permeating: 'permeates',
  };
  if (Object.prototype.hasOwnProperty.call(irregular3rd, lower)) return irregular3rd[lower];

  const stem = lower.slice(0, -3);

  if (/(?:creat|delineat|permeat|nucleat|nauseat)$/.test(stem)) {
    return stem + 'es';
  }

  if (stem.endsWith('y') && stem.length >= 2 && !/[aeiou]y$/.test(stem)) {
    return stem.slice(0, -1) + 'ies';
  }

  if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem) && !/[lsz]$/.test(stem)) {
    return stem.slice(0, -1) + 's';
  }
  if (
    /^(compel|propel|excel|repel|expel|impel|dispel|control|patrol|enrol|extol|instil|distil|fulfil|appal|instal|annul|cancel|model|label|travel|level|channel|tunnel|signal|equal|rival|marshal|pedal|total|spiral|quarrel|fuel|duel|dial)l$/.test(
      stem
    )
  ) {
    return stem.slice(0, -1) + 's';
  }

  if (/(?:ss|sh|ch|x|zz)$/.test(stem)) {
    return stem + 'es';
  }

  if (/[cgvz]$/.test(stem)) {
    return stem + 'es';
  }
  if (/[^aeiou]l$/.test(stem) && !/ll$/.test(stem)) {
    return stem + 'es';
  }
  if (/^(rul|scal|schedul|profil|compil|fil|smil|styl|til|pil|mil|exil|reconcil|whil|consol|isol|viol|pol|rol|mol|hol|sol|stol|whol)$/.test(stem)) {
    return stem + 'es';
  }

  const noSilentEExceptions =
    /(?:develop|consider|deliver|discover|recover|uncover|cover|hover|lower|power|empower|overpower|tower|flower|shower|cower|trigger|foster|bolster|master|cluster|bluster|muster|luster|fluster|register|administer|minister|sinister|banister|canister|cloister|roister|encounter|counter|center|enter|reenter|render|surrender|tender|slender|gender|fender|bender|lender|sender|vendor|splendor|wander|squander|ponder|wonder|yonder|thunder|plunder|blunder|sunder|under|hinder|cinder|tinder|finder|binder|grinder|reminder|cylinder|order|border|disorder|recorder|warder|murder|girder|herder|offer|suffer|differ|prefer|refer|confer|transfer|infer|defer|pilfer|proffer|coffer|buffer|duffer|puffer|cater|water|alter|falter|palter|halter|psalter|filter|kilter|philter|shelter|welter|swelter|helter|skelter|pelt|shatter|scatter|matter|batter|chatter|flatter|platter|smatter|spatter|tatter|clatter|patter|hatter|natter|latter|clutter|flutter|mutter|stutter|utter|butter|cutter|gutter|putter|shutter|splutter|sputter|gather|lather|rather|father|weather|feather|leather|heather|tether|wether|together|altogether|bother|mother|smother|brother|other|another|further|strengthen|lengthen|shorten|heighten|lighten|tighten|brighten|frighten|straighten|broaden|widen|deepen|steepen|cheapen|sharpen|ripen|waken|awaken|weaken|shaken|taken|token|betoken|liken|darken|harken|hearken|thicken|sicken|quicken|blacken|slacken|soften|fasten|hasten|chasten|listen|glisten|christen|moisten|happen|open|reopen|pen|garden|burden|overburden|warden|harden|pardon|cordon|abandon|reckon|beckon|iron|environ|apron|patron|matron|citron|positron|neutron|proton|electron|photon|phonon|boson|fermion|lepton|hadron|baryon|meson|gluon|graviton|button|unbutton|glutton|mutton|cotton|bottom|blossom|bosom|custom|accustom|fathom|symptom|phantom|atom|idiom|axiom|theorem|problem|emblem|system|ecosystem|subsystem|item|totem|modem|tandem|random|freedom|wisdom|kingdom|boredom|martyrdom|stardom|seldom|venom|groom|bloom|boom|doom|gloom|loom|room|broom|mushroom|zoom|limit|visit|audit|edit|credit|exhibit|prohibit|inhibit|inhabit|orbit|profit|benefit|merit|inherit|deposit|elicit|solicit|recruit|suit)$/;

  if (
    /(?:iz|is|at|ur|ir|or|ar|er|ul|il|el|al|ol|id|od|ud|ad|ed|ak|ek|ik|ok|uk|am|em|im|om|um|an|en|in|on|un|ap|ep|ip|op|up|as|es|os|us|av|ev|iv|ov|uv)$/.test(
      stem
    )
  ) {
    if (/[aeiou]{2}[bcdfghjklmnpqrstvwxz]$/.test(stem)) {
      return stem + 's';
    }
    if (/[^aeiou]{2}$/.test(stem)) {
      if (/(?:[bpcdfgkzt]l|rg|ng|lg|dg|nc|rc|lv|rv|past|wast|tast|hast|bast|chast)$/.test(stem)) {
        return stem + 'es';
      }
      return stem + 's';
    }
    if (!noSilentEExceptions.test(stem)) {
      return stem + 'es';
    }
  }

  return stem + 's';
}

export function conjugateParticipleToInfinitive(ingWord) {
  const third = conjugateParticipleToPresent3rd(ingWord);
  if (third === 'is') return 'be';
  if (third === 'has') return 'have';
  if (third === 'does') return 'do';
  if (third === 'goes') return 'go';
  if (third === 'undergoes') return 'undergo';
  if (third.endsWith('ies')) return third.slice(0, -3) + 'y';
  if (third.endsWith('es')) {
    const baseWithoutEs = third.slice(0, -2);
    if (/(?:ss|sh|ch|x|zz|o)$/.test(baseWithoutEs)) return baseWithoutEs;
    return third.slice(0, -1);
  }
  if (third.endsWith('s')) return third.slice(0, -1);
  return ingWord;
}

/**
 * Multi-stage humaniser transform v2.5 (site's transformHumaniser).
 * Accepts either an options object `transformHumaniser(text, opts)` or positional arguments.
 * @param {string} text
 * @param {object|string} [opts]
 * @param {string} [opts.style='chat']            one of VOICE_MODES ids
 * @param {boolean} [opts.useContractions=true]
 * @param {'light'|'balanced'|'deep'} [opts.intensity='balanced']
 * @param {boolean} [opts.stripChatWrappers=true]
 * @param {boolean} [opts.normalizeEmDashes=true]
 * @param {number} [opts.variationSeed=0]          0..3, cycles alternative phrasings
 * @param {boolean} [opts.protectAcademicCitations=true]
 * @param {'auto'|'uk'|'us'} [opts.englishDialect='auto']
 */
export function transformHumaniser(text, opts = {}, ...legacyArgs) {
  const normalizedOpts =
    typeof opts === 'string'
      ? {
          style: opts,
          useContractions: legacyArgs[0] ?? true,
          intensity: legacyArgs[1] ?? 'balanced',
          stripChatWrappers: legacyArgs[2] ?? true,
          normalizeEmDashes: legacyArgs[3] ?? true,
          variationSeed: legacyArgs[4] ?? 0,
          protectAcademicCitations: legacyArgs[5] ?? true,
          englishDialect: legacyArgs[6] ?? 'auto',
        }
      : opts || {};

  const {
    style = 'chat',
    useContractions = true,
    intensity = 'balanced',
    stripChatWrappers = true,
    normalizeEmDashes = true,
    variationSeed = 0,
    protectAcademicCitations = true,
    englishDialect = 'auto',
  } = normalizedOpts;

  if (!text || !text.trim()) {
    return {
      text: '',
      replacementsCount: 0,
      structuresFixed: 0,
      emDashesFixed: 0,
      watermarksStripped: 0,
      changedTerms: [],
      protectedBlocksCount: 0,
    };
  }

  // Stage 1: Strip invisible zero-width watermarks & normalise non-breaking spaces / smart quotes
  const watermarkMatches = text.match(/[\u200B\u200C\u200D\uFEFF\u2060\u00A0]/g) || [];
  const watermarksStripped = watermarkMatches.length;
  const cleanedInput = text
    .replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  const { text: protectedText, blocks } = protectBlocks(cleanedInput, protectAcademicCitations);
  let currentText = protectedText;
  let replacementsCount = 0;
  let structuresFixed = 0;
  let emDashesFixed = 0;
  const changedTerms = [];
  const usedReplacements = new Set();
  let occurrenceCounter = 0;

  // Stage 2: Strip ChatGPT / Claude conversational preambles & sign-offs
  if (stripChatWrappers) {
    const preambleRegex =
      /^\s*(certainly|sure|of course|absolutely|great question|happy to help)[!,.]?\s+(here is|here's|below is|i have|i've)[^\n:]*[:\n]\s*/i;
    if (preambleRegex.test(currentText)) {
      currentText = currentText.replace(preambleRegex, '');
      structuresFixed++;
    }
    const postambleRegex =
      /\n*\s*(let me know if you('d| would) like|feel free to ask if|i hope this helps|hope this helps|if you need any further adjustments|would you like me to)[^\n]*$/i;
    if (postambleRegex.test(currentText)) {
      currentText = currentText.replace(postambleRegex, '');
      structuresFixed++;
    }
    // Robotic bold-colon list starters ("- **Point:** text" -> "- Point — text") in chat/casual/email
    if (style === 'chat' || style === 'casual' || style === 'email') {
      const boldBulletRegex = /^(\s*[-*•]\s+)\*\*([^*]+?)\*\*:\s+/gm;
      if (boldBulletRegex.test(currentText)) {
        currentText = currentText.replace(boldBulletRegex, '$1$2 — ');
        structuresFixed++;
      }
    }
  }

  // Stage 3: Rewrite signature AI syntactic templates ("It's not just X, it's Y", "Not only X, but also Y") — ReDoS-bounded
  const contrastTemplates = [
    {
      regex: /\b(It is|It's|This is|This isn't) not (just|merely|only) about ([^,;—.\n!?]{1,90})[,;—]+\s*(it is|it's|but rather)\s+about\s+/gi,
      repl:
        style === 'academic'
          ? ['Beyond $3, the primary focus is ', 'More than $3, this analysis centers on ', 'Rather than solely $3, the core issue is ']
          : ['Beyond $3, the real focus is ', 'More than $3, this comes down to ', 'Rather than just $3, it centers on '],
    },
    {
      regex: /\b(It is|It's|This is) not (just|merely|only) ([^,;—.\n!?]{1,90})[,;—]+\s*(it is|it's|but rather)\s+/gi,
      repl:
        style === 'academic'
          ? ['More than $3, it is ', 'Beyond $3, this represents ', 'Rather than solely $3, it is ']
          : ['More than $3, it is ', 'Beyond $3, this is ', "Rather than just $3, it's "],
    },
    {
      regex: /\bNot only does ([^,;\n.!?]{1,80}?) ([a-z]+),?[ \t]+but it also ([a-z]+)/gi,
      repl: ['$1 both $2s and $3', '$1 does not merely $2; it also $3', 'In addition to its primary function, $1 also $3'],
    },
    {
      regex: /\bWhether you('re| are) a ([^,;\n.!?]{1,60}?) or a ([^,;\n.!?]{1,60}?),/gi,
      repl: ['For both $2s and $3s,', 'Across $2s and $3s alike,', 'From $2s to $3s,'],
    },
    {
      regex: /\bFrom ([^,;\n.!?]{3,35}) to ([^,;\n.!?]{3,35}),?\s+and everything in between,\s*/gi,
      repl: ['Across both $1 and $2, ', 'Covering $1 through $2, ', 'Spanning $1 and $2, '],
    },
    {
      regex: /\bAt its core,\s+/gi,
      repl: style === 'academic' ? ['Fundamentally, ', 'In essence, ', 'Specifically, '] : ['Basically, ', 'In short, ', 'At heart, '],
    },
  ];

  contrastTemplates.forEach((tpl, idx) => {
    currentText = currentText.replace(tpl.regex, (...args) => {
      structuresFixed++;
      const groups = args.slice(1, -2);
      const template = pickUniqueAlternative(tpl.repl, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
      return expandTemplate(template, groups);
    });
  });

  // Stage 3.5: Discourse & transition orchestrator (runs BEFORE word-level replacement)
  const transitionGroups = [
    {
      regex: /(^|\n\s*|[.!?][ \t]+)(?:Furthermore|Moreover|Additionally|In addition|What is more),\s+/gi,
      pool: {
        chat: ['Beyond that, ', 'Plus, ', '', 'Along with that, ', 'On top of that, ', 'Also, '],
        casual: ['Plus, ', 'Beyond that, ', '', 'Also, ', 'Along with that, ', 'On top of that, '],
        email: ['Along with that, ', 'Beyond that, ', '', 'Plus, ', 'Also, '],
        executive: ['Beyond that, ', '', 'In parallel, ', 'Equally important, ', 'Alongside this, '],
        academic: ['In parallel, ', 'Beyond this, ', '', 'Further, ', 'Alongside this, ', 'Concurrently, '],
        technical: ['In addition, ', '', 'Alongside this, ', 'Separately, ', 'Further, '],
      },
    },
    {
      regex: /(^|\n\s*|[.!?][ \t]+)(?:Consequently|Therefore|Thus|Hence|As a consequence),\s+/gi,
      pool: {
        chat: ['So, ', 'Because of that, ', 'As a result, ', 'That means ', 'In turn, '],
        casual: ['So, ', 'As a result, ', 'Because of this, ', 'That means '],
        email: ['As a result, ', 'Because of this, ', 'So, ', 'That means '],
        executive: ['As a result, ', 'Consequently, ', 'In turn, ', 'This means '],
        academic: ['As a result, ', 'In turn, ', 'Accordingly, ', 'Because of this, ', 'For this reason, '],
        technical: ['As a result, ', 'In turn, ', 'Because of this, ', 'So '],
      },
    },
    {
      regex: /(^|\n\s*|[.!?][ \t]+)(?:However|Nevertheless|Nonetheless|Be that as it may),\s+/gi,
      pool: {
        chat: ['That said, ', 'Still, ', 'Even so, ', 'At the same time, ', 'Yet '],
        casual: ['Still, ', 'That said, ', 'Even so, ', 'Though, '],
        email: ['That said, ', 'Still, ', 'At the same time, '],
        executive: ['That said, ', 'Still, ', 'Even so, ', 'Yet '],
        academic: ['Even so, ', 'Still, ', 'Yet, ', 'By contrast, ', 'At the same time, '],
        technical: ['However, ', 'That said, ', 'Still, ', 'Even so, '],
      },
    },
    {
      regex: /(^|\n\s*|[.!?][ \t]+)(?:In conclusion|To summarize|In summary|All in all|To sum up|Ultimately),\s+/gi,
      pool: {
        chat: ['Overall, ', 'To wrap up, ', 'In short, ', 'Taken together, ', 'Looking at the big picture, '],
        casual: ['Overall, ', 'In short, ', 'To wrap up, ', 'At the end of the day, '],
        email: ['Overall, ', 'In short, ', 'To wrap up, '],
        executive: ['Bottom line: ', 'In short, ', 'Overall, ', 'Taken together, '],
        academic: ['Taken together, ', 'Overall, ', 'In sum, ', 'Collectively, ', 'In synthesis, '],
        technical: ['In short, ', 'Overall, ', 'Taken together, ', 'Summary: '],
      },
    },
  ];

  transitionGroups.forEach((grp, gIdx) => {
    currentText = currentText.replace(grp.regex, (fullMatch, prefix) => {
      structuresFixed++;
      replacementsCount++;
      const choices = grp.pool[style] || grp.pool.casual;
      const chosen = pickUniqueAlternative(choices, style, variationSeed, gIdx + occurrenceCounter++, usedReplacements);
      const term = chosen.trim().replace(/,$/, '');
      if (term && !changedTerms.includes(term)) changedTerms.push(term);
      return `${prefix}${chosen}`;
    });
  });
  currentText = capitalizeSentenceStartsSafely(currentText);

  // Stage 4: Multi-word phrase replacements (per-occurrence anti-repetition rotation & academic register filter)
  PHRASE_REPLACEMENTS.forEach((item, idx) => {
    const regex = buildPhraseRegex(item.phrase, 'gi');
    if (regex.test(currentText)) {
      regex.lastIndex = 0;
      currentText = currentText.replace(regex, (m) => {
        replacementsCount++;
        const pool =
          style === 'academic'
            ? item.alternatives.filter(
                (a) =>
                  !/\b(lots|plenty|kicker|catch|bottom line|dive|dig into|look into|key here|worth noting|keep in mind|don't forget|first off|to wrap up|big picture|at the end of the day|what's more|don't|it's|let's|we'll)\b/i.test(
                    a
                  )
              )
            : item.alternatives;
        const safePool = pool.length > 0 ? pool : item.alternatives;
        const repl = pickUniqueAlternative(safePool, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
        if (repl && !changedTerms.includes(repl)) changedTerms.push(repl);
        return matchCase(m, repl);
      });
    }
  });

  // Stage 5: Single-word AI vocabulary replacements (filtered by intensity + academic register overrides)
  const minSeverity = intensity === 'light' ? 4 : intensity === 'balanced' ? 3 : 1;
  Object.entries(AI_WORDS_MAP).forEach(([word, data], idx) => {
    if (data.severity < minSeverity) return;
    // In Academic or Technical mode, preserve legitimate methodological & disciplinary terms
    if ((style === 'academic' || style === 'technical') && ACADEMIC_METHODOLOGY_TERMS.has(word)) {
      return;
    }
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(currentText)) {
      regex.lastIndex = 0;
      currentText = currentText.replace(regex, (m) => {
        replacementsCount++;
        const pool =
          style === 'academic' && Object.prototype.hasOwnProperty.call(ACADEMIC_AI_OVERRIDES, word)
            ? ACADEMIC_AI_OVERRIDES[word]
            : data.alternatives;
        const repl = pickUniqueAlternative(pool, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
        if (repl && !changedTerms.includes(repl)) changedTerms.push(repl);
        return matchCase(m, repl);
      });
    }
  });

  // Stage 6: Normalise excessive Clause-Level AI Em-Dashes (— or spaced – or --), NEVER breaking numeric/page en-dashes (142–158, 2020–2026) or verse \n breaks
  if (normalizeEmDashes) {
    let dashCounter = 0;
    currentText = currentText.replace(CLAUSE_EM_DASH_REGEX, () => {
      dashCounter++;
      emDashesFixed++;
      if (style === 'chat' || style === 'casual') {
        return dashCounter % 2 === 1 ? ', ' : ' - ';
      }
      return dashCounter % 2 === 1 ? ', ' : '; ';
    });
  }

  // Stage 7: Burstiness & Morphologically Exact Cadence Splitter (balanced / deep only)
  if (intensity === 'balanced' || intensity === 'deep') {
    // 7a. Morphologically verified participle clause splitters (", thereby reducing" -> ". This reduces" / ", helping to reduce")
    currentText = currentText.replace(/[,;]\s+thereby\s+([a-z]+ing)\b/gi, (fullMatch, ingWord, offset, fullStr) => {
      structuresFixed++;
      const trailingSlice = fullStr.slice(offset + fullMatch.length, offset + fullMatch.length + 70);
      // If followed by a parallel participle ("thereby reducing X and fostering Y"), keep participle form so parallelism never breaks
      if (/^[^.;!?]{1,55}\band\s+[a-z]+ing\b/i.test(trailingSlice)) {
        return `, ${ingWord}`;
      }
      const thirdVerb = conjugateParticipleToPresent3rd(ingWord);
      const infVerb = conjugateParticipleToInfinitive(ingWord);
      const choices =
        style === 'academic'
          ? [`. This ${thirdVerb}`, `; in turn, this ${thirdVerb}`, `, which directly ${thirdVerb}`]
          : [`. This ${thirdVerb}`, `, which directly ${thirdVerb}`, `, helping to ${infVerb}`];
      const chosen = pickUniqueAlternative(choices, style, variationSeed, occurrenceCounter++, usedReplacements);
      if (!changedTerms.includes(thirdVerb)) changedTerms.push(thirdVerb);
      return chosen;
    });

    currentText = currentText.replace(
      /[,;]\s+(?:ultimately|finally|in the end|thus|hence|consequently)\s+([a-z]+ing)\b/gi,
      (fullMatch, ingWord, offset, fullStr) => {
        structuresFixed++;
        const trailingSlice = fullStr.slice(offset + fullMatch.length, offset + fullMatch.length + 70);
        if (/^[^.;!?]{1,55}\band\s+[a-z]+ing\b/i.test(trailingSlice)) {
          return `, ultimately ${ingWord}`;
        }
        const thirdVerb = conjugateParticipleToPresent3rd(ingWord);
        const choices =
          style === 'academic'
            ? [`. In turn, this ${thirdVerb}`, `. Accordingly, this ${thirdVerb}`, ` and ${thirdVerb}`]
            : [`. In the end, this ${thirdVerb}`, `. That ultimately ${thirdVerb}`, ` and ${thirdVerb}`];
        const chosen = pickUniqueAlternative(choices, style, variationSeed, occurrenceCounter++, usedReplacements);
        if (!changedTerms.includes(thirdVerb)) changedTerms.push(thirdVerb);
        return chosen;
      }
    );

    const staticClauseSplitters = [
      {
        regex: /,\s+ensuring\s+that\s+/g,
        replacements:
          style === 'academic'
            ? ['. This ensures that ', '; in doing so, it ensures that ', ' so that ']
            : ['. This makes sure ', '. That way, ', ' so that '],
      },
      {
        regex: /,\s+which\s+in\s+turn\s+/g,
        replacements:
          style === 'academic'
            ? ['. In turn, this ', '; consequently, this ', ' and subsequently ']
            : ['. That in turn ', '. As a result, it ', ' and then '],
      },
      {
        regex: /,\s+making\s+it\s+easier\s+to\s+/g,
        replacements:
          style === 'academic'
            ? ['. This simplifies efforts to ', ', which enables researchers to ', ' so teams can more readily ']
            : ['. That makes it much easier to ', ' so you can easily ', '. From there, it is simpler to '],
      },
      {
        regex: /,\s+demonstrating\s+that\s+/g,
        replacements: ['. This demonstrates that ', '. These results show that ', '; notably, this shows that '],
      },
      {
        regex: /,\s+suggesting\s+that\s+/g,
        replacements: ['. This suggests that ', '. Such patterns indicate that ', '; in turn, this implies that '],
      },
    ];

    staticClauseSplitters.forEach((sp, idx) => {
      if (sp.regex.test(currentText)) {
        sp.regex.lastIndex = 0;
        currentText = currentText.replace(sp.regex, () => {
          structuresFixed++;
          return pickUniqueAlternative(sp.replacements, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
        });
      }
    });

    // 7b. Break monotonous long sentences (>=22 words) & consecutive sentence-starter anaphora per paragraph
    const paragraphs = currentText.split(/\n{2,}/);
    const seenParaOpeners = new Set();
    const processedParagraphs = paragraphs.map((para, pIdx) => {
      let updatedPara = para.trim();

      // Guard against two paragraphs starting with the same 1-3 word opener
      const openerMatch = updatedPara.match(/^([A-Za-z']+(?:\s+[A-Za-z']+){0,2}),\s+/);
      if (openerMatch) {
        const openerKey = openerMatch[1].toLowerCase();
        if (seenParaOpeners.has(openerKey)) {
          updatedPara = updatedPara.slice(openerMatch[0].length);
          if (/^[a-z]/.test(updatedPara)) {
            updatedPara = updatedPara.charAt(0).toUpperCase() + updatedPara.slice(1);
          }
          structuresFixed++;
        } else {
          seenParaOpeners.add(openerKey);
        }
      }

      // Preserve single line breaks inside paragraphs (poetic verse stanzas, bullet lists, headings)
      const lines = updatedPara.split('\n');
      const processedLines = lines.map((line, lIdx) => {
        const leadingIndent = (line.match(/^[ \t]+/) || [''])[0];
        const sentences = splitSentencesSafely(line);
        let prevStarter = '';
        const variedSentences = sentences.map((s, sIdx) => {
          let currentSent = s;

          // Intra-paragraph Anaphora Breaker: if two consecutive sentences start with "This [verb/noun]..."
          const starterMatch = currentSent.trim().match(/^([A-Za-z']+)\s+([a-z]+)/);
          if (starterMatch) {
            const firstWord = starterMatch[1].toLowerCase();
            if (firstWord === prevStarter && firstWord === 'this') {
              const anaphoraPrefixes =
                style === 'academic'
                  ? ['In this context, this ', 'Specifically, this ', 'At the same time, this ']
                  : ['In practice, this ', 'At the same time, this ', 'Here, this '];
              const chosenPrefix = anaphoraPrefixes[(pIdx + sIdx + variationSeed) % anaphoraPrefixes.length];
              currentSent = currentSent.replace(/^This\s+/, chosenPrefix);
              structuresFixed++;
            }
            prevStarter = firstWord;
          }

          const sentWords = currentSent.match(/\b[a-zA-Z'-]+\b/g) || [];
          const wordCount = sentWords.filter((w) => !w.startsWith('__PROTECTED')).length;
          // Guard: Only split on ", and " when followed by an explicit new clause subject (pronoun/article/demonstrative),
          // NEVER inside a 3-item verb or noun serial list ("A, B, and C")!
          const independentClauseAndRegex =
            /,[ \t]+(?:while|whereas|and(?=[ \t]+(?:we|they|it|he|she|you|i|this|that|these|those|the|a|an|our|their|its|his|her|your|my|many|most|some|all|several|prior|recent|such|each|every)\b))[ \t]+([a-z])/i;
          if (wordCount >= 22 && independentClauseAndRegex.test(currentSent)) {
            structuresFixed++;
            const connectorChoices =
              style === 'chat' || style === 'casual'
                ? ['. Plus, ', '. At the same time, ', '. Along with that, ', '. ']
                : style === 'academic'
                ? ['. Concurrently, ', '. By contrast, ', '. At the same time, ', '. In parallel, ']
                : ['. Meanwhile, ', '. In parallel, ', '. At the same time, ', '. '];
            const connector = connectorChoices[(pIdx + lIdx + sIdx + variationSeed) % connectorChoices.length];
            const needsCap = connector.trim().endsWith('.');
            return currentSent.replace(independentClauseAndRegex, (_, firstChar) =>
              connector + (needsCap ? firstChar.toUpperCase() : firstChar.toLowerCase())
            );
          }
          // Dynamic Relative-Clause Cadence Breaker for long uniform sentences (>= 21 words) with ", which [verb]"
          if (wordCount >= 21 && /,[ \t]+which[ \t]+([a-z]+s)\b/i.test(currentSent)) {
            structuresFixed++;
            const relChoices =
              style === 'academic'
                ? ['. This ', '; in turn, this ', '. Consequently, this ']
                : ['. This ', '. In practice, this ', '. That directly '];
            const chosenRel = relChoices[(pIdx + lIdx + sIdx + variationSeed) % relChoices.length];
            return currentSent.replace(/,[ \t]+which[ \t]+([a-z]+s)\b/i, (_, verb) => `${chosenRel}${verb}`);
          }
          // Dynamic Participial-Clause Cadence Breaker for long uniform sentences (>= 22 words) with ", [participle]ing "
          if (
            wordCount >= 22 &&
            /,[ \t]+(enabling|allowing|forcing|prompting|causing|helping|driving|creating|generating|producing|yielding|reducing|increasing|improving|enhancing|accelerating|expanding)[ \t]+/i.test(
              currentSent
            )
          ) {
            structuresFixed++;
            return currentSent.replace(
              /,[ \t]+(enabling|allowing|forcing|prompting|causing|helping|driving|creating|generating|producing|yielding|reducing|increasing|improving|enhancing|accelerating|expanding)[ \t]+/i,
              (_, ingWord) => {
                const thirdVerb = conjugateParticipleToPresent3rd(ingWord);
                return style === 'academic' ? `. In turn, this ${thirdVerb} ` : `. This ${thirdVerb} `;
              }
            );
          }
          return currentSent;
        });
        const joinedLine = variedSentences.join(' ');
        return leadingIndent && !joinedLine.startsWith(leadingIndent) ? leadingIndent + joinedLine.trimStart() : joinedLine;
      });

      return processedLines.join('\n');
    });
    currentText = processedParagraphs.join('\n\n');
  }

  // Stage 8: Tone & Contraction Calibration (with smart "it's" -> "it has" vs "it is" disambiguation & modal "have to" guard)
  if (useContractions && style !== 'academic') {
    Object.entries(CONTRACTION_MAP).forEach(([full, contract]) => {
      // Never contract modal obligation "have to" ("you have to" must never become "you've to")
      const modalGuard = /\bhave$/.test(full) ? '(?!\\s+to\\b)' : '';
      const regex = new RegExp(`\\b${full}\\b${modalGuard}`, 'gi');
      if (regex.test(currentText)) {
        regex.lastIndex = 0;
        currentText = currentText.replace(regex, (m) => matchCase(m, contract));
      }
    });
  } else {
    // Disambiguate "it's + past participle" -> "it has" vs "it's" -> "it is"
    currentText = currentText.replace(
      /\b(it's)\s+(been|become|grown|shown|taken|had|got|gotten|made|done|given|seen|come|gone|found|known|led|kept|left|brought|thought|built|spent|sent|lost|held|set|put|run|begun|proven|demonstrated|remained|emerged|evolved)\b/gi,
      (_, its, pp) => `${matchCase(its, 'it has')} ${pp}`
    );
    currentText = currentText.replace(
      /\b(it's)\s+(not|never|always|also|often|already|still|just|only|even|recently|now|since)\s+(been|become|grown|shown|taken|had|made|done|given|seen|come|gone|found|known|led|proven|demonstrated|remained|emerged|evolved)\b/gi,
      (_, its, adv, pp) => `${matchCase(its, 'it has')} ${adv} ${pp}`
    );
    currentText = currentText.replace(/\bit's\b/gi, (m) => matchCase(m, 'it is'));

    Object.entries(REVERSE_CONTRACTION_MAP).forEach(([contract, full]) => {
      const regex = new RegExp(`\\b${contract}\\b`, 'gi');
      if (regex.test(currentText)) {
        regex.lastIndex = 0;
        currentText = currentText.replace(regex, (m) => matchCase(m, full));
      }
    });
  }

  // Stage 8.5: UK (en-GB) / US (en-US) Dialect Calibration
  if (englishDialect !== 'auto') {
    currentText = applyEnglishDialect(currentText, englishDialect);
  }

  // Stage 9: Phonetic a/an & grammar agreement self-healer
  currentText = fixEnglishArticlesAndGrammar(currentText);

  // Final cleanup: horizontal whitespace / stacked transitions / orphaned commas, preserving \n, \n\n, and scholarly abbreviations
  currentText = capitalizeSentenceStartsSafely(
    currentText
      .replace(/\r\n/g, '\n')
      .replace(
        /\b(Beyond this|In addition|Moreover|Further|Equally|Similarly|However|Yet|Still|As a result|Accordingly),\s+(?:notably|importantly|specifically|key here|worth noting)[,:]?\s+/gi,
        '$1, '
      )
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+,/g, ',')
      .replace(/,[ \t]*,/g, ',')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );

  return {
    text: restoreBlocks(currentText, blocks),
    replacementsCount,
    structuresFixed,
    emDashesFixed,
    watermarksStripped,
    changedTerms,
    protectedBlocksCount: blocks.length,
  };
}

/**
 * Split text into segments for the "Highlight changes" view (site's highlightedSegments).
 * Marks every occurrence of a term the engine inserted.
 * @returns {Array<{part: string, isMatch: boolean}>|null}
 */
export function highlightChangedTerms(text, changedTerms) {
  if (!text || !changedTerms || changedTerms.length === 0) return null;
  const escapedTerms = changedTerms
    .filter((t) => t.trim().length > 1)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escapedTerms.length === 0) return null;
  const regex = new RegExp(`(\\b(?:${escapedTerms.join('|')})\\b)`, 'gi');
  const lowerTerms = changedTerms.map((t) => t.toLowerCase());
  return text.split(regex).map((part) => ({ part, isMatch: lowerTerms.includes(part.toLowerCase()) }));
}

// ── Studio Visual Word Diff, Sentence AI Heatmap & Multi-Detector Bypass Radar ──

/**
 * Compute word-level LCS diff between original and humanised text.
 * @param {string} beforeText
 * @param {string} afterText
 * @returns {Array<{type: 'same'|'removed'|'added', text: string}>}
 */
export function computeWordLevelDiff(beforeText, afterText) {
  if (!beforeText || !beforeText.trim() || !afterText || !afterText.trim()) return [];
  const tokenize = (str) => str.split(/(\s+)/).filter((t) => t.length > 0);
  const a = tokenize(beforeText);
  const b = tokenize(afterText);

  // Guard against quadratic blowup on 5,000+ word essays by diffing paragraph-by-paragraph
  if (a.length * b.length > 220000) {
    const aParas = beforeText.split(/\n{2,}/);
    const bParas = afterText.split(/\n{2,}/);
    const maxLen = Math.max(aParas.length, bParas.length);
    const out = [];
    for (let p = 0; p < maxLen; p++) {
      if (p > 0) out.push({ type: 'same', text: '\n\n' });
      out.push(...computeWordLevelDiff(aParas[p] || '', bParas[p] || ''));
    }
    return out;
  }

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const raw = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      raw.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) raw.push({ type: 'removed', text: a[i++] });
  while (j < n) raw.push({ type: 'added', text: b[j++] });

  const merged = [];
  for (const tok of raw) {
    if (merged.length > 0 && merged[merged.length - 1].type === tok.type) {
      merged[merged.length - 1].text += tok.text;
    } else {
      merged.push({ ...tok });
    }
  }
  return merged;
}

/**
 * Sentence-by-sentence AI cadence & vocabulary risk heatmap.
 * @param {string} text
 * @param {string} [style='chat']
 * @returns {Array<{text: string, wordCount: number, tier: 'high'|'moderate'|'human', reason: string, paragraphIndex: number}>}
 */
export function analyzeSentenceHeatmap(text, style = 'chat') {
  if (!text || !text.trim()) return [];
  const paragraphs = text.split(/\n{2,}/);
  const items = [];

  paragraphs.forEach((para, pIdx) => {
    const sents = splitSentencesSafely(para.trim()).filter((s) => s.trim().length > 0);
    sents.forEach((s) => {
      const words = s.match(/\b[a-zA-Z'-]+\b/g) || [];
      const wc = words.length;
      let aiHits = 0;
      words.forEach((w) => {
        const low = w.toLowerCase();
        if ((style === 'academic' || style === 'technical') && ACADEMIC_METHODOLOGY_TERMS.has(low)) return;
        if (Object.prototype.hasOwnProperty.call(AI_WORDS_MAP, low) && AI_WORDS_MAP[low].severity >= 3) aiHits++;
      });
      const hasEmDash = CLAUSE_EM_DASH_REGEX.test(s);
      CLAUSE_EM_DASH_REGEX.lastIndex = 0;
      const hasRoboticStarter = /^(Furthermore|Moreover|Additionally|Consequently|In conclusion|It is worth noting|In today's)/i.test(s.trim());

      let tier = 'human';
      let reason = 'Natural human cadence & vocabulary';

      if (aiHits >= 2 || hasRoboticStarter || (aiHits >= 1 && hasEmDash)) {
        tier = 'high';
        reason = 'High AI lexical/structural signature';
      } else if (aiHits === 1 || hasEmDash || (wc >= 17 && wc <= 22)) {
        tier = 'moderate';
        reason = wc >= 17 && wc <= 22 ? `Uniform LLM sentence length (${wc}w)` : 'Moderate AI phrasing / punctuation';
      }

      items.push({
        text: s,
        wordCount: wc,
        tier,
        reason,
        paragraphIndex: pIdx,
      });
    });
  });

  return items;
}

/**
 * Flesch-Kincaid Grade Level + Multi-Detector Bypass Radar (GPTZero, Turnitin AI, Originality.ai, Copyleaks).
 */
export function computeReadabilityAndDetectors(text, rawAIScore, burstinessCVStr, lexicalDiversityTTR, emDashCount) {
  const words = (text || '').match(/\b[a-zA-Z'-]+\b/g) || [];
  const sentences = (text || '')
    .split(/\n+/)
    .flatMap((l) => splitSentencesSafely(l))
    .filter((s) => s.trim().length > 0);
  const totalWords = Math.max(1, words.length);
  const totalSentences = Math.max(1, sentences.length);

  const countSyllables = (word) => {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    const cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const matches = cleaned.match(/[aeiouy]{1,2}/g);
    return matches ? Math.max(1, matches.length) : 1;
  };
  const totalSyllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  const fkGradeRaw = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;
  const fkGrade = Math.max(1, Math.min(18, Number(fkGradeRaw.toFixed(1))));

  const cv = parseFloat(burstinessCVStr) || 0;
  const gptZeroHuman = Math.min(99, Math.max(2, Math.round(100 - rawAIScore * 0.85 + (cv >= 0.38 ? 8 : -6))));
  const turnitinHuman = Math.min(99, Math.max(2, Math.round(100 - rawAIScore * 0.92 - emDashCount * 2)));
  const originalityHuman = Math.min(99, Math.max(2, Math.round(100 - rawAIScore * 0.95 + (lexicalDiversityTTR > 68 ? 5 : -4))));
  const copyleaksHuman = Math.min(99, Math.max(2, Math.round(100 - rawAIScore * 0.88 + (cv >= 0.35 ? 5 : 0))));

  return {
    fkGrade,
    fkLabel:
      fkGrade <= 8
        ? 'Conversational'
        : fkGrade <= 12
        ? 'Standard / Clear'
        : fkGrade <= 15
        ? 'University / Executive'
        : 'Post-Grad / Scholarly',
    detectors: [
      { name: 'GPTZero', humanPct: gptZeroHuman, focus: 'Burstiness & Perplexity' },
      { name: 'Turnitin AI', humanPct: turnitinHuman, focus: 'Academic Syntax & Transitions' },
      { name: 'Originality.ai', humanPct: originalityHuman, focus: 'Token Entropy & Clichés' },
      { name: 'Copyleaks', humanPct: copyleaksHuman, focus: 'N-Gram Cadence' },
    ],
  };
}
