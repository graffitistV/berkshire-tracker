// ── 全域狀態 ──────────────────────────────────────────────
let allHoldings  = [];
let sortKey      = 'rank';
let sortAsc      = true;
let pieChart     = null;

// ── 主入口 ────────────────────────────────────────────────
async function loadData() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  btn.textContent = '⏳ 載入中…';
  showStatus('正在載入最新持股資料…', 'info');

  try {
    const res = await fetch('data/holdings.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allHoldings = data.latest.holdings;

    renderCards(data.latest.period, data.latest.filed, data.fetchedAt);
    renderChart();
    renderChanges();
    renderTable();

    showStatus(`✅ 資料已載入！申報季度：${data.latest.period}　共 ${allHoldings.length} 檔持股`, 'ok');
  } catch (err) {
    console.error(err);
    showStatus('⚠️ 無法載入資料（' + err.message + '），顯示示範資料', 'error');
    renderFallback();
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 重新載入';
  }
}

// ── 渲染：摘要卡片 ────────────────────────────────────────
function renderCards(period, filed, fetchedAt) {
  document.getElementById('card-period').textContent = period || '—';
  document.getElementById('card-filed').textContent  = filed  || '—';

  const total = allHoldings.reduce((s, h) => s + h.value, 0);
  document.getElementById('card-value').textContent = (total / 100000).toFixed(1);
  document.getElementById('card-count').textContent = allHoldings.length;
  document.getElementById('card-new').textContent   = allHoldings.filter(h => h.changeType === 'new').length;
  document.getElementById('card-sold').textContent  = allHoldings.filter(h => h.changeType === 'sold').length;

  if (fetchedAt) {
    const d = new Date(fetchedAt);
    document.getElementById('last-update').textContent =
      '資料更新時間：' + d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  }
}

// ── 渲染：圓餅圖（前15大）────────────────────────────────
function renderChart() {
  const top15    = allHoldings.slice(0, 15);
  const othersVal = allHoldings.slice(15).reduce((s, h) => s + h.value, 0);

  const labels = top15.map(h => h.name.length > 22 ? h.name.slice(0, 20) + '…' : h.name);
  const values = top15.map(h => h.value);
  if (othersVal > 0) { labels.push('其他'); values.push(othersVal); }

  const COLORS = [
    '#0f3460','#16213e','#e94560','#533483','#06668c',
    '#f5a623','#7ed321','#4a90e2','#d0021b','#9b59b6',
    '#2ecc71','#f39c12','#1abc9c','#e74c3c','#3498db','#95a5a6'
  ];

  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${fmtNum(ctx.parsed)} 千美元（${pct}%）`;
            }
          }
        }
      }
    }
  });
}

// ── 渲染：重大變化列表 ────────────────────────────────────
function renderChanges() {
  const notable = allHoldings
    .filter(h => h.changeType !== 'hold')
    .sort((a, b) => Math.abs(b.changePct ?? 999) - Math.abs(a.changePct ?? 999))
    .slice(0, 20);

  const el = document.getElementById('changes-list');
  if (!notable.length) { el.innerHTML = '<p class="placeholder">無重大變化</p>'; return; }

  el.innerHTML = notable.map(h => {
    const label = { new:'新買入', add:'加碼', trim:'減碼', sold:'賣出' }[h.changeType];
    const pct = h.changePct !== null
      ? `<span class="pct ${h.changePct >= 0 ? 'up':'down'}">${h.changePct > 0 ? '+':''}${h.changePct?.toFixed(1)}%</span>`
      : '';
    return `<div class="change-item">
      <span class="badge ${h.changeType}">${label}</span>
      <span>${h.name.length > 28 ? h.name.slice(0,26)+'…' : h.name}</span>
      ${pct}
    </div>`;
  }).join('');
}

// ── 渲染：表格 ────────────────────────────────────────────
function renderTable() {
  const query = (document.getElementById('search').value || '').toLowerCase();
  let rows = allHoldings.filter(h => h.name.toLowerCase().includes(query));

  rows.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va == null) va = sortAsc ?  Infinity : -Infinity;
    if (vb == null) vb = sortAsc ?  Infinity : -Infinity;
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const tagMap = {
    new:  '<span class="tag tag-new">新買入</span>',
    add:  '<span class="tag tag-add">加碼</span>',
    trim: '<span class="tag tag-trim">減碼</span>',
    sold: '<span class="tag tag-sold">賣出</span>',
    hold: '<span class="tag tag-hold">持平</span>',
  };
  const pctStr = h => h.changePct === null ? '—'
    : `<span style="color:${h.changePct >= 0 ? '#16a34a':'#dc2626'}">${h.changePct > 0 ? '+':''}${h.changePct.toFixed(1)}%</span>`;

  document.getElementById('table-body').innerHTML = rows.length
    ? rows.map(h => `<tr>
        <td class="rank-col">${h.rank}</td>
        <td>${h.name}</td>
        <td class="value-col">${fmtNum(h.value)}</td>
        <td class="value-col">${fmtNum(h.shares)}</td>
        <td>${pctStr(h)}</td>
        <td>${tagMap[h.changeType] || ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="placeholder">沒有符合的結果</td></tr>';
}

// ── 排序 / 搜尋 ───────────────────────────────────────────
function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = key === 'rank' || key === 'name'; }
  renderTable();
}
function filterTable() { renderTable(); }

