import { createGauge } from './js/gauge.js';
import { highlightPatterns, clearHighlights } from './js/highlighter.js';

// Stub imports for modules not strictly requested but assumed to exist
let analyse = (text) => ({ score: 75, patterns: [], stats: { wordCount: text.split(/\s+/).filter(w=>w).length, sentenceCount: text.split(/[.!?]+/).filter(w=>w).length, readingLevel: 'Medium', passiveVoicePercent: 0, avgSentenceLength: 0, sentenceLengthVariance: 0, contractionRate: 0, transitionDensity: 0, patternsByCategory: {} } });
let quickFix = (text) => ({ text, changes: [] });
let deepRewrite = async (text) => ({ text });
let getEntries = () => [];
let saveEntry = () => {};
let deleteEntry = () => {};
let clearHistoryAPI = () => {};

// Try importing real ones if they exist
try {
  const detector = await import('./js/detector.js');
  analyse = detector.analyse || analyse;
} catch (e) { console.warn('Humaniser: detector.js import failed', e); }
try {
  const humaniser = await import('./js/humaniser.js');
  quickFix = humaniser.quickFix || quickFix;
  deepRewrite = humaniser.deepRewrite || deepRewrite;
} catch (e) { console.warn('Humaniser: humaniser.js import failed', e); }
let analyzeAIProbabilities = null;
let highlightChangedTerms = () => null;
try {
  const workbench = await import('./js/workbench.js');
  analyzeAIProbabilities = workbench.analyzeAIProbabilities;
  highlightChangedTerms = workbench.highlightChangedTerms;
} catch (e) { console.warn('Humaniser: workbench.js import failed', e); }
try {
  const history = await import('./js/history.js');
  getEntries = history.getEntries || getEntries;
  saveEntry = history.saveEntry || saveEntry;
  deleteEntry = history.deleteEntry || deleteEntry;
  clearHistoryAPI = history.clearHistory || clearHistoryAPI;
} catch (e) { console.warn('Humaniser: history.js import failed', e); }

