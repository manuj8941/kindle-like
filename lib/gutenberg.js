import * as cheerio from 'cheerio';
import db from './db.js';

const GUTENDEX_API_URL = 'https://gutendex.com/books';

/**
 * Searches Project Gutenberg catalog via Gutendex API
 */
export async function searchCatalog(query = '', topic = '', page = 1) {
  const queryKey = `${query.toLowerCase().trim()}:${topic.toLowerCase().trim()}:${page}`;

  // 1. Check local SQLite search_cache
  const cachedRow = db.prepare(`
    SELECT response_json FROM search_cache
    WHERE query_key = ? AND datetime(created_at, '+24 hours') > CURRENT_TIMESTAMP
  `).get(queryKey);

  if (cachedRow) {
    try {
      return JSON.parse(cachedRow.response_json);
    } catch (e) {
      // Ignore invalid JSON and continue
    }
  }

  const url = new URL(GUTENDEX_API_URL);
  if (query) url.searchParams.set('search', query);
  if (topic) url.searchParams.set('topic', topic);
  if (page) url.searchParams.set('page', page);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Gutendex API error: ${res.statusText}`);
  }
  const data = await res.json();

  const books = data.results.map(book => ({
    id: book.id,
    title: book.title,
    author: book.authors.map(a => a.name).join(', ') || 'Unknown Author',
    cover_url: book.formats['image/jpeg'] || `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`,
    subjects: book.subjects,
    download_count: book.download_count,
    html_url: book.formats['text/html'] || book.formats['text/html; charset=utf-8'] || null,
    epub_url: book.formats['application/epub+zip'] || null
  }));

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO books (id, title, author, cover_url, subjects, epub_url, html_url, download_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const b of books) {
    stmt.run(
      b.id,
      b.title,
      b.author,
      b.cover_url,
      JSON.stringify(b.subjects || []),
      b.epub_url,
      b.html_url,
      b.download_count
    );
  }

  const resultObj = {
    count: data.count,
    next: data.next ? page + 1 : null,
    previous: data.previous ? Math.max(1, page - 1) : null,
    books
  };

  db.prepare(`
    INSERT OR REPLACE INTO search_cache (query_key, response_json)
    VALUES (?, ?)
  `).run(queryKey, JSON.stringify(resultObj));

  return resultObj;
}

/**
 * Gets cached book metadata or fetches from Gutendex
 */
export async function getBookDetails(id) {
  const numId = Number(id);
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(numId);
  if (row) {
    return {
      ...row,
      subjects: JSON.parse(row.subjects || '[]')
    };
  }

  const res = await fetch(`${GUTENDEX_API_URL}/${id}`);
  if (!res.ok) {
    throw new Error(`Book ${id} not found on Gutendex`);
  }
  const book = await res.json();
  const bookObj = {
    id: book.id,
    title: book.title,
    author: book.authors.map(a => a.name).join(', ') || 'Unknown Author',
    cover_url: book.formats['image/jpeg'] || `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`,
    subjects: book.subjects,
    download_count: book.download_count,
    html_url: book.formats['text/html'] || book.formats['text/html; charset=utf-8'] || null,
    epub_url: book.formats['application/epub+zip'] || null
  };

  db.prepare(`
    INSERT OR REPLACE INTO books (id, title, author, cover_url, subjects, epub_url, html_url, download_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bookObj.id,
    bookObj.title,
    bookObj.author,
    bookObj.cover_url,
    JSON.stringify(bookObj.subjects || []),
    bookObj.epub_url,
    bookObj.html_url,
    bookObj.download_count
  );

  return bookObj;
}

/**
 * Fetches, cleans, splits into chapters and stores in node:sqlite
 */
