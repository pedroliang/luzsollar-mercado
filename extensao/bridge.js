// Ponte entre o site (página) e a extensão.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const announce = () => window.postMessage({ src: 'LSM_EXT', type: 'hello', version: VERSION }, '*');
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.src !== 'LSM_PAGE') return;
    if (m.type === 'ping') return announce();
    if (m.type === 'search') {
      chrome.runtime.sendMessage({ type: 'search', job: m.job }, (res) => {
        const err = chrome.runtime.lastError;
        window.postMessage({
          src: 'LSM_EXT', type: 'result', id: m.job.id,
          ok: !err && res && res.ok, items: (res && res.items) || [],
          note: (res && res.note) || null,
          error: err ? err.message : (res && res.error) || null
        }, '*');
      });
    }
  });
  announce();
  document.addEventListener('DOMContentLoaded', announce);
})();
