export function highlightPatterns(highlightLayer, text, patterns) {
  if (!text) {
    highlightLayer.innerHTML = '';
    return;
  }
  
  // Sort patterns by start index
  const sorted = [...(patterns || [])].sort((a, b) => a.start - b.start);
  
  let html = '';
  let lastIndex = 0;
  
  const escapeHtml = (str) => {
    return str.replace(/[&<>'"]/g, 
      tag => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[tag] || tag)
    );
  };
  
  // Keep track of active tooltips
  let currentTooltip = null;

  sorted.forEach((p, idx) => {
    if (p.start >= lastIndex) {
      html += escapeHtml(text.substring(lastIndex, p.start));
      const match = text.substring(p.start, p.end);
      
      html += `<mark class="pattern-highlight" data-category="${p.category}" data-id="${idx}">${escapeHtml(match)}</mark>`;
      lastIndex = p.end;
    }
  });
  
  html += escapeHtml(text.substring(lastIndex));
  
  // Add an extra space/newline to ensure scrolling matches trailing newlines
  if (text.endsWith('\n')) {
    html += ' ';
  }
  
  highlightLayer.innerHTML = html;
  
  // Add interactions
  const marks = highlightLayer.querySelectorAll('.pattern-highlight');
  marks.forEach(mark => {
    mark.addEventListener('mouseenter', (e) => {
      if (currentTooltip) currentTooltip.remove();
      
      const pId = mark.getAttribute('data-id');
      const p = sorted[pId];
      if (!p) return;
      
      const tooltip = document.createElement('div');
      tooltip.className = 'highlight-tooltip';
      
      const rawColor = getComputedStyle(mark).getPropertyValue('border-bottom-color');
      const categoryColor = /^[#a-zA-Z0-9(),.\s%-]+$/.test(rawColor) ? rawColor : 'var(--accent)';
      const safeCategory = escapeHtml(String(p.category || ''));
      const safeMessage = escapeHtml(String(p.message || 'AI pattern detected'));
      const safeSuggestion = p.suggestion ? escapeHtml(String(p.suggestion)) : '';
      
      tooltip.innerHTML = `
        <div class="tooltip-header">
          <span class="legend-dot" style="background:${categoryColor}"></span>
          ${safeCategory}
        </div>
        <div class="tooltip-msg">${safeMessage}</div>
        ${safeSuggestion ? `<div class="tooltip-sugg">Try: ${safeSuggestion}</div>` : ''}
        ${p.replacement ? `<button class="tooltip-btn">Fix</button>` : ''}
        <div class="tooltip-arrow"></div>
      `;
      
      document.body.appendChild(tooltip);
      currentTooltip = tooltip;
      
      // Positioning
      const rect = mark.getBoundingClientRect();
      const ttRect = tooltip.getBoundingClientRect();
      
      let top = rect.top - ttRect.height - 8;
      let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
      
      // Arrow pos
      const arrow = tooltip.querySelector('.tooltip-arrow');
      arrow.style.left = '50%';
      arrow.style.marginLeft = '-4px';
      arrow.style.bottom = '-4px';
      
      if (top < 10) {
        // Flip below
        top = rect.bottom + 8;
        arrow.style.bottom = 'auto';
        arrow.style.top = '-4px';
        arrow.style.borderBottom = 'none';
        arrow.style.borderRight = 'none';
        arrow.style.borderLeft = '1px solid var(--border)';
        arrow.style.borderTop = '1px solid var(--border)';
      }
      
      if (left < 10) left = 10;
      if (left + ttRect.width > window.innerWidth - 10) left = window.innerWidth - ttRect.width - 10;
      
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      
      tooltip.addEventListener('mouseenter', () => {
        // Keep alive
      });
      tooltip.addEventListener('mouseleave', () => {
        if (currentTooltip === tooltip) {
          tooltip.remove();
          currentTooltip = null;
        }
      });
      
      const btn = tooltip.querySelector('.tooltip-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          const textarea = document.getElementById('input-text');
          const val = textarea.value;
          textarea.value = val.substring(0, p.start) + p.replacement + val.substring(p.end);
          textarea.dispatchEvent(new Event('input'));
          tooltip.remove();
        });
      }
    });
    
    mark.addEventListener('mouseleave', (e) => {
      setTimeout(() => {
        if (currentTooltip && !currentTooltip.matches(':hover')) {
          currentTooltip.remove();
          currentTooltip = null;
        }
      }, 100);
    });
  });
}

export function clearHighlights(highlightLayer) {
  highlightLayer.innerHTML = '';
  document.querySelectorAll('.highlight-tooltip').forEach(t => t.remove());
}