export async function getOrFetchChapters(bookId) {
  const numId = Number(bookId);

  const existingChapters = db.prepare(`
    SELECT id, book_id, chapter_index, title, word_count
    FROM chapters
    WHERE book_id = ?
    ORDER BY chapter_index ASC
  `).all(numId);

  if (existingChapters.length > 0) {
    return existingChapters;
  }

  const book = await getBookDetails(numId);

  const contentUrls = [
    book.html_url,
    `https://www.gutenberg.org/files/${numId}/${numId}-h/${numId}-h.htm`,
    `https://www.gutenberg.org/cache/epub/${numId}/pg${numId}-images.html`,
    `https://www.gutenberg.org/cache/epub/${numId}/pg${numId}.html`,
    `https://www.gutenberg.org/files/${numId}/${numId}-0.txt`
  ].filter(Boolean);

  let rawContent = null;
  let isHtml = true;
  let sourceUrl = '';

  for (const url of contentUrls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'KindleLikeApp/1.0' } });
      if (res.ok) {
        rawContent = await res.text();
        isHtml = url.endsWith('.html') || url.endsWith('.htm') || rawContent.trim().startsWith('<');
        sourceUrl = url;
        break;
      }
    } catch (err) {
      console.warn(`Failed to fetch from ${url}:`, err.message);
    }
  }

  if (!rawContent) {
    throw new Error(`Unable to download content for book ${numId} from Gutenberg`);
  }

  let parsedChapters = [];

  if (isHtml) {
    parsedChapters = parseHtmlToChapters(rawContent, numId, sourceUrl);
  } else {
    parsedChapters = parseTextToChapters(rawContent);
  }

  const insertStmt = db.prepare(`
    INSERT INTO chapters (book_id, chapter_index, title, content_html, word_count)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < parsedChapters.length; i++) {
    const ch = parsedChapters[i];
    insertStmt.run(numId, i, ch.title, ch.content_html, ch.word_count);
  }

  return db.prepare(`
    SELECT id, book_id, chapter_index, title, word_count
    FROM chapters
    WHERE book_id = ?
    ORDER BY chapter_index ASC
  `).all(numId);
}

export function getChapterContent(bookId, chapterIndex) {
  const row = db.prepare(`
    SELECT * FROM chapters WHERE book_id = ? AND chapter_index = ?
  `).get(Number(bookId), Number(chapterIndex));
  return row || null;
}

/**
 * Parse HTML content into structured clean chapters with concise titles and absolute image URLs
 */
function parseHtmlToChapters(html, bookId, sourceUrl) {
  const $ = cheerio.load(html);

  // Strip Gutenberg headers/footers/scripts/styles/nav
  $('.pg-header, .pg-footer, #pg-header, #pg-footer, script, style, iframe, header, footer, nav, .toc').remove();
  
  // Strip external links, but KEEP internal anchor links (#chap01, #c1)
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith('http://') || href.startsWith('https://')) {
      $(el).replaceWith($(el).text());
    }
  });

  const chapters = [];
  const headingEls = $('h1, h2, h3, h4, .chapterhead, .chapter-title');

  if (headingEls.length >= 2) {
    let currentTitle = 'Beginning';
    let currentElements = [];
    const bodyChildren = $('body').children().length > 0 ? $('body').children() : $.root().children();

    bodyChildren.each((_, el) => {
      const $el = $(el);
      const isHeadingNode = $el.is('h1, h2, h3, h4, .chapterhead, .chapter-title') || $el.find('h1, h2, h3, h4, .chapterhead').length > 0;

      if (isHeadingNode && currentElements.length > 0) {
        const contentHtml = currentElements.map(e => $.html(e)).join('');
        const textContent = currentElements.map(e => $(e).text()).join(' ');
        const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;

        if (wordCount > 40) {
          chapters.push({
            title: cleanTitleText(currentTitle, chapters.length + 1),
            content_html: cleanChapterHtml(contentHtml, bookId, sourceUrl),
            word_count: wordCount
          });
        }

        currentTitle = extractHeadingTitle($el, chapters.length + 1);
        currentElements = [el];
      } else {
        currentElements.push(el);
      }
    });

    if (currentElements.length > 0) {
      const contentHtml = currentElements.map(e => $.html(e)).join('');
      const textContent = currentElements.map(e => $(e).text()).join(' ');
      const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 40) {
        chapters.push({
          title: cleanTitleText(currentTitle, chapters.length + 1),
          content_html: cleanChapterHtml(contentHtml, bookId, sourceUrl),
          word_count: wordCount
        });
      }
    }
  }

  if (chapters.length < 2) {
    return fallbackChunkHtml($, $('body').length ? $('body') : $.root(), bookId, sourceUrl);
  }

  return chapters;
}

function extractHeadingTitle($el, chapterNum) {
  let text = '';
  if ($el.is('h1, h2, h3, h4, .chapterhead, .chapter-title')) {
    text = $el.text();
  } else {
    const h = $el.find('h1, h2, h3, h4, .chapterhead, .chapter-title').first();
    text = h.length > 0 ? h.text() : $el.text();
  }
  return cleanTitleText(text, chapterNum);
}

function cleanTitleText(rawTitle, fallbackIndex) {
  let cleaned = (rawTitle || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > 70) {
    const firstSentence = cleaned.split('.')[0];
    if (firstSentence && firstSentence.length > 5 && firstSentence.length <= 70) {
      cleaned = firstSentence;
    } else {
      cleaned = cleaned.slice(0, 65) + '...';
    }
  }

  if (!cleaned || cleaned.length < 2) {
    return `Chapter ${fallbackIndex}`;
  }

  return cleaned;
}

function cleanChapterHtml(rawHtml, bookId, sourceUrl = '') {
  const $ = cheerio.load(rawHtml);
  
  // Base URL for image resolution
  const baseUrl = sourceUrl ? sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1) : `https://www.gutenberg.org/files/${bookId}/${bookId}-h/`;

  $('img').each((_, el) => {
    const $img = $(el);
    let src = ($img.attr('src') || '').trim();

    if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
      try {
        const resolvedUrl = new URL(src, baseUrl).toString();
        const fallbackUrl = `https://www.gutenberg.org/files/${bookId}/${bookId}-h/${src.replace(/^(\.\/|\.\.\/)+/, '')}`;
        $img.attr('src', resolvedUrl);
        $img.attr('onerror', `this.onerror=null; this.src='${fallbackUrl}';`);
      } catch (err) {
        $img.attr('src', `https://www.gutenberg.org/files/${bookId}/${bookId}-h/${src}`);
      }
    }
  });

  // Clean attributes except src, alt, title, onerror, href, id, name (for internal links)
  $('*').each((_, el) => {
    if (el.type === 'tag') {
      const allowedAttrs = ['src', 'alt', 'title', 'onerror', 'href', 'id', 'name'];
      const attrs = Object.keys(el.attribs || {});
      attrs.forEach(attr => {
        if (!allowedAttrs.includes(attr)) {
          $(el).removeAttr(attr);
        }
      });
    }
  });

  return $.html().trim();
}

