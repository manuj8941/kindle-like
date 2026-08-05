import {
  fetchCatalog,
  fetchLibrary,
  addToLibrary,
  removeFromLibrary
} from './storage.js';
import { initReader, loadBookInReader } from './reader.js';

let currentView = 'catalog';
let activeTopic = '';
let searchKeyword = '';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initReader();
  bindNavigation();
  bindSearchAndTopics();
  loadCatalog();
}

function bindNavigation() {
  const brandBtn = document.getElementById('brandBtn');
  const catalogBtn = document.getElementById('navCatalogBtn');
  const libraryBtn = document.getElementById('navLibraryBtn');

  brandBtn.onclick = () => switchView('catalog');
  catalogBtn.onclick = () => switchView('catalog');
  libraryBtn.onclick = () => switchView('library');
}

function switchView(viewName) {
  currentView = viewName;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (viewName === 'catalog') {
    document.getElementById('catalogView').classList.add('active');
    document.getElementById('navCatalogBtn').classList.add('active');
    loadCatalog();
  } else if (viewName === 'library') {
    document.getElementById('libraryView').classList.add('active');
    document.getElementById('navLibraryBtn').classList.add('active');
    loadMyLibrary();
  }
}

function bindSearchAndTopics() {
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const topicsContainer = document.getElementById('topicsContainer');

  let debounceTimer = null;

  searchForm.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    searchKeyword = searchInput.value.trim();
    loadCatalog();
  };

  searchInput.oninput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchKeyword = searchInput.value.trim();
      loadCatalog();
    }, 350);
  };

  topicsContainer.querySelectorAll('.topic-chip').forEach(chip => {
    chip.onclick = () => {
      topicsContainer.querySelectorAll('.topic-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeTopic = chip.dataset.topic;
      loadCatalog();
    };
  });
}

async function loadCatalog() {
  const grid = document.getElementById('catalogGrid');
  const titleEl = document.getElementById('catalogSectionTitle');

  if (searchKeyword) {
    titleEl.textContent = `Search results for "${searchKeyword}"`;
  } else if (activeTopic) {
    titleEl.textContent = `${capitalize(activeTopic)} Classics`;
  } else {
    titleEl.textContent = `Popular Gutenberg Classics`;
  }

  grid.innerHTML = `
    <div class="spinner-container">
      <div class="spinner"></div>
      <p>Searching Gutenberg catalog...</p>
    </div>
  `;

  try {
    const data = await fetchCatalog(searchKeyword, activeTopic, 1);
    if (!data.books || data.books.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>No books found</h3>
          <p>Try adjusting your search query or selected category.</p>
        </div>
      `;
      return;
    }
    renderBooksGrid(grid, data.books, false);
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Error loading catalog</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function loadMyLibrary() {
  const grid = document.getElementById('libraryGrid');
  grid.innerHTML = `
    <div class="spinner-container">
      <div class="spinner"></div>
      <p>Loading your bookshelf...</p>
    </div>
  `;

  try {
    const data = await fetchLibrary();
    if (!data.books || data.books.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>Your library is empty</h3>
          <p>Books you read or add to your library will appear here.</p>
        </div>
      `;
      return;
    }
    renderBooksGrid(grid, data.books, true);
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Error loading library</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderBooksGrid(containerEl, books, isLibraryView = false) {
  containerEl.innerHTML = books.map(book => {
    const progressPercent = book.progress_percent || 0;
    return `
      <div class="book-card" data-book-id="${book.id}">
        <div class="cover-wrapper">
          <img src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(book.title)}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x300?text=No+Cover'">
        </div>
        <div class="card-content">
          <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
          <div class="book-author">${escapeHtml(book.author)}</div>
          
          ${isLibraryView ? `
            <div class="progress-bar-container" title="${progressPercent}% read">
              <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.4rem; display:flex; justify-content:space-between; align-items:center;">
              <span>${progressPercent > 0 ? `${progressPercent}% read` : 'Unread'}</span>
              <button class="remove-lib-btn" data-id="${book.id}" style="background:none; border:none; color:#ef4444; cursor:pointer;">Remove</button>
            </div>
          ` : `
            <button class="add-lib-btn" data-id="${book.id}" style="margin-top:auto; background:var(--accent-subtle); color:var(--accent-primary); border:none; padding:0.4rem; border-radius:6px; font-weight:600; font-size:0.8rem; cursor:pointer;">
              + Add to Library
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');

  // Bind click on card to open reader
  containerEl.querySelectorAll('.book-card').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      const bookId = Number(card.dataset.bookId);
      loadBookInReader(bookId);
    };
  });

  // Bind Add/Remove library buttons
  containerEl.querySelectorAll('.add-lib-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      await addToLibrary(id);
      btn.textContent = '✓ In Library';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    };
  });

  containerEl.querySelectorAll('.remove-lib-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      await removeFromLibrary(id);
      loadMyLibrary();
    };
  });
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
