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
 */
export function quickFix(text, patterns, style = 'casual') {
    if (!text || text.trim().length === 0) {
        return { text, changes: [] };
    }

    const allChanges = [];
    const protectedInfo = protectBlocks(text);
    let currentText = protectedInfo.text;

    // Helper to apply regex replacement and track changes
    const applyChanges = (regex, replacer, passName) => {
        let match;
        // Create a new RegExp based on the passed one, adding 'g' flag if missing
        const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
        
        // We use string.replace to actually change the text, but we also want to track changes.
        // It's tricky to track exact positions as the string mutates, so we'll just track the before/after string.
        let newText = currentText.replace(globalRegex, (matchStr, ...args) => {
            // Find the offset (last argument before the full string)
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

    // PASS 1: Remove Filler Phrases
    const applyPass1 = () => {
        if (HEDGING_PHRASES && Array.isArray(HEDGING_PHRASES)) {
            HEDGING_PHRASES.forEach(item => {
                // Each item is {pattern: RegExp, severity, suggestion}
                const regex = new RegExp(item.pattern.source, 'gi');
                applyChanges(regex, '', 'pass_1_filler_removal');
            });
        }
        
        if (FILLER_STARTERS && Array.isArray(FILLER_STARTERS)) {
            FILLER_STARTERS.forEach(item => {
                // Each item is {pattern: RegExp, severity}
                const regex = new RegExp(item.pattern.source, 'gim');
                applyChanges(regex, '', 'pass_1_filler_removal');
            });
        }
    };

    // Escape special regex chars in a string
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // PASS 2: Wordy Phrase Simplification
    const applyPass2 = () => {
        if (!PHRASE_REPLACEMENTS) return;
        // PHRASE_REPLACEMENTS is a Map<string, string>
        const iterate = PHRASE_REPLACEMENTS instanceof Map ? PHRASE_REPLACEMENTS : new Map(Object.entries(PHRASE_REPLACEMENTS));
        iterate.forEach((replacement, phrase) => {
            const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
            applyChanges(regex, (match) => {
                const r = preserveCase(match, replacement);
                return r || '';
            }, 'pass_2_phrase_simplification');
        });
    };

    // PASS 3: AI Vocabulary Replacement
    const applyPass3 = () => {
        if (!AI_WORDS) return;
        
        const usedReplacements = new Map();
        const recentlyUsedGlobal = []; // Track recent replacements to avoid adjacent duplicates
        // AI_WORDS is a Map<string, {alternatives: string[], severity: number}>
        const iterate = AI_WORDS instanceof Map ? AI_WORDS : new Map(Object.entries(AI_WORDS));
        
        iterate.forEach((data, word) => {
            const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
            const alternatives = data.alternatives || data;
            
            if (!Array.isArray(alternatives) || alternatives.length === 0) return;
            
            applyChanges(regex, (match) => {
                // Pick alternative based on style:
                // casual: first (most informal), academic: last (most formal),
                // professional: middle, conversational: first
                let pickIndex = 0;
                const wordLower = word.toLowerCase();
                if (!usedReplacements.has(wordLower)) {
                    usedReplacements.set(wordLower, 0);
                }
                const rotation = usedReplacements.get(wordLower);
                
                if (style === 'casual' || style === 'conversational') {
                    pickIndex = rotation % alternatives.length;
                } else if (style === 'academic') {
                    pickIndex = (alternatives.length - 1 - rotation % alternatives.length);
                } else {
                    // professional: start from middle
                    const mid = Math.floor(alternatives.length / 2);
                    pickIndex = (mid + rotation) % alternatives.length;
                }
                
                // Avoid using a replacement that was just used nearby
                let chosen = alternatives[pickIndex];
                if (recentlyUsedGlobal.includes(chosen.toLowerCase()) && alternatives.length > 1) {
                    // Try the next alternative
                    for (let i = 1; i < alternatives.length; i++) {
                        const alt = alternatives[(pickIndex + i) % alternatives.length];
                        if (!recentlyUsedGlobal.includes(alt.toLowerCase())) {
                            chosen = alt;
                            break;
                        }
                    }
                }
                
                recentlyUsedGlobal.push(chosen.toLowerCase());
                if (recentlyUsedGlobal.length > 10) recentlyUsedGlobal.shift();
                
                usedReplacements.set(wordLower, rotation + 1);
                return preserveCase(match, chosen);
                
            }, 'pass_3_ai_vocab_replacement');
        });
    };

    // PASS 4: Contraction Insertion
    const applyPass4 = () => {
        if (!CONTRACTION_MAP) return;
        
        let probability = 0.9;
        if (style === 'professional') probability = 0.6;
        if (style === 'academic') probability = 0.2;

        // CONTRACTION_MAP is a Map<string, string>
        const iterate = CONTRACTION_MAP instanceof Map ? CONTRACTION_MAP : new Map(Object.entries(CONTRACTION_MAP));
        iterate.forEach((contracted, formal) => {
            // Only apply academic to basic ones
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

    // PASS 5: Transition Word Replacement
    const applyPass5 = () => {
        if (!TRANSITION_WORDS || !HUMAN_CONNECTORS) return;
        
        const connectors = HUMAN_CONNECTORS[style] || HUMAN_CONNECTORS['casual'] || ['But', 'And', 'So'];
        
        TRANSITION_WORDS.forEach(word => {
            // Match transition words at the start of sentences (with optional comma after)
            const regex = new RegExp(`([.?!]\\s+|^)${word}(?:\\s*,\\s*|\\s+)`, 'gi');
            applyChanges(regex, (match, prefix) => {
                const seed = match.charCodeAt(0) + match.length;
                if (seededRandom(seed) <= 0.65) { // 65% replacement rate
                    const randomConnector = connectors[Math.floor(seededRandom(seed + 1) * connectors.length)];
                    // Clean up the connector: if it already ends with punctuation, use as-is
                    const trimmed = randomConnector.trim();
                    const endsWithPunct = /[,;:\-]$/.test(trimmed);
                    // Simple conjunctions (And, But, So, Or, Yet) don't need a comma
                    const simpleConjunctions = ['and', 'but', 'so', 'or', 'yet', 'plus', 'also', 'now', 'still'];
                    const isSimple = simpleConjunctions.includes(trimmed.replace(/[^a-zA-Z]/g, '').toLowerCase());
                    
                    let connector = preserveCase(word, trimmed);
                    if (!endsWithPunct && !isSimple) {
                        connector += ',';
                    }
                    return `${prefix}${connector} `;
                }
                return match;
            }, 'pass_5_transition_replacement');
        });
    };

    // PASS 6: Sentence Restructuring
    const applyPass6 = () => {
        if (!SENTENCE_RESTRUCTURES || !Array.isArray(SENTENCE_RESTRUCTURES)) return;
        
        SENTENCE_RESTRUCTURES.forEach(rule => {
            // Each rule has {pattern: RegExp, transform: function|string}
            const handler = typeof rule.transform === 'function' ? rule.transform : (rule.replacement || rule.transform);
            if (handler) {
                applyChanges(rule.pattern, handler, 'pass_6_sentence_restructuring');
            }
        });
    };

    // PASS 7: Sentence Starter Variation
    const applyPass7 = () => {
        if (!SENTENCE_STARTERS) return;
        
        // This is complex to do with pure regex on the whole block.
        // We will split into sentences for this pass.
        const sentences = currentText.split(/([.?!]\s+)/);
        let sameStarterCount = 0;
        let lastStarter = '';
        
        for (let i = 0; i < sentences.length; i += 2) {
            const sentence = sentences[i];
            const firstWordMatch = sentence.match(/^\s*([a-zA-Z]+)/);
            
            if (firstWordMatch) {
                const starter = firstWordMatch[1].toLowerCase();
                if (starter === lastStarter && starter.length > 1) {
                    sameStarterCount++;
                    if (sameStarterCount >= 2) { // 3rd sentence with same starter
                        const starters = SENTENCE_STARTERS[style] || SENTENCE_STARTERS['casual'] || ['Well, ', 'In fact, ', 'Actually, '];
                        const randomStarter = starters[Math.floor(Math.random() * starters.length)];
                        
                        const oldSentence = sentences[i];
                        sentences[i] = sentence.replace(/^\s*([a-zA-Z]+)/, (match) => {
                            return match.replace(firstWordMatch[1], preserveCase(firstWordMatch[1], randomStarter + firstWordMatch[1].toLowerCase()));
                        });
                        
                        allChanges.push({
                            original: oldSentence,
                            replacement: sentences[i],
                            position: 0, // Approx
                            pass: 'pass_7_starter_variation'
                        });
                        
                        sameStarterCount = 0; // Reset
                    }
                } else {
                    sameStarterCount = 0;
                    lastStarter = starter;
                }
            }
        }
        
        currentText = sentences.join('');
    };

    // PASS 8: Sentence Length Variation
    const applyPass8 = () => {
        // Only split truly long sentences (40+ words) at natural conjunction points
        // Be conservative: only split if both halves are substantial
        const sentences = currentText.split(/(?<=[.!?])\s+/);
        const rebuilt = [];
        let changed = false;
        
        for (const sentence of sentences) {
            const wordCount = sentence.split(/\s+/).length;
            if (wordCount >= 40) {
                // Try to split at ", and " or ", but " or "; " (natural break points only)
                const splitMatch = sentence.match(/^(.{60,}?,)\s+(and|but|so)\s+(.{20,})$/s);
                if (splitMatch && splitMatch[1] && splitMatch[3]) {
                    const part2 = splitMatch[3].charAt(0).toUpperCase() + splitMatch[3].slice(1);
                    rebuilt.push(splitMatch[1].trimEnd() + '.');
                    rebuilt.push(part2);
                    allChanges.push({
                        original: sentence.substring(0, 50) + '...',
                        replacement: '(split into two sentences)',
                        position: 0,
                        pass: 'pass_8_length_variation'
                    });
                    changed = true;
                    continue;
                }
            }
            rebuilt.push(sentence);
        }
        
        if (changed) {
            currentText = rebuilt.join(' ');
        }
    };

    // PASS 9: Natural Imperfections
    const applyPass9 = () => {
        if (style === 'academic') return; // Minimal imperfections for academic
        if (style === 'professional') return; // Keep professional clean
        
        // Add occasional em-dashes for explanatory "which is" / "that is" clauses
        // Only match when followed by an adjective/noun (not a verb like -ing/-ed)
        const dashRegex = /\b(\w+)\s+(which is|that is)\s+((?!\w+(?:ing|ed|s)\b)[a-z]\w*)\b/gi;
        applyChanges(dashRegex, (match, word1, transition, word2) => {
            if (Math.random() > 0.8) {
                return `${word1} — ${transition} — ${word2}`;
            }
            return match;
        }, 'pass_9_natural_imperfections');
    };

    // Common abbreviations that should NOT trigger capitalization after their period
    const ABBREVIATIONS = new Set(['vs', 'etc', 'e.g', 'i.e', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'ave', 'approx', 'dept', 'est', 'min', 'max', 'govt', 'inc', 'corp', 'ltd', 'no', 'vol', 'fig', 'eq', 'ref']);

    // PASS 10: Final Cleanup
    const applyPass10 = () => {
        // Fix a/an article mismatches caused by vocabulary swaps
        const vowelSound = /^[aeiou]/i;
        // "an" before consonant sound → "a"
        applyChanges(/\b(an)\s+([bcdfghjklmnpqrstvwxyz]\w*)/gi, (match, article, word) => {
            return `${preserveCase(article, 'a')} ${word}`;
        }, 'pass_10_cleanup');
        // "a" before vowel sound → "an"
        applyChanges(/\b(a)\s+([aeiou]\w*)/gi, (match, article, word) => {
            // Skip "a us..." "a un..." "a eu..." (sounds like 'yoo')
            if (/^(uni|use|us[eu]|ubi|uro|eur|util)/i.test(word)) return match;
            return `${preserveCase(article, 'an')} ${word}`;
        }, 'pass_10_cleanup');

        // Remove double spaces
        applyChanges(/ {2,}/g, ' ', 'pass_10_cleanup');
        
        // Fix spacing around punctuation (use function callbacks, not string backrefs)
        applyChanges(/\s+([.,?!])/g, (match, punct) => punct, 'pass_10_cleanup');
        applyChanges(/([.,?!])([a-zA-Z])/g, (match, punct, letter) => `${punct} ${letter}`, 'pass_10_cleanup');
        
        // Capitalize after sentence-ending punctuation, but not after abbreviations
        applyChanges(/(\w+)([.?!])\s+([a-z])/g, (match, prevWord, punct, letter) => {
            // Don't capitalize after abbreviations or single uppercase letters (like initials)
            const lower = prevWord.toLowerCase();
            if (ABBREVIATIONS.has(lower) || (prevWord.length <= 3 && /^[A-Z]+$/.test(prevWord))) {
                return match;
            }
            // Don't capitalize after decimal numbers
            if (/^\d+$/.test(prevWord)) {
                return match;
            }
            return `${prevWord}${punct} ${letter.toUpperCase()}`;
        }, 'pass_10_cleanup');
    };

    // Execute pipeline
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
