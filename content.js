// === Site selectors ===
const SITE_SELECTORS = {
  'chat.openai.com': { input: '#prompt-textarea', sendButton: '[data-testid="send-button"], button[aria-label="Send message"]' },
  'chatgpt.com': { input: '#prompt-textarea', sendButton: '[data-testid="send-button"], button[aria-label="Send message"]' },
  'chat.deepseek.com': { input: 'textarea[placeholder*="Send a message"]', sendButton: '.ds-icon-button' },
  'gemini.google.com': { input: 'div[contenteditable="true"]', sendButton: 'button[aria-label="Send message"]' }
};

function getSiteConfig() {
  return SITE_SELECTORS[location.hostname];
}

function getInputElement() {
  const config = getSiteConfig();
  return config ? document.querySelector(config.input) : null;
}

// === Capture a sent prompt ===
function extractPromptText() {
  const input = getInputElement();
  if (!input) return '';
  return input.value || input.innerText || '';
}

let lastStoredPrompt = '';
let latestTypingBuffer = '';

function captureAndStore(triggerSource) {
  let text = extractPromptText().trim();
  if (!text) text = latestTypingBuffer.trim();

  console.log(`[AI Memory] Attempting save via ${triggerSource}. Text: "${text}"`);
  
  if (!text || text === lastStoredPrompt) {
    return;
  }
  
  lastStoredPrompt = text;
  latestTypingBuffer = '';

  chrome.runtime.sendMessage({
    action: 'storePrompt',
    text,
    source: location.hostname
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[AI Memory] Message passing error:", chrome.runtime.lastError.message);
    } else {
      console.log("[AI Memory] Saved successfully!", response);
    }
  });
}

function attachSendListeners() {
  const config = getSiteConfig();
  if (!config) return;

  document.addEventListener('click', (e) => {
    const button = e.target.closest(config.sendButton);
    if (button) {
      captureAndStore('Send Button');
    }
  }, true);

  const inputEl = getInputElement();
  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        captureAndStore('Enter Key');
      }
    }, true);
  }
}

// === Memory suggestion chip (shadow DOM) ===
class MemoryChip {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'ai-memory-chip-container';
    const shadow = this.container.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .chip {
          position: fixed;
          bottom: 80px;
          right: 20px;
          z-index: 999999;
          background: #1a1a2e;
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 13px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: none;
          align-items: center;
          gap: 6px;
        }
        .chip.visible { display: flex; }
        .popover {
          display: none;
          position: fixed;
          bottom: 130px;
          right: 20px;
          z-index: 1000000;
          background: white;
          color: #333;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
          padding: 12px;
          max-width: 300px;
          font-size: 14px;
        }
        .popover.visible { display: block; }
        .memory-item {
          border-bottom: 1px solid #eee;
          padding: 8px 0;
          cursor: pointer;
        }
        .memory-item:last-child { border: none; }
        .memory-item:hover { background: #f0f0f0; }
        .insert-btn {
          background: #4a6cf7;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
          cursor: pointer;
        }
        .dismiss {
          float: right;
          font-size: 18px;
          cursor: pointer;
        }
      </style>
      <div class="chip" id="chip">🧠 0 memories</div>
      <div class="popover" id="popover"></div>
    `;
    document.body.appendChild(this.container);
    this.chip = shadow.getElementById('chip');
    this.popover = shadow.getElementById('popover');
    this.setupEvents();
  }

  setupEvents() {
    this.chip.addEventListener('click', () => {
      this.popover.classList.toggle('visible');
    });
    this.popover.addEventListener('click', (e) => {
      if (e.target.classList.contains('dismiss')) {
        this.hide();
      }
    });
  }

  show(results) {
    if (!results || results.length === 0) {
      this.hide();
      return;
    }
    this.chip.textContent = `🧠 ${results.length} memories`;
    this.chip.classList.add('visible');
    this.popover.innerHTML = results.map((r, i) => `
      <div class="memory-item">
        <div>${escapeHTML(r.text.substring(0, 100))}…</div>
        <button class="insert-btn" data-index="${i}">Insert</button>
      </div>
    `).join('') + '<span class="dismiss">×</span>';

    this.popover.querySelectorAll('.insert-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Prevent click from bubbling up and blurring things unnecessarily
        e.preventDefault();
        e.stopPropagation();
        
        const index = parseInt(btn.dataset.index);
        this.insertMemory(results[index].text);
        this.hide();
      });
    });
    this.popover.classList.remove('visible');
  }

  hide() {
    this.chip.classList.remove('visible');
    this.popover.classList.remove('visible');
  }

  insertMemory(text) {
    const input = getInputElement();
    if (!input) return;
    
    const prefix = `[Previous context]: ${text}\n---\n`;
    
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      // Standard textarea like DeepSeek
      input.value = prefix + input.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable (ChatGPT and Gemini)
      
      // 1. Force the focus back onto the input element
      input.focus();
      
      // 2. Programmatically create a selection range specifically INSIDE the input box
      const selection = window.getSelection();
      const range = document.createRange();
      
      // Select the contents of the input and collapse to the very beginning
      range.selectNodeContents(input);
      range.collapse(true); 
      
      // Apply this range to the user's browser selection
      selection.removeAllRanges();
      selection.addRange(range);
      
      // 3. Insert the text natively so React/ProseMirror registers it
      document.execCommand('insertText', false, prefix);
      
      // 4. Trigger input event to ensure React state updates
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Debounced suggestion search ===
let debounceTimer;
let memoryChip = null;

function initMemoryChip() {
  if (!memoryChip) memoryChip = new MemoryChip();
}

async function searchAndSuggest(query) {
  if (!query || query.trim().length < 10) {
    memoryChip && memoryChip.hide();
    return;
  }
  chrome.runtime.sendMessage(
    { action: 'searchMemory', query, limit: 3 },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[AI Memory] Search error:', chrome.runtime.lastError);
        return;
      }
      if (response && response.results) {
        memoryChip.show(response.results);
      } else {
        memoryChip.hide();
      }
    }
  );
}

function onInput() {
  const text = extractPromptText();
  
  if (text.trim()) {
    latestTypingBuffer = text;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => searchAndSuggest(text), 800);
}

// === Initialize ===
function init() {
  console.log(`[AI Memory] Content script injected on ${location.hostname}`);
  
  const observer = new MutationObserver(() => {
    const input = getInputElement();
    if (input && !input.dataset.aiMemoryAttached) {
      input.dataset.aiMemoryAttached = 'true';
      console.log("[AI Memory] Input element found, attaching listeners.");
      setup(input);
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });

  const input = getInputElement();
  if (input && !input.dataset.aiMemoryAttached) {
    input.dataset.aiMemoryAttached = 'true';
    console.log("[AI Memory] Input element found immediately, attaching listeners.");
    setup(input);
  }

  function setup(inputEl) {
    attachSendListeners();
    initMemoryChip();
    
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keyup', onInput);
  }
}

if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}