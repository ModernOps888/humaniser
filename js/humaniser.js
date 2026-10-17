import { 
    AI_WORDS, 
    CONTRACTION_MAP, 
    PHRASE_REPLACEMENTS, 
    SENTENCE_RESTRUCTURES, 
    HUMAN_CONNECTORS, 
    SENTENCE_STARTERS, 
    TRANSITION_WORDS, 
    HEDGING_PHRASES, 
    FILLER_STARTERS, 
    AI_PHRASES 
} from './patterns.js';

/**
 * Helper to preserve case of the original word
 */
function preserveCase(original, replacement) {
    if (!original || !replacement) return replacement;
    
    // All caps
    if (original === original.toUpperCase() && original.length > 1 && /[A-Z]/.test(original)) {
        return replacement.toUpperCase();
    }
    // Title case
    if (original[0] === original[0].toUpperCase() && /[A-Z]/.test(original[0])) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    // Lowercase (default)
    return replacement.toLowerCase();
}

/**
 * A seeded random function for deterministic randomness based on string
 */
function seededRandom(seed) {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

/**
 * Extract protected blocks (URLs, code blocks, etc) and replace with placeholders
 */
function protectBlocks(text) {
    const blocks = [];
    let processedText = text;
    let index = 0;

    // Protect markdown code blocks
    processedText = processedText.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `__PROTECTED_BLOCK_${index}__`;
        blocks[index++] = match;
        return placeholder;
    });

    // Protect inline code
    processedText = processedText.replace(/`[^`]*`/g, (match) => {
        const placeholder = `__PROTECTED_BLOCK_${index}__`;
        blocks[index++] = match;
        return placeholder;
    });

    // Protect URLs
    processedText = processedText.replace(/https?:\/\/[^\s]+/g, (match) => {
        const placeholder = `__PROTECTED_BLOCK_${index}__`;
        blocks[index++] = match;
        return placeholder;
    });

    return { text: processedText, blocks };
}

/**
 * Restore protected blocks
 */
function restoreBlocks(text, blocks) {
    let restoredText = text;
    for (let i = 0; i < blocks.length; i++) {
        restoredText = restoredText.replace(`__PROTECTED_BLOCK_${i}__`, blocks[i]);
    }
    return restoredText;
}

/**
 * Quick Fix engine - applies multiple passes of text transformation
 * Supports 6 voice modes: casual (natural), conversational, professional (executive),
 * technical, academic, creative.
 */
export function quickFix(text, patterns, style = 'casual') {
    if (!text || text.trim().length === 0) {
        return { text, changes: [] };
    }

    const allChanges = [];
    const protectedInfo = protectBlocks(text);
    let currentText = protectedInfo.text;

    // Normalize newlines and preserve multi-paragraph structure via sentinel tokens
    currentText = currentText.replace(/\r\n/g, '\n');

    // Helper to apply regex replacement and track changes
    const applyChanges = (regex, replacer, passName) => {
        const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
        let newText = currentText.replace(globalRegex, (matchStr, ...args) => {
            const offset = args[args.length - 2];
            const replacement = typeof replacer === 'function' ? replacer(matchStr, ...args) : replacer;
            if (matchStr !== replacement) {
                allChanges.push({
                    original: matchStr,
                    replacement: replacement,
                    position: offset,
                    pass: passName
                });
            }
            return replacement;
        });
        currentText = newText;
    };

    // PASS 0: Watermark, Chat-Prefix & Mechanical Em-Dash Cleaner
    const applyPass0 = () => {
        // Strip zero-width & invisible Unicode watermarks
        applyChanges(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '', 'pass_0_watermark_cleaner');
        // Strip robotic chat preamble lines ("Certainly! Here is...", "Sure, here's...")
        applyChanges(/^(?:certainly|sure|of course|absolutely|great question)[!,.]?\s+here\s+(?:is|are)\s+[^\n:]+:\s*\n+/gim, '', 'pass_0_watermark_cleaner');
        // Normalize excessive mechanical em-dashes (>1 per paragraph) into natural commas or parentheses
        let dashCount = 0;
        applyChanges(/\s*[—–]\s*/g, (match) => {
            dashCount++;
            if (style === 'academic' || style === 'technical' || dashCount % 2 === 0) {
                return ', ';
            }
            return ' — ';
        }, 'pass_0_watermark_cleaner');
    };

    // PASS 1: Remove Filler Phrases
    const applyPass1 = () => {
        if (HEDGING_PHRASES && Array.isArray(HEDGING_PHRASES)) {
            HEDGING_PHRASES.forEach(item => {
                const regex = new RegExp(item.pattern.source, 'gi');
                applyChanges(regex, '', 'pass_1_filler_removal');
            });
        }
        if (FILLER_STARTERS && Array.isArray(FILLER_STARTERS)) {
            FILLER_STARTERS.forEach(item => {
                const regex = new RegExp(item.pattern.source, 'gim');
                applyChanges(regex, '', 'pass_1_filler_removal');
            });
        }
    };

    // Escape special regex chars in a string
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // PASS 2: Wordy Phrase Simplification (Punctuation-Safe Boundaries)
    const applyPass2 = () => {
        if (!PHRASE_REPLACEMENTS) return;
        const iterate = PHRASE_REPLACEMENTS instanceof Map ? PHRASE_REPLACEMENTS : new Map(Object.entries(PHRASE_REPLACEMENTS));
        iterate.forEach((replacement, phrase) => {
            const regex = new RegExp(`(?<![\\w-])${escapeRegex(phrase)}(?![\\w-])`, 'gi');
            applyChanges(regex, (match) => {
                const r = preserveCase(match, replacement);
                return r || '';
            }, 'pass_2_phrase_simplification');
        });
    };

    // PASS 3: AI Vocabulary Replacement with Anti-Repetition Ledger
    const applyPass3 = () => {
        if (!AI_WORDS) return;

        const usedReplacements = new Map();
        const antiRepetitionLedger = new Map(); // Tracks total usage count of each replacement across document
        const recentlyUsedGlobal = [];
        const iterate = AI_WORDS instanceof Map ? AI_WORDS : new Map(Object.entries(AI_WORDS));

        iterate.forEach((data, word) => {
            const regex = new RegExp(`(?<![\\w-])${escapeRegex(word)}(?![\\w-])`, 'gi');
            const alternatives = data.alternatives || data;
            if (!Array.isArray(alternatives) || alternatives.length === 0) return;

            applyChanges(regex, (match) => {
                let pickIndex = 0;
                const wordLower = word.toLowerCase();
                if (!usedReplacements.has(wordLower)) {
                    usedReplacements.set(wordLower, 0);
                }
                const rotation = usedReplacements.get(wordLower);

                if (style === 'casual' || style === 'conversational' || style === 'creative') {
                    pickIndex = rotation % alternatives.length;
                } else if (style === 'academic' || style === 'technical') {
                    pickIndex = (alternatives.length - 1 - (rotation % alternatives.length));
                } else {
                    const mid = Math.floor(alternatives.length / 2);
                    pickIndex = (mid + rotation) % alternatives.length;
                }

                // Select candidate with lowest ledger frequency and not in recent window
                let chosen = alternatives[pickIndex];
                let bestScore = Infinity;
                for (let i = 0; i < alternatives.length; i++) {
                    const candidate = alternatives[(pickIndex + i) % alternatives.length];
                    const candLower = candidate.toLowerCase();
                    const ledgerCount = antiRepetitionLedger.get(candLower) || 0;
                    const recentPenalty = recentlyUsedGlobal.includes(candLower) ? 10 : 0;
                    const score = ledgerCount * 3 + recentPenalty + i * 0.1;
                    if (score < bestScore) {
                        bestScore = score;
                        chosen = candidate;
                    }
                }

                const chosenLower = chosen.toLowerCase();
                antiRepetitionLedger.set(chosenLower, (antiRepetitionLedger.get(chosenLower) || 0) + 1);
                recentlyUsedGlobal.push(chosenLower);
                if (recentlyUsedGlobal.length > 12) recentlyUsedGlobal.shift();

                usedReplacements.set(wordLower, rotation + 1);
                return preserveCase(match, chosen);
            }, 'pass_3_ai_vocab_replacement');
        });
    };

    // PASS 4: Contraction Insertion
    const applyPass4 = () => {
        if (!CONTRACTION_MAP) return;

        let probability = 0.9;
        if (style === 'professional' || style === 'executive' || style === 'technical') probability = 0.55;
        if (style === 'academic') probability = 0.15;

        const iterate = CONTRACTION_MAP instanceof Map ? CONTRACTION_MAP : new Map(Object.entries(CONTRACTION_MAP));
        iterate.forEach((contracted, formal) => {
            if (style === 'academic' && !['do not', 'it is', 'cannot', 'will not'].includes(formal.toLowerCase())) {
                return;
            }
            const regex = new RegExp(`\\b${escapeRegex(formal)}\\b`, 'gi');
            applyChanges(regex, (match) => {
                const seed = match.charCodeAt(0) + match.length;
                if (seededRandom(seed) <= probability) {
                    return preserveCase(match, contracted);
                }
                return match;
            }, 'pass_4_contraction_insertion');
        });
    };

    // PASS 5: Transition Orchestrator (Deduplicated Connector Rotation)
    const applyPass5 = () => {
        if (!TRANSITION_WORDS || !HUMAN_CONNECTORS) return;

        const styleKey = (style === 'executive' || style === 'technical') ? 'professional' : (style === 'creative' ? 'conversational' : style);
        const connectors = HUMAN_CONNECTORS[styleKey] || HUMAN_CONNECTORS['casual'] || ['But', 'And', 'So'];
        let transitionCursor = 0;

        TRANSITION_WORDS.forEach(word => {
            const regex = new RegExp(`([.?!]\\s+|^|\\n\\n)${word}(?:\\s*,\\s*|\\s+)`, 'gi');
            applyChanges(regex, (match, prefix) => {
                const chosenRaw = connectors[transitionCursor % connectors.length];
                transitionCursor++;
                const trimmed = chosenRaw.trim();
                const endsWithPunct = /[,;:\-]$/.test(trimmed);
                const simpleConjunctions = ['and', 'but', 'so', 'or', 'yet', 'plus', 'also', 'now', 'still'];
                const isSimple = simpleConjunctions.includes(trimmed.replace(/[^a-zA-Z]/g, '').toLowerCase());

                let connector = preserveCase(word, trimmed);
                if (!endsWithPunct && !isSimple) {
                    connector += ',';
                }
                return `${prefix}${connector} `;
            }, 'pass_5_transition_replacement');
        });
    };

    // PASS 6: Sentence Restructuring
    const applyPass6 = () => {
        if (!SENTENCE_RESTRUCTURES || !Array.isArray(SENTENCE_RESTRUCTURES)) return;
        SENTENCE_RESTRUCTURES.forEach(rule => {
            const handler = typeof rule.transform === 'function' ? rule.transform : (rule.replacement || rule.transform);
            if (handler) {
                applyChanges(rule.pattern, handler, 'pass_6_sentence_restructuring');
            }
        });
    };

    // PASS 7: Sentence Starter Variation
    const applyPass7 = () => {
        if (!SENTENCE_STARTERS) return;
        const styleKey = (style === 'executive' || style === 'technical') ? 'professional' : (style === 'creative' ? 'conversational' : style);
        const sentences = currentText.split(/([.?!]\s+)/);
        let sameStarterCount = 0;
        let lastStarter = '';
        let starterIdx = 0;

        for (let i = 0; i < sentences.length; i += 2) {
            const sentence = sentences[i];
            const firstWordMatch = sentence.match(/^\s*([a-zA-Z]+)/);
            if (firstWordMatch) {
                const starter = firstWordMatch[1].toLowerCase();
                if (starter === lastStarter && starter.length > 1) {
                    sameStarterCount++;
                    if (sameStarterCount >= 2) {
                        const starters = SENTENCE_STARTERS[styleKey] || SENTENCE_STARTERS['casual'] || ['Well, ', 'In fact, ', 'Actually, '];
                        const chosenStarter = starters[starterIdx % starters.length];
                        starterIdx++;
                        const oldSentence = sentences[i];
                        sentences[i] = sentence.replace(/^\s*([a-zA-Z]+)/, (match) => {
                            return match.replace(firstWordMatch[1], preserveCase(firstWordMatch[1], chosenStarter + firstWordMatch[1].toLowerCase()));
                        });
                        allChanges.push({
                            original: oldSentence,
                            replacement: sentences[i],
                            position: 0,
                            pass: 'pass_7_starter_variation'
                        });
                        sameStarterCount = 0;
                    }
                } else {
                    sameStarterCount = 0;
                    lastStarter = starter;
                }
            }
        }
        currentText = sentences.join('');
    };

    // PASS 8: Sentence Length Variation (Paragraph-Aware)
    const applyPass8 = () => {
        const paragraphs = currentText.split(/\n{2,}/);
        let anyChanged = false;
        const processedParagraphs = paragraphs.map(para => {
            const sentences = para.split(/(?<=[.!?])\s+/);
            const rebuilt = [];
            for (const sentence of sentences) {
                const wordCount = sentence.split(/\s+/).length;
                if (wordCount >= 38) {
                    const splitMatch = sentence.match(/^(.{55,}?,)\s+(and|but|so)\s+(.{20,})$/s);
                    if (splitMatch && splitMatch[1] && splitMatch[3]) {
                        const part2 = splitMatch[3].charAt(0).toUpperCase() + splitMatch[3].slice(1);
                        rebuilt.push(splitMatch[1].trimEnd().replace(/,$/, '') + '.');
                        rebuilt.push(part2);
                        allChanges.push({
                            original: sentence.substring(0, 50) + '...',
                            replacement: '(split into two sentences)',
                            position: 0,
                            pass: 'pass_8_length_variation'
                        });
                        anyChanged = true;
                        continue;
                    }
                }
                rebuilt.push(sentence);
            }
            return rebuilt.join(' ');
        });
        if (anyChanged) {
            currentText = processedParagraphs.join('\n\n');
        }
    };

    // PASS 9: Natural Rhythm & Voice Polish
    const applyPass9 = () => {
        if (style === 'academic' || style === 'professional' || style === 'executive' || style === 'technical') return;
        const dashRegex = /\b(\w+)\s+(which is|that is)\s+((?!\w+(?:ing|ed|s)\b)[a-z]\w*)\b/gi;
        applyChanges(dashRegex, (match, word1, transition, word2) => {
            return `${word1} (${transition} ${word2})`;
        }, 'pass_9_natural_imperfections');
    };

    const ABBREVIATIONS = new Set(['vs', 'etc', 'e.g', 'i.e', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'ave', 'approx', 'dept', 'est', 'min', 'max', 'govt', 'inc', 'corp', 'ltd', 'no', 'vol', 'fig', 'eq', 'ref']);

    // Phonetic helper for "a" vs "an" self-healer
    const requiresAnArticle = (rawWord) => {
        const clean = rawWord.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
        if (!clean) return false;
        // Acronyms / initialisms pronounced with a leading vowel sound (e.g. "an LLM", "an API", "an MBA", "an SQL", "an HTTP")
        if (/^(?:LLM|API|SDK|SLA|SLO|SRE|SSO|SSH|SQL|HTML|HTTP|HTTPS|MCP|NLI|AST|RFC|ORM|FPS|GPU|CPU|IDE|MBA|MVP|nda|faq)$/i.test(clean) && clean === clean.toUpperCase()) {
            return /^(?:[AEFILMNORSX]|HTTP|HTML|SQL|LLM|API|SDK|SLA|SLO|SRE|SSO|SSH|MCP|NLI|AST|RFC|ORM|FPS|MBA|MVP)/i.test(clean);
        }
        // Silent 'h' words -> "an hour", "an honest", "an honor", "an heir"
        if (/^(?:hour|honest|honor|honour|heir|herb\b)/i.test(clean)) return true;
        // 'yoo' or 'wun' sounds starting with vowels -> "a unique", "a uniform", "a user", "a European", "a one-time"
        if (/^(?:uni|use|us[eu]|ubi|uro|eur|util|one\b|once\b)/i.test(clean)) return false;
        return /^[aeiou]/i.test(clean);
    };

    // PASS 10: Phonetic a/an Self-Healer & Multi-Paragraph Safe Cleanup
    const applyPass10 = () => {
        applyChanges(/\b(a|an)\s+([a-zA-Z0-9][\w-]*)/gi, (match, article, nextWord) => {
            const wantAn = requiresAnArticle(nextWord);
            const targetArticle = wantAn ? 'an' : 'a';
            const casedArticle = preserveCase(article, targetArticle);
            return `${casedArticle} ${nextWord}`;
        }, 'pass_10_phonetic_a_an_healer');

        // Collapse horizontal double spaces without destroying paragraph breaks (\n\n)
        applyChanges(/[^\S\r\n]{2,}/g, ' ', 'pass_10_cleanup');
        applyChanges(/\n{3,}/g, '\n\n', 'pass_10_cleanup');

        // Fix spacing around punctuation without eating newlines
        applyChanges(/[^\S\r\n]+([.,?!])/g, (match, punct) => punct, 'pass_10_cleanup');
        applyChanges(/([.,?!])([a-zA-Z])/g, (match, punct, letter) => `${punct} ${letter}`, 'pass_10_cleanup');

        // Capitalize after sentence-ending punctuation
        applyChanges(/(\w+)([.?!])([^\S\r\n]+|\n+)([a-z])/g, (match, prevWord, punct, ws, letter) => {
            const lower = prevWord.toLowerCase();
            if (ABBREVIATIONS.has(lower) || (prevWord.length <= 3 && /^[A-Z]+$/.test(prevWord))) {
                return match;
            }
            if (/^\d+$/.test(prevWord)) {
                return match;
            }
            return `${prevWord}${punct}${ws}${letter.toUpperCase()}`;
        }, 'pass_10_cleanup');
    };

    // Execute 11-step deterministic pipeline
    applyPass0();
    applyPass1();
    applyPass2();
    applyPass3();
    applyPass4();
    applyPass5();
    applyPass6();
    applyPass7();
    applyPass8();
    applyPass9();
    applyPass10();

    // Restore protected blocks
    currentText = restoreBlocks(currentText, protectedInfo.blocks);

    return {
        text: currentText.trim(),
        changes: allChanges
    };
}


/**
 * Deep Rewrite using AI
 * Kept EXACTLY as the current implementation as requested
 */
export async function deepRewrite(text, apiKey, style = 'casual', provider = 'openai') {
  if (!text || !apiKey) {
    return { text, error: "Missing text or API key" };
  }

  const systemPrompt = `You are a skilled human editor. Rewrite the following text to sound completely natural and human-written. 

