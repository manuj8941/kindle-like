import { fetchDictionaryDefinition, saveHighlight } from './storage.js';

let activePopup = null;

export function initSelectionHandler(readerContentEl, getBookState, onHighlightSaved) {
  document.addEventListener('selectionchange', () => {
    // Small delay to allow double-clicks or drag selection to settle
    clearTimeout(window._selTimeout);
    window._selTimeout = setTimeout(() => {
      handleSelection(readerContentEl, getBookState, onHighlightSaved);
    }, 250);
  });
}

async function handleSelection(containerEl, getBookState, onHighlightSaved) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    return;
  }

  const range = sel.getRangeAt(0);
  // Ensure selection is inside reader container
  if (!containerEl.contains(range.commonAncestorContainer)) {
    return;
  }

  const selectedText = sel.toString().trim();
  if (!selectedText || selectedText.length > 500) {
    return;
  }

  const rect = range.getBoundingClientRect();
  showPopup(rect, selectedText, getBookState, onHighlightSaved);
}

function removePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

async function showPopup(rect, text, getBookState, onHighlightSaved) {
  removePopup();

  const popup = document.createElement('div');
  popup.className = 'selection-popup';
  
  // Position above selection rect
  const top = Math.max(10, rect.top + window.scrollY - 80);
  const left = Math.min(window.innerWidth - 330, Math.max(10, rect.left + (rect.width / 2) - 160));
  
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  popup.innerHTML = `
    <div style="font-size:0.8rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
      <span>Looking up...</span>
      <button id="closePopBtn" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">&times;</button>
    </div>
    <div class="dictionary-word">${escapeHtml(text.slice(0, 30))}</div>
    <div class="dictionary-def" style="color:var(--text-muted);">Fetching definition...</div>
    <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
      <button id="popHighlightBtn" style="background:var(--accent-subtle); color:var(--accent-primary); border:none; padding:0.4rem 0.75rem; border-radius:6px; font-weight:600; font-size:0.8rem; cursor:pointer; width:100%;">
        Highlight Text
      </button>
    </div>
  `;

  document.body.appendChild(popup);
  activePopup = popup;

  popup.querySelector('#closePopBtn').onclick = removePopup;

  popup.querySelector('#popHighlightBtn').onclick = async () => {
    const state = getBookState();
    if (state && state.bookId) {
      // Visually apply yellow highlight to DOM text range immediately
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const markNode = document.createElement('mark');
          markNode.className = 'user-highlight';
          markNode.appendChild(range.extractContents());
          range.insertNode(markNode);
          sel.removeAllRanges();
        }
      } catch (e) {
        console.warn('DOM highlight wrap error:', e);
      }

      await saveHighlight(state.bookId, state.chapterIndex, text);
      removePopup();
      if (onHighlightSaved) onHighlightSaved();
    }
  };

  // If selection is a single word, fetch dictionary definition
  const singleWord = text.replace(/[^a-zA-Z]/g, '');
  if (singleWord && !text.includes(' ')) {
    const defData = await fetchDictionaryDefinition(singleWord);
    if (!activePopup || activePopup !== popup) return;

    const defEl = popup.querySelector('.dictionary-def');
    if (defData.found && defData.meanings && defData.meanings.length > 0) {
      const m = defData.meanings[0];
      popup.querySelector('.dictionary-word').innerHTML = `
        <span>${escapeHtml(defData.word)}</span>
        <span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">${escapeHtml(defData.phonetic || '')}</span>
      `;
      defEl.innerHTML = `
        <div class="dictionary-pos">${escapeHtml(m.partOfSpeech)}</div>
        <div>${escapeHtml(m.definitions[0])}</div>
      `;
    } else {
      defEl.textContent = defData.message || 'No definition found.';
    }
  } else {
    const defEl = popup.querySelector('.dictionary-def');
    defEl.textContent = `Selected ${text.split(/\s+/).length} words.`;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.contains(e.target) && !window.getSelection()?.toString().trim()) {
    removePopup();
  }
});
