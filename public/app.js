let USERS = [];
let GROUPS = [];
let EXPENSES = [];
let SETTLEMENTS = [];
let NOTIFS = [];
let BUDGETS = [];
let AI_INSIGHTS = [];
let ME = null; // Loaded dynamically on boot

const CATS = [
  { id: 'food', lbl: 'Food', ico: '🍔', bg: '#FEE2E2', col: '#DC2626' },
  { id: 'travel', lbl: 'Travel', ico: '✈️', bg: '#DBEAFE', col: '#0EA5E9' },
  { id: 'rent', lbl: 'Rent', ico: '🏠', bg: '#F3E8FF', col: '#8B5CF6' },
  { id: 'groceries', lbl: 'Groceries', ico: '🛒', bg: '#DCFCE7', col: '#16A34A' },
  { id: 'utilities', lbl: 'Utilities', ico: '💡', bg: '#FEF3C7', col: '#D97706' },
  { id: 'entertainment', lbl: 'Entertainment', ico: '🎬', bg: '#FCE7F3', col: '#EC4899' },
  { id: 'medical', lbl: 'Medical', ico: '💊', bg: '#CFFAFE', col: '#14B8A6' },
  { id: 'fuel', lbl: 'Fuel', ico: '⛽', bg: '#FED7AA', col: '#F59E0B' },
  { id: 'education', lbl: 'Education', ico: '📚', bg: '#E0E7FF', col: '#6366F1' },
  { id: 'misc', lbl: 'Misc', ico: '📦', bg: '#F1F5F9', col: '#6B7280' },
];

let S = {
  page: 'landing',
  loginTab: 'login',
  modal: null,
  modalData: null,
  activeGroup: null,
  filterCat: null,
  showNotif: false,
  cmdOpen: false,
  cmdQ: '',
  sidebarOpen: false,
  faqOpen: {},
  newExpense: { type: 'equal' },
  newGroup: { cat: 'travel' },
  newBudget: { gid: '', limit: '', threshold: '80%' },
  aiIdx: 0,
  viewedAnalytics: false, // Tracks onboarding progress
};

// State Updater
function ss(u) {
  S = { ...S, ...u };
  
  // Track if they navigated to analytics for onboarding
  if (S.page === 'analytics') {
    S.viewedAnalytics = true;
  }
  
  render();
}

// Fetch API Wrapper adding JWT Authorization Headers
async function fetchAPI(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401) {
    localStorage.removeItem('token');
    ME = null;
    ss({ page: 'landing', modal: null });
    toast('Session expired. Please sign in.', 'error');
    throw new Error('Unauthenticated');
  }
  
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP error ${res.status}`);
  }
  
  return res.json();
}

// Load database data
async function loadData() {
  if (!localStorage.getItem('token')) return;
  try {
    const meData = await fetchAPI('/api/auth/me');
    ME = meData;

    const usersData = await fetchAPI('/api/users');
    USERS = usersData;

    const groupsData = await fetchAPI('/api/groups');
    GROUPS = groupsData;

    const expensesData = await fetchAPI('/api/expenses');
    EXPENSES = expensesData;

    const settlementsData = await fetchAPI('/api/settlements');
    SETTLEMENTS = settlementsData.history;

    const budgetsData = await fetchAPI('/api/budgets');
    BUDGETS = budgetsData;

    const notifsData = await fetchAPI('/api/notifications');
    NOTIFS = notifsData;

    const aiData = await fetchAPI('/api/ai-insights');
    AI_INSIGHTS = aiData;
  } catch (err) {
    console.error('Error fetching data from API:', err);
  }
}

// Helper functions
const uf = id => USERS.find(u => u.id === id) || { name: 'Unknown User', ini: '?', col: '#777' };
const gf = id => GROUPS.find(g => g.id === id);
const cf = id => CATS.find(c => c.id === id) || CATS[9];
const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtK = n => n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : '₹' + Math.round(n);

// Dynamic split share helper
function getMemberShare(e, uid) {
  if (!e.split.includes(uid)) return 0;
  if (e.type === 'percentage') {
    return e.amount * (e.pcts && e.pcts[uid] !== undefined ? e.pcts[uid] : (100 / e.split.length)) / 100;
  }
  if (e.type === 'exact') {
    return e.exacts && e.exacts[uid] !== undefined ? e.exacts[uid] : (e.amount / e.split.length);
  }
  if (e.type === 'shares') {
    const getShare = id => (e.shares && e.shares[id] !== undefined ? e.shares[id] : 1);
    const totalShares = e.split.reduce((s, id) => s + getShare(id), 0) || 1;
    return (e.amount * getShare(uid)) / totalShares;
  }
  return e.amount / e.split.length;
}

// Calculate Net Balances dynamically
function calcBal() {
  const b = {};
  USERS.forEach(u => { b[u.id] = 0; });

  EXPENSES.forEach(e => {
    e.split.forEach(uid => {
      if (uid !== e.paidBy) {
        const sh = getMemberShare(e, uid);
        b[uid] = (b[uid] || 0) - sh;
        b[e.paidBy] = (b[e.paidBy] || 0) + sh;
      }
    });
  });

  SETTLEMENTS.forEach(s => {
    b[s.from] = (b[s.from] || 0) + s.amount;
    b[s.to] = (b[s.to] || 0) - s.amount;
  });

  return b;
}

// Calculate Pairwise Balances between myId and other users (accounting for expenses and settlements)
function calcBalPairwise(myId) {
  const pair = {};
  USERS.forEach(u => {
    if (u.id !== myId) pair[u.id] = 0;
  });

  EXPENSES.forEach(e => {
    const paidByMe = e.paidBy === myId;
    const splitWithMe = e.split.includes(myId);
    
    e.split.forEach(uid => {
      if (uid === myId) return;
      const share = getMemberShare(e, uid);
      if (paidByMe) {
        pair[uid] = (pair[uid] || 0) + share;
      } else if (e.paidBy === uid && splitWithMe) {
        const myShare = getMemberShare(e, myId);
        pair[uid] = (pair[uid] || 0) - myShare;
      }
    });
  });

  SETTLEMENTS.forEach(s => {
    if (s.from === myId && pair[s.to] !== undefined) {
      pair[s.to] += s.amount;
    } else if (s.to === myId && pair[s.from] !== undefined) {
      pair[s.from] -= s.amount;
    }
  });

  return pair;
}

// Greedy cash flow simplification algorithm (Min Cash Flow)
function minCashFlow(expenses, settlements) {
  const net = {};
  
  // Initialize net balances for all known users
  USERS.forEach(u => {
    net[u.id] = 0;
  });

  // Accumulate debts from expenses
  expenses.forEach(e => {
    e.split.forEach(uid => {
      if (uid !== e.paidBy) {
        const sh = getMemberShare(e, uid);
        net[uid] -= sh;
        net[e.paidBy] += sh;
      }
    });
  });

  // Adjust debts from settlements already made
  settlements.forEach(s => {
    net[s.from] += s.amount;
    net[s.to] -= s.amount;
  });

  // Build balances list of debtors and creditors
  const balances = [];
  Object.keys(net).forEach(uid => {
    const val = net[uid];
    if (Math.abs(val) > 0.01) {
      balances.push({ uid, val });
    }
  });

  const txns = [];
  let iterations = 0;
  
  // Greedy matching of largest debtor and largest creditor
  while (balances.length > 1 && iterations < 1000) {
    iterations++;
    balances.sort((a, b) => a.val - b.val);
    
    const debtor = balances[0];
    const creditor = balances[balances.length - 1];
    
    if (Math.abs(debtor.val) < 0.01 || Math.abs(creditor.val) < 0.01) {
      break;
    }
    
    const amount = Math.min(-debtor.val, creditor.val);
    
    txns.push({
      from: debtor.uid,
      to: creditor.uid,
      amount: amount
    });
    
    debtor.val += amount;
    creditor.val -= amount;
    
    // Clean up settled accounts
    for (let i = balances.length - 1; i >= 0; i--) {
      if (Math.abs(balances[i].val) < 0.01) {
        balances.splice(i, 1);
      }
    }
  }
  
  return txns;
}

// Dynamic Month Spending Aggregation
function getMonthlyStats() {
  const map = {};
  EXPENSES.forEach(e => {
    const month = e.date.substring(0, 7); // "YYYY-MM"
    if (!map[month]) map[month] = { total: 0, me: 0 };
    map[month].total += e.amount;
    map[month].me += getMemberShare(e, ME.id);
  });

  let monthsKeys = Object.keys(map).sort();
  if (monthsKeys.length < 6) {
    let first = monthsKeys[0] || new Date().toISOString().substring(0, 7);
    let [y, m] = first.split('-').map(Number);
    while (monthsKeys.length < 6) {
      m--;
      if (m === 0) { m = 12; y--; }
      const monthStr = `${y}-${String(m).padStart(2, '0')}`;
      monthsKeys.unshift(monthStr);
      map[monthStr] = { total: 0, me: 0 };
    }
  }
  monthsKeys = monthsKeys.slice(-6);

  const labels = monthsKeys.map(k => {
    const [, m] = k.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(m) - 1];
  });

  const meData = monthsKeys.map(k => map[k]?.me || 0);
  const totalData = monthsKeys.map(k => map[k]?.total || 0);

  return { labels, meData, totalData };
}

// Dynamic Category Spending Aggregation
function getCategoryStats() {
  const catMap = {};
  CATS.forEach(c => { catMap[c.id] = 0; });

  EXPENSES.forEach(e => {
    const share = getMemberShare(e, ME.id);
    if (catMap[e.cat] !== undefined) {
      catMap[e.cat] += share;
    } else {
      catMap['misc'] = (catMap['misc'] || 0) + share;
    }
  });

  return Object.entries(catMap)
    .map(([id, val]) => ({ id, val, label: cf(id).lbl, color: cf(id).col }))
    .sort((a, b) => b.val - a.val);
}

// Autocategorization based on keywords
function autocat(t) {
  const s = t.toLowerCase();
  if (/pizza|food|dinner|lunch|biryani|restaurant|cafe|burger|chai|coffee|swiggy|zomato/i.test(s)) return 'food';
  if (/uber|ola|cab|taxi|train|flight|airport|bus|petrol|fuel|rapido|metro/i.test(s)) return 'travel';
  if (/rent|flat|house|hostel|hotel|pg|stay|booking|room/i.test(s)) return 'rent';
  if (/grocery|vegetable|milk|market|kirana|blinkit|zepto|instamart/i.test(s)) return 'groceries';
  if (/electricity|wifi|water|gas|bill|internet|broadband|recharge/i.test(s)) return 'utilities';
  if (/movie|game|netflix|sports|concert|party|amazon prime|hotstar|pub|club/i.test(s)) return 'entertainment';
  if (/doctor|medicine|hospital|medical|pharma|health|clinic/i.test(s)) return 'medical';
  if (/course|tuition|book|school|college|exam|edu|stationery/i.test(s)) return 'education';
  return 'misc';
}

// Toast notification
let toastQ = [];
function toast(msg, type = 'info') {
  const id = Date.now();
  toastQ.push({ id, msg, type });
  const el = document.getElementById('toasts');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `<i class="ti ti-${type === 'success' ? 'check' : type === 'error' ? 'x' : 'info-circle'}" style="font-size:16px;color:var(--${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'brand'})"></i>${msg}`;
  el.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateX(40px)';
    div.style.transition = 'all 0.3s';
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

// Real CSV Export
function exportToCSV() {
  const headers = ['Expense Title', 'Group', 'Category', 'Paid By', 'Date', 'Amount', 'Split Members', 'Your Share'];
  const rows = EXPENSES.map(e => {
    const g = gf(e.gid);
    const cat = cf(e.cat);
    const pu = uf(e.paidBy);
    const sh = getMemberShare(e, ME.id);
    const membersList = e.split.map(uid => uf(uid).name).join('; ');
    return [
      e.title,
      g ? g.name : 'No Group',
      cat.lbl,
      pu ? pu.name : '',
      e.date,
      e.amount,
      membersList,
      sh
    ];
  });

  const csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(','), ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `splitwise_expenses_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast('CSV downloaded successfully!', 'success');
}

