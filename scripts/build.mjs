// Converte epg/guide.xml (XMLTV) in guide.json, aggiunge loghi e locandine.
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

const WANT = ['Rai 1','Rai 2','Rai 3','Rete 4','Canale 5','Italia 1','La7','TV8','NOVE','20 Mediaset','Rai 4','Iris','Rai 5',
'Rai Movie','Rai Premium','Cielo','27 Twentyseven','TV2000','Cine34','Focus','Giallo','La5','Real Time','Top Crime','Rai Gulp','Rai YoYo','Rai News 24','TGcom24','Rai Storia',
'Rai Scuola','Focus','DMAX','Giallo','Warner TV','Food Network','K2','Frisbee','Boing','Cartoonito','La7d','Paramount Network',
'Sportitalia','Mediaset Extra','Italia 2'];
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/hd$/, '');
const order = new Map(WANT.map((n, i) => [norm(n), i]));

const txt = x => Array.isArray(x) ? txt(x[0]) : (x && typeof x === 'object' ? (x['#text'] ?? '') : (x ?? ''));
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
function t(s) {
  const m = String(s).match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-])(\d\d)(\d\d)/);
  if (!m) return null;
  const off = (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]);
  return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60000).toISOString();
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  .parse(fs.readFileSync('epg/guide.xml', 'utf8')).tv;

let logos = {};
try {
  const l = await (await fetch('https://iptv-org.github.io/api/logos.json')).json();
  for (const x of l) if (!logos[x.channel]) logos[x.channel] = x.url;
} catch { console.warn('Loghi non scaricati'); }

const cacheFile = 'tmdb-cache.json';
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile)) : {};
async function poster(title) {
  const key = process.env.TMDB_KEY;
  if (!key) return null;
  if (title in cache) return cache[title];
  try {
    const r = await (await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${key}&language=it-IT&query=${encodeURIComponent(title)}`)).json();
    const p = r.results?.[0]?.poster_path;
    cache[title] = p ? 'https://image.tmdb.org/t/p/w185' + p : null;
  } catch { cache[title] = null; }
  return cache[title];
}

const chans = new Map();
for (const c of arr(xml.channel)) {
  const name = txt(c['display-name']);
  const idx = order.get(norm(name));
  if (idx === undefined || [...chans.values()].some(x => x.idx === idx)) continue;
  const base = c['@_id'].split('@')[0];
  chans.set(c['@_id'], { idx, id: base, name, logo: logos[base] || null, programs: [] });
}

const from = Date.now() - 3 * 3600e3, to = Date.now() + 36 * 3600e3;
for (const p of arr(xml.programme)) {
  const ch = chans.get(p['@_channel']);
  if (!ch) continue;
  const s = t(p['@_start']), e = t(p['@_stop']);
  if (!s || !e || Date.parse(e) < from || Date.parse(s) > to) continue;
  ch.programs.push({ s, e, t: txt(p.title), d: txt(p.desc), c: arr(p.category).map(txt).join(', ') });
}

for (const ch of chans.values()) {
  ch.programs.sort((a, b) => a.s.localeCompare(b.s));
  for (const p of ch.programs)
    if (/film|movie|cinema/i.test(p.c) && Date.parse(p.e) > Date.now()) p.p = await poster(p.t);
}

const out = [...chans.values()].filter(c => c.programs.length).sort((a, b) => a.idx - b.idx);
fs.writeFileSync('guide.json', JSON.stringify({ updated: new Date().toISOString(), channels: out }));
fs.writeFileSync(cacheFile, JSON.stringify(cache));
console.log(`Canali: ${out.length}`);
