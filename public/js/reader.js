import {
  fetchBookDetails,
  fetchChapter,
  saveReadingProgress,
  fetchHighlights,
  deleteHighlight
} from './storage.js';
import { initSelectionHandler } from './dictionary.js';

let currentState = {
  bookId: null,
  bookTitle: '',
  chapterIndex: 0,
  totalChapters: 0,
  totalBookWords: 0,
  totalBookPages: 1,
  chaptersList: [],
  currentPage: 1,
  totalPages: 1,
  mode: 'paginated', // 'paginated' or 'scroll'
  theme: 'light',
  fontFamily: 'serif',
  fontSize: 18,
  chromeVisible: true
};

const dom = {};

export function initReader() {
  dom.view = document.getElementById('readerView');
  dom.topBar = document.getElementById('readerTopBar');
  dom.bottomBar = document.getElementById('readerBottomBar');
  dom.viewport = document.getElementById('readerViewport');
  dom.content = document.getElementById('readerContent');
  dom.title = document.getElementById('readerTitle');
  dom.pageInfo = document.getElementById('readerPageInfo');
  dom.progressSlider = document.getElementById('progressSlider');
  
  dom.prevZone = document.getElementById('prevZone');
  dom.nextZone = document.getElementById('nextZone');
  dom.prevBtn = document.getElementById('prevChapterBtn');
  dom.nextBtn = document.getElementById('nextChapterBtn');
  
  dom.settingsDrawer = document.getElementById('settingsDrawer');
  dom.tocDrawer = document.getElementById('tocDrawer');
  dom.highlightsDrawer = document.getElementById('highlightsDrawer');

  bindEvents();
  initSelectionHandler(dom.content, () => currentState, refreshHighlightsDrawer);
}

function getVisibleColsCount() {
  const w = window.innerWidth;
  if (w > 1400) return 3;
  if (w > 900) return 2;
  return 1;
}

export async function loadBookInReader(bookId, targetChapterIndex = null) {
  try {
    showReaderView();
    renderLoadingState();

    const bookData = await fetchBookDetails(bookId);
    currentState.bookId = bookId;
    currentState.bookTitle = bookData.book.title;
    currentState.chaptersList = bookData.chapters;
    currentState.totalChapters = bookData.chapters.length;

    // Calculate total book word count and total book pages (~250 words per Kindle page)
    currentState.totalBookWords = bookData.chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0);
    currentState.totalBookPages = Math.max(1, Math.ceil(currentState.totalBookWords / 250));

    dom.title.textContent = `${bookData.book.title} - ${bookData.book.author}`;

    if (targetChapterIndex !== null && targetChapterIndex >= 0) {
      currentState.chapterIndex = targetChapterIndex;
    } else if (bookData.progress && bookData.progress.chapter_index >= 0) {
      currentState.chapterIndex = bookData.progress.chapter_index;
    } else {
      currentState.chapterIndex = 0;
    }

    renderTocDrawer();
    await loadChapter(currentState.chapterIndex);

  } catch (err) {
    alert(`Failed to load book: ${err.message}`);
    closeReaderView();
  }
}

async function loadChapter(index) {
  if (index < 0 || index >= currentState.totalChapters) return;

  currentState.chapterIndex = index;
  renderLoadingState();

  const data = await fetchChapter(currentState.bookId, index);
  const chapter = data.chapter;

  dom.content.innerHTML = `
    <h2 class="chapter-heading" style="text-align:center; margin-bottom: 2rem;">${escapeHtml(chapter.title)}</h2>
    ${chapter.content_html}
  `;

  applyDisplaySettings();
  await highlightTextInContent();
  bindImageZoom();

  currentState.currentPage = 1;
  updatePaginationLayout();

  if (currentState.mode === 'scroll') {
    dom.viewport.querySelector('.reader-stage').scrollTop = 0;
  }

  saveProgress();
}