function fallbackChunkHtml($, $root, bookId, sourceUrl) {
  const chapters = [];
  const paragraphs = $root.find('p, div, pre');
  let currentGroup = [];
  let currentWordCount = 0;
  let chapterIndex = 1;

  paragraphs.each((_, el) => {
    const text = $(el).text();
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    currentGroup.push($.html(el));
    currentWordCount += words;

    if (currentWordCount >= 1800) {
      chapters.push({
        title: `Part ${chapterIndex}`,
        content_html: cleanChapterHtml(currentGroup.join('\n'), bookId, sourceUrl),
        word_count: currentWordCount
      });
      chapterIndex++;
      currentGroup = [];
      currentWordCount = 0;
    }
  });

  if (currentGroup.length > 0) {
    chapters.push({
      title: `Part ${chapterIndex}`,
      content_html: cleanChapterHtml(currentGroup.join('\n'), bookId, sourceUrl),
      word_count: currentWordCount
    });
  }

  return chapters;
}

function parseTextToChapters(text) {
  const headerIdx = text.indexOf('*** START OF THIS PROJECT GUTENBERG');
  const footerIdx = text.indexOf('*** END OF THIS PROJECT GUTENBERG');
  
  let mainBody = text;
  if (headerIdx !== -1) {
    const startLineEnd = text.indexOf('\n', headerIdx);
    mainBody = text.substring(startLineEnd !== -1 ? startLineEnd : headerIdx);
  }
  if (footerIdx !== -1) {
    mainBody = mainBody.substring(0, mainBody.indexOf('*** END OF THIS PROJECT GUTENBERG'));
  }

  const lines = mainBody.split(/\r?\n/);
  const chapters = [];
  let currentTitle = 'Beginning';
  let currentParagraphs = [];
  let currentWordCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeaderLine = /^(CHAPTER|STAVE|BOOK|PART|SECTION|SONNET)\s+[0-9IVXLCDM]+/i.test(trimmed);
    
    if (isHeaderLine && currentParagraphs.length > 0) {
      const htmlContent = currentParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n');
      if (currentWordCount > 40) {
        chapters.push({
          title: cleanTitleText(currentTitle, chapters.length + 1),
          content_html: htmlContent,
          word_count: currentWordCount
        });
      }
      currentTitle = trimmed;
      currentParagraphs = [];
      currentWordCount = 0;
    } else if (trimmed.length > 0) {
      currentParagraphs.push(trimmed);
      currentWordCount += trimmed.split(/\s+/).length;
    }
  }

  if (currentParagraphs.length > 0) {
    const htmlContent = currentParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n');
    chapters.push({
      title: cleanTitleText(currentTitle, chapters.length + 1),
      content_html: htmlContent,
      word_count: currentWordCount
    });
  }

  if (chapters.length === 0) {
    chapters.push({
      title: 'Full Text',
      content_html: mainBody.split(/\n\n+/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n'),
      word_count: mainBody.split(/\s+/).length
    });
  }

  return chapters;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
