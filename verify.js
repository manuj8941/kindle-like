import db from './lib/db.js';
import { searchCatalog, getBookDetails, getOrFetchChapters, getChapterContent } from './lib/gutenberg.js';
import { lookupWord } from './lib/dictionary.js';

async function testAll() {
  console.log('--- Step 1: Testing node:sqlite tables ---');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Database tables initialized:', tables.map(t => t.name));

  console.log('\n--- Step 2: Testing Gutendex Catalog Search ---');
  const catalog = await searchCatalog('pride and prejudice', '', 1);
  console.log(`Found ${catalog.count} books. First result: "${catalog.books[0]?.title}" by ${catalog.books[0]?.author} (ID: ${catalog.books[0]?.id})`);

  if (!catalog.books[0]) {
    throw new Error('No books returned from Gutendex catalog');
  }

  const bookId = catalog.books[0].id;

  console.log(`\n--- Step 3: Fetching and parsing chapters for book ID ${bookId} ---`);
  const chapters = await getOrFetchChapters(bookId);
  console.log(`Successfully parsed ${chapters.length} chapters into node:sqlite!`);
  console.log(`Chapter 1 title: "${chapters[0]?.title}", word count: ${chapters[0]?.word_count}`);

  console.log('\n--- Step 4: Fetching single chapter content from DB ---');
  const chapter1 = getChapterContent(bookId, 0);
  console.log(`Chapter 1 content length: ${chapter1?.content_html.length} chars`);

  console.log('\n--- Step 5: Testing Reading Progress & Highlights in SQLite ---');
  db.prepare(`
    INSERT INTO reading_progress (book_id, chapter_index, progress_percent, scroll_position)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET progress_percent = excluded.progress_percent
  `).run(bookId, 0, 15.5, 120);

  const prog = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId);
  console.log(`Reading progress saved: ${prog.progress_percent}% in chapter ${prog.chapter_index}`);

  const hlStmt = db.prepare(`
    INSERT INTO highlights (book_id, chapter_index, selected_text, note)
    VALUES (?, ?, ?, ?)
  `);
  hlStmt.run(bookId, 0, 'It is a truth universally acknowledged', 'Famous opening line');

  const hls = db.prepare('SELECT * FROM highlights WHERE book_id = ?').all(bookId);
  console.log(`Saved ${hls.length} highlight: "${hls[0].selected_text}" (Note: ${hls[0].note})`);

  console.log('\n--- Step 6: Testing Free Dictionary API ---');
  const dictResult = await lookupWord('prejudice');
  console.log(`Word lookup: "${dictResult.word}" (${dictResult.phonetic}) -> ${dictResult.meanings[0]?.definitions[0]}`);

  console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

testAll().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
