document.addEventListener('DOMContentLoaded', () => {
  const clearBtn = document.getElementById('clearBtn');
  const status = document.getElementById('status');

  clearBtn.addEventListener('click', async () => {
    status.textContent = 'Clearing...';
    try {
      await chrome.runtime.sendMessage({ action: 'clearAll' });
      status.textContent = 'All memories cleared.';
    } catch (err) {
      console.error('Clear error:', err);
      status.textContent = 'Failed to clear memories.';
    }
  });
});