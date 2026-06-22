// 這個腳本由 GitHub Actions 每天自動執行
// 它從 SEC EDGAR 抓取波克夏的持股資料，存成 data/holdings.json
// 網頁直接讀這個 JSON，就不需要瀏覽器直接連 SEC

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BRK_CIK = '0001067983';

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'BerkshireTracker/1.0 contact@example.com',
        'Accept': 'application/json, text/xml, */*',
      }
    };
    https.get(url, opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        } else {
          resolve(body);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 解析 infotable XML
function parseInfoTable(xml) {
  const holdings = [];
  const rowRe = /<infoTable>([\s\S]*?)<\/infoTable>/g;
  const tagRe = /<([^>\/\s]+)[^>]*>([\s\S]*?)<\/\1>/g;

  let row;
  while ((row = rowRe.exec(xml)) !== null) {
    const block = row[1];
    const fields = {};
    let m;
    while ((m = tagRe.exec(block)) !== null) {
      fields[m[1]] = m[2].trim();
    }
    const name   = fields['nameOfIssuer'] || '';
    const value  = parseInt(fields['value'], 10) || 0;
    const shares = parseInt(fields['sshPrnamt'], 10) || 0;
    const putCall = fields['putCall'] || '';

    if (putCall) continue;          // 略過選擇權
    if (!name || value === 0) continue;

    holdings.push({ name, value, shares });
  }

  holdings.sort((a, b) => b.value - a.value);
  holdings.forEach((h, i) => { h.rank = i + 1; });
  return holdings;
}

async function main() {
  console.log('1. 取得申報清單…');
  const subJson = await get(`https://data.sec.gov/submissions/CIK${BRK_CIK}.json`);
  const sub = JSON.parse(subJson);

  const forms   = sub.filings.recent.form;
  const dates   = sub.filings.recent.filingDate;
  const accNos  = sub.filings.recent.accessionNumber;
  const periods = sub.filings.recent.reportDate;

  // 找最新兩份 13F-HR
  const filings = [];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '13F-HR') {
      filings.push({ accNo: accNos[i].replace(/-/g,''), accNoDash: accNos[i], filed: dates[i], period: periods[i] });
      if (filings.length === 2) break;
    }
  }
  if (filings.length === 0) throw new Error('找不到 13F 申報');
  console.log(`  找到 ${filings.length} 份申報，最新：${filings[0].period}`);

  const results = [];
  for (const filing of filings) {
    console.log(`\n2. 處理 ${filing.period} (${filing.accNo})…`);
    await sleep(500); // 避免請求太快

    const idxJson = await get(
      `https://www.sec.gov/Archives/edgar/data/1067983/${filing.accNo}/${filing.accNoDash}-index.json`
    );
    const idx = JSON.parse(idxJson);
    const files = idx.directory.item;

    const xmlFile = files.find(f =>
      f.name.toLowerCase().includes('infotable') ||
      (f.name.toLowerCase().endsWith('.xml') &&
       !['primary_doc.xml','xslForm13F_X02.xsl'].includes(f.name.toLowerCase()))
    );
    if (!xmlFile) { console.warn('  找不到 XML，跳過'); continue; }

    console.log(`  XML 檔案：${xmlFile.name}`);
    await sleep(300);

    const xml = await get(
      `https://www.sec.gov/Archives/edgar/data/1067983/${filing.accNo}/${xmlFile.name}`
    );
    const holdings = parseInfoTable(xml);
    console.log(`  解析完成，${holdings.length} 筆持股`);

    results.push({ ...filing, holdings });
  }

  if (results.length === 0) throw new Error('沒有解析到任何資料');

  // 計算季度變化
  const latest = results[0];
  const prev   = results[1];

  const prevMap = {};
  if (prev) {
    for (const h of prev.holdings) prevMap[h.name] = h.shares;
  }

  latest.holdings = latest.holdings.map(h => {
    const p = prevMap[h.name];
    if (p === undefined) return { ...h, changeType: 'new',  changePct: null };
    if (h.shares === 0)  return { ...h, changeType: 'sold', changePct: -100 };
    const pct = ((h.shares - p) / p) * 100;
    if (Math.abs(pct) < 0.5) return { ...h, changeType: 'hold', changePct: +(pct.toFixed(2)) };
    return { ...h, changeType: pct > 0 ? 'add' : 'trim', changePct: +(pct.toFixed(2)) };
  });

  // 存檔
  const outDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const output = {
    fetchedAt: new Date().toISOString(),
    latest: {
      period:   latest.period,
      filed:    latest.filed,
      holdings: latest.holdings,
    },
    prev: prev ? {
      period:   prev.period,
      filed:    prev.filed,
      holdings: prev.holdings,
    } : null,
  };

  fs.writeFileSync(path.join(outDir, 'holdings.json'), JSON.stringify(output, null, 2));
  console.log(`\n✅ 資料已存到 data/holdings.json（${latest.holdings.length} 筆）`);
}

main().catch(e => { console.error('❌ 錯誤：', e.message); process.exit(1); });
