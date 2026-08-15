/**
 * History Manager - Manages humanisation history in localStorage.
 */

const STORAGE_KEY = 'humaniser_history';
const MAX_ENTRIES = 20;

/**
 * @typedef {Object} HistoryEntry
 * @property {string} id
 * @property {number} timestamp
 * @property {string} originalText
 * @property {string} humanisedText
 * @property {number} originalScore
 * @property {number} humanisedScore
 * @property {string} mode
 * @property {string} style
 */

/**
 * Saves a new entry to the history in localStorage.
 * @param {Object} data
 * @param {string} data.originalText
 * @param {string} data.humanisedText
 * @param {number} data.originalScore
 * @param {number} data.humanisedScore
 * @param {string} data.mode
 * @param {string} data.style
 */
export function saveEntry({ originalText, humanisedText, originalScore, humanisedScore, mode, style }) {
  try {
    const entries = getEntries();
    
    const newEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      originalText,
      humanisedText,
      originalScore,
      humanisedScore,
      mode,
      style
    };

    entries.unshift(newEntry);

    if (entries.length > MAX_ENTRIES) {
      entries.pop(); // Remove oldest
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save history entry:', e);
  }
}

/**
 * Retrieves all history entries, sorted newest first.
 * @returns {HistoryEntry[]}
 */
export function getEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    
    // Ensure sorted by timestamp descending
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    console.error('Failed to retrieve history entries:', e);
    return [];
  }
}

/**
 * Gets a specific entry by its ID.
 * @param {string} id 
 * @returns {HistoryEntry|null}
 */
export function getEntryById(id) {
  try {
    const entries = getEntries();
    return entries.find(entry => entry.id === id) || null;
  } catch (e) {
    console.error(`Failed to get history entry with id ${id}:`, e);
    return null;
  }
}

/**
 * Deletes a specific entry by its ID.
 * @param {string} id 
 */
export function deleteEntry(id) {
  try {
    const entries = getEntries();
    const filtered = entries.filter(entry => entry.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error(`Failed to delete history entry with id ${id}:`, e);
  }
}

/**
 * Clears all history entries.
 */
export function clearHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear history:', e);
  }
}
