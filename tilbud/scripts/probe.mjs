// Midlertidig: undersøker hvordan Tjek/eTilbudsavis-API-et svarer.
const LAT = 69.6496, LNG = 18.9560, RADIUS = 15000;
const BASE = 'https://squid-api.tjek.com/v2';
const geo = `r_lat=${LAT}&r_lng=${LNG}&r_radius=${RADIUS}&r_locale=nb_NO`;

async function get(path) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}${geo}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  console.log(`\n### ${res.status} ${url}`);
  console.log('headers:', JSON.stringify(Object.fromEntries(res.headers)));
  try { return JSON.parse(text); } catch { console.log(text.slice(0, 1500)); return null; }
}

const dealers = await get('/dealers?limit=100');
if (Array.isArray(dealers)) {
  console.log('DEALERS', dealers.length);
  for (const d of dealers) console.log(' -', d.id, '|', d.name, '|', JSON.stringify(d.category_ids ?? d.categories ?? d.types ?? ''), '|', d.color);
  console.log('RAW DEALER', JSON.stringify(dealers[0]).slice(0, 1500));
}

const catalogs = await get('/catalogs?limit=100&order_by=-publication_date');
if (Array.isArray(catalogs)) {
  console.log('CATALOGS', catalogs.length);
  for (const c of catalogs) console.log(' -', c.id, '|', c.branding?.name, '|', c.label, '|', c.run_from, '->', c.run_till, '| offers:', c.offer_count, '| types:', JSON.stringify(c.types), '| dealer:', c.dealer_id);
  console.log('RAW CATALOG', JSON.stringify(catalogs[0]).slice(0, 2500));
}

const search = await get('/offers/search?query=' + encodeURIComponent('kjøttdeig') + '&limit=5');
if (Array.isArray(search)) {
  console.log('SEARCH kjøttdeig', search.length);
  for (const o of search) console.log(JSON.stringify(o));
}

const grocery = Array.isArray(catalogs) ? catalogs.find(c => /kiwi|rema|extra|coop|meny|spar|joker|bunnpris/i.test(c.branding?.name || '')) : null;
if (grocery) {
  const offers = await get(`/offers?catalog_ids=${grocery.id}&limit=100`);
  if (Array.isArray(offers)) {
    console.log('OFFERS in', grocery.branding?.name, offers.length);
    for (const o of offers.slice(0, 4)) console.log(JSON.stringify(o));
    for (const o of offers) console.log(' *', o.heading, '|', o.pricing?.price, '/', o.pricing?.pre_price, '|', JSON.stringify(o.quantity), '|', (o.description || '').replace(/\s+/g, ' ').slice(0, 120));
  }
  const page2 = await get(`/offers?catalog_ids=${grocery.id}&limit=100&offset=100`);
  if (Array.isArray(page2)) console.log('PAGE2 count', page2.length);
}