function updatePaginationLayout() {
  const overallPercent = Math.round(
    ((currentState.chapterIndex + (currentState.currentPage / currentState.totalPages)) / currentState.totalChapters) * 100
  );
  const currentBookPage = Math.max(1, Math.min(currentState.totalBookPages, Math.round((overallPercent / 100) * currentState.totalBookPages)));
  const chNum = currentState.chapterIndex + 1;
  const chTotal = currentState.totalChapters;

  if (currentState.mode === 'scroll') {
    dom.content.style.transform = 'none';
    dom.pageInfo.textContent = `Page ${currentBookPage} of ${currentState.totalBookPages} (Ch ${chNum} of ${chTotal}) • ${overallPercent}%`;
    return;
  }

  requestAnimationFrame(() => {
    const cols = getVisibleColsCount();
    const stageWidth = dom.viewport.clientWidth;
    const totalWidth = dom.content.scrollWidth;

    currentState.totalPages = Math.max(1, Math.ceil(totalWidth / stageWidth));
    currentState.currentPage = Math.min(currentState.currentPage, currentState.totalPages);

    const translateX = -(currentState.currentPage - 1) * stageWidth;
    dom.content.style.transform = `translateX(${translateX}px)`;

    dom.pageInfo.textContent = `Page ${currentBookPage} of ${currentState.totalBookPages} (Ch ${chNum} of ${chTotal}) • ${overallPercent}%`;
    dom.progressSlider.value = overallPercent;
  });
}

function nextPage() {
  if (currentState.mode === 'scroll') return;
  const cols = getVisibleColsCount();
  if (currentState.currentPage + cols <= currentState.totalPages) {
    currentState.currentPage += cols;
    updatePaginationLayout();
    saveProgress();
  } else if (currentState.currentPage < currentState.totalPages) {
    currentState.currentPage = currentState.totalPages;
    updatePaginationLayout();
    saveProgress();
  } else if (currentState.chapterIndex < currentState.totalChapters - 1) {
    loadChapter(currentState.chapterIndex + 1);
  }
}

function prevPage() {
  if (currentState.mode === 'scroll') return;
  const cols = getVisibleColsCount();
  if (currentState.currentPage - cols >= 1) {
    currentState.currentPage -= cols;
    updatePaginationLayout();
    saveProgress();
  } else if (currentState.currentPage > 1) {
    currentState.currentPage = 1;
    updatePaginationLayout();
    saveProgress();
  } else if (currentState.chapterIndex > 0) {
    loadChapter(currentState.chapterIndex - 1);
  }
}

function saveProgress() {
  if (!currentState.bookId) return;
  const percent = Math.round(
    ((currentState.chapterIndex + (currentState.currentPage / currentState.totalPages)) / currentState.totalChapters) * 100
  );
  saveReadingProgress(currentState.bookId, currentState.chapterIndex, percent);
}

function applyDisplaySettings() {
  dom.view.setAttribute('data-theme', currentState.theme);
  dom.view.className = `reader-view mode-${currentState.mode}`;

  if (currentState.fontFamily === 'serif') {
    dom.content.style.fontFamily = 'var(--font-serif)';
  } else if (currentState.fontFamily === 'sans') {
    dom.content.style.fontFamily = 'var(--font-sans)';
  } else {
    dom.content.style.fontFamily = 'var(--font-mono)';
  }

  dom.content.style.fontSize = `${currentState.fontSize}px`;
  dom.content.style.lineHeight = '1.6';

  updatePaginationLayout();
}

function bindImageZoom() {
  dom.content.querySelectorAll('img').forEach(img => {
    img.onclick = (e) => {
      e.stopPropagation();
      showImageLightbox(img.src);
    };
  });
}

function showImageLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'img-lightbox-overlay';
  overlay.innerHTML = `<img src="${escapeHtml(src)}" alt="Illustration Zoom">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function bindEvents() {
  document.getElementById('readerBackBtn').onclick = closeReaderView;
  
  dom.prevZone.onclick = (e) => { e.stopPropagation(); prevPage(); };
  dom.nextZone.onclick = (e) => { e.stopPropagation(); nextPage(); };
  
  dom.prevBtn.onclick = () => loadChapter(currentState.chapterIndex - 1);
  dom.nextBtn.onclick = () => loadChapter(currentState.chapterIndex + 1);

  dom.viewport.onclick = (e) => {
    if (e.target.closest('a, button, mark, input, select, img')) return;
    toggleChrome();
  };

  document.addEventListener('keydown', (e) => {
    if (dom.view.style.display === 'none') return;

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      nextPage();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      prevPage();
    } else if (e.key === 'Escape') {
      closeDrawers();
    }
  });

  window.addEventListener('resize', () => {
    if (dom.view.style.display !== 'none') {
      updatePaginationLayout();
    }
  });

  document.getElementById('toggleSettingsBtn').onclick = () => toggleDrawer(dom.settingsDrawer);
  document.getElementById('toggleTocBtn').onclick = () => toggleDrawer(dom.tocDrawer);
  document.getElementById('toggleHighlightsBtn').onclick = () => {
    refreshHighlightsDrawer();
    toggleDrawer(dom.highlightsDrawer);
  };

  document.getElementById('closeSettingsBtn').onclick = () => closeDrawers();
  document.getElementById('closeTocBtn').onclick = () => closeDrawers();
  document.getElementById('closeHighlightsBtn').onclick = () => closeDrawers();

  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.onclick = () => {
      currentState.theme = btn.dataset.setTheme;
      applyDisplaySettings();
    };
  });

  document.querySelectorAll('[data-set-font]').forEach(btn => {
    btn.onclick = () => {
      currentState.fontFamily = btn.dataset.setFont;
      applyDisplaySettings();
    };
  });

  const fontSizeSlider = document.getElementById('fontSizeSlider');
  fontSizeSlider.oninput = (e) => {
    currentState.fontSize = Number(e.target.value);
    applyDisplaySettings();
  };

  document.getElementById('modePaginatedBtn').onclick = () => {
    currentState.mode = 'paginated';
    applyDisplaySettings();
  };
  document.getElementById('modeScrollBtn').onclick = () => {
    currentState.mode = 'scroll';
    applyDisplaySettings();
  };

  dom.progressSlider.onchange = (e) => {
    const targetPercent = Number(e.target.value);
    const targetChapter = Math.min(
      currentState.totalChapters - 1,
      Math.floor((targetPercent / 100) * currentState.totalChapters)
    );
    loadChapter(targetChapter);
  };
}

function toggleChrome() {
  currentState.chromeVisible = !currentState.chromeVisible;
  if (currentState.chromeVisible) {
    dom.view.classList.remove('chrome-hidden');
  } else {
    dom.view.classList.add('chrome-hidden');
  }
}

function toggleDrawer(drawerEl) {
  const isActive = drawerEl.classList.contains('active');
  closeDrawers();
  if (!isActive) drawerEl.classList.add('active');
}

function closeDrawers() {
  [dom.settingsDrawer, dom.tocDrawer, dom.highlightsDrawer].forEach(d => d.classList.remove('active'));
}

function renderTocDrawer() {
  const container = document.getElementById('tocList');
  container.innerHTML = currentState.chaptersList.map((ch, idx) => `
    <div class="toc-item ${idx === currentState.chapterIndex ? 'active' : ''}" data-chapter-idx="${idx}">
      <div class="toc-item-title" style="font-weight:${idx === currentState.chapterIndex ? '700' : '500'}; color:${idx === currentState.chapterIndex ? 'var(--accent-primary)' : 'inherit'};">${escapeHtml(ch.title)}</div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">${ch.word_count} words</div>
    </div>
  `).join('');

  container.querySelectorAll('.toc-item').forEach(el => {
    el.onclick = () => {
      const idx = Number(el.dataset.chapterIdx);
      loadChapter(idx);
      closeDrawers();
    };
  });
}

async function refreshHighlightsDrawer() {
  const container = document.getElementById('highlightsList');
  if (!currentState.bookId) return;

  const data = await fetchHighlights(currentState.bookId);
  if (!data.highlights || data.highlights.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:2rem 0;">No highlights yet. Select text in the reader to save highlights.</div>';
    return;
  }

  container.innerHTML = data.highlights.map(h => `
    <div class="hl-card" data-chapter-idx="${h.chapter_index}" data-text="${escapeHtml(h.selected_text)}" style="padding:0.75rem; background:var(--bg-app); border-radius:8px; margin-bottom:0.75rem; border-left:4px solid var(--accent-primary); cursor:pointer; transition:transform 0.15s ease;">
      <div style="font-style:italic; font-size:0.9rem; margin-bottom:0.4rem;">"${escapeHtml(h.selected_text)}"</div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; color:var(--text-muted);">
        <span>Chapter ${h.chapter_index + 1}</span>
        <button class="del-hl-btn" data-hl-id="${h.id}" style="background:none; border:none; color:#ef4444; cursor:pointer;">Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.hl-card').forEach(card => {
    card.onclick = async (e) => {
      if (e.target.closest('.del-hl-btn')) return;
      const chIdx = Number(card.dataset.chapterIdx);
      const textToMatch = card.dataset.text;
      
      closeDrawers();

      if (chIdx !== currentState.chapterIndex) {
        await loadChapter(chIdx);
      }

      jumpToHighlightedText(textToMatch);
    };
  });

  container.querySelectorAll('.del-hl-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      await deleteHighlight(Number(btn.dataset.hlId));
      refreshHighlightsDrawer();
      await highlightTextInContent();
    };
  });
}

