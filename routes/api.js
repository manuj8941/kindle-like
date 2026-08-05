import { Router } from 'express';
import db from '../lib/db.js';
import {
  searchCatalog,
  getBookDetails,
  getOrFetchChapters,
  getChapterContent
} from '../lib/gutenberg.js';
import { lookupWord } from '../lib/dictionary.js';

const router = Router();

// Catalog search & browse
router.get('/catalog', async (req, res) => {
  try {
    const { search, topic, page } = req.query;
    const result = await searchCatalog(search || '', topic || '', Number(page) || 1);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Book details & chapter index
router.get('/books/:id', async (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const book = await getBookDetails(bookId);
    const chapters = await getOrFetchChapters(bookId);

    const progress = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId) || null;
    const inLibrary = Boolean(db.prepare('SELECT 1 FROM user_library WHERE book_id = ?').get(bookId));

    res.json({
      book,
      chapters,
      progress,
      inLibrary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch single chapter content
router.get('/books/:id/chapters/:index', async (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const chapterIndex = Number(req.params.index);
    const chapter = getChapterContent(bookId, chapterIndex);

    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    const totalChaptersRow = db.prepare('SELECT COUNT(*) as count FROM chapters WHERE book_id = ?').get(bookId);
    
    res.json({
      chapter,
      totalChapters: totalChaptersRow ? totalChaptersRow.count : 0,
      hasPrevious: chapterIndex > 0,
      hasNext: chapterIndex < (totalChaptersRow.count - 1)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find chapter index containing a specific anchor ID or name
router.get('/books/:id/anchors/:targetId', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const targetId = req.params.targetId;

    const row = db.prepare(`
      SELECT chapter_index FROM chapters
      WHERE book_id = ? AND (content_html LIKE ? OR content_html LIKE ?)
      ORDER BY chapter_index ASC
      LIMIT 1
    `).get(bookId, `%id="${targetId}"%`, `%name="${targetId}"%`);

    if (row) {
      res.json({ found: true, chapterIndex: row.chapter_index });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Library endpoints
router.get('/library', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT b.*, ul.added_at, rp.chapter_index, rp.progress_percent, rp.updated_at as last_read_at
      FROM user_library ul
      JOIN books b ON ul.book_id = b.id
      LEFT JOIN reading_progress rp ON ul.book_id = rp.book_id
      ORDER BY ul.added_at DESC
    `).all();

    const books = rows.map(r => ({
      ...r,
      subjects: JSON.parse(r.subjects || '[]')
    }));

    res.json({ books });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/library/:id', async (req, res) => {
  try {
    const bookId = Number(req.params.id);
    await getBookDetails(bookId);

    db.prepare('INSERT OR IGNORE INTO user_library (book_id) VALUES (?)').run(bookId);
    res.json({ success: true, message: 'Added to library' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/library/:id', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    db.prepare('DELETE FROM user_library WHERE book_id = ?').run(bookId);
    res.json({ success: true, message: 'Removed from library' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reading progress endpoints
router.get('/progress/:id', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const progress = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId);
    res.json(progress || { chapter_index: 0, progress_percent: 0.0, scroll_position: 0.0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/progress/:id', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const { chapter_index = 0, progress_percent = 0.0, scroll_position = 0.0 } = req.body;

    db.prepare(`
      INSERT INTO reading_progress (book_id, chapter_index, progress_percent, scroll_position, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(book_id) DO UPDATE SET
        chapter_index = excluded.chapter_index,
        progress_percent = excluded.progress_percent,
        scroll_position = excluded.scroll_position,
        updated_at = CURRENT_TIMESTAMP
    `).run(bookId, Number(chapter_index), Number(progress_percent), Number(scroll_position));

    db.prepare('INSERT OR IGNORE INTO user_library (book_id) VALUES (?)').run(bookId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Highlights & Notes endpoints
router.get('/highlights/:id', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const rows = db.prepare(`
      SELECT * FROM highlights WHERE book_id = ? ORDER BY chapter_index ASC, created_at ASC
    `).all(bookId);
    res.json({ highlights: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/highlights/:id', (req, res) => {
  try {
    const bookId = Number(req.params.id);
    const { chapter_index = 0, selected_text, note = '', color = 'yellow' } = req.body;

    if (!selected_text || !selected_text.trim()) {
      return res.status(400).json({ error: 'Selected text cannot be empty' });
    }

    const info = db.prepare(`
      INSERT INTO highlights (book_id, chapter_index, selected_text, note, color)
      VALUES (?, ?, ?, ?, ?)
    `).run(bookId, Number(chapter_index), selected_text.trim(), note.trim(), color);

    res.json({ success: true, id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/highlights/:highlightId', (req, res) => {
  try {
    const highlightId = Number(req.params.highlightId);
    db.prepare('DELETE FROM highlights WHERE id = ?').run(highlightId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dictionary definition lookup
router.get('/dictionary/:word', async (req, res) => {
  try {
    const word = req.params.word;
    const result = await lookupWord(word);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
