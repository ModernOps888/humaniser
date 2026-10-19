import { transformHumaniser, VOICE_MODES } from './workbench.js';

/**
 * Quick Fix — deterministic, client-side humanisation.
 *
 * Delegates to transformHumaniser() in ./workbench.js, a port of the live workbench engine at
 * https://infinitytechstack.uk/humaniser. The `patterns` argument (detector output) is accepted
 * for backward compatibility with older callers but is not used by the engine.
 *
 * @param {string} text
 * @param {Array<Object>} [_patterns] unused
 * @param {string} [style='chat'] one of VOICE_MODES ids: chat, casual, email, executive, academic, technical
 * @param {object} [options] intensity, useContractions, stripChatWrappers, normalizeEmDashes, variationSeed
 * @returns {{text: string, changes: Array<{replacement: string}>, changeCount: number,
 *            replacementsCount: number, structuresFixed: number, emDashesFixed: number,
 *            watermarksStripped: number, changedTerms: string[]}}
 */
export function quickFix(text, _patterns, style = 'chat', options = {}) {
  if (!text || text.trim().length === 0) {
    return { text, changes: [], changeCount: 0, replacementsCount: 0, structuresFixed: 0, emDashesFixed: 0, watermarksStripped: 0, changedTerms: [] };
  }
  const r = transformHumaniser(text, { ...options, style });
  return {
    ...r,
    // `changes` lists the distinct replacement terms the engine inserted (used for highlighting).
    changes: r.changedTerms.map((t) => ({ replacement: t })),
    // Total edits = word/phrase/transition replacements + structural rewrites + dash fixes.
    changeCount: r.replacementsCount + r.structuresFixed + r.emDashesFixed,
  };
}

/** Human-readable label for a voice mode id (used in the Deep Rewrite prompt). */
function styleLabel(style) {
  const mode = VOICE_MODES.find((m) => m.id === style);
  return mode ? `${mode.label} (${mode.desc})` : style;
}

/** Model IDs used by Deep Rewrite, per provider. Keep README.md in sync. */
export const DEEP_REWRITE_MODELS = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-5-5',
  deepseek: 'deepseek-chat',
};

/**
 * Deep Rewrite using the user's own API key (OpenAI, Gemini, Anthropic or DeepSeek).
 */
export async function deepRewrite(text, apiKey, style = 'chat', provider = 'openai') {
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
- Match this writing style: ${styleLabel(style)}
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
          model: DEEP_REWRITE_MODELS.openai,
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
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${DEEP_REWRITE_MODELS.gemini}:generateContent?key=${apiKey}`, {
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
          // Required for direct browser (CORS) access to the Messages API.
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: DEEP_REWRITE_MODELS.anthropic,
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
          model: DEEP_REWRITE_MODELS.deepseek,
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
