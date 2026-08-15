export function createGauge(containerElement) {
  const svgNS = "http://www.w3.org/2000/svg";
  
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 120 80");
  svg.style.width = "100%";
  svg.style.height = "100%";
  
  // Arc path for semicircle
  const pathData = "M 10 70 A 50 50 0 0 1 110 70";
  
  const bgPath = document.createElementNS(svgNS, "path");
  bgPath.setAttribute("d", pathData);
  bgPath.setAttribute("fill", "none");
  bgPath.setAttribute("stroke", "var(--border)");
  bgPath.setAttribute("stroke-width", "4");
  bgPath.setAttribute("stroke-linecap", "round");
  
  const valPath = document.createElementNS(svgNS, "path");
  valPath.setAttribute("d", pathData);
  valPath.setAttribute("fill", "none");
  valPath.setAttribute("stroke-width", "5");
  valPath.setAttribute("stroke-linecap", "round");
  
  // Length of the arc
  const arcLength = 157.08; // Math.PI * 50
  valPath.setAttribute("stroke-dasharray", arcLength);
  valPath.setAttribute("stroke-dashoffset", arcLength);
  valPath.style.transition = "stroke-dashoffset 0.8s ease-out, stroke 0.8s ease-out";
  
  const textVal = document.createElementNS(svgNS, "text");
  textVal.setAttribute("x", "60");
  textVal.setAttribute("y", "55");
  textVal.setAttribute("text-anchor", "middle");
  textVal.setAttribute("font-family", "var(--font-mono)");
  textVal.setAttribute("font-weight", "700");
  textVal.setAttribute("font-size", "28px");
  textVal.setAttribute("fill", "var(--text-primary)");
  textVal.textContent = "0";
  textVal.style.transition = "fill var(--transition-base)";
  
  const textLbl = document.createElementNS(svgNS, "text");
  textLbl.setAttribute("x", "60");
  textLbl.setAttribute("y", "70");
  textLbl.setAttribute("text-anchor", "middle");
  textLbl.setAttribute("font-family", "var(--font-ui)");
  textLbl.setAttribute("font-size", "10px");
  textLbl.setAttribute("fill", "var(--text-muted)");
  textLbl.setAttribute("text-transform", "uppercase");
  textLbl.textContent = "AI-Like";
  
  svg.appendChild(bgPath);
  svg.appendChild(valPath);
  svg.appendChild(textVal);
  svg.appendChild(textLbl);
  containerElement.appendChild(svg);
  
  let currentScore = 0;
  let animFrame;
  
  function getScoreColor(s) {
    if (s <= 30) return "var(--danger)";
    if (s <= 60) return "var(--warning)";
    if (s <= 80) return "var(--accent)";
    return "var(--success)";
  }
  
  function getScoreLabel(s) {
    if (s <= 30) return "AI-Like";
    if (s <= 60) return "Mixed";
    if (s <= 80) return "Mostly Human";
    return "Human";
  }

  function animateValue(start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const val = Math.floor(start + (end - start) * easeProgress);
      textVal.textContent = val;
      if (progress < 1) {
        animFrame = requestAnimationFrame(step);
      } else {
        textVal.textContent = end;
      }
    };
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(step);
  }

  return {
    update(score) {
      score = Math.max(0, Math.min(100, score));
      
      const offset = arcLength - (score / 100) * arcLength;
      valPath.setAttribute("stroke-dashoffset", offset);
      valPath.setAttribute("stroke", getScoreColor(score));
      textLbl.textContent = getScoreLabel(score);
      
      animateValue(currentScore, score, 800);
      currentScore = score;
    },
    destroy() {
      if (animFrame) cancelAnimationFrame(animFrame);
      containerElement.innerHTML = "";
    }
  };
}
