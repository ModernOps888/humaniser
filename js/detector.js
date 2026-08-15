/**
 * Detector Engine - Analyzes text for AI-generated patterns and signatures.
 */

import {
  AI_WORDS,
  AI_PHRASES,
  TRANSITION_WORDS,
  CONTRACTION_MAP,
  HEDGING_PHRASES,
  FILLER_STARTERS,
  PATTERN_CATEGORIES
} from './patterns.js';

/**
 * Checks if a proposed range overlaps with any already registered patterns.
 * @param {number} start 
 * @param {number} end 
 * @param {Array<Object>} patterns 
 * @returns {boolean}
 */
function isOverlapping(start, end, patterns) {
  return patterns.some(p => {
    return (start >= p.start && start < p.end) || (end > p.start && end <= p.end) || (start <= p.start && end >= p.end);
  });
}

/**
 * Extracts sentences carefully, trying not to break on abbreviations.
 * @param {string} text 
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function extractSentences(text) {
  // basic abbreviation list
  const abbr = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Rev', 'St', 'Jr', 'Sr', 'vs', 'etc', 'ie', 'eg', 'Inc', 'Ltd'];
  const abbrRegexStr = abbr.join('|');
  const endRegex = new RegExp(`(?<!\\b(?:${abbrRegexStr}))[.!?]+(?:\\s+|$)`, 'g');
  
  let sentences = [];
  let lastIndex = 0;
  let match;
  
  while ((match = endRegex.exec(text)) !== null) {
    const start = lastIndex;
    const end = match.index + match[0].length;
    const sentenceText = text.substring(start, end);
    if (sentenceText.trim().length > 0) {
      sentences.push({ text: sentenceText, start, end });
    }
    lastIndex = end;
  }
  
  if (lastIndex < text.length) {
    const sentenceText = text.substring(lastIndex);
    if (sentenceText.trim().length > 0) {
      sentences.push({ text: sentenceText, start: lastIndex, end: text.length });
    }
  }
  
  return sentences;
}

/**
 * Get word count roughly.
 */
function getWordCount(text) {
  const matches = text.match(/\b\w+\b/g);
  return matches ? matches.length : 0;
}

/**
 * Calculates sentence variance
 */
function getVarianceStats(sentences) {
  if (sentences.length === 0) return { avg: 0, cv: 0 };
  const lengths = sentences.map(s => getWordCount(s.text));
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (lengths.length === 1) return { avg, cv: 1 };
  const sumSq = lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
  const variance = sumSq / (lengths.length - 1);
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? stdDev / avg : 0;
  return { avg, cv };
}

/**
 * Analyzes the text against all known AI patterns.
 * @param {string} text
 * @returns {{score: number, patterns: Array<Object>, stats: Object}}
 */
