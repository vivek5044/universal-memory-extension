let creatingOffscreen;

async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    if (creatingOffscreen) {
      await creatingOffscreen;
    } else {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['WORKERS'], // WORKERS is better suited for ML pipelines than DOM_SCRAPING
        justification: 'Run Transformers.js for embeddings'
      });
      await creatingOffscreen;
      creatingOffscreen = null;
    }
  }
}

// Route messages to offscreen document safely
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Listen to actions from content.js and popup.js
  if (['storePrompt', 'searchMemory', 'clearAll'].includes(message.action)) {
    (async () => {
      try {
        await ensureOffscreen();
        // Forward to offscreen with a modified action prefix to avoid background re-intercepting it
        const offscreenMessage = { ...message, action: `offscreen_${message.action}` };
        const response = await chrome.runtime.sendMessage(offscreenMessage);
        sendResponse(response);
      } catch (err) {
        console.error('Error routing to offscreen:', err);
        sendResponse({ error: err.message });
      }
    })();
    return true; // Keep the message channel open for the async response
  }
});