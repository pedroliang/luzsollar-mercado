// Abre a busca em uma aba, espera o scrape.js responder e fecha a aba.
const pending = new Map(); // tabId -> {resolve, job, timer}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'search') {
    runJob(msg.job).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'whoami') {
    const p = sender.tab && pending.get(sender.tab.id);
    sendResponse(p ? { job: p.job } : { job: null });
    return false;
  }
  if (msg.type === 'scraped') {
    const p = sender.tab && pending.get(sender.tab.id);
    if (p) finish(sender.tab.id, { ok: true, items: msg.items, note: msg.note });
    return false;
  }
});

function finish(tabId, result) {
  const p = pending.get(tabId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(tabId);
  p.resolve(result);
  if (!p.job.keepOpen) chrome.tabs.remove(tabId).catch(() => {});
}

async function runJob(job) {
  const tab = await chrome.tabs.create({ url: job.url, active: !!job.visible });
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(tab.id, { ok: false, items: [], error: 'Tempo esgotado (a página não carregou ou pediu login/captcha).' }), (job.timeout || 35) * 1000);
    pending.set(tab.id, { resolve, job, timer });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pending.has(tabId)) finish(tabId, { ok: false, items: [], error: 'Aba fechada antes de terminar.' });
});
