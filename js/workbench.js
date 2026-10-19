/**
 * Workbench engine — vanilla-JS port of the live Humaniser workbench
 * (https://infinitytechstack.uk/humaniser, Next.js source src/app/humaniser/page.tsx).
 *
 * Ported functions (same algorithm, same stage order, same data tables):
 *   protectBlocks / restoreBlocks, buildPhraseRegex, matchCase, pickUniqueAlternative,
 *   fixEnglishArticlesAndGrammar, transformHumaniser, analyzeAIProbabilities.
 *
 * Deliberate deviations from the site source (bugs found while porting; each is covered by
 * tests/regression.mjs):
 *   1. Stage 3 / Stage 7 templates contain `$1`/`$3` back-references but the site passes a
 *      replacer *function* to String.replace, so the literal text "$3" leaks into the output.
 *      Here the captured groups are expanded explicitly (expandTemplate).
 *   2. restoreBlocks uses a replacer function so code containing `$&`, `$1`, `$'` etc. is
 *      restored byte-identical (a string replacement would interpret those patterns).
 *   3. a/an healer: "URL", "URI", "UUID" take "a" (the site turned "a URL" into "an URL"),
 *      vowel-sound acronyms after "a" are corrected ("a LLM" -> "an LLM"), and the
 *      "ophoria" typo is corrected to "euphoria".
 *   4. Stage 7 sentence splitter only capitalises the next word when the connector is a bare
 *      full stop (the site produced "Plus, Customers ...").
 *   5. analyzeAIProbabilities looks words up with hasOwnProperty, so words such as
 *      "constructor" no longer resolve to Object.prototype members (which produced NaN scores).
 *   6. The a/an healer leaves "an" + numeral alone ("an 8-hour shift", "an 11-step plan").
 */

import {
  AI_WORDS_MAP,
  PHRASE_REPLACEMENTS,
  CONTRACTION_MAP,
  REVERSE_CONTRACTION_MAP,
} from './workbench-data.js';

/** The six voice modes of the live workbench (PRESETS in page.tsx). */
export const VOICE_MODES = [
  { id: 'chat', label: 'Chat / Everyday', desc: "Strips ChatGPT wrappers ('Certainly!'), em-dashes & stiff transitions for natural chat/paste" },
  { id: 'casual', label: 'Casual & Natural', desc: 'Conversational cadence, active voice, natural contractions enabled' },
  { id: 'email', label: 'Email & Outreach', desc: "Warm, direct human messages without 'I hope this email finds you well'" },
  { id: 'executive', label: 'Executive & Pitch', desc: 'Direct, punchy business tone, zero fluff, high signal' },
  { id: 'academic', label: 'Academic & Formal', desc: 'Formal prose; contractions are always expanded' },
  { id: 'technical', label: 'Technical & Direct', desc: 'Crisp engineering writing; preserves ```code``` & URLs' },
];

export const INTENSITIES = ['light', 'balanced', 'deep'];

// ── Punctuation-safe phrase regex builder (handles trailing commas/colons where \b fails) ──
export function buildPhraseRegex(phrase, flags = 'gi') {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWithWord = /^\w/.test(phrase);
  const endsWithWord = /\w$/.test(phrase);
  const prefix = startsWithWord ? '\\b' : "(?:^|(?<=\\s|[([{\"']))";
  const suffix = endsWithWord ? '\\b' : "(?=\\s|[.!?;:)\\]}\"']|$)";
  return new RegExp(`${prefix}${escaped}${suffix}`, flags);
}

// ── Code block & URL protection ──
export function protectBlocks(text) {
  const blocks = [];
  let processedText = text;
  let index = 0;
  const stash = (match) => {
    const placeholder = `__PROTECTED_BLOCK_${index}__`;
    blocks[index++] = match;
    return placeholder;
  };
  processedText = processedText.replace(/```[\s\S]*?```/g, stash);
  processedText = processedText.replace(/`[^`]*`/g, stash);
  processedText = processedText.replace(/https?:\/\/[^\s]+/g, stash);
  return { text: processedText, blocks };
}

export function restoreBlocks(text, blocks) {
  let restoredText = text;
  for (let i = 0; i < blocks.length; i++) {
    // Replacer function: never interpret `$&`, `$1`, `$'` inside protected code (deviation 2).
    restoredText = restoredText.replace(`__PROTECTED_BLOCK_${i}__`, () => blocks[i]);
  }
  return restoredText;
}

/** Expand `$1`..`$9` in a template using regex capture groups (deviation 1). */
function expandTemplate(template, groups) {
  return template.replace(/\$(\d)/g, (_, n) => (groups[Number(n) - 1] ?? ''));
}

