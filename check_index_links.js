import * as cheerio from 'cheerio';
import { getOrFetchChapters, getChapterContent } from './lib/gutenberg.js';

async function checkBookIndexLinks(bookId) {
  console.log(`\n================ Checking Book ID: ${bookId} ================`);
  const chapters = await getOrFetchChapters(bookId);
  console.log(`Total chapters parsed: ${chapters.length}`);

  // Fetch Chapter 0 content
  const ch0 = getChapterContent(bookId, 0);
  if (!ch0) {
    console.log('Chapter 0 not found');
    return;
  }

  const $0 = cheerio.load(ch0.content_html);
  const links = [];
  $0('a[href]').each((_, el) => {
    links.push({
      href: $0(el).attr('href'),
      text: $0(el).text().trim()
    });
  });

  console.log(`Found ${links.length} total <a> links in Chapter 0.`);
  const internalLinks = links.filter(l => l.href.startsWith('#'));
  console.log(`Internal anchor links in Chapter 0 (${internalLinks.length}):`, internalLinks.slice(0, 10));

  // Check where target anchor elements land in the database
  if (internalLinks.length > 0) {
    const testLink = internalLinks[0];
    const targetId = testLink.href.substring(1);
    console.log(`\nTesting target anchor ID "${targetId}" (Link text: "${testLink.text}")`);

    for (let i = 0; i < Math.min(chapters.length, 15); i++) {
      const ch = getChapterContent(bookId, i);
      const $ = cheerio.load(ch.content_html);
      const hasId = $(`[id="${targetId}"]`).length > 0;
      const hasName = $(`[name="${targetId}"]`).length > 0;

      if (hasId || hasName) {
        console.log(`✅ Target anchor "#${targetId}" FOUND in Chapter ${i} ("${ch.title}")! (hasId: ${hasId}, hasName: ${hasName})`);
        break;
      }
    }
  }
}

async function run() {
  await checkBookIndexLinks(1342); // Pride and Prejudice
  await checkBookIndexLinks(100);  // Shakespeare
}

run().catch(console.error);