function jumpToHighlightedText(textToMatch) {
  if (!textToMatch) return;

  const marks = Array.from(dom.content.querySelectorAll('mark.user-highlight'));
  let targetMark = marks.find(m => m.textContent.trim().includes(textToMatch) || textToMatch.includes(m.textContent.trim()));

  if (!targetMark) {
    const walker = document.createTreeWalker(dom.content, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.includes(textToMatch) && node.parentElement) {
        targetMark = node.parentElement;
        break;
      }
    }
  }

  if (targetMark) {
    if (currentState.mode === 'scroll') {
      targetMark.scrollIntoView({ behavior: 'smooth' });
    } else {
      const stageWidth = dom.viewport.clientWidth;
      const targetRect = targetMark.getBoundingClientRect();
      const containerRect = dom.content.getBoundingClientRect();
      const relativeX = targetRect.left - containerRect.left;
      const targetPage = Math.max(1, Math.floor(relativeX / stageWidth) + 1);
      currentState.currentPage = Math.min(targetPage, currentState.totalPages);
      updatePaginationLayout();
    }

    targetMark.style.animation = 'none';
    requestAnimationFrame(() => {
      targetMark.style.animation = 'highlightPulse 1.5s ease';
    });
  }
}

async function highlightTextInContent() {
  if (!currentState.bookId) return;

  // Clear existing mark tags and normalize text nodes before re-applying highlights
  dom.content.querySelectorAll('mark.user-highlight').forEach(mark => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
  });

  const data = await fetchHighlights(currentState.bookId);
  const chapterHighlights = (data.highlights || []).filter(h => h.chapter_index === currentState.chapterIndex);

  if (chapterHighlights.length === 0) return;

  chapterHighlights.forEach(h => {
    if (!h.selected_text || !h.selected_text.trim()) return;
    const rawText = h.selected_text.trim();
    const cleanText = rawText.replace(/\s+/g, ' ');

    const walker = document.createTreeWalker(dom.content, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let currentNode;

    while (currentNode = walker.nextNode()) {
      if (currentNode.parentNode && currentNode.parentNode.tagName !== 'MARK' && currentNode.parentNode.tagName !== 'SCRIPT') {
        textNodes.push(currentNode);
      }
    }

    for (const node of textNodes) {
      if (!node.parentNode || !node.nodeValue) continue;
      const val = node.nodeValue;
      
      let matchStart = val.indexOf(rawText);
      let matchLen = rawText.length;

      if (matchStart === -1) {
        const cleanVal = val.replace(/\s+/g, ' ');
        const normIdx = cleanVal.indexOf(cleanText);
        if (normIdx !== -1) {
          matchStart = normIdx;
          matchLen = cleanText.length;
        }
      }

      if (matchStart === -1 && cleanText.length > 15) {
        const prefix = cleanText.slice(0, 30);
        const pIdx = val.indexOf(prefix);
        if (pIdx !== -1) {
          matchStart = pIdx;
          matchLen = Math.min(val.length - pIdx, rawText.length);
        }
      }

      if (matchStart !== -1) {
        try {
          const before = val.substring(0, matchStart);
          const matched = val.substring(matchStart, matchStart + matchLen);
          const after = val.substring(matchStart + matchLen);

          const parent = node.parentNode;
          const mark = document.createElement('mark');
          mark.className = 'user-highlight';
          mark.textContent = matched;

          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
          break;
        } catch (e) {
          console.warn('Failed to wrap highlight node:', e);
        }
      }
    }
  });
}

function showReaderView() {
  dom.view.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeReaderView() {
  dom.view.style.display = 'none';
  document.body.style.overflow = 'auto';
  closeDrawers();
}

function renderLoadingState() {
  dom.content.innerHTML = `
    <div class="spinner-container">
      <div class="spinner"></div>
      <p>Downloading and parsing Gutenberg chapter...</p>
    </div>
  `;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
