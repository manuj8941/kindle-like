export async function fetchCatalog(search = '', topic = '', page = 1) {
  const url = new URL('/api/catalog', window.location.origin);
  if (search) url.searchParams.set('search', search);
  if (topic) url.searchParams.set('topic', topic);
  if (page) url.searchParams.set('page', page);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch catalog');
  return res.json();
}

export async function fetchBookDetails(bookId) {
  const res = await fetch(`/api/books/${bookId}`);
  if (!res.ok) throw new Error('Failed to fetch book details');
  return res.json();
}

export async function fetchChapter(bookId, chapterIndex) {
  const res = await fetch(`/api/books/${bookId}/chapters/${chapterIndex}`);
  if (!res.ok) throw new Error('Failed to fetch chapter content');
  return res.json();
}

export async function fetchLibrary() {
  const res = await fetch('/api/library');
  if (!res.ok) throw new Error('Failed to fetch user library');
  return res.json();
}

export async function addToLibrary(bookId) {
  const res = await fetch(`/api/library/${bookId}`, { method: 'POST' });
  return res.json();
}

export async function removeFromLibrary(bookId) {
  const res = await fetch(`/api/library/${bookId}`, { method: 'DELETE' });
  return res.json();
}

export async function saveReadingProgress(bookId, chapterIndex, percent, scrollPos = 0) {
  const res = await fetch(`/api/progress/${bookId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chapter_index: chapterIndex,
      progress_percent: percent,
      scroll_position: scrollPos
    })
  });
  return res.json();
}

export async function fetchHighlights(bookId) {
  const res = await fetch(`/api/highlights/${bookId}`);
  if (!res.ok) throw new Error('Failed to fetch highlights');
  return res.json();
}

export async function saveHighlight(bookId, chapterIndex, selectedText, note = '', color = 'yellow') {
  const res = await fetch(`/api/highlights/${bookId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter_index: chapterIndex, selected_text: selectedText, note, color })
  });
  return res.json();
}

export async function deleteHighlight(highlightId) {
  const res = await fetch(`/api/highlights/${highlightId}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchDictionaryDefinition(word) {
  const res = await fetch(`/api/dictionary/${encodeURIComponent(word)}`);
  if (!res.ok) return { found: false, message: 'Unable to connect to dictionary service' };
  return res.json();
}