Rules:
- Preserve the original meaning and key information
- Use contractions naturally (don't, it's, they're)
- Vary sentence length — mix short punchy sentences with longer ones
- Avoid AI cliché words: delve, crucial, landscape, leverage, utilize, robust, seamless, etc.
- Use concrete, specific language instead of vague buzzwords
- Add natural imperfections — the occasional dash, parenthetical, or informal aside
- Match this writing style: ${style}
- Don't add disclaimers or notes about what you changed
- Just output the rewritten text, nothing else`;

  try {
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'OpenAI API error');
      }

      const data = await response.json();
      return { text: data.choices[0].message.content.trim() };
      
    } else if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            parts: [{ text: text }]
          }]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Gemini API error');
      }

      const data = await response.json();
      const rewritten = data.candidates?.[0]?.content?.parts?.[0]?.text || text;
      return { text: rewritten.trim() };

    } else if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'dangerously-allow-browser': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [
            { role: 'user', content: text }
          ]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Anthropic API error');
      }

      const data = await response.json();
      const content = data.content?.map(c => c.text).join('') || text;
      return { text: content.trim() };

    } else if (provider === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'DeepSeek API error');
      }

      const data = await response.json();
      return { text: data.choices[0].message.content.trim() };

    } else {
      return { text, error: "Unknown provider" };
    }
  } catch (error) {
    return { text, error: error.message || 'An error occurred during rewrite' };
  }
}
