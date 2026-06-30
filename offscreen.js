import { pipeline, env } from './libs/transformers.min.js';

// Crucial for Chrome Extensions: Disable local model loading so it fetches from HuggingFace hub
env.allowLocalModels = false;

let embedder = null;
const DB_NAME = 'AIMemoryDB';
const STORE_NAME = 'memories';
const DB_VERSION = 1;

// ---------- IndexedDB helpers ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToDB(text, embedding, source) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record = {
      text,
      embedding,
      source,
      timestamp: Date.now()
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllMemories() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearAllMemories() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Similarity ----------
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}

async function searchSimilar(queryEmbedding, limit = 3, threshold = 0.7) {
  const memories = await getAllMemories();
  const scored = memories.map(m => ({
    text: m.text,
    similarity: cosineSimilarity(queryEmbedding, m.embedding)
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.filter(s => s.similarity >= threshold).slice(0, limit);
}

// ---------- Core actions ----------
async function handleStore(text, source) {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);
  await saveToDB(text, vector, source);
}

async function handleSearch(query, limit) {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const output = await embedder(query, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data);
  return await searchSimilar(queryVec, limit, 0.7);
}

// ---------- Message listener ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Listen to the mapped events coming from background.js
  if (message.action === 'offscreen_storePrompt') {
    handleStore(message.text, message.source)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
  if (message.action === 'offscreen_searchMemory') {
    handleSearch(message.query, message.limit || 3)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ error: err.message }));
    return true; 
  }
  if (message.action === 'offscreen_clearAll') {
    clearAllMemories()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});