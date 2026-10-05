// Lê os anúncios da página de busca (só age em abas abertas pelo site).
(() => {
  const host = location.hostname;
  const PLAT = host.includes('mercadolivre') ? 'ml' : host.includes('shopee') ? 'shopee' : host.includes('tiktok') ? 'tiktok' : null;
  if (!PLAT) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function parseBRL(txt) {
    if (!txt) return null;
    const m = String(txt).replace(/ /g, ' ').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    return isFinite(v) && v > 0 ? v : null;
  }

  // ---------- Mercado Livre ----------
  function scrapeML() {
    const out = [];
    const cards = document.querySelectorAll('li.ui-search-layout__item, .poly-card, .ui-search-result__wrapper');
    cards.forEach((c) => {
      const a = c.querySelector('a.poly-component__title, h3 a, a.ui-search-link, a[href*="MLB"]');
      if (!a) return;
      const titulo = clean(a.textContent) || clean(c.querySelector('img')?.alt);
      let preco = null;
      const cur = c.querySelector('.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount');
      const pick = cur || [...c.querySelectorAll('.andes-money-amount')].find((el) => !el.closest('s') && !el.className.includes('previous'));
      if (pick) {
        const frac = pick.querySelector('.andes-money-amount__fraction')?.textContent || '';
        const cents = pick.querySelector('.andes-money-amount__cents')?.textContent || '';
        preco = parseFloat(frac.replace(/\./g, '') + (cents ? '.' + cents : ''));
      }
      if (!preco) preco = parseBRL(c.innerText);
      const vendedor = clean(c.querySelector('.poly-component__seller, .ui-search-official-store-label')?.textContent).replace(/^Por\s+/i, '');
      const full = !!c.querySelector('[aria-label*="FULL" i], .poly-component__shipped-from svg');
      out.push({ titulo, preco, url: a.href.split('#')[0], vendedor, extra: full ? 'FULL' : '' });
    });
    return out;
  }

  // ---------- genérico (Shopee / TikTok) ----------
  function scrapeGeneric(linkTest) {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href;
      if (!linkTest(href)) return;
      const key = href.split('?')[0];
      if (seen.has(key)) return;
      // sobe até um container que tenha preço
      let card = a, preco = null;
      for (let i = 0; i < 7 && card; i++) {
        const keys = new Set([...card.querySelectorAll('a[href]')].map((x) => x.href).filter(linkTest).map((x) => x.split('?')[0]));
        if (keys.size > 1) { preco = null; break; }
        preco = parseBRL(card.innerText);
        if (preco) break;
        card = card.parentElement;
      }
      if (!preco || !card) return;
      seen.add(key);
      const img = card.querySelector('img[alt]');
      const lines = (card.innerText || '').split('\n').map(clean).filter((l) => l.length > 12 && !/R\$/.test(l));
      const titulo = clean(img?.alt) || lines[0] || clean(a.title) || clean(a.textContent);
      const vend = (card.innerText.match(/([\d.,]+\s*(?:mil)?\+?)\s*vendid/i) || [])[1] || '';
      out.push({ titulo, preco, url: href, vendedor: '', extra: vend ? vend + ' vendidos' : '' });
    });
    return out;
  }

  const shopeeLink = (h) => /shopee\.com\.br\/.+-i\.\d+\.\d+/.test(h) || /shopee\.com\.br\/product\/\d+\/\d+/.test(h);
  const tiktokLink = (h) => /tiktok\.com\/.*(\/pdp\/|\/product\/|\/view\/product\/)/.test(h);

  function scrape() {
    if (PLAT === 'ml') return scrapeML();
    if (PLAT === 'shopee') return scrapeGeneric(shopeeLink);
    return scrapeGeneric(tiktokLink);
  }

  function blocked() {
    const u = location.href;
    return /registration|login|captcha|verify|suspicious|account-verification/i.test(u);
  }

  async function run(job) {
    const want = job.limit || 10;
    let items = [];
    const t0 = Date.now();
    while (Date.now() - t0 < (job.timeout || 35) * 1000 - 4000) {
      if (blocked()) {
        chrome.runtime.sendMessage({ type: 'scraped', items: [], note: 'login' });
        return;
      }
      window.scrollBy(0, Math.max(600, innerHeight * 0.9));
      await sleep(900);
      items = scrape().filter((x) => x.titulo && x.preco);
      if (items.length >= want) break;
      if (items.length && Date.now() - t0 > 12000) break;
    }
    window.scrollTo(0, 0);
    chrome.runtime.sendMessage({ type: 'scraped', items: items.slice(0, want) });
  }

  chrome.runtime.sendMessage({ type: 'whoami' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.job) return;
    run(res.job);
  });
})();
