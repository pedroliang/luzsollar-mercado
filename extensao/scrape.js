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
  const txt = (el) => el ? (el.innerText || el.textContent || '') : '';
  function scrapeML(root) {
    const out = [];
    let cards = root.querySelectorAll('.poly-card');
    if (!cards.length) cards = root.querySelectorAll('li.ui-search-layout__item, .ui-search-result__wrapper');
    cards.forEach((c) => {
      const a = c.querySelector('a.poly-component__title, h3 a, a.ui-search-link, a[href*="MLB"]');
      if (!a) return;
      const titulo = (clean(a.textContent) || clean(c.querySelector('img')?.getAttribute('alt'))).replace(/\s*Imagem\s*-\s*\d+\/\d+\s*$/i, '').trim();
      let preco = null;
      const cur = c.querySelector('.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount');
      const pick = cur || [...c.querySelectorAll('.andes-money-amount')].find((el) => !el.closest('s') && !String(el.className).includes('previous'));
      if (pick) {
        const frac = pick.querySelector('.andes-money-amount__fraction')?.textContent || '';
        const cents = pick.querySelector('.andes-money-amount__cents')?.textContent || '';
        preco = parseFloat(frac.replace(/\./g, '') + (cents ? '.' + cents : ''));
      }
      if (!preco) preco = parseBRL(txt(c));
      const vendedor = clean(c.querySelector('.poly-component__seller, .ui-search-official-store-label')?.textContent).replace(/^Por\s+/i, '');
      const vend = (txt(c).match(/\+?([\d.,]+\s*(?:mil)?)\s*vendid/i) || [])[1] || '';
      let url = a.getAttribute('href') || '';
      try { url = new URL(url, location.href).href; } catch {}
      out.push({ titulo, preco, url: url.split('#')[0], vendedor, extra: vend ? '+' + clean(vend) + ' vendidos' : '' });
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
    if (PLAT === 'ml') return scrapeML(document);
    if (PLAT === 'shopee') return scrapeGeneric(shopeeLink);
    return scrapeGeneric(tiktokLink);
  }

  function blocked() {
    const u = location.href;
    return /registration|login|captcha|verify|suspicious|account-verification/i.test(u);
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => {
      if (!x.titulo || !x.preco) return false;
      const k = x.titulo.toLowerCase() + '|' + x.preco;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  const send = (items, note) => chrome.runtime.sendMessage({ type: 'scraped', items, note: note || null });
  const diag = () => `aba ${document.visibilityState}, ${document.querySelectorAll('.poly-card, li.ui-search-layout__item, a[href]').length} elementos, "${document.title.slice(0, 40)}"`;

  async function run(job) {
    const want = job.limit || 10;
    const t0 = Date.now();
    const deadline = (job.timeout || 45) * 1000 - 4000;
    let items = [], askedVis = false;
    while (Date.now() - t0 < deadline) {
      if (blocked()) return send([], 'login');
      window.scrollBy(0, Math.max(600, innerHeight * 0.9));
      await sleep(800);
      items = dedupe(scrape());
      if (items.length >= want) break;
      if (items.length && Date.now() - t0 > 8000) break;
      // ainda vazio e aba escondida: pede para mostrar a aba
      if (!items.length && !askedVis && document.visibilityState !== 'visible' && Date.now() - t0 > 2500) {
        askedVis = true;
        chrome.runtime.sendMessage({ type: 'needVisible' });
      }
    }
    window.scrollTo(0, 0);
    send(items.slice(0, want), items.length ? null : 'diag:' + diag());
  }

  chrome.runtime.sendMessage({ type: 'whoami' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.job) return;
    run(res.job);
  });
})();