// ── Detector (site's analyzeAIProbabilities) ──
export function analyzeAIProbabilities(text) {
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
    };
  }

  const watermarkMatches = text.match(/[\u200B\u200C\u200D\uFEFF\u2060\u00A0]/g) || [];
  const emDashMatches = text.match(/\s*[—–]\s*|\s--\s/g) || [];

  const { text: cleanText } = protectBlocks(text);
  const words = cleanText.match(/\b[a-zA-Z'-]+\b/g) || [];
  const totalWords = words.length || 1;
  const charCount = text.length;
  const readingTimeSec = Math.max(1, Math.round((totalWords / 220) * 60));

  let patternScore = 0;
  const detectedPatterns = [];

  const structuralChecks = [
    {
      regex: /\b(it is|it's|this is|this isn't|is) not (just|merely|only) (about )?([^,;—.]+)[,;—]+\s*(it is|it's|but rather|but)\s+/gi,
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
      replacement: 'Natural commas / periods',
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

  words.forEach((w, idx) => {
    const lower = w.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(AI_WORDS_MAP, lower)) {
      const data = AI_WORDS_MAP[lower];
      patternScore += data.severity * 3;
      if (!detectedPatterns.some((p) => p.matchedText.toLowerCase() === lower)) {
        detectedPatterns.push({
          id: `word-${idx}`,
          category: 'AI Word',
          severity: data.severity,
          matchedText: w,
          message: `Overused AI vocabulary '${w}'`,
          replacement: data.alternatives[0],
        });
      }
    }
  });

  const sentences = cleanText.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const sentenceLengths = sentences.map((s) => (s.match(/\b\w+\b/g) || []).length);
  const avgLen = sentenceLengths.reduce((a, b) => a + b, 0) / (sentenceLengths.length || 1);
  const variance = sentenceLengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / (sentenceLengths.length || 1);
  const cv = avgLen > 0 ? Math.sqrt(variance) / avgLen : 0;

  const burstinessPenalty = sentences.length > 1 ? Math.max(0, (0.48 - Math.min(cv, 0.48)) * 42) : 6;
  const rawAIScore = Math.min(
    99,
    Math.max(0, Math.round((patternScore / totalWords) * 115 + burstinessPenalty + (watermarkMatches.length > 0 ? 8 : 0)))
  );

  return {
    rawAIScore,
    humanScore: 100 - rawAIScore,
    totalWords: text.trim() ? words.length : 0,
    charCount,
    readingTimeSec,
    detectedPatterns,
    sentenceCount: sentences.length,
    burstinessCV: cv.toFixed(2),
    emDashCount: emDashMatches.length,
    watermarkChars: watermarkMatches.length,
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

/** Non-repeating rotation selector (anti-repetition ledger shared across the whole document). */
export function pickUniqueAlternative(alternatives, style, variationSeed, occurrenceIndex, usedSet) {
  const valid = alternatives.filter((a) => a !== undefined);
  if (valid.length === 0) return '';
  const styleOffset =
    style === 'chat' ? 2
      : style === 'casual' ? 0
        : style === 'email' ? 1
          : style === 'executive' ? 3
            : style === 'academic' ? 1
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
const VOWEL_SOUND_ACRONYMS = /^(?:AI|API|LLM|MCP|SLA|SLO|SDK|SQL|HTML|HTTP|HTTPS|SSR|SEO|AEO|ATS|ROI|SOP|RFP|NDA|IDE|ORM|IAM|AWS|F1|M1|M2|M3|M4|R1|R2)$/;

/** Phonetic English indefinite article ("a" <-> "an") & grammar self-healer. */
export function fixEnglishArticlesAndGrammar(input) {
  // Vowel-letter words with a consonant sound ("yoo" / "w" glide) -> take "a"
  const consonantSoundVowelWords =
    /^(?:user|users|usability|usable|used|useful|usefulness|using|usual|usually|usurp|utensil|utility|utilities|utilize|utilized|utilizing|utilization|utopia|utopian|ubiquitous|ubiquity|unanimous|unanimously|unicorn|uniform|uniformly|unify|unified|unifying|union|unique|uniquely|unison|unit|unite|united|uniting|unity|universal|universally|universe|university|universities|unilateral|url|urls|uri|uris|uuid|uuids|eulogy|euphemism|euphoria|europe|european|euro|one|ones|once)(?:$|-)/i;

  // Silent 'h' words -> take "an"
  const vowelSoundHWords = /^(?:hour|hours|hourly|honest|honestly|honesty|honor|honors|honorable|honour|honours|honourable|heir|heiress|heirloom|herb|herbal)(?:$|-)/i;

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

/**
 * Multi-stage humaniser transform (site's transformHumaniser).
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.style='chat']            one of VOICE_MODES ids
 * @param {boolean} [opts.useContractions=true]
 * @param {'light'|'balanced'|'deep'} [opts.intensity='balanced']
 * @param {boolean} [opts.stripChatWrappers=true]
 * @param {boolean} [opts.normalizeEmDashes=true]
 * @param {number} [opts.variationSeed=0]          0..3, cycles alternative phrasings
 */
export function transformHumaniser(text, opts = {}) {
  const {
    style = 'chat',
    useContractions = true,
    intensity = 'balanced',
    stripChatWrappers = true,
    normalizeEmDashes = true,
    variationSeed = 0,
  } = opts;

  if (!text || !text.trim()) {
    return { text: '', replacementsCount: 0, structuresFixed: 0, emDashesFixed: 0, watermarksStripped: 0, changedTerms: [] };
  }

  // Stage 1: Strip invisible zero-width watermarks & normalise non-breaking spaces / smart quotes
  const watermarkMatches = text.match(/[\u200B\u200C\u200D\uFEFF\u2060\u00A0]/g) || [];
  const watermarksStripped = watermarkMatches.length;
  const cleanedInput = text
    .replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  const { text: protectedText, blocks } = protectBlocks(cleanedInput);
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

  // Stage 3: Rewrite signature AI syntactic templates
  const contrastTemplates = [
    {
      regex: /\b(It is|It's|This is|This isn't) not (just|merely|only) about ([^,;—.]+)[,;—]+\s*(it is|it's|but rather)\s+about\s+/gi,
      repl: ['Beyond $3, the real focus is ', 'More than $3, this comes down to ', 'Rather than just $3, it centers on '],
    },
    {
      regex: /\b(It is|It's|This is) not (just|merely|only) ([^,;—.]+)[,;—]+\s*(it is|it's|but rather)\s+/gi,
      repl: ['More than $3, it is ', 'Beyond $3, this is ', "Rather than just $3, it's "],
    },
    {
      regex: /\bNot only does ([^,]+?) ([a-z]+),?\s+but it also ([a-z]+)/gi,
      repl: ['$1 both $2s and $3', "$1 doesn't just $2—it also $3", 'Alongside $2ing, $1 also $3'],
    },
    {
      regex: /\bWhether you('re| are) a ([^,]+?) or a ([^,]+?),/gi,
      repl: ['For both $2s and $3s,', 'Across $2s and $3s alike,', 'From $2s to $3s,'],
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
        academic: ['In parallel, ', 'Beyond this, ', '', 'Further, ', 'Alongside this, '],
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
        academic: ['As a result, ', 'In turn, ', 'Accordingly, ', 'Because of this, '],
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
        academic: ['Even so, ', 'Still, ', 'Yet, ', 'That said, '],
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
        academic: ['Taken together, ', 'Overall, ', 'In short, ', 'In sum, '],
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
  currentText = currentText.replace(/(^\s*|\n\s*|[.!?][ \t]+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());

  // Stage 4: Multi-word phrase replacements (per-occurrence anti-repetition rotation)
  PHRASE_REPLACEMENTS.forEach((item, idx) => {
    const regex = buildPhraseRegex(item.phrase, 'gi');
    if (regex.test(currentText)) {
      regex.lastIndex = 0;
      currentText = currentText.replace(regex, (m) => {
        replacementsCount++;
        const repl = pickUniqueAlternative(item.alternatives, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
        if (repl && !changedTerms.includes(repl)) changedTerms.push(repl);
        return matchCase(m, repl);
      });
    }
  });

  // Stage 5: Single-word AI vocabulary replacements (filtered by intensity, rotated per occurrence)
  const minSeverity = intensity === 'light' ? 4 : intensity === 'balanced' ? 3 : 1;
  Object.entries(AI_WORDS_MAP).forEach(([word, data], idx) => {
    if (data.severity < minSeverity) return;
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(currentText)) {
      regex.lastIndex = 0;
      currentText = currentText.replace(regex, (m) => {
        replacementsCount++;
        const repl = pickUniqueAlternative(data.alternatives, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
        if (repl && !changedTerms.includes(repl)) changedTerms.push(repl);
        return matchCase(m, repl);
      });
    }
  });

  // Stage 6: Normalise excessive AI em-dashes (— – --)
  if (normalizeEmDashes) {
    let dashCounter = 0;
    currentText = currentText.replace(/\s*(?:—|–|--)\s*/g, () => {
      dashCounter++;
      emDashesFixed++;
      if (style === 'chat' || style === 'casual') {
        return dashCounter % 2 === 1 ? ', ' : ' - ';
      }
      return dashCounter % 2 === 1 ? ', ' : '; ';
    });
  }

  // Stage 7: Burstiness & cadence splitter (balanced / deep only)
  if (intensity === 'balanced' || intensity === 'deep') {
    const clauseSplitters = [
      { regex: /,\s+thereby\s+([a-z]+)ing\b/g, replacements: ['. This $1s', '—which directly $1s', ', helping to $1'] },
      { regex: /,\s+ultimately\s+([a-z]+)ing\b/g, replacements: ['. In the end, this $1s', '. That ultimately $1s', ' and $1s'] },
      { regex: /,\s+ensuring\s+that\s+/g, replacements: ['. This makes sure ', '. That way, ', ' so that '] },
      { regex: /,\s+which\s+in\s+turn\s+/g, replacements: ['. That in turn ', '. As a result, it ', ' and then '] },
      { regex: /,\s+making\s+it\s+easier\s+to\s+/g, replacements: ['. That makes it much easier to ', ' so you can easily ', ". From there, it's simpler to "] },
    ];

    clauseSplitters.forEach((sp, idx) => {
      if (sp.regex.test(currentText)) {
        sp.regex.lastIndex = 0;
        currentText = currentText.replace(sp.regex, (...args) => {
          structuresFixed++;
          const groups = args.slice(1, -2);
          const template = pickUniqueAlternative(sp.replacements, style, variationSeed, idx + occurrenceCounter++, usedReplacements);
          return expandTemplate(template, groups);
        });
      }
    });

    // Break monotonous long sentences (>=24 words) per paragraph so \n\n breaks are preserved
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

      // Preserve single line breaks inside paragraphs (bullet lists, headings)
      const lines = updatedPara.split('\n');
      const processedLines = lines.map((line, lIdx) => {
        const sentences = line.split(/(?<=[.!?])[ \t]+/);
        const variedSentences = sentences.map((s, sIdx) => {
          const wordCount = (s.match(/\b\w+\b/g) || []).length;
          if (wordCount >= 24 && /,[ \t]+(and|while)[ \t]+([a-z])/i.test(s)) {
            structuresFixed++;
            const connectorChoices =
              style === 'chat' || style === 'casual'
                ? ['. Plus, ', '. At the same time, ', '. Along with that, ', '. ']
                : ['. Meanwhile, ', '. In parallel, ', '. At the same time, ', '. '];
            const connector = connectorChoices[(pIdx + lIdx + sIdx + variationSeed) % connectorChoices.length];
            // Deviation 4: only capitalise when the connector is a bare full stop.
            return s.replace(/,[ \t]+(?:and|while)[ \t]+([a-z])/i, (_, firstChar) =>
              connector + (connector === '. ' ? firstChar.toUpperCase() : firstChar));
          }
          return s;
        });
        return variedSentences.join(' ');
      });

      return processedLines.join('\n');
    });
    currentText = processedParagraphs.join('\n\n');
  }

  // Stage 8: Tone & contraction calibration
  if (useContractions && style !== 'academic') {
    Object.entries(CONTRACTION_MAP).forEach(([full, contract]) => {
      const regex = new RegExp(`\\b${full}\\b`, 'gi');
      if (regex.test(currentText)) {
        regex.lastIndex = 0;
        currentText = currentText.replace(regex, (m) => matchCase(m, contract));
      }
    });
  } else {
    Object.entries(REVERSE_CONTRACTION_MAP).forEach(([contract, full]) => {
      const regex = new RegExp(`\\b${contract}\\b`, 'gi');
      if (regex.test(currentText)) {
        regex.lastIndex = 0;
        currentText = currentText.replace(regex, (m) => matchCase(m, full));
      }
    });
  }

  // Stage 9: Phonetic a/an & grammar agreement self-healer
  currentText = fixEnglishArticlesAndGrammar(currentText);

  // Final cleanup: horizontal whitespace / orphaned commas, preserving \n and \n\n
  currentText = currentText
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+,/g, ',')
    .replace(/,[ \t]*,/g, ',')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^\s*|\n\s*|[.!?][ \t]+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase())
    .trim();

  return {
    text: restoreBlocks(currentText, blocks),
    replacementsCount,
    structuresFixed,
    emDashesFixed,
    watermarksStripped,
    changedTerms,
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