export function analyse(text) {
  let patterns = [];
  let patternIdCounter = 0;
  
  const addPattern = (category, severity, start, end, matchedText, message, suggestion, replacement = null) => {
    if (!isOverlapping(start, end, patterns)) {
      patterns.push({
        id: `${category}-${patternIdCounter++}`,
        category,
        severity,
        start,
        end,
        matchedText,
        message,
        suggestion,
        replacement
      });
    }
  };

  // 1. Vocabulary Scan
  const wordsRegex = /\b([a-zA-Z]+(?:-[a-zA-Z]+)*)\b/g;
  let match;
  while ((match = wordsRegex.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    if (AI_WORDS.has(word)) {
      const data = AI_WORDS.get(word);
      const start = match.index;
      const end = start + match[0].length;
      const suggestion = data.alternatives[Math.floor(Math.random() * data.alternatives.length)];
      addPattern('vocabulary', data.severity, start, end, match[0], `Overused AI word: ${word}`, suggestion, suggestion);
    }
  }

  // 2. Phrase Scan
  AI_PHRASES.forEach(phraseDef => {
    const regex = new RegExp(phraseDef.pattern.source, 'gi'); // clone regex
    let pMatch;
    while ((pMatch = regex.exec(text)) !== null) {
      addPattern('phrase', phraseDef.severity, pMatch.index, pMatch.index + pMatch[0].length, pMatch[0], phraseDef.message, phraseDef.suggestion, phraseDef.suggestion);
    }
  });

  const sentences = extractSentences(text);
  let totalTransitions = 0;
  let passiveCount = 0;
  const sentenceStarts = [];

  // Sentence-level scanning
  sentences.forEach((sentenceObj) => {
    const sText = sentenceObj.text.trim();
    if (!sText) return;
    
    // First word extraction
    const firstWordMatch = sText.match(/^[A-Za-z]+/);
    if (firstWordMatch) {
      const firstWord = firstWordMatch[0];
      sentenceStarts.push({ word: firstWord.toLowerCase(), start: sentenceObj.start, end: sentenceObj.end });
      
      // 3. Transition Density Check
      if (TRANSITION_WORDS.has(firstWord) || TRANSITION_WORDS.has(firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase())) {
        totalTransitions++;
        const sIndex = text.indexOf(firstWord, sentenceObj.start);
        if (sIndex !== -1) {
          addPattern('flow', 3, sIndex, sIndex + firstWord.length, firstWord, `Overused AI transition`, 'Try restructuring or omitting');
        }
      }
    }

    // 6. Filler Starters Check
    FILLER_STARTERS.forEach(fs => {
      const regex = new RegExp(fs.pattern.source, 'gi');
      let fsMatch;
      while ((fsMatch = regex.exec(sText)) !== null) {
        if (fsMatch.index === 0) { // Should be at the start
          const globalStart = sentenceObj.start + sText.indexOf(fsMatch[0]);
          addPattern('structure', fs.severity, globalStart, globalStart + fsMatch[0].length, fsMatch[0], `Redundant filler starter`, 'Remove completely', '');
        }
      }
    });

    // 9. Passive Voice Detection
    const passiveRegex = /\b(is|are|was|were|been|being)\s+([a-zA-Z]+(?:ed|en|t))\b/gi;
    let pvMatch;
    while ((pvMatch = passiveRegex.exec(sText)) !== null) {
      passiveCount++;
      // We don't flag every single one immediately unless we cross a threshold, but the requirement says 
      // "If passive voice exceeds 30%, flag examples." We'll just flag them with a special tag and filter later or flag directly.
      // Let's flag directly for simplicity but with low severity, or only if overall is high.
      const gStart = sentenceObj.start + sText.indexOf(pvMatch[0]); // Rough estimate, may need more exact matching
    }
  });

  // 4. Contraction Check
  CONTRACTION_MAP.forEach((contracted, formal) => {
    const regex = new RegExp(`\\b${formal}\\b`, 'gi');
    let cMatch;
    while ((cMatch = regex.exec(text)) !== null) {
      addPattern('tone', 2, cMatch.index, cMatch.index + cMatch[0].length, cMatch[0], `Formal uncontracted phrase`, contracted, contracted);
    }
  });

  // 5. Hedging Phrases
  HEDGING_PHRASES.forEach(hedge => {
    const regex = new RegExp(hedge.pattern.source, 'gi');
    let hMatch;
    while ((hMatch = regex.exec(text)) !== null) {
      addPattern('hedging', hedge.severity, hMatch.index, hMatch.index + hMatch[0].length, hMatch[0], `Excessive hedging`, hedge.suggestion, hedge.suggestion || '');
    }
  });

  // 7. Repetitive Sentence Starters
  const starterCounts = {};
  sentenceStarts.forEach(s => {
    starterCounts[s.word] = (starterCounts[s.word] || 0) + 1;
  });
  sentenceStarts.forEach(s => {
    if (starterCounts[s.word] >= 3) {
      // Flag
      const globalStart = s.start + text.substring(s.start).indexOf(s.word); // exact offset
      // only add if not overlapping
      addPattern('structure', 4, globalStart, globalStart + s.word.length, s.word, `Repetitive sentence starter (${s.word} used ${starterCounts[s.word]} times)`, 'Vary the starting word');
    }
  });

  // 8. Sentence length uniformity
  const { avg: avgSentenceLength, cv: sentenceLengthVariance } = getVarianceStats(sentences);
  if (sentenceLengthVariance > 0 && sentenceLengthVariance < 0.3 && sentences.length > 3) {
    // Flag the whole text vaguely or just the first few
    addPattern('structure', 5, 0, Math.min(100, text.length), text.substring(0, 100) + '...', `Highly uniform sentence length (CV: ${sentenceLengthVariance.toFixed(2)})`, 'Vary sentence length');
  }

  // Calculate passive voice percent
  let passiveVoicePercent = 0;
  const sentenceCount = sentences.length;
  if (sentenceCount > 0) {
    passiveVoicePercent = passiveCount / sentenceCount;
    if (passiveVoicePercent > 0.3) {
       addPattern('tone', 4, 0, 0, '', `High passive voice usage (${(passiveVoicePercent*100).toFixed(0)}%)`, 'Use active voice');
    }
  }

  // 10. Em-dash overuse
  const dashMatches = text.match(/—|--/g);
  const wordCount = getWordCount(text);
  if (dashMatches && dashMatches.length > 0) {
    const ratio = dashMatches.length / (wordCount / 500);
    if (ratio > 2) {
      addPattern('structure', 3, 0, 0, '', `Overuse of em-dashes (${dashMatches.length} found)`, 'Reduce dash usage');
    }
  }

  // Scoring algorithm
  let score = 100;
  const categoryCounts = {};
  const weights = {
    vocabulary: 1.5,
    phrase: 2.5,
    structure: 2.0,
    tone: 1.0,
    flow: 1.5,
    hedging: 1.5
  };

  patterns.forEach(p => {
    const cat = p.category;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    
    // Diminishing returns: 1st penalty is 100%, 2nd is 80%, 3rd is 60% etc.
    const reductionFactor = Math.max(0.2, 1 - (categoryCounts[cat] - 1) * 0.2);
    const penalty = p.severity * (weights[cat] || 1.0) * reductionFactor;
    score -= penalty;
  });

  // Calculate stats for bonus points
  // Contraction rate approximation (contracted vs formal possibilities)
  const formalMatches = Array.from(text.matchAll(/\b(do not|does not|cannot|it is)\b/gi)).length;
  const contractedMatches = Array.from(text.matchAll(/\b(don't|doesn't|can't|it's)\b/gi)).length;
  const contractionRate = formalMatches + contractedMatches > 0 ? contractedMatches / (formalMatches + contractedMatches) : 1.0;

  if (contractionRate > 0.5) score += 5;
  if (sentenceLengthVariance > 0.4) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine reading level
  let readingLevel = 'Medium';
  if (avgSentenceLength > 20) readingLevel = 'Advanced';
  else if (avgSentenceLength < 12) readingLevel = 'Easy';

  return {
    score,
    patterns,
    stats: {
      wordCount,
      sentenceCount,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      sentenceLengthVariance: Math.round(sentenceLengthVariance * 100) / 100,
      readingLevel,
      passiveVoicePercent: Math.round(passiveVoicePercent * 100) / 100,
      contractionRate: Math.round(contractionRate * 100) / 100,
      transitionDensity: sentenceCount > 0 ? totalTransitions / sentenceCount : 0,
      patternsByCategory: categoryCounts
    }
  };
}