// ── 工具 ─────────────────────────────────────────────────
function showStatus(msg, type) {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = `status-bar ${type}`;
}
function fmtNum(n) {
  return (n != null) ? n.toLocaleString('en-US') : '—';
}

// ── 示範資料 ─────────────────────────────────────────────
function renderFallback() {
  allHoldings = [
    { rank:1,  name:'Apple Inc.',              value:174300000, shares:900000000,   changeType:'trim', changePct:-4.2  },
    { rank:2,  name:'Bank of America Corp',    value: 33900000, shares:1032852006,  changeType:'hold', changePct: 0.0  },
    { rank:3,  name:'American Express Co',     value: 28400000, shares:151610700,   changeType:'hold', changePct: 0.0  },
    { rank:4,  name:'Coca-Cola Co',            value: 24100000, shares:400000000,   changeType:'hold', changePct: 0.0  },
    { rank:5,  name:'Chevron Corp',            value: 18800000, shares:126093326,   changeType:'trim', changePct:-16.5 },
    { rank:6,  name:'Occidental Petroleum',    value: 13200000, shares:228200000,   changeType:'add',  changePct: 2.1  },
    { rank:7,  name:'Kraft Heinz Co',          value:  9900000, shares:325634818,   changeType:'hold', changePct: 0.0  },
    { rank:8,  name:'Moody\'s Corp',           value:  9600000, shares: 24669778,   changeType:'hold', changePct: 0.0  },
    { rank:9,  name:'DaVita Inc',              value:  5000000, shares: 36095570,   changeType:'hold', changePct: 0.0  },
    { rank:10, name:'Visa Inc',                value:  2900000, shares:  8297460,   changeType:'hold', changePct: 0.0  },
    { rank:11, name:'Amazon.com Inc',          value:  2300000, shares: 10666000,   changeType:'new',  changePct: null },
    { rank:12, name:'Nu Holdings Ltd',         value:  1600000, shares:107118784,   changeType:'hold', changePct: 0.0  },
    { rank:13, name:'Charter Communications', value:  1400000, shares:  2797796,   changeType:'trim', changePct:-9.1  },
    { rank:14, name:'HP Inc',                  value:  1300000, shares: 58848000,   changeType:'hold', changePct: 0.0  },
    { rank:15, name:'Sirius XM Holdings',      value:   900000, shares:248838679,   changeType:'add',  changePct: 5.3  },
  ];
  renderCards('2024-09-30 (示範)', '2024-11-14 (示範)', null);
  renderChart();
  renderChanges();
  renderTable();
}

window.addEventListener('DOMContentLoaded', loadData);