// Real PDF Export (Print layout)
function exportToPDF() {
  const win = window.open("", "_blank");
  const html = `
    <html>
    <head>
      <title>Splitwise Expense Report</title>
      <style>
        body { font-family: sans-serif; padding: 20px; color: #333; }
        h1 { margin-bottom: 5px; color: #5B5BD6; }
        .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #f5f5f5; font-size: 12px; text-transform: uppercase; color: #666; }
        td { font-size: 14px; }
        .amt { font-weight: bold; }
        .brand { color: #5B5BD6; }
      </style>
    </head>
    <body>
      <h1>Splitwise <span class="brand">Mini Pro</span> Report</h1>
      <div class="meta">Generated on ${new Date().toLocaleDateString()} for ${ME.name}</div>
      
      <h3>Report Summary</h3>
      <p>Total Expenses: <strong>${fmt(EXPENSES.reduce((s, e) => s + e.amount, 0))}</strong><br>
      Your Share: <strong>${fmt(EXPENSES.reduce((s, e) => s + getMemberShare(e, ME.id), 0))}</strong></p>
      
      <table>
        <thead>
          <tr>
            <th>Expense</th>
            <th>Group</th>
            <th>Paid By</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Your Share</th>
          </tr>
        </thead>
        <tbody>
          ${EXPENSES.map(e => {
            const g = gf(e.gid);
            const cat = cf(e.cat);
            const pu = uf(e.paidBy);
            const sh = getMemberShare(e, ME.id);
            return `
              <tr>
                <td><strong>${e.title}</strong><br><small>${cat.lbl}</small></td>
                <td>${g ? g.name : 'No Group'}</td>
                <td>${pu ? pu.name : ''}</td>
                <td>${e.date}</td>
                <td class="amt">${fmt(e.amount)}</td>
                <td class="amt">${fmt(sh)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <script>
        window.onload = function() { window.print(); window.close(); }
      <\/script>
    </body>
    </html>
  `;
  win.document.write(html);
  win.document.close();
  toast('PDF report generated!', 'success');
}

// Local Theme Storage
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  toast(`${isDark ? 'Dark' : 'Light'} Mode enabled`, 'info');
}

// Onboarding Step Tracker (First-Time Users)
function rOnboarding() {
  const steps = [
    { title: 'Create Group', desc: 'Create a group for trips or shared bills', done: GROUPS.length > 0 },
    { title: 'Invite Friends', desc: 'Ensure your group has other members', done: GROUPS.some(g => g.members.length > 1) },
    { title: 'Add Expense', desc: 'Add your first shared transaction', done: EXPENSES.length > 0 },
    { title: 'View Analytics', desc: 'Open your analytics tab to view spending', done: S.viewedAnalytics === true }
  ];

  const currentStepIdx = steps.findIndex(s => !s.done);
  if (currentStepIdx === -1) return ''; // All onboarding steps finished!

  return `
  <div class="card" style="background:var(--brand-light);border-color:rgba(91,91,214,0.2);margin-bottom:22px">
    <div style="font-size:14px;font-weight:800;color:var(--brand);margin-bottom:12px">🚀 Onboarding Guide — Get Started in 4 Steps</div>
    <div class="grid4">
      ${steps.map((s, idx) => `
      <div style="padding:12px;background:var(--surface);border-radius:10px;border:1px solid ${s.done ? 'var(--success)' : idx === currentStepIdx ? 'var(--brand)' : 'var(--border)'};opacity:${s.done ? 0.7 : 1}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="width:20px;height:20px;border-radius:50%;background:${s.done ? 'var(--success-light)' : 'var(--brand-light)'};color:${s.done ? 'var(--success)' : 'var(--brand)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">
            ${s.done ? '✓' : idx + 1}
          </span>
          <strong style="font-size:12.5px;color:var(--text)">${s.title}</strong>
        </div>
        <div style="font-size:11.5px;color:var(--text2)">${s.desc}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

// Empty State View Template Helper
function rEmptyState(ico, title, desc, btnText, btnAction) {
  return `<div class="empty" style="padding:42px 20px">
    <i class="ti ${ico}" style="font-size:44px;margin-bottom:12px;opacity:0.35;display:block"></i>
    <h3 style="font-size:15px;font-weight:800;margin-bottom:5px">${title}</h3>
    <p style="font-size:13px;color:var(--text3);margin-bottom:16px">${desc}</p>
    <button class="btn btn-brand btn-sm" onclick="${btnAction}">${btnText}</button>
  </div>`;
}

// Landing View
function rLanding() {
  const faqs = [
    { q: 'Is Splitwise Mini Pro free to use?', a: 'Yes — the Starter plan is free forever. Pro and Team plans offer advanced analytics, AI features, and database persistence.' },
    { q: 'How does the debt simplification work?', a: 'We use the Min Cash Flow algorithm which minimizes the number of transactions needed to settle all debts within a group.' },
    { q: 'Can I use it for international trips?', a: 'Absolutely! We support multi-currency expenses with live exchange rates for INR, USD, EUR, and GBP.' },
    { q: 'Is my financial data secure?', a: 'All data is encrypted at rest and in transit. We use JWT authentication, rate limiting, and never store payment credentials.' },
  ];
  return `<div class="landing">
    <div style="background:var(--surface);border-bottom:1px solid var(--border);padding:14px 40px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:var(--brand);border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px">S</div>
        <span style="font-weight:800;font-size:15px">Splitwise <span style="color:var(--brand)">Mini</span></span>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-sm" onclick="ss({page:'login',loginTab:'login'})">Sign In</button>
        <button class="btn btn-brand btn-sm" onclick="ss({page:'login',loginTab:'register'})">Get started free</button>
      </div>
    </div>
    <div class="hero">
      <div style="display:inline-flex;align-items:center;gap:7px;background:var(--brand-light);color:var(--brand);border-radius:20px;padding:5px 13px;font-size:12px;font-weight:700;margin-bottom:20px">
        <i class="ti ti-lock" style="font-size:13px"></i> Fully authenticated multi-user database storage
      </div>
      <h1>Split expenses.<br><span>Not friendships.</span></h1>
      <p>The professional-grade expense splitting platform for friends, roommates, travel groups, and teams. Track, split, settle — effortlessly.</p>
      <div class="hero-btns">
        <button class="btn btn-brand" style="padding:12px 24px;font-size:14px" onclick="ss({page:'login',loginTab:'register'})">
          <i class="ti ti-rocket"></i> Create Account — It's Free
        </button>
      </div>
      <div class="hero-img">
        <div style="font-size:12px;margin-bottom:12px;color:var(--text3);font-weight:600">PERSONAL FINANCIAL TRACKER</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          ${[['Total Expenses', '₹0', 'brand'], ['Active Groups', '0', 'success'], ['Settlements', '0', 'info']].map(([l, v, c]) => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-size:10px;color:var(--text3);font-weight:700;margin-bottom:5px;text-transform:uppercase">${l}</div>
            <div style="font-size:18px;font-weight:800;color:var(--${c})">${v}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-label">Features</div>
      <div class="section-title">Everything you need to split smarter</div>
      <div class="section-sub">From simple equal splits to complex share-based calculations, we handle every scenario.</div>
      <div class="feat-grid">
        ${[
          ['ti-git-branch', 'Min Cash Flow Algorithm', 'Our graph-based debt optimization reduces 10 transactions to 3, saving everyone time and effort.'],
          ['ti-sparkles', 'AI-Powered Insights', 'Auto-categorization, spending trend analysis, and database calculations — all computed in real-time.'],
          ['ti-users-group', 'Smart Group Management', 'Travel, roommates, office, family — organize by context with persistent backend storage.'],
          ['ti-chart-pie', 'Advanced Analytics', 'Breakdowns, trends, and category analysis in one place, dynamically generated.'],
          ['ti-wallet', 'Budget Planning', 'Set limits per group. Get real-time alerts at 80% and 100% usage.'],
          ['ti-file-export', 'One-Click Exports', 'Export your expense reports as PDF or CSV — anytime you want.'],
        ].map(([ico, t, d]) => `
        <div class="feat-card">
          <div class="feat-icon"><i class="ti ${ico}" style="font-size:20px;color:var(--brand)"></i></div>
          <div class="feat-title">${t}</div>
          <div class="feat-desc">${d}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="section" style="max-width:640px">
      <div class="section-label">FAQ</div>
      <div class="section-title" style="margin-bottom:30px">Frequently asked questions</div>
      ${faqs.map((f, i) => `
      <div class="faq-item" onclick="ss({faqOpen:{...S.faqOpen,[${i}]:!S.faqOpen[${i}]}})">
        <div class="faq-q">${f.q}<i class="ti ti-chevron-${S.faqOpen[i] ? 'up' : 'down'}" style="font-size:15px;color:var(--text3)"></i></div>
        ${S.faqOpen[i] ? `<div class="faq-a">${f.a}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}

// Authentication Forms (Sign In / Sign Up)
function rLogin() {
  return `<div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="icon">S</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:-0.5px">Splitwise <span style="color:var(--brand)">Mini</span></div>
        <div style="font-size:13px;color:var(--text3);margin-top:4px">Your shared finances, simplified</div>
      </div>
      <div class="tabs-line">
        <div class="tab-li ${S.loginTab === 'login' ? 'active' : ''}" onclick="ss({loginTab:'login'})">Sign In</div>
        <div class="tab-li ${S.loginTab === 'register' ? 'active' : ''}" onclick="ss({loginTab:'register'})">Register</div>
        <div class="tab-li ${S.loginTab === 'forgot' ? 'active' : ''}" onclick="ss({loginTab:'forgot'})">Forgot</div>
      </div>
      
      ${S.loginTab === 'login' ? `
        <div class="fg"><label>Email</label><div class="input-icon"><i class="ti ti-mail"></i><input type="email" id="loginEmail" placeholder="you@example.com"></div></div>
        <div class="fg"><label>Password</label><div class="input-icon"><i class="ti ti-lock"></i><input type="password" id="loginPassword" placeholder="••••••••"></div></div>
        <button class="btn btn-brand" style="width:100%;justify-content:center;padding:11px;font-size:13.5px" onclick="handleLogin()">Sign In <i class="ti ti-arrow-right"></i></button>
      ` : S.loginTab === 'register' ? `
        <div class="fg"><label>Full Name</label><div class="input-icon"><i class="ti ti-user"></i><input type="text" id="registerName" placeholder="John Doe"></div></div>
        <div class="fg"><label>Email</label><div class="input-icon"><i class="ti ti-mail"></i><input type="email" id="registerEmail" placeholder="you@example.com"></div></div>
        <div class="fg"><label>Password</label><div class="input-icon"><i class="ti ti-lock"></i><input type="password" id="registerPassword" placeholder="Min 6 characters"></div></div>
        <div class="fg"><label>Confirm Password</label><div class="input-icon"><i class="ti ti-lock"></i><input type="password" id="registerConfirmPassword" placeholder="Confirm your password"></div></div>
        <button class="btn btn-brand" style="width:100%;justify-content:center;padding:11px" onclick="handleRegister()">Register Account <i class="ti ti-arrow-right"></i></button>
      ` : `
        <div class="fg"><label>Registered Email</label><div class="input-icon"><i class="ti ti-mail"></i><input type="email" placeholder="you@example.com"></div></div>
        <button class="btn btn-brand" style="width:100%;justify-content:center;padding:11px" onclick="alert('Instructions sent if account exists.')">Send Reset Link</button>
        <div style="text-align:center;margin-top:10px"><span style="font-size:13px;color:var(--brand);cursor:pointer;font-weight:600" onclick="ss({loginTab:'login'})">← Back to Sign In</span></div>
      `}
      <div style="text-align:center;margin-top:14px"><span style="font-size:12.5px;color:var(--text3);cursor:pointer" onclick="ss({page:'landing'})">← Back to Home</span></div>
    </div>
  </div>`;
}

function rSidebar() {
  const b = calcBal();
  const mb = b[ME.id] || 0;
  const items = [
    { id: 'dashboard', ico: 'ti-layout-dashboard', lbl: 'Dashboard' },
    { id: 'groups', ico: 'ti-users-group', lbl: 'Groups' },
    { id: 'expenses', ico: 'ti-receipt', lbl: 'Expenses' },
    { id: 'settlements', ico: 'ti-transfer', lbl: 'Settlements' },
    { id: 'analytics', ico: 'ti-chart-pie', lbl: 'Analytics' },
    { id: 'budgets', ico: 'ti-wallet', lbl: 'Budgets' },
    { id: 'ai', ico: 'ti-sparkles', lbl: 'AI Insights', tag: 'AI' },
    { id: 'export', ico: 'ti-file-export', lbl: 'Export' },
  ];
  return `<aside class="sidebar ${S.sidebarOpen ? 'open' : ''}">
    <div class="s-logo">
      <div class="s-logo-icon">S</div>
      <div class="s-logo-txt">Split<span>wise</span> Mini</div>
    </div>
    <div class="s-nav">
      <div class="s-section-lbl">Navigation</div>
      ${items.map(it => `<div class="s-item ${S.page === it.id ? 'active' : ''}" onclick="ss({page:'${it.id}',activeGroup:null,sidebarOpen:false})">
        <i class="ti ${it.ico}" aria-hidden="true"></i>${it.lbl}
        ${it.tag ? `<span class="new-tag">${it.tag}</span>` : ''}
        ${it.id === 'settlements' && NOTIFS.filter(n => !n.read && n.type === 'settle').length > 0 ? `<span class="badge-dot">${NOTIFS.filter(n => !n.read && n.type === 'settle').length}</span>` : ''}
      </div>`).join('')}
    </div>
    <div class="s-bottom">
      <div class="s-user" onclick="ss({page:'profile',sidebarOpen:false})">
        <div class="av av-md" style="background:${ME.col}">${ME.ini}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ME.name}</div>
          <div style="font-size:11.5px;font-weight:700;color:${mb >= 0 ? 'var(--success)' : 'var(--danger)'}">Net: ${mb >= 0 ? '+' : ''}${fmtK(mb)}</div>
        </div>
        <i class="ti ti-settings" style="font-size:15px;color:var(--text3)"></i>
      </div>
    </div>
  </aside>`;
}

function rTopbar(title, sub, actions = '') {
  const unread = NOTIFS.filter(n => !n.read).length;
  return `<div class="topbar">
    <div class="topbar-left">
      <div class="mob-menu-btn" onclick="ss({sidebarOpen:!S.sidebarOpen})" aria-label="Toggle menu">
        <i class="ti ti-menu-2" style="font-size:20px"></i>
      </div>
      <div><div class="topbar-title">${title}</div>${sub ? `<div class="topbar-breadcrumb">${sub}</div>` : ''}</div>
    </div>
    <div class="topbar-right">
      ${actions}
      <button class="btn btn-ghost theme-toggle-btn" onclick="toggleTheme()" title="Toggle Theme">
        <i class="ti ti-sun" style="font-size:18px"></i>
      </button>
      <button class="btn btn-ghost" style="padding:8px" onclick="ss({cmdOpen:true})" title="Command palette (⌘K)">
        <i class="ti ti-command" style="font-size:18px"></i>
      </button>
      <div style="position:relative">
        <button class="btn btn-ghost" style="padding:8px;position:relative" onclick="ss({showNotif:!S.showNotif})" aria-label="Notifications">
          <i class="ti ti-bell" style="font-size:18px"></i>
          ${unread > 0 ? `<span style="position:absolute;top:4px;right:4px;width:8px;height:8px;background:var(--danger);border-radius:50%;border:2px solid var(--surface)"></span>` : ''}
        </button>
        ${S.showNotif ? rNotifPanel() : ''}
      </div>
      <div class="av av-sm" style="background:${ME.col};cursor:pointer" onclick="ss({page:'profile',showNotif:false})">${ME.ini}</div>
    </div>
  </div>`;
}

function rNotifPanel() {
  return `<div style="position:absolute;top:calc(100% + 8px);right:0;width:310px;background:var(--surface);border:1px solid var(--border2);border-radius:14px;z-index:200;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.15)" onclick="event.stopPropagation()">
    <div style="padding:13px 16px;font-size:13.5px;font-weight:800;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      Notifications
      <span style="font-size:12px;color:var(--brand);cursor:pointer;font-weight:700" onclick="markAllNotificationsRead()">Mark all read</span>
    </div>
    ${NOTIFS.length === 0 ? `<div style="padding:20px;text-align:center;color:var(--text3)">No notifications yet</div>` : NOTIFS.map(n => `<div style="padding:11px 15px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;${!n.read ? 'background:var(--brand-light)' : ''}" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background='${!n.read ? 'var(--brand-light)' : ''}'}">
      <div style="display:flex;gap:9px;align-items:flex-start">
        <span style="font-size:18px;line-height:1">${n.type === 'expense' ? '💸' : n.type === 'settle' ? '✅' : n.type === 'budget' ? '⚠️' : '👥'}</span>
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:700;${!n.read ? 'color:var(--brand)' : ''}">${n.title}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:1px">${n.body}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${n.time}</div>
        </div>
        ${!n.read ? `<div style="width:7px;height:7px;background:var(--brand);border-radius:50%;margin-top:4px;flex-shrink:0"></div>` : ''}
      </div>
    </div>`).join('')}
  </div>`;
}

async function markAllNotificationsRead() {
  await fetchAPI('/api/notifications/read', { method: 'POST' });
  await loadData();
  ss({ showNotif: false });
}

function rCmdPalette() {
  if (!S.cmdOpen) return '';
  const cmds = [
    { ico: 'ti-plus', lbl: 'Add new expense', action: "ss({cmdOpen:false,modal:'addExpense'})" },
    { ico: 'ti-users-group', lbl: 'Create new group', action: "ss({cmdOpen:false,modal:'addGroup'})" },
    { ico: 'ti-layout-dashboard', lbl: 'Go to Dashboard', action: "ss({cmdOpen:false,page:'dashboard'})" },
    { ico: 'ti-chart-pie', lbl: 'View Analytics', action: "ss({cmdOpen:false,page:'analytics'})" },
    { ico: 'ti-sparkles', lbl: 'AI Insights', action: "ss({cmdOpen:false,page:'ai'})" },
    { ico: 'ti-transfer', lbl: 'Settlements', action: "ss({cmdOpen:false,page:'settlements'})" },
    { ico: 'ti-file-export', lbl: 'Export report', action: "ss({cmdOpen:false,page:'export'})" },
  ];
  const filtered = S.cmdQ ? cmds.filter(c => c.lbl.toLowerCase().includes(S.cmdQ.toLowerCase())) : cmds;
  return `<div class="mo" onclick="ss({cmdOpen:false})">
    <div class="cmd-palette" onclick="event.stopPropagation()">
      <div class="cmd-input">
        <i class="ti ti-search" style="font-size:16px;color:var(--text3)"></i>
        <input type="text" id="cmdInput" placeholder="Type a command or search..." value="${S.cmdQ}" oninput="ss({cmdQ:this.value})" autofocus>
        <kbd style="font-size:11px;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:2px 6px">ESC</kbd>
      </div>
      <div class="cmd-result">
        <div style="font-size:10.5px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:6px 12px 3px">Commands</div>
        ${filtered.map(c => `<div class="cmd-item" onclick="${c.action}">
          <i class="ti ${c.ico}" style="font-size:16px"></i>${c.lbl}
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function rDashboard() {
  const b = calcBal();
  const mb = b[ME.id] || 0;
  const pairB = calcBalPairwise(ME.id);
  const owe = Object.values(pairB).filter(v => v < 0).reduce((s, v) => s - v, 0);
  const owed = Object.values(pairB).filter(v => v > 0).reduce((s, v) => s + v, 0);
  const total = EXPENSES.reduce((s, e) => s + getMemberShare(e, ME.id), 0);
  const recent = [...EXPENSES].sort((a, x) => x.date.localeCompare(a.date)).slice(0, 5);
  
  // Calculate settlements involving ME
  const myGroupsIds = GROUPS.map(g => g.id);
  const networkExpenses = EXPENSES.filter(e => myGroupsIds.includes(e.gid));
  
  const txns = minCashFlow(EXPENSES, SETTLEMENTS).filter(t => t.from === ME.id || t.to === ME.id).slice(0, 3);
  const ins = AI_INSIGHTS[S.aiIdx % Math.max(1, AI_INSIGHTS.length)] || { ico: '💡', txt: 'Add more expenses to see personalized financial insights.' };

  const onboardingUI = rOnboarding();

  return `
  ${rTopbar('Dashboard', `Welcome back, ${ME.name.split(' ')[0]} 👋`, `<button class="btn btn-brand btn-sm" onclick="ss({modal:'addExpense'})"><i class="ti ti-plus"></i> Add Expense</button>`)}
  <div class="page" onclick="ss({showNotif:false})">
    ${onboardingUI}
    <div class="ai-banner">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="width:36px;height:36px;background:var(--brand);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-size:16px">🤖</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px">AI Insight</div>
          <div style="font-size:13.5px;color:var(--text2);line-height:1.6">${ins.ico} ${ins.txt}</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <span style="background:var(--brand);color:#fff;border-radius:6px;padding:3px 10px;font-size:11.5px;font-weight:700;cursor:pointer" onclick="ss({aiIdx:${S.aiIdx + 1}})">Next insight →</span>
            <span style="background:transparent;border:1px solid var(--brand);color:var(--brand);border-radius:6px;padding:3px 10px;font-size:11.5px;font-weight:700;cursor:pointer" onclick="ss({page:'ai'})">View all</span>
          </div>
        </div>
      </div>
    </div>
    <div class="grid4" style="margin-bottom:22px">
      ${[
        { lbl: 'You Are Owed', val: fmt(owed), cls: 'success', ico: 'ti-trending-up', bg: 'var(--success-light)', spark: [1, .7, .9, 1.2, 1, .8, 1.1] },
        { lbl: 'You Owe', val: fmt(owe), cls: 'danger', ico: 'ti-trending-down', bg: 'var(--danger-light)', spark: [0.8, 1, 0.7, 1.1, 0.9, 0.6, 1] },
        { lbl: 'Net Balance', val: (mb >= 0 ? '+' : '') + fmt(mb), cls: mb >= 0 ? 'success' : 'danger', ico: 'ti-scale', bg: mb >= 0 ? 'var(--success-light)' : 'var(--danger-light)', spark: [0.6, 0.8, 1, 0.7, 1.1, 0.9, 1.2] },
        { lbl: 'Total Spent', val: fmtK(total), cls: 'info', ico: 'ti-chart-bar', bg: 'var(--info-light)', spark: [0.5, 0.7, 0.6, 0.9, 0.8, 1, 1.1] },
      ].map(s => `<div class="stat-card">
        <div class="stat-icon" style="background:${s.bg}"><i class="ti ${s.ico}" style="color:var(--${s.cls});font-size:17px"></i></div>
        <div class="stat-lbl">${s.lbl}</div>
        <div class="stat-val" style="color:var(--${s.cls})">${s.val}</div>
        <div class="stat-spark">${s.spark.map(v => `<div class="spark-b" style="height:${Math.round(v * 22)}px;background:var(--${s.cls})"></div>`).join('')}</div>
      </div>`).join('')}
    </div>
    <div class="g23">
      <div>
        <div class="card" style="margin-bottom:18px">
          <div class="ch"><div><div class="ct">Recent Expenses</div><div class="cs">Your latest transactions</div></div>
            <button class="btn btn-outline btn-sm" onclick="ss({page:'expenses'})">View all</button></div>
          ${recent.length === 0 ? rEmptyState('ti-receipt', 'No expenses yet', 'Add your first group expense to start tracking.', 'Add Expense', "ss({modal:'addExpense'})") : recent.map(e => {
            const cat = cf(e.cat);
            const pu = uf(e.paidBy);
            const g = gf(e.gid);
            const sh = getMemberShare(e, ME.id);
            const iOwe = e.paidBy !== ME.id && e.split.includes(ME.id);
            const owedToMe = e.paidBy === ME.id ? (e.amount - sh) : 0;
            return `<div class="exp-row" onclick="ss({modal:'expenseDetail',modalData:'${e.id}'})">
              <div class="exp-ico" style="background:${cat.bg}">${cat.ico}</div>
              <div class="exp-info"><div class="exp-title">${e.title}</div>
                <div class="exp-meta">${g ? g.name : 'No Group'} · ${e.date}</div></div>
              <div class="exp-amt">
                <div class="a">${fmt(e.amount)}</div>
                <div class="l" style="color:${iOwe ? 'var(--danger)' : owedToMe > 0 ? 'var(--success)' : 'var(--text3)'}">
                  ${iOwe ? `you owe ${fmt(sh)}` : owedToMe > 0 ? `owed ${fmt(owedToMe)}` : `your share: ${fmt(sh)}`}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Monthly Spending</div>
          <div style="position:relative;height:180px;margin-top:10px">
            ${EXPENSES.length === 0 ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3)">Add expenses to generate spending trends</div>` : `<canvas id="dash-chart" role="img" aria-label="Monthly spending trend"></canvas>`}
          </div>
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="ch"><div class="ct">Simplified Debts</div><span class="badge bg-brand"><i class="ti ti-sparkles" style="font-size:11px"></i> Optimized</span></div>
          ${txns.length === 0 ? `<div class="empty" style="padding:20px 0"><i class="ti ti-check" style="font-size:32px;opacity:0.3;margin-bottom:6px;display:block"></i><p>All settled up! 🎉</p></div>` :
          txns.map(t => {
            const fu = uf(t.from);
            const tu = uf(t.to);
            return `<div class="settle-card">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${fu.name.split(' ')[0]} <span style="color:var(--brand)">→</span> ${tu.name.split(' ')[0]}</div>
                <div style="font-size:11.5px;color:var(--text3);margin-top:2px">Optimal payment</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:15px;font-weight:800;color:var(--brand)">${fmt(t.amount)}</div>
                ${t.from === ME.id || t.to === ME.id ? `<button class="btn btn-brand btn-xs" style="margin-top:4px" onclick="doSettle('${t.from}','${t.to}',${t.amount})">Settle</button>` : ''}
              </div>
            </div>`
          }).join('')}
          <button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;margin-top:4px" onclick="ss({page:'settlements'})"><i class="ti ti-transfer"></i> All Settlements</button>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:12px">Groups</div>
          ${GROUPS.length === 0 ? rEmptyState('ti-users-group', 'No groups yet', 'Group members can split together.', 'Create Group', "ss({modal:'addGroup'})") : GROUPS.slice(0, 3).map(g => `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="ss({page:'groups',activeGroup:'${g.id}'})">
            <span style="font-size:22px">${g.emoji}</span>
            <div style="flex:1"><div style="font-size:13px;font-weight:700">${g.name}</div>
              <div style="font-size:11.5px;color:var(--text3)">${g.members.length} members</div></div>
            <i class="ti ti-chevron-right" style="font-size:14px;color:var(--text3)"></i>
          </div>`).join('')}
          ${GROUPS.length > 0 ? `<button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;margin-top:10px" onclick="ss({page:'groups'})">All Groups</button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function rGroups() {
  if (S.activeGroup) return rGroupDetail(S.activeGroup);
  return `${rTopbar('Groups', 'Manage your shared expense groups', `<button class="btn btn-brand btn-sm" onclick="ss({modal:'addGroup'})"><i class="ti ti-plus"></i> New Group</button>`)}
  <div class="page" onclick="ss({showNotif:false})">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
      ${GROUPS.map(g => {
        const b = BUDGETS.find(x => x.gid === g.id);
        const ge = EXPENSES.filter(e => e.gid === g.id);
        const spentVal = ge.reduce((s, e) => s + e.amount, 0);
        const pct = b ? Math.round((spentVal / b.limit_amount) * 100) : 0;
        
        const myBal = ge.reduce((s, e) => {
          if (e.paidBy === ME.id) return s + (e.amount - getMemberShare(e, ME.id));
          return s - getMemberShare(e, ME.id);
        }, 0);

        return `<div class="g-card" onclick="ss({activeGroup:'${g.id}'})">
          <div class="g-emoji">${g.emoji}</div>
          <div class="g-name">${g.name}</div>
          <div class="g-meta">${g.members.length} members · ${ge.length} expenses</div>
          <div class="g-bal" style="color:${myBal > 0 ? 'var(--success)' : myBal < 0 ? 'var(--danger)' : 'var(--text3)'}">
            ${myBal > 0 ? `owed ${fmt(myBal)}` : myBal < 0 ? `you owe ${fmt(-myBal)}` : 'settled ✓'}</div>
          ${b ? `<div style="margin-top:10px"><div class="prog"><div class="prog-b ${pct > 100 ? 'danger' : pct > 80 ? 'warn' : ''}" style="width:${Math.min(pct, 100)}%"></div></div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">${pct}% of budget · ${fmt(spentVal)}/${fmt(b.limit_amount)}</div></div>` : ''}
        </div>`
      }).join('')}
      <div class="g-card" style="border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:140px" onclick="ss({modal:'addGroup'})">
        <i class="ti ti-plus" style="font-size:30px;color:var(--text3);opacity:0.4"></i>
        <span style="font-size:13px;color:var(--text3);font-weight:600">New Group</span>
      </div>
    </div>
  </div>`;
}

function rGroupDetail(gid) {
  const g = gf(gid);
  if (!g) return '';
  const ge = EXPENSES.filter(e => e.gid === gid);
  const total = ge.reduce((s, e) => s + e.amount, 0);
  const b = BUDGETS.find(x => x.gid === gid);
  const pct = b ? Math.round((total / b.limit_amount) * 100) : 0;
  const txns = minCashFlow(ge, SETTLEMENTS);

  return `${rTopbar(g.name, 'Group details', `
    <button class="btn btn-brand btn-sm" onclick="ss({modal:'addExpense'})"><i class="ti ti-plus"></i> Add</button>
    <button class="btn btn-outline btn-sm" onclick="ss({activeGroup:null})"><i class="ti ti-arrow-left"></i> Back</button>`)}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="grid3" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-lbl">Total Expenses</div><div class="stat-val" style="color:var(--info)">${fmt(total)}</div><div class="stat-ch">${ge.length} transactions</div></div>
      <div class="stat-card"><div class="stat-lbl">Your Share</div><div class="stat-val" style="color:var(--warning)">${fmt(ge.reduce((s, e) => s + getMemberShare(e, ME.id), 0))}</div><div class="stat-ch">Personal contribution</div></div>
      <div class="stat-card"><div class="stat-lbl">Budget Used</div><div class="stat-val" style="color:var(--${pct > 100 ? 'danger' : pct > 80 ? 'warning' : 'success'})">${pct}%</div><div class="stat-ch">${fmt(total)} / ${fmt(b ? b.limit_amount : 0)}</div></div>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="ch"><div class="ct">Expenses</div><button class="btn btn-brand btn-xs" onclick="ss({modal:'addExpense'})"><i class="ti ti-plus"></i> Add</button></div>
        ${ge.length === 0 ? rEmptyState('ti-receipt', 'No expenses yet', 'No expenses have been added to this group.', 'Add Expense', "ss({modal:'addExpense'})") :
        ge.map(e => {
          const cat = cf(e.cat);
          const pu = uf(e.paidBy);
          return `<div class="exp-row" onclick="ss({modal:'expenseDetail',modalData:'${e.id}'})">
            <div class="exp-ico" style="background:${cat.bg}">${cat.ico}</div>
            <div class="exp-info"><div class="exp-title">${e.title}</div>
              <div class="exp-meta">Paid by ${pu.name.split(' ')[0]} · ${e.date}</div></div>
            <div class="exp-amt">
              <div class="a">${fmt(e.amount)}</div>
              <div class="l">${e.type === 'equal' ? fmt(e.amount / e.split.length) + '/person' : fmt(getMemberShare(e, ME.id)) + ' (your share)'}</div>
            </div>
          </div>`
        }).join('')}
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:12px">Members</div>
          ${g.members.map(uid => {
            const u = uf(uid);
            const paid = ge.filter(e => e.paidBy === uid).reduce((s, e) => s + e.amount, 0);
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
              <div class="av av-md" style="background:${u.col}">${u.ini}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:700">${u.name}</div>
                <span class="role-tag ${uid === ME.id ? 'role-admin' : 'role-member'}">${uid === ME.id ? 'admin' : 'member'}</span>
              </div>
              <div style="text-align:right"><div style="font-size:11px;color:var(--text3)">paid</div><div style="font-size:13px;font-weight:700">${fmt(paid)}</div></div>
            </div>`
          }).join('')}
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:12px">Simplified Debts</div>
          ${txns.length === 0 ? `<div class="empty" style="padding:16px"><p>All settled ✓</p></div>` :
          txns.map(t => {
            const fu = uf(t.from);
            const tu = uf(t.to);
            return `<div class="debt-row">
              <div class="av av-sm" style="background:${fu.col}">${fu.ini}</div>
              <div style="flex:1;display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:2px;background:var(--surface2);position:relative">
                  <div style="position:absolute;right:-6px;top:-6px;font-size:11px;color:var(--brand)">▶</div>
                </div>
              </div>
              <div class="av av-sm" style="background:${tu.col}">${tu.ini}</div>
              <div style="font-weight:800;color:var(--brand);min-width:70px;text-align:right">${fmt(t.amount)}</div>
              ${t.from === ME.id || t.to === ME.id ? `<button class="btn btn-brand btn-xs" onclick="doSettle('${t.from}','${t.to}',${t.amount})">Pay</button>` : ''}
            </div>`
          }).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function rExpenses() {
  const filtered = S.filterCat ? EXPENSES.filter(e => e.cat === S.filterCat) : [...EXPENSES];
  const sorted = filtered.sort((a, b) => b.date.localeCompare(a.date));
  return `${rTopbar('Expenses', 'All your tracked expenses', `<button class="btn btn-brand btn-sm" onclick="ss({modal:'addExpense'})"><i class="ti ti-plus"></i> Add Expense</button>`)}
  <div class="page" onclick="ss({showNotif:false})">
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
      <div class="chip ${!S.filterCat ? 'active' : ''}" onclick="ss({filterCat:null})">All (${EXPENSES.length})</div>
      ${CATS.map(c => {
        const cnt = EXPENSES.filter(e => e.cat === c.id).length;
        return cnt > 0 ? `<div class="chip ${S.filterCat === c.id ? 'active' : ''}" onclick="ss({filterCat:'${c.id}'})">${c.ico} ${c.lbl} (${cnt})</div>` : ''
      }).join('')}
    </div>
    <div class="card overflow-x">
      ${sorted.length === 0 ? rEmptyState('ti-receipt', 'No expenses found', 'No expenses match the current filter.', 'Add Expense', "ss({modal:'addExpense'})") : `
      <table>
        <thead><tr><th>Expense</th><th>Group</th><th>Paid by</th><th>Date</th><th>Amount</th><th>Your share</th></tr></thead>
        <tbody>
          ${sorted.map(e => {
            const cat = cf(e.cat);
            const g = gf(e.gid);
            const pu = uf(e.paidBy);
            const sh = e.split.includes(ME.id) ? getMemberShare(e, ME.id) : 0;
            const iOwe = e.paidBy !== ME.id && e.split.includes(ME.id);
            return `<tr onclick="ss({modal:'expenseDetail',modalData:'${e.id}'})">
              <td><div style="display:flex;align-items:center;gap:10px">
                <div class="exp-ico" style="width:34px;height:34px;font-size:15px;background:${cat.bg}">${cat.ico}</div>
                <div><div style="font-weight:700;font-size:13px">${e.title}</div>
                  <div style="font-size:11px;color:var(--text3)">${cat.lbl}${e.tags.length > 0 ? ` · ${e.tags.slice(0, 2).join(', ')}` : ''}</div></div>
              </div></td>
              <td style="font-size:13px">${g ? g.name : 'No Group'}</td>
              <td><div style="display:flex;align-items:center;gap:7px"><div class="av av-sm" style="background:${pu.col}">${pu.ini}</div><span style="font-size:13px">${pu.name.split(' ')[0]}</span></div></td>
              <td style="font-size:13px;color:var(--text3)">${e.date}</td>
              <td style="font-weight:800;font-size:13.5px">${fmt(e.amount)}</td>
              <td style="font-weight:800;color:${iOwe ? 'var(--danger)' : sh > 0 ? 'var(--success)' : 'var(--text3)'}">
                ${sh > 0 ? (iOwe ? '−' : '+') + '' + fmt(sh) : '—'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`}
    </div>
  </div>`;
}

function rSettlements() {
  const txns = minCashFlow(EXPENSES, SETTLEMENTS);
  const orig = EXPENSES.reduce((s, e) => s + (e.split.length - 1), 0);
  return `${rTopbar('Settlements', 'Optimized debt resolution')}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="grid2">
      <div>
        <div class="card" style="margin-bottom:18px">
          <div class="ch"><div><div class="ct">Optimized Settlement Plan</div><div class="cs">Min Cash Flow algorithm · ${orig} raw debts → ${txns.length} optimal payments</div></div>
            <span class="badge bg-brand"><i class="ti ti-sparkles" style="font-size:11px"></i> AI</span></div>
          ${txns.length === 0 ? `<div class="empty"><i class="ti ti-check"></i><p>All settled up! 🎉</p></div>` :
          txns.map(t => {
            const fu = uf(t.from);
            const tu = uf(t.to);
            const isMe = t.from === ME.id || t.to === ME.id;
            return `<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border)">
              <div class="av av-md" style="background:${fu.col}">${fu.ini}</div>
              <div style="flex:1">
                <div style="font-size:13.5px;font-weight:700">${fu.name.split(' ')[0]} pays ${tu.name.split(' ')[0]}</div>
                <div style="font-size:12px;color:var(--text3)">via UPI · GPay · Bank Transfer</div>
              </div>
              <div class="av av-md" style="background:${tu.col}">${tu.ini}</div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:800;color:var(--brand)">${fmt(t.amount)}</div>
                ${isMe ? `<button class="btn btn-brand btn-xs" style="margin-top:4px" onclick="doSettle('${t.from}','${t.to}',${t.amount})">Mark Paid</button>` : ''}
              </div>
            </div>`
          }).join('')}
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Settlement History</div>
          ${SETTLEMENTS.length === 0 ? `<div class="empty"><i class="ti ti-transfer"></i><p>No settlements recorded yet</p></div>` : SETTLEMENTS.map(s => {
            const fu = uf(s.from);
            const tu = uf(s.to);
            return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
              <div class="av av-sm" style="background:${fu.col}">${fu.ini}</div>
              <div style="flex:1;font-size:13px"><strong>${fu.name.split(' ')[0]}</strong> paid <strong>${tu.name.split(' ')[0]}</strong>
                <div style="font-size:11px;color:var(--text3)">${s.date} · ${s.method}</div></div>
              <div style="font-weight:800;color:var(--success)">${fmt(s.amount)}</div>
              <span class="badge bg-success">✓ Paid</span>
            </div>`
          }).join('')}
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Payment Channels</div>
          ${[{ ico: '💙', name: 'GPay', clr: '#1A73E8' }, { ico: '💜', name: 'PhonePe', clr: '#5F259F' }, { ico: '💙', name: 'Paytm', clr: '#00BAF2' }, { ico: '🏦', name: 'Bank Transfer', clr: '#059669' }].map(p => `
          <div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
            <div style="width:38px;height:38px;border-radius:10px;background:${p.clr}18;display:flex;align-items:center;justify-content:center;font-size:18px">${p.ico}</div>
            <span style="flex:1;font-size:14px;font-weight:700">${p.name}</span>
            <button class="btn btn-outline btn-xs" onclick="toast('Opening external checkout...','info')">Pay →</button>
          </div>`).join('')}
        </div>
        <div class="card" style="background:var(--brand-light);border-color:rgba(91,91,214,.2)">
          <div style="font-size:13px;font-weight:700;color:var(--brand);margin-bottom:10px">💡 Optimization Summary</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.8">
            Original transactions: <strong>${orig}</strong><br>
            After simplification: <strong>${txns.length}</strong><br>
            Transactions saved: <strong style="color:var(--success)">${orig - txns.length} (${orig > 0 ? Math.round((orig - txns.length) / orig * 100) : 0}% reduction)</strong>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function rAnalytics() {
  return `${rTopbar('Analytics', 'Insights into your spending')}
  <div class="page" onclick="ss({showNotif:false})">
    ${EXPENSES.length === 0 ? rEmptyState('ti-chart-pie', 'No analytics available', 'Track expenses to view visual statistics and spending categories.', 'Add Expense', "ss({modal:'addExpense'})") : `
    <div class="grid2" style="margin-bottom:20px">
      <div class="card"><div class="ch"><div class="ct">Monthly Spending</div><span class="badge bg-info">Trend</span></div>
        <div style="position:relative;height:220px"><canvas id="ac1" role="img" aria-label="Monthly spending bar chart"></canvas></div></div>
      <div class="card"><div class="ch"><div class="ct">By Category</div></div>
        <div style="position:relative;height:180px"><canvas id="ac2" role="img" aria-label="Category donut chart"></canvas></div></div>
    </div>
    <div class="grid2" style="margin-bottom:20px">
      <div class="card">
        <div class="ct" style="margin-bottom:16px">Member Contributions</div>
        ${USERS.slice(0, 4).map(u => {
          const paid = EXPENSES.filter(e => e.paidBy === u.id).reduce((s, e) => s + e.amount, 0);
          const tot = EXPENSES.reduce((s, e) => s + e.amount, 0);
          const pct = tot > 0 ? Math.round(paid / tot * 100) : 0;
          return `<div style="margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
              <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
              <span style="flex:1;font-size:13px;font-weight:600">${u.name}</span>
              <span style="font-size:13px;font-weight:800">${fmt(paid)}</span>
              <span style="font-size:12px;color:var(--text3);min-width:32px;text-align:right">${pct}%</span>
            </div>
            <div class="prog"><div class="prog-b" style="width:${pct}%;background:${u.col}"></div></div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="ct" style="margin-bottom:14px">Spending Trend (6 months)</div>
        <div style="position:relative;height:180px"><canvas id="ac3" role="img" aria-label="6-month spending trend line chart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="ct" style="margin-bottom:16px">Expense Calendar Overview</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;max-width:300px">
        ${Array.from({ length: 28 }, (_, i) => {
          const v = Math.random();
          const h = Math.random() > 0.6;
          return `<div title="${h ? fmt(Math.round(v * 4000)) : 'No expenses'} on Day ${i + 1}" style="aspect-ratio:1;border-radius:3px;background:${h ? `rgba(91,91,214,${Math.max(0.15, v)})` : 'var(--surface2)'}"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px;font-size:11px;color:var(--text3)">
        <span>Less</span>
        ${[0.1, 0.25, 0.45, 0.65, 0.85].map(o => `<div style="width:12px;height:12px;border-radius:2px;background:rgba(91, 91, 214, ${o})"></div>`).join('')}
        <span>More</span>
      </div>
    </div>`}
  </div>`;
}

function rBudgets() {
  return `${rTopbar('Budget Planner', 'Track and manage spending limits')}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="grid2">
      <div>
        ${BUDGETS.length === 0 ? rEmptyState('ti-wallet', 'No budgets configured', 'Set budgets on groups to track their spending limits.', 'Configure Budget', "document.getElementById('budLimit')?.focus()") : BUDGETS.map(b => {
          const g = gf(b.gid);
          const ge = EXPENSES.filter(e => e.gid === b.gid);
          const spentVal = ge.reduce((s, e) => s + e.amount, 0);
          const pct = Math.round((spentVal / b.limit_amount) * 100);
          return `<div class="card" style="margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
              <span style="font-size:24px">${g ? g.emoji : '📦'}</span>
              <div style="flex:1"><div style="font-size:14px;font-weight:800">${g ? g.name : 'No Group'}</div><div style="font-size:11.5px;color:var(--text3)">${ge.length} expenses</div></div>
              <span class="badge ${pct > 100 ? 'bg-danger' : pct > 80 ? 'bg-warning' : 'bg-success'}">${pct > 100 ? '⚠️ Over budget' : pct > 80 ? '⚡ Nearing' : '✓ On track'}</span>
            </div>
            <div style="margin-bottom:8px"><div class="prog" style="height:8px"><div class="prog-b ${pct > 100 ? 'danger' : pct > 80 ? 'warn' : ''}" style="width:${Math.min(pct, 100)}%"></div></div></div>
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span style="color:var(--text2)">Spent: <strong>${fmt(spentVal)}</strong></span>
              <span style="color:var(--text2)">Limit: <strong>${fmt(b.limit_amount)}</strong></span>
              <span style="font-weight:800;color:var(--${pct > 100 ? 'danger' : pct > 80 ? 'warning' : 'success'})">${pct}%</span>
            </div>
            ${pct > 80 ? `<div style="margin-top:10px;padding:9px 12px;background:var(--${pct > 100 ? 'danger' : 'warning'}-light);border-radius:8px;font-size:12.5px;color:var(--${pct > 100 ? 'danger' : 'warning'})">
              ${pct > 100 ? `🚨 Over budget by ${fmt(spentVal - b.limit_amount)}!` : `⚡ ${100 - pct}% remaining — spending fast!`}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:16px">Set Group Budget</div>
          ${GROUPS.length === 0 ? `<p style="font-size:13px;color:var(--text3)">Create a group first to set budgets.</p>` : `
          <div class="fg"><label>Select Group</label>
            <select id="budGid">
              ${GROUPS.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Monthly Limit (₹)</label>
            <input type="number" id="budLimit" placeholder="Enter amount" value="${S.newBudget.limit}">
          </div>
          <div class="fg"><label>Alert threshold</label>
            <select id="budThreshold">
              <option value="80%">80%</option>
              <option value="90%">90%</option>
              <option value="100%">100%</option>
            </select>
          </div>
          <button class="btn btn-brand" style="width:100%;justify-content:center" onclick="submitBudget()">Save Budget</button>`}
        </div>
      </div>
    </div>
  </div>`;
}

function rAI() {
  const ins = AI_INSIGHTS;
  const txns = minCashFlow(EXPENSES, SETTLEMENTS);
  return `${rTopbar('AI Insights', 'Powered by SQLite & Claude AI')}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="ai-banner" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="font-size:28px">🤖</div>
        <div>
          <div style="font-size:14px;font-weight:800;color:var(--brand);margin-bottom:3px">AI Financial Assistant</div>
          <div style="font-size:13px;color:var(--text2)">Analyzing ${EXPENSES.length} expenses across ${GROUPS.length} groups. Updated in real-time as you add data.</div>
        </div>
        <button class="btn btn-brand btn-sm" style="margin-left:auto" onclick="refreshAI()"><i class="ti ti-refresh"></i> Refresh</button>
      </div>
    </div>
    <div class="grid2">
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:14px">💡 Spending Insights</div>
          ${ins.length === 0 ? `<div class="empty"><p>No insights yet. Add some expenses to get started!</p></div>` : ins.map(i => `<div style="display:flex;gap:12px;padding:13px 0;border-bottom:1px solid var(--border)">
            <div style="width:30px;height:30px;background:var(--brand-light);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">${i.ico}</div>
            <div style="font-size:13.5px;color:var(--text2);line-height:1.6">${i.txt}</div>
          </div>`).join('')}
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:14px">🎯 Smart Settlement Suggestions</div>
          ${txns.length === 0 ? `<div class="empty"><p>All settled up!</p></div>` : txns.slice(0, 3).map(t => {
            const fu = uf(t.from);
            const tu = uf(t.to);
            return `<div style="padding:12px;background:var(--surface2);border-radius:10px;margin-bottom:10px">
              <div style="font-size:13.5px;font-weight:700;margin-bottom:4px">${fu.name.split(' ')[0]} → ${tu.name.split(' ')[0]}: ${fmt(t.amount)}</div>
              <div style="font-size:12px;color:var(--text3)">Optimal payment to clear pending debts</div>
              ${t.from === ME.id ? `<button class="btn btn-brand btn-xs" style="margin-top:8px" onclick="doSettle('${t.from}','${t.to}',${t.amount})">Pay Now</button>` : ''}
            </div>`
          }).join('')}
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:14px">🏷️ Auto-Category Detector</div>
          <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px">Type any expense title to detect its category:</div>
          <input type="text" id="aiInp" placeholder='e.g. "Uber to Airport"' oninput="aiDetect(this.value)" style="margin-bottom:10px">
          <div id="aiRes" style="padding:12px;background:var(--surface2);border-radius:9px;font-size:13.5px;color:var(--text2)">Start typing above...</div>
          <div style="margin-top:14px">
            <div style="font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Examples</div>
            ${[['Ola cab from airport', 'travel'], ['Pizza Hut dinner', 'food'], ['Electricity bill Feb', 'utilities'], ['Netflix subscription', 'entertainment'], ['Pharmacy antibiotics', 'medical']].map(([ex, cat]) => {
              const c = cf(cat);
              return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px">
                <span style="color:var(--text2);flex:1">"${ex}"</span>
                <span class="badge bg-success">${c.ico} ${c.lbl}</span></div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

async function refreshAI() {
  await loadData();
  toast('AI analysis refreshed!', 'success');
  ss({});
}

function rExport() {
  return `${rTopbar('Export', 'Generate reports and downloads')}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="grid2">
      <div class="card">
        <div class="ct" style="margin-bottom:16px">Export Configuration</div>
        <div class="fg"><label>Date Range</label>
          <select><option>This Month</option><option>Last Month</option><option>Last 3 Months</option><option>Custom Range</option></select></div>
        <div class="fg"><label>Group</label>
          <select><option>All Groups</option>${GROUPS.map(g => `<option>${g.name}</option>`).join('')}</select></div>
        <div class="fg"><label>Category</label>
          <select><option>All Categories</option>${CATS.map(c => `<option>${c.lbl}</option>`).join('')}</select></div>
        <div class="fg"><label>Include</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:2px;font-size:13px">
            ${['Expenses', 'Settlements', 'Balances', 'Budget summary'].map(opt => `<label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0"><input type="checkbox" checked style="width:auto"> ${opt}</label>`).join('')}
          </div>
        </div>
        <div class="scol">
          <button class="btn btn-brand" style="justify-content:center" onclick="exportToPDF()"><i class="ti ti-file-type-pdf"></i> Export as PDF</button>
          <button class="btn btn-outline" style="justify-content:center" onclick="exportToCSV()"><i class="ti ti-file-spreadsheet"></i> Export as CSV</button>
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Report Summary</div>
          ${[
            ['Total Expenses', fmt(EXPENSES.reduce((s, e) => s + e.amount, 0))],
            ['Your Share', fmt(EXPENSES.reduce((s, e) => s + getMemberShare(e, ME.id), 0))],
            ['Groups', GROUPS.length], ['Transactions', EXPENSES.length],
            ['Settlements Made', SETTLEMENTS.length],
            ['Pending', minCashFlow(EXPENSES, SETTLEMENTS).length],
          ].map(([l, v]) => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13.5px">
            <span style="color:var(--text2)">${l}</span><strong>${v}</strong></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function rProfile() {
  const b = calcBal();
  const mb = b[ME.id] || 0;
  return `${rTopbar('My Profile', 'Account settings and preferences')}
  <div class="page" onclick="ss({showNotif:false})">
    <div class="grid2">
      <div class="scol">
        <div class="card">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
            <div class="av av-xl" style="background:${ME.col}">${ME.ini}</div>
            <div>
              <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px">${ME.name}</div>
              <div style="font-size:13px;color:var(--text3)">${ME.email}</div>
              <div style="margin-top:6px"><span class="badge bg-brand">Pro Member</span></div>
            </div>
            <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="toast('Profile changes will persist in database','info')"><i class="ti ti-edit"></i> Settings</button>
          </div>
          <div class="grid3" style="text-align:center">
            ${[[ME.stats?.expenses || 0, 'Expenses', 'info'], [ME.stats?.groups || 0, 'Groups', 'brand'], [ME.stats?.settlements || 0, 'Settlements', 'success']].map(([v, l, c]) => `
            <div style="padding:12px;background:var(--surface2);border-radius:10px">
              <div style="font-size:22px;font-weight:800;color:var(--${c})">${v}</div>
              <div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:700;letter-spacing:0.06em">${l}</div>
            </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Balances with Others</div>
          ${(() => {
            const pairB = calcBalPairwise(ME.id);
            const others = USERS.filter(u => u.id !== ME.id);
            return others.length === 0 ? `<p style="font-size:13px;color:var(--text3)">No other registered users found.</p>` : others.map(u => {
              const net = pairB[u.id] || 0;
              return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
                <div class="av av-md" style="background:${u.col}">${u.ini}</div>
                <div style="flex:1;font-size:13.5px;font-weight:600">${u.name}</div>
                <div style="font-weight:800;font-size:14px;color:${net > 0 ? 'var(--success)' : net < 0 ? 'var(--danger)' : 'var(--text3)'}">
                  ${net > 0 ? `owes you ${fmt(net)}` : net < 0 ? `you owe ${fmt(-net)}` : 'settled ✓'}</div>
              </div>`;
            }).join('');
          })()}
        </div>
      </div>
      <div class="scol">
        <div class="card">
          <div class="ct" style="margin-bottom:16px">Preferences</div>
          <div class="fg"><label>Currency</label><select><option>₹ INR</option><option>$ USD</option><option>€ EUR</option></select></div>
          <div class="fg"><label>Notifications</label><select><option>All</option><option>Disabled</option></select></div>
          <div class="fg"><label>Default Split</label><select><option>Equal</option><option>Percentage</option></select></div>
          <button class="btn btn-brand btn-sm" style="justify-content:center;width:100%" onclick="toast('Preferences saved!','success')">Save Preferences</button>
        </div>
        <div class="card">
          <div class="ct" style="margin-bottom:14px">Security</div>
          <button class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:8px" onclick="toast('Password settings loaded...','info')"><i class="ti ti-lock"></i> Change Password</button>
          <hr class="divider">
          <button class="btn btn-danger" style="width:100%;justify-content:center" onclick="handleLogout()"><i class="ti ti-logout"></i> Sign Out</button>
        </div>
      </div>
    </div>
  </div>`;
}

// Modals
function rAddExpense() {
  const ne = S.newExpense;
  const g = gf(ne.gid || GROUPS[0]?.id);
  const members = g ? USERS.filter(u => g.members.includes(u.id)) : USERS;
  
  return `<div class="mo" id="expenseModal" onclick="if(event.target===this)ss({modal:null})">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="mh"><div class="mt">Add Expense</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:16px" onclick="ss({modal:null})">✕</button></div>
      <div class="mb2">
        ${GROUPS.length === 0 ? `<p style="font-size:13.5px;color:var(--text3);text-align:center">Please create a group first to add expenses.</p>` : `
        <div class="fg">
          <label>Title</label>
          <input type="text" id="expTitle" placeholder='e.g. "Dinner at Taj"' value="${ne.title || ''}" oninput="updateExpenseModalPreview()">
          <div id="expAiBadge" style="font-size:11.5px;color:var(--brand);margin-top:4px;font-weight:600;display:none"></div>
        </div>
        <div class="grid2">
          <div class="fg"><label>Amount (₹)</label><input type="number" id="expAmount" placeholder="0.00" value="${ne.amount || ''}" oninput="updateExpenseModalPreview()"></div>
          <div class="fg"><label>Category</label><select id="expCat">
            ${CATS.map(c => `<option value="${c.id}" ${ne.cat === c.id ? 'selected' : ''}>${c.ico} ${c.lbl}</option>`).join('')}
          </select></div>
        </div>
        <div class="grid2">
          <div class="fg"><label>Group</label><select id="expGid" onchange="refreshModalMembers(this.value)">
            ${GROUPS.map(gOption => `<option value="${gOption.id}" ${gOption.id === (ne.gid || g?.id) ? 'selected' : ''}>${gOption.name}</option>`).join('')}
          </select></div>
          <div class="fg"><label>Paid By</label><select id="expPaidBy">
            ${members.map(u => `<option value="${u.id}" ${ne.paidBy === u.id ? 'selected' : ''}>${u.name.split(' ')[0]}</option>`).join('')}
          </select></div>
        </div>
        <div class="grid2">
          <div class="fg"><label>Date</label><input type="date" id="expDate" value="${ne.date || new Date().toISOString().split('T')[0]}" oninput="updateExpenseModalPreview()"></div>
          <div class="fg"><label>Tags (comma separated)</label><input type="text" id="expTags" placeholder="trip, food" value="${ne.tags || ''}"></div>
        </div>
        <div class="fg">
          <label>Split Type</label>
          <div class="split-tabs">
            ${['equal', 'percentage', 'exact', 'shares'].map(t => `<div class="split-tab ${ne.type === t ? 'active' : ''}" onclick="changeSplitType('${t}')">
              ${t === 'equal' ? '⚖️ Equal' : t === 'percentage' ? '% Percent' : t === 'exact' ? '✏️ Exact' : '📊 Shares'}</div>`).join('')}
          </div>
          
          <div id="splitUISection">
            ${ne.type === 'equal' ? `<div id="equalSplitPreview" style="padding:10px 12px;background:var(--brand-light);border-radius:8px;font-size:13px;color:var(--brand);font-weight:600">
              Each person: ₹0 (${members.length} people)</div>` : ''}
              
            ${ne.type === 'percentage' ? `<div>
              ${members.map(u => `<div class="inline-row">
                <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
                <span style="flex:1">${u.name.split(' ')[0]}</span>
                <input type="number" id="pct_${u.id}" value="${ne.pcts?.[u.id] !== undefined ? ne.pcts[u.id] : Math.round(100 / members.length)}" min="0" max="100" oninput="updateExpenseModalPreview()">
                <span style="font-size:12px;color:var(--text3);min-width:70px;text-align:right" id="pctVal_${u.id}">% = ₹0</span>
              </div>`).join('')}
              <div id="pctTotalSum" style="font-size:12px;font-weight:700;margin-top:6px;text-align:right">Total Percentage: 0% / 100%</div>
            </div>` : ''}
            
            ${ne.type === 'exact' ? `<div>
              ${members.map(u => `<div class="inline-row">
                <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
                <span style="flex:1">${u.name.split(' ')[0]}</span>
                <input type="number" id="exact_${u.id}" placeholder="0" value="${ne.exacts?.[u.id] || ''}" oninput="updateExpenseModalPreview()">
              </div>`).join('')}
              <div id="exactTotalSum" style="font-size:12px;font-weight:700;margin-top:6px;text-align:right">Assigned: ₹0 / ₹0</div>
            </div>` : ''}
            
            ${ne.type === 'shares' ? `<div>
              ${members.map(u => `<div class="inline-row">
                <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
                <span style="flex:1">${u.name.split(' ')[0]}</span>
                <input type="number" id="shares_${u.id}" placeholder="1" value="${ne.shares?.[u.id] || 1}" min="1" oninput="updateExpenseModalPreview()">
                <span style="font-size:12px;color:var(--text3);min-width:60px;text-align:right">shares</span>
              </div>`).join('')}
              <div id="sharesTotalSum" style="font-size:12px;font-weight:700;margin-top:6px;text-align:right">Total Shares: ${members.length}</div>
            </div>` : ''}
          </div>
        </div>
        <div class="fg"><label>Note</label><textarea id="expNote" placeholder="Add a note...">${ne.note || ''}</textarea></div>
        `}
      </div>
      <div class="mf">
        <button class="btn btn-outline" onclick="ss({modal:null})">Cancel</button>
        ${GROUPS.length > 0 ? `<button class="btn btn-brand" onclick="submitExp()"><i class="ti ti-check"></i> Add Expense</button>` : ''}
      </div>
    </div>
  </div>`;
}

function refreshModalMembers(gid) {
  ss({ newExpense: { ...S.newExpense, gid } });
  setTimeout(updateExpenseModalPreview, 50);
}

function changeSplitType(type) {
  ss({ newExpense: { ...S.newExpense, type } });
  setTimeout(updateExpenseModalPreview, 50);
}

function rExpDetail() {
  const e = EXPENSES.find(x => x.id === S.modalData);
  if (!e) return '';
  const cat = cf(e.cat);
  const pu = uf(e.paidBy);
  const g = gf(e.gid);

  return `<div class="mo" onclick="if(event.target===this)ss({modal:null})">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="mh"><div class="mt">${e.title}</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:16px" onclick="ss({modal:null})">✕</button></div>
      <div class="mb2">
        <div style="display:flex;align-items:center;gap:16px;padding:16px;background:var(--surface2);border-radius:12px;margin-bottom:16px">
          <div class="exp-ico" style="width:52px;height:52px;font-size:24px;background:${cat.bg}">${cat.ico}</div>
          <div><div style="font-size:26px;font-weight:800;letter-spacing:-0.5px">${fmt(e.amount)}</div>
            <div style="font-size:13px;color:var(--text3)">${cat.lbl} · ${g ? g.name : 'No Group'}</div></div>
          <span class="badge bg-info" style="margin-left:auto">${e.date}</span>
        </div>
        ${e.tags.length > 0 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${e.tags.map(t => `<span class="badge bg-gray">#${t}</span>`).join('')}</div>` : ''}
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Paid by</div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="av av-md" style="background:${pu.col}">${pu.ini}</div>
            <div><div style="font-weight:700">${pu.name}</div><div style="font-size:12px;color:var(--text3)">paid full ${fmt(e.amount)}</div></div>
          </div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Split (${e.split.length} people)</div>
          ${e.split.map(uid => {
            const u = uf(uid);
            const owes = uid !== e.paidBy;
            const memberShare = getMemberShare(e, uid);
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
              <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
              <div style="flex:1;font-size:13.5px;font-weight:600">${u.name}${uid === ME.id ? ' (you)' : ''}</div>
              <div style="font-weight:800">${fmt(memberShare)}</div>
              <span class="badge ${!owes ? 'bg-success' : 'bg-gray'}">${!owes ? 'paid' : 'owes'}</span>
            </div>`
          }).join('')}
        </div>
        ${e.note ? `<div style="margin-top:16px;padding:12px;background:var(--surface2);border-radius:10px;font-size:13px;color:var(--text2)"><strong>Note:</strong> ${e.note}</div>` : ''}
      </div>
      <div class="mf">
        <button class="btn btn-outline btn-sm" onclick="delExp('${e.id}')"><i class="ti ti-trash"></i> Delete</button>
        <button class="btn btn-outline" onclick="ss({modal:null})">Close</button>
      </div>
    </div>
  </div>`;
}

function rAddGroup() {
  const ng = S.newGroup;
  return `<div class="mo" id="groupModal" onclick="if(event.target===this)ss({modal:null})">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="mh"><div class="mt">Create Group</div><button class="btn btn-ghost" style="padding:4px 8px;font-size:16px" onclick="ss({modal:null})">✕</button></div>
      <div class="mb2">
        <div class="fg"><label>Group Name</label><input type="text" id="groupName" placeholder='e.g. "Goa Trip 2024"' value="${ng.name || ''}"></div>
        <div class="fg"><label>Type</label><div style="display:flex;flex-wrap:wrap;gap:8px">
          ${[{ id: 'travel', l: '🏖️ Trip' }, { id: 'home', l: '🏠 Home' }, { id: 'food', l: '🍱 Food' }, { id: 'work', l: '💼 Work' }, { id: 'friends', l: '👥 Friends' }, { id: 'other', l: '📦 Other' }].map(c => `
          <div class="chip ${ng.cat === c.id ? 'active' : ''}" onclick="changeGroupCategory('${c.id}')"> ${c.l}</div>`).join('')}
        </div></div>
        <div class="fg" style="max-height: 250px; overflow-y: auto;"><label>Select Friends to Add</label>
          ${USERS.filter(u => u.id !== ME.id).length === 0 ? `<p style="font-size:12px;color:var(--text3);padding:8px 0">No friends registered on the platform yet. They can create an account to show up here!</p>` : USERS.filter(u => u.id !== ME.id).map(u => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div class="av av-sm" style="background:${u.col}">${u.ini}</div>
            <span style="flex:1;font-size:13px;font-weight:600">${u.name} <small style="color:var(--text3)">(${u.email})</small></span>
            <input type="checkbox" id="member_${u.id}" style="width:auto;cursor:pointer">
          </div>`).join('')}
        </div>
        <div class="fg"><label>Budget (₹, optional)</label><input type="number" id="groupBudget" placeholder="Set group budget" value="${ng.budget || ''}"></div>
      </div>
      <div class="mf">
        <button class="btn btn-outline" onclick="ss({modal:null})">Cancel</button>
        <button class="btn btn-brand" onclick="submitGroup()"><i class="ti ti-check"></i> Create Group</button>
      </div>
    </div>
  </div>`;
}

function changeGroupCategory(cat) {
  const name = document.getElementById('groupName')?.value || '';
  const budget = document.getElementById('groupBudget')?.value || '';
  ss({ newGroup: { ...S.newGroup, cat, name, budget } });
}

// Focus-free input modal update
function updateExpenseModalPreview() {
  const titleVal = document.getElementById('expTitle')?.value || '';
  const amountVal = parseFloat(document.getElementById('expAmount')?.value || 0);
  const type = S.newExpense.type;

  // AI Detect Category from Title
  const aiBadge = document.getElementById('expAiBadge');
  if (aiBadge) {
    if (titleVal) {
      const detectedCat = autocat(titleVal);
      const c = cf(detectedCat);
      aiBadge.innerHTML = `🤖 AI detected: ${c.ico} ${c.lbl}`;
      aiBadge.style.display = 'block';
      const catSelect = document.getElementById('expCat');
      if (catSelect && catSelect.value !== detectedCat) {
        catSelect.value = detectedCat;
      }
    } else {
      aiBadge.style.display = 'none';
    }
  }

  // Update Split Previews based on type
  const gSelect = document.getElementById('expGid');
  const g = gf(gSelect?.value || GROUPS[0]?.id);
  const members = g ? USERS.filter(u => g.members.includes(u.id)) : [ME];

  if (type === 'equal') {
    const previewEl = document.getElementById('equalSplitPreview');
    if (previewEl) {
      previewEl.textContent = `Each person: ${amountVal ? fmt(amountVal / members.length) : '₹0'} (${members.length} people)`;
    }
  } else if (type === 'percentage') {
    let totalPct = 0;
    members.forEach(u => {
      const pctInput = document.getElementById(`pct_${u.id}`);
      const pctVal = parseFloat(pctInput?.value || 0);
      totalPct += pctVal;
      const valEl = document.getElementById(`pctVal_${u.id}`);
      if (valEl) {
        valEl.textContent = `% = ${amountVal ? fmt(amountVal * pctVal / 100) : '₹0'}`;
      }
    });
    const pctSumEl = document.getElementById('pctTotalSum');
    if (pctSumEl) {
      pctSumEl.textContent = `Total Percentage: ${totalPct}% / 100%`;
      pctSumEl.style.color = Math.abs(totalPct - 100) < 0.01 ? 'var(--success)' : 'var(--danger)';
    }
  } else if (type === 'exact') {
    let totalExact = 0;
    members.forEach(u => {
      const exactInput = document.getElementById(`exact_${u.id}`);
      totalExact += parseFloat(exactInput?.value || 0);
    });
    const exactSumEl = document.getElementById('exactTotalSum');
    if (exactSumEl) {
      exactSumEl.textContent = `Assigned: ${fmt(totalExact)} / ${fmt(amountVal)}`;
      exactSumEl.style.color = Math.abs(totalExact - amountVal) < 0.01 ? 'var(--success)' : 'var(--danger)';
    }
  } else if (type === 'shares') {
    let totalShares = 0;
    members.forEach(u => {
      const sharesInput = document.getElementById(`shares_${u.id}`);
      totalShares += parseFloat(sharesInput?.value || 1);
    });
    const sharesSumEl = document.getElementById('sharesTotalSum');
    if (sharesSumEl) {
      sharesSumEl.textContent = `Total Shares: ${totalShares}`;
    }
  }
}

// ----------------------------------------------------
// ACTIONS & API POSTS
// ----------------------------------------------------
async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value;
  const password = document.getElementById('loginPassword')?.value;

  if (!email || !password) {
    toast('Email and password are required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await res.json();
    localStorage.setItem('token', data.token);
    ME = data.user;
    
    await loadData();
    ss({ page: 'dashboard' });
    toast('Welcome back! 👋', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleRegister() {
  const name = document.getElementById('registerName')?.value;
  const email = document.getElementById('registerEmail')?.value;
  const password = document.getElementById('registerPassword')?.value;
  const confirmPassword = document.getElementById('registerConfirmPassword')?.value;

  if (!name || !email || !password || !confirmPassword) {
    toast('All fields are required', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, confirmPassword })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await res.json();
    localStorage.setItem('token', data.token);
    ME = data.user;

    await loadData();
    ss({ page: 'dashboard' });
    toast('Account created successfully! 🚀', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleLogout() {
  localStorage.removeItem('token');
  ME = null;
  ss({ page: 'landing' });
  toast('Signed out successfully', 'info');
}

async function doSettle(from, to, amount) {
  try {
    await fetchAPI('/api/settlements', {
      method: 'POST',
      body: JSON.stringify({ from, to, amount, method: 'UPI' })
    });
    await loadData();
    toast(`Settlement of ${fmt(amount)} recorded! ✅`, 'success');
    ss({});
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitExp() {
  const title = document.getElementById('expTitle').value;
  const amountStr = document.getElementById('expAmount').value;
  const cat = document.getElementById('expCat').value;
  const gid = document.getElementById('expGid').value;
  const paidBy = document.getElementById('expPaidBy').value;
  const date = document.getElementById('expDate').value;
  const tags = document.getElementById('expTags').value;
  const note = document.getElementById('expNote').value;
  const type = S.newExpense.type;

  if (!title || !amountStr) {
    toast('Please fill in title and amount', 'error');
    return;
  }
  const amount = parseFloat(amountStr);
  const g = gf(gid);
  const members = g ? USERS.filter(u => g.members.includes(u.id)) : [ME];

  const split = members.map(m => m.id);
  const pcts = {};
  const exacts = {};
  const shares = {};

  if (type === 'percentage') {
    let totalPct = 0;
    split.forEach(uid => {
      const pctVal = parseFloat(document.getElementById(`pct_${uid}`)?.value || 0);
      pcts[uid] = pctVal;
      totalPct += pctVal;
    });
    if (Math.abs(totalPct - 100) > 0.01) {
      toast(`Total percentage must equal 100% (currently ${totalPct}%)`, 'error');
      return;
    }
  } else if (type === 'exact') {
    let totalExact = 0;
    split.forEach(uid => {
      const exactVal = parseFloat(document.getElementById(`exact_${uid}`)?.value || 0);
      exacts[uid] = exactVal;
      totalExact += exactVal;
    });
    if (Math.abs(totalExact - amount) > 0.01) {
      toast(`Total exact amounts must equal expense amount ₹${amount} (currently ₹${totalExact})`, 'error');
      return;
    }
  } else if (type === 'shares') {
    split.forEach(uid => {
      const sharesVal = parseFloat(document.getElementById(`shares_${uid}`)?.value || 1);
      shares[uid] = sharesVal;
    });
  }

  try {
    await fetchAPI('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        title, amount, cat, gid, paidBy, date, tags, note, type, split, pcts, exacts, shares
      })
    });

    await loadData();
    ss({ modal: null, newExpense: { type: 'equal' } });
    toast(`"${title}" added successfully!`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitGroup() {
  const name = document.getElementById('groupName').value;
  const budget = document.getElementById('groupBudget').value;
  const cat = S.newGroup.cat;

  const members = [ME.id];
  USERS.forEach(u => {
    if (u.id !== ME.id) {
      const chk = document.getElementById(`member_${u.id}`);
      if (chk && chk.checked) {
        members.push(u.id);
      }
    }
  });

  if (!name) {
    toast('Please enter a group name', 'error');
    return;
  }
  const emojis = { travel: '🏖️', home: '🏠', food: '🍱', work: '💼', friends: '👥', other: '📦' };

  try {
    await fetchAPI('/api/groups', {
      method: 'POST',
      body: JSON.stringify({
        name, emoji: emojis[cat] || '📦', cat, budget: budget ? parseInt(budget) : null, members
      })
    });

    await loadData();
    ss({ modal: null, newGroup: { cat: 'travel' } });
    toast(`Group "${name}" created!`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function delExp(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await fetchAPI(`/api/expenses/${id}`, { method: 'DELETE' });
    await loadData();
    ss({ modal: null });
    toast('Expense deleted', 'info');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitBudget() {
  const gid = document.getElementById('budGid').value;
  const limit = document.getElementById('budLimit').value;
  const threshold = document.getElementById('budThreshold').value;

  if (!limit) {
    toast('Please enter a budget limit', 'error');
    return;
  }

  try {
    await fetchAPI('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({ gid, limit, threshold })
    });

    await loadData();
    toast('Budget saved successfully!', 'success');
    ss({ newBudget: { gid: GROUPS[0]?.id || '', limit: '', threshold: '80%' } });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function aiDetect(v) {
  const el = document.getElementById('aiRes');
  if (!el) return;
  if (!v) {
    el.textContent = 'Start typing above...';
    return;
  }
  const cat = autocat(v);
  const c = cf(cat);
  el.innerHTML = `🤖 Detected: <strong style="color:var(--brand)">${c.ico} ${c.lbl}</strong> &nbsp;·&nbsp; <span style="color:var(--text3)">Confidence: High</span>`;
}

// Chart.js controllers
let chartInstances = {};
function initCharts() {
  const mStats = getMonthlyStats();
  const cStats = getCategoryStats();

  const activeCats = cStats.filter(c => c.val > 0);
  const catLabels = activeCats.map(c => c.label);
  const catVals = activeCats.map(c => c.val);
  const catCols = activeCats.map(c => c.color);

  const finalCatLabels = catLabels.length ? catLabels : ['Food', 'Travel', 'Rent'];
  const finalCatVals = catVals.length ? catVals : [0, 0, 0];
  const finalCatCols = catCols.length ? catCols : ['#DC2626', '#0EA5E9', '#8B5CF6'];

  const defs = [
    {
      id: 'dash-chart',
      type: 'line',
      data: {
        labels: mStats.labels,
        datasets: [{
          label: '₹',
          data: mStats.meData,
          borderColor: '#5B5BD6',
          backgroundColor: 'rgba(91, 91, 214, 0.08)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#5B5BD6',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#9CA3AF' }, grid: { display: false } },
          y: { ticks: { color: '#9CA3AF', callback: v => '₹' + v }, grid: { color: 'rgba(156,163,175,.1)' } }
        }
      }
    },
    {
      id: 'ac1',
      type: 'bar',
      data: {
        labels: finalCatLabels,
        datasets: [{
          label: '₹',
          data: finalCatVals,
          backgroundColor: finalCatCols,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#9CA3AF' }, grid: { display: false } },
          y: { ticks: { color: '#9CA3AF', callback: v => '₹' + v }, grid: { color: 'rgba(156,163,175,.1)' } }
        }
      }
    },
    {
      id: 'ac2',
      type: 'doughnut',
      data: {
        labels: finalCatLabels,
        datasets: [{
          data: finalCatVals,
          backgroundColor: finalCatCols,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 10, font: { size: 11 }, color: '#9CA3AF' } } },
        cutout: '65%'
      }
    },
    {
      id: 'ac3',
      type: 'line',
      data: {
        labels: mStats.labels,
        datasets: [
          {
            label: 'Spending',
            data: mStats.meData,
            borderColor: '#5B5BD6',
            tension: 0.4,
            fill: false,
            pointBackgroundColor: '#5B5BD6'
          },
          {
            label: 'Budget Limit',
            data: mStats.labels.map(() => 25000),
            borderColor: '#16A34A',
            tension: 0.4,
            fill: false,
            borderDash: [5, 3],
            pointBackgroundColor: '#16A34A'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#9CA3AF' }, grid: { display: false } },
          y: { ticks: { color: '#9CA3AF', callback: v => '₹' + v }, grid: { color: 'rgba(156,163,175,.1)' } }
        }
      }
    },
  ];

  defs.forEach(d => {
    const el = document.getElementById(d.id);
    if (!el) return;
    if (chartInstances[d.id]) {
      chartInstances[d.id].destroy();
    }
    chartInstances[d.id] = new Chart(el, { type: d.type, data: d.data, options: d.options });
  });
}

// Main View Router & DOM Builder
function render() {
  const root = document.getElementById('root');
  if (!root) return;

  // Protect client side routes from unauthenticated access
  const isAuth = !!localStorage.getItem('token');
  if (!isAuth && !['landing', 'login'].includes(S.page)) {
    S.page = 'landing';
  }

  // Focus and Selection Restoration Setup
  const activeId = document.activeElement ? document.activeElement.id : null;
  let caretStart = 0;
  let caretEnd = 0;
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try {
        caretStart = el.selectionStart;
        caretEnd = el.selectionEnd;
      } catch (e) {}
    }
  }

  if (S.page === 'landing') {
    root.innerHTML = rLanding();
    // Restore focus if needed
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          try { el.setSelectionRange(caretStart, caretEnd); } catch (e) {}
        }
      }
    }
    return;
  }
  if (S.page === 'login') {
    root.innerHTML = rLogin();
    // Restore focus if needed
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          try { el.setSelectionRange(caretStart, caretEnd); } catch (e) {}
        }
      }
    }
    return;
  }

  const pages = {
    dashboard: rDashboard,
    groups: rGroups,
    expenses: rExpenses,
    settlements: rSettlements,
    analytics: rAnalytics,
    budgets: rBudgets,
    ai: rAI,
    export: rExport,
    profile: rProfile
  };

  const pg = (pages[S.page] || rDashboard)();
  let modal = '';
  if (S.modal === 'addExpense') modal = rAddExpense();
  else if (S.modal === 'expenseDetail') modal = rExpDetail();
  else if (S.modal === 'addGroup') modal = rAddGroup();

  root.innerHTML = `<div class="app">${rSidebar()}<div class="main">${pg}</div></div>${modal}${rCmdPalette()}`;

  // Restore focus after main page injection
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        try { el.setSelectionRange(caretStart, caretEnd); } catch (e) {}
      }
    }
  }

  if (['dashboard', 'analytics'].includes(S.page) && EXPENSES.length > 0) {
    setTimeout(initCharts, 60);
  }

  // Pre-load default values in modal on render (once)
  if (S.modal === 'addExpense') {
    setTimeout(updateExpenseModalPreview, 50);
  }
}

// Initialize Application
async function initApp() {
  initTheme();
  
  // Auto-login check
  const token = localStorage.getItem('token');
  if (token) {
    try {
      await loadData();
      S.page = 'dashboard';
    } catch (err) {
      localStorage.removeItem('token');
      ME = null;
      S.page = 'landing';
    }
  } else {
    S.page = 'landing';
  }

  render();

  // Keyboard hooks
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      ss({ cmdOpen: true });
    }
    if (e.key === 'Escape') {
      ss({ cmdOpen: false, showNotif: false, modal: null });
    }
  });
}

initApp();
