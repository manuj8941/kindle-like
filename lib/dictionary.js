/**
 * Looks up word definition via Free Dictionary API
 */
export async function lookupWord(word) {
  if (!word || typeof word !== 'string') {
    throw new Error('Invalid word query');
  }

  const cleanWord = word.trim().toLowerCase().replace(/[^a-z'-]/g, '');
  if (!cleanWord) {
    throw new Error('No valid characters in word query');
  }

  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`;
  
  try {
    const res = await fetch(url);
    if (res.status === 404) {
      return { word: cleanWord, found: false, message: 'No definition found.' };
    }
    if (!res.ok) {
      throw new Error(`Dictionary API error: ${res.statusText}`);
    }
    const data = await res.json();
    const entry = data[0];

    const meanings = (entry.meanings || []).map(m => ({
      partOfSpeech: m.partOfSpeech,
      definitions: (m.definitions || []).slice(0, 3).map(d => d.definition),
      example: m.definitions?.[0]?.example || null
    }));

    return {
      word: entry.word,
      phonetic: entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '',
      audio: entry.phonetics?.find(p => p.audio)?.audio || null,
      meanings,
      found: true
    };
  } catch (err) {
    return { word: cleanWord, found: false, message: err.message };
  }
}