// DOM is already ready since script is at the bottom of <body> and we used top-level await
(function init() {
  // Elements
  const btnTheme = document.getElementById('btn-theme');
  const iconSun = btnTheme.querySelector('.icon-sun');
  const iconMoon = btnTheme.querySelector('.icon-moon');
  const btnHistory = document.getElementById('btn-history');
  const btnSettings = document.getElementById('btn-settings');
  
  const textarea = document.getElementById('input-text');
  const highlightLayer = document.getElementById('input-highlight-layer');
  const outputText = document.getElementById('output-text');
  
  const btnAnalyse = document.getElementById('btn-analyse');
  const btnQuickFix = document.getElementById('btn-quickfix');
  const btnDeepRewrite = document.getElementById('btn-deeprewrite');
  
  const btnPaste = document.getElementById('btn-paste');
  const btnClear = document.getElementById('btn-clear');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');
  
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('settings-close');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const inputApiKey = document.getElementById('api-key');
  const selectApiProvider = document.getElementById('api-provider');
  const btnToggleKey = document.getElementById('btn-toggle-key');
  
  const historyPanel = document.getElementById('history-panel');
  const historyBackdrop = document.getElementById('history-backdrop');
  const btnCloseHistory = document.getElementById('btn-close-history');
  
  const statWords = document.getElementById('stat-words');
  const statSentences = document.getElementById('stat-sentences');
  const statReading = document.getElementById('stat-reading');
  const statPassive = document.getElementById('stat-passive');
  const patternCount = document.getElementById('pattern-count');

  const styleSelect = document.getElementById('style-select');
  const intensitySelect = document.getElementById('intensity-select');
  const optStripWrappers = document.getElementById('opt-strip-wrappers');
  const optEmDash = document.getElementById('opt-emdash');
  const optContractions = document.getElementById('opt-contractions');
  const optAuto = document.getElementById('opt-auto');
  const btnVariation = document.getElementById('btn-variation');
  const btnHighlight = document.getElementById('btn-highlight');
  const outputMetrics = document.getElementById('output-metrics');
  
  // State
  let currentAnalysis = null;
  let variationSeed = 0;          // 0..3, cycled by the Variation button
  let showHighlights = false;     // "Highlight changes" toggle
  let lastOutput = '';            // plain-text output (copy/download source of truth)
  let lastChangedTerms = [];      // terms inserted by the last Quick Fix
  const gauge = createGauge(document.getElementById('gauge-container'));
  
  // Theme Setup
  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      iconSun.style.display = 'none';
      iconMoon.style.display = 'block';
    } else {
      iconSun.style.display = 'block';
      iconMoon.style.display = 'none';
    }
  };
  const savedTheme = localStorage.getItem('humaniser_theme') || 'light';
  applyTheme(savedTheme);
  
  btnTheme.addEventListener('click', () => {
    document.body.classList.add('theme-transitioning');
    const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('humaniser_theme', newTheme);
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 300);
  });
  
  // Settings Load
  const loadSettings = () => {
    const settings = JSON.parse(localStorage.getItem('humaniser_settings') || '{}');
    if (settings.provider) selectApiProvider.value = settings.provider;
    if (settings.key) inputApiKey.value = settings.key;
  };
  loadSettings();
  
  // Toast
  const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fadeOut');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // Sync scroll between textarea and highlight layer
  textarea.addEventListener('scroll', () => {
    highlightLayer.scrollTop = textarea.scrollTop;
    highlightLayer.scrollLeft = textarea.scrollLeft;
  });
  
  // Sync size/text changes
  textarea.addEventListener('input', () => {
    const text = textarea.value;
    const hasText = text.trim().length > 0;
    btnAnalyse.disabled = !hasText;
    
    // Clear highlights on edit to avoid misalignment
    clearHighlights(highlightLayer);
    btnQuickFix.disabled = true;
    
    // Auto analyse debounce (+ auto-humanise when enabled)
    clearTimeout(textarea._analyseTimeout);
    textarea._analyseTimeout = setTimeout(() => {
      if (hasText) {
        performAnalysis();
        if (optAuto.checked) runQuickFix({ quiet: true });
      }
    }, optAuto.checked ? 350 : 800);
  });
  
  // Perform Analysis
  const performAnalysis = () => {
    const text = textarea.value;
    if (!text.trim()) return;
    
    currentAnalysis = analyse(text);
    gauge.update(currentAnalysis.score);
    
    const s = currentAnalysis.stats;
    statWords.textContent = s.wordCount;
    statSentences.textContent = s.sentenceCount;
    statReading.textContent = s.readingLevel;
    statPassive.textContent = Math.round(s.passiveVoicePercent * 100) + '%';
    
    patternCount.textContent = `${currentAnalysis.patterns.length} patterns found`;
    
    // Update legend bar
    const legendBar = document.getElementById('legend-bar');
    const legendItems = document.getElementById('legend-items');
    if (currentAnalysis.patterns.length > 0) {
      legendBar.style.display = 'flex';
      legendItems.innerHTML = '';
      const cats = s.patternsByCategory || {};
      const categoryMeta = {
        vocabulary: { label: 'Vocabulary', color: '#E8634A' },
        phrase: { label: 'AI Phrases', color: '#9B59B6' },
        structure: { label: 'Structure', color: '#3498DB' },
        tone: { label: 'Tone', color: '#E67E22' },
        flow: { label: 'Flow', color: '#1ABC9C' },
        hedging: { label: 'Hedging', color: '#F39C12' }
      };
      for (const [cat, count] of Object.entries(cats)) {
        if (count > 0 && categoryMeta[cat]) {
          const item = document.createElement('span');
          item.className = 'legend-item';
          item.innerHTML = `<span class="legend-dot" style="background:${categoryMeta[cat].color}"></span>${categoryMeta[cat].label} <span class="legend-count">${count}</span>`;
          legendItems.appendChild(item);
        }
      }
    } else {
      legendBar.style.display = 'none';
    }
    
    highlightPatterns(highlightLayer, text, currentAnalysis.patterns);
    
    btnQuickFix.disabled = false;
    btnDeepRewrite.disabled = false;
  };
  
  btnAnalyse.addEventListener('click', performAnalysis);

  // Render output: plain text, or with <mark> around inserted terms when "Highlight changes" is on.
  // Built with DOM nodes (never innerHTML) so pasted text can't inject markup.
  const renderOutput = () => {
    outputText.textContent = '';
    const segments = showHighlights ? highlightChangedTerms(lastOutput, lastChangedTerms) : null;
    if (!segments) {
      outputText.textContent = lastOutput;
    } else {
      for (const seg of segments) {
        if (seg.isMatch) {
          const mark = document.createElement('mark');
          mark.className = 'change-mark';
          mark.textContent = seg.part;
          outputText.appendChild(mark);
        } else {
          outputText.appendChild(document.createTextNode(seg.part));
        }
      }
    }
    const hasOutput = lastOutput.length > 0;
    btnCopy.disabled = !hasOutput;
    btnDownload.disabled = !hasOutput;
    btnHighlight.disabled = !hasOutput || lastChangedTerms.length === 0;
  };

  // Site metrics line under the output (AI risk %, burstiness CV, dashes/watermarks).
  const renderMetrics = (inputText, outputStr) => {
    if (!analyzeAIProbabilities || !outputStr) { outputMetrics.textContent = ''; return; }
    const before = analyzeAIProbabilities(inputText);
    const after = analyzeAIProbabilities(outputStr);
    outputMetrics.textContent =
      `AI risk ${before.rawAIScore}% → ${after.rawAIScore}% · burstiness CV ${before.burstinessCV} → ${after.burstinessCV}` +
      ` · dashes/watermarks ${before.emDashCount + before.watermarkChars} → ${after.emDashCount + after.watermarkChars}`;
  };

  const getQuickFixOptions = () => ({
    intensity: intensitySelect.value,
    useContractions: optContractions.checked,
    stripChatWrappers: optStripWrappers.checked,
    normalizeEmDashes: optEmDash.checked,
    variationSeed,
  });
  
  // Fixes
  const runQuickFix = ({ quiet = false } = {}) => {
    const input = textarea.value;
    if (!input.trim()) return;
    if (!currentAnalysis) currentAnalysis = analyse(input);
    const style = styleSelect.value;
    const result = quickFix(input, currentAnalysis.patterns, style, getQuickFixOptions());
    lastOutput = result.text || '';
    lastChangedTerms = result.changedTerms || [];
    renderOutput();
    renderMetrics(input, lastOutput);
    btnVariation.disabled = false;
    
    const newScore = analyse(lastOutput).score;
    gauge.update(newScore);
    if (!quiet) {
      saveEntry({ originalText: input, humanisedText: lastOutput, originalScore: currentAnalysis.score, humanisedScore: newScore, mode: 'Quick Fix', style });
      const n = result.changeCount || 0;
      showToast(`Applied ${n} fix${n !== 1 ? 'es' : ''} successfully!`);
    }
  };

  btnQuickFix.addEventListener('click', () => runQuickFix());

  btnVariation.addEventListener('click', () => {
    variationSeed = (variationSeed + 1) % 4;
    btnVariation.textContent = `↻ Variation v${variationSeed + 1}`;
    runQuickFix({ quiet: true });
  });

  btnHighlight.addEventListener('click', () => {
    showHighlights = !showHighlights;
    btnHighlight.setAttribute('aria-pressed', String(showHighlights));
    btnHighlight.textContent = showHighlights ? 'Changes highlighted' : 'Highlight changes';
    renderOutput();
  });

  // Re-run automatically when an option changes and auto-humanise is on
  [styleSelect, intensitySelect, optStripWrappers, optEmDash, optContractions].forEach((el) => {
    el.addEventListener('change', () => { if (optAuto.checked && textarea.value.trim()) runQuickFix({ quiet: true }); });
  });
  optAuto.addEventListener('change', () => { if (optAuto.checked && textarea.value.trim()) runQuickFix({ quiet: true }); });
  
  btnDeepRewrite.addEventListener('click', async () => {
    const settings = JSON.parse(localStorage.getItem('humaniser_settings') || '{}');
    if (!settings.key) {
      settingsModal.style.display = 'flex';
      return;
    }
    
    const style = document.getElementById('style-select').value;
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
      const result = await deepRewrite(textarea.value, settings.key, style, settings.provider || 'openai');
      const outputStr = typeof result === 'object' ? result.text : result;
      if (result && result.error) {
        showToast(result.error, 'error');
        return;
      }
      lastOutput = outputStr || '';
      lastChangedTerms = [];
      renderOutput();
      renderMetrics(textarea.value, lastOutput);
      
      const newAnalysis = analyse(outputStr);
      const newScore = newAnalysis.score;
      gauge.update(newScore);
      saveEntry({ originalText: textarea.value, humanisedText: outputStr, originalScore: currentAnalysis ? currentAnalysis.score : 0, humanisedScore: newScore, mode: 'Deep Rewrite', style });
      showToast('Deep rewrite complete!');
    } catch (e) {
      showToast('Error during deep rewrite: ' + (e.message || e), 'error');
    } finally {
      document.getElementById('loading-overlay').style.display = 'none';
    }
  });
  
  // Editor Actions
  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
    } catch (e) {
      showToast('Failed to paste from clipboard', 'error');
    }
  });
  
  btnClear.addEventListener('click', () => {
    textarea.value = '';
    lastOutput = '';
    lastChangedTerms = [];
    renderOutput();
    outputMetrics.textContent = '';
    clearHighlights(highlightLayer);
    gauge.update(0);
    btnAnalyse.disabled = true;
    btnQuickFix.disabled = true;
    btnDeepRewrite.disabled = true;
    btnVariation.disabled = true;
    statWords.textContent = '0';
    statSentences.textContent = '0';
    statReading.textContent = '—';
    statPassive.textContent = '0%';
    patternCount.textContent = '';
  });
  
  btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(lastOutput);
    showToast('Copied to clipboard!');
  });
  
  btnDownload.addEventListener('click', () => {
    const blob = new Blob([lastOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'humanised-text.txt';
    a.click();
    URL.revokeObjectURL(url);
  });
  
  // Settings
  btnSettings.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
  btnCloseSettings.addEventListener('click', () => { settingsModal.style.display = 'none'; });
  
  btnToggleKey.addEventListener('click', () => {
    inputApiKey.type = inputApiKey.type === 'password' ? 'text' : 'password';
  });
  
  btnSaveSettings.addEventListener('click', () => {
    localStorage.setItem('humaniser_settings', JSON.stringify({
      provider: selectApiProvider.value,
      key: inputApiKey.value
    }));
    settingsModal.style.display = 'none';
    showToast('Settings saved!');
  });
  
  // History
  const formatTimeAgo = (timestamp) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const openHistory = () => {
    const list = document.getElementById('history-list');
    const entries = getEntries();
    const emptyEl = document.getElementById('history-empty');
    if (entries.length === 0) {
      list.innerHTML = '';
      if (emptyEl) list.appendChild(emptyEl.cloneNode(true));
    } else {
      list.innerHTML = '';
      entries.forEach((e) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const preview = (e.originalText || '').substring(0, 80);
        const scoreDisplay = e.humanisedScore != null ? `${e.originalScore || '?'} → ${e.humanisedScore}` : (e.originalScore || '—');
        div.innerHTML = `
          <div class="history-item-header">
            <span class="history-mode">${e.mode || 'Unknown'}</span>
            <span class="history-time">${formatTimeAgo(e.timestamp)}</span>
          </div>
          <div class="history-item-preview">${preview}${preview.length >= 80 ? '…' : ''}</div>
          <div class="history-item-footer">
            <span class="history-score">Score: ${scoreDisplay}</span>
            <button class="history-delete panel-btn" data-id="${e.id}" title="Delete">✕</button>
          </div>
        `;
        div.querySelector('.history-delete').addEventListener('click', (ev) => {
          ev.stopPropagation();
          deleteEntry(e.id);
          openHistory();
          showToast('Entry removed', 'info');
        });
        div.addEventListener('click', () => {
          textarea.value = e.originalText || '';
          lastOutput = e.humanisedText || '';
          lastChangedTerms = [];
          renderOutput();
          textarea.dispatchEvent(new Event('input'));
          closeHistory();
        });
        list.appendChild(div);
      });
    }
    historyPanel.style.display = 'block';
    requestAnimationFrame(() => historyPanel.classList.add('open'));
    historyBackdrop.style.display = 'block';
  };

  const closeHistory = () => {
    historyPanel.classList.remove('open');
    historyBackdrop.style.display = 'none';
    setTimeout(() => { historyPanel.style.display = 'none'; }, 300);
  };

  btnHistory.addEventListener('click', openHistory);
  btnCloseHistory.addEventListener('click', closeHistory);
  historyBackdrop.addEventListener('click', closeHistory);
  
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (confirm('Clear all history?')) {
      clearHistoryAPI();
      document.getElementById('history-list').innerHTML = document.getElementById('history-empty').outerHTML;
    }
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      settingsModal.style.display = 'none';
      historyPanel.classList.remove('open');
      historyBackdrop.style.display = 'none';
    } else if (e.ctrlKey && e.key === 'Enter') {
      if (e.shiftKey) {
        if (!btnQuickFix.disabled) btnQuickFix.click();
      } else {
        if (!btnAnalyse.disabled) btnAnalyse.click();
      }
    }
  });
})();
