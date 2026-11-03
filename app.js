// =====================================================================
// SINO ทำเบิกออนไลน์ — ส่วนที่ 2–5: ล็อกอิน, ใบเบิก, ยื่นเบิก, อนุมัติ, Memo, เอกสารดาวน์โหลด
// ไฟล์นี้ไม่มีรหัสผ่านหรือ key (key อยู่ใน config.js)
// =====================================================================
'use strict';

const cfg = window.APP_CONFIG || {};
const $app = document.getElementById('app');
const sb = (cfg.SUPABASE_URL && cfg.SUPABASE_KEY && !cfg.SUPABASE_KEY.startsWith('วาง'))
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)
  : null;

const S = { session: null, profile: null, settings: {}, refs: { cats: [], gls: [], levels: {} } };
const svpEnd = () => (S.settings.workflow_end || 'full') === 'svp';
const BUCKET = 'receipts';

// ---------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthLabel = (iso) => { const [y, m] = iso.split('-').map(Number); return `${TH_MONTHS[m - 1]} ${y + 543}`; };
const bkkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const monthStart = (iso) => iso.slice(0, 7) + '-01';
function addMonths(iso, n) {
  let [y, m] = iso.split('-').map(Number);
  m += n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
const fmtDate = (iso) => { if (!iso) return '-'; const d = iso.slice(0, 10).split('-'); return `${d[2]}/${d[1]}/${+d[0] + 543}`; };
const fmtDateTime = (ts) => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });

const STATUS = {
  draft: ['ร่าง', 'draft'],
  pending_approval: ['รอ SVP อนุมัติ', 'wait'],
  svp_approved: ['SVP อนุมัติแล้ว', 'ok'],
  pending_ceo: ['รอ CEO อนุมัติ', 'wait'],
  pending_fhr: ['รอ SVP F&HR อนุมัติ Memo', 'wait'],
  pending_hr: ['รอ HR', 'wait'],
  pending_accounting: ['รอบัญชีตรวจ', 'wait'],
  pending_payment: ['รอโอนเงิน', 'wait'],
  paid: ['จ่ายแล้ว', 'ok'],
  returned: ['ส่งกลับแก้ไข', 'bad'],
  rejected: ['ไม่อนุมัติ', 'bad'],
  cancelled: ['ยกเลิก', 'draft'],
};
const chip = (st) => { const s = STATUS[st] || [st, '']; return `<span class="chip ${s[1]}">${esc(s[0])}</span>`; };
const ROUTE_LABEL = { general: 'ค่าใช้จ่ายทั่วไป', welfare: 'สวัสดิการ' };
const RECEIPT_TYPES = [
  ['tax_invoice', 'ใบกำกับภาษี'], ['receipt', 'ใบเสร็จรับเงิน'],
  ['cash_bill', 'บิลเงินสด'], ['substitute', 'ใบรับรองแทนใบเสร็จ'],
];
const FILE_KINDS = [
  ['receipt', 'ใบเสร็จ / ใบกำกับภาษี'], ['substitute_form', 'ใบรับรองแทนใบเสร็จ'],
  ['entertain_form', 'บันทึกขออนุมัติเลี้ยงรับรอง'], ['memo', 'Memo ที่อนุมัติแล้ว'],
  ['map', 'แผนที่ระยะทาง'], ['statement', 'Statement บัตรเครดิต'], ['other', 'อื่นๆ'],
];
const kindLabel = (k) => (FILE_KINDS.find((x) => x[0] === k) || [k, k])[1];
const catOf = (code) => S.refs.cats.find((c) => c.code === code);

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
const errMsg = (e) => (e && (e.message || e.error_description)) || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';

// ขั้นที่แต่ละ role ต้องดำเนินการ
const QUEUE = {
  svp: ['pending_approval'],
  ceo: ['pending_ceo'],
  hr: ['pending_hr'],
  accounting: ['pending_accounting', 'pending_payment'],
  admin: ['pending_approval', 'pending_ceo', 'pending_fhr', 'pending_hr', 'pending_accounting', 'pending_payment'],
};
function queueStatuses() {
  if (!S.profile) return [];
  if (svpEnd()) {   // เฟสแรก: ในระบบมีแค่ขั้น SVP
    if (S.profile.role === 'admin') return ['pending_approval', 'svp_approved'];
    return ['svp', 'ceo'].includes(S.profile.role) ? ['pending_approval'] : [];
  }
  const sts = [...(QUEUE[S.profile.role] || [])];
  if (S.profile.is_fhr && !sts.includes('pending_fhr')) sts.push('pending_fhr');
  return sts;
}
const isApprover = () => queueStatuses().length > 0;

function showTop(on) {
  document.getElementById('topbar').hidden = !on;
  if (!on || !S.profile) return;
  document.getElementById('who').textContent = S.profile.full_name || S.profile.email || '';
  const nav = document.getElementById('nav');
  if (!isApprover()) { nav.innerHTML = ''; return; }
  const h = location.hash || '#/';
  const onApprove = h === '#/approve';
  nav.innerHTML = `<a href="#/" class="${onApprove ? '' : 'on'}">ใบเบิกของฉัน</a>
    <a href="#/approve" class="${onApprove ? 'on' : ''}">${S.profile.role === 'admin' ? 'ใบเบิกที่ค้างอยู่' : 'รอดำเนินการ'}<span class="count" id="qcount"></span></a>`;
  queueQuery(false).then(({ count }) => {
    const el = document.getElementById('qcount');
    if (el) el.textContent = count ? String(count) : '';
  });
}

function queueQuery(withRows) {
  const sts = queueStatuses();
  const cols = withRows
    ? 'id, ref_no, claim_month, route, project, status, total_amount, max_item_amount, memo_required, submitted_at, employee:profiles!claims_employee_id_fkey(full_name, emp_code)'
    : 'id';
  let q = sb.from('claims')
    .select(cols, withRows ? undefined : { count: 'exact', head: true })
    .in('status', sts)
    .neq('employee_id', S.profile.id);
  if (withRows) q = q.order('submitted_at', { ascending: true });
  return q;
}

// ---------------------------------------------------------------------
// เริ่มต้น + เส้นทางหน้า
// ---------------------------------------------------------------------
async function init() {
  if (!sb) {
    $app.innerHTML = `<div class="note err">ยังไม่ได้ใส่ค่าใน <b>config.js</b> — ใส่ SUPABASE_URL และ Publishable key ก่อนใช้งาน</div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    S.session = session;
    if (event === 'SIGNED_OUT') { S.profile = null; location.hash = '#/login'; route(); }
  });
  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  const h = location.hash || '#/';
  if (!S.session) { showTop(false); return viewLogin(); }
  if (!S.profile) { const ok = await loadMe(); if (!ok) return; }
  showTop(true);
  window.scrollTo(0, 0);
  const m = h.match(/^#\/claim\/([0-9a-f-]{36})$/);
  if (h === '#/new') return viewNew();
  if (h === '#/approve') return isApprover() ? viewApprove() : viewHome();
  if (m) return viewClaim(m[1]);
  return viewHome();
}

async function loadMe() {
  $app.innerHTML = `<p class="muted center pad">กำลังโหลด…</p>`;
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', S.session.user.id).single();
  if (error || !p) {
    $app.innerHTML = `<div class="note err">ไม่พบข้อมูลพนักงานของบัญชีนี้ กรุณาแจ้ง admin</div>`;
    return false;
  }
  if (!p.active) {
    await sb.auth.signOut();
    toast('บัญชีนี้ถูกปิดใช้งาน');
    return false;
  }
  S.profile = p;
  const [cats, gls, levels, settings] = await Promise.all([
    sb.from('expense_categories').select('*').eq('active', true).order('sort_order'),
    sb.from('gl_codes').select('*').eq('active', true).order('code'),
    sb.from('position_levels').select('*'),
    sb.from('app_settings').select('key, value'),
  ]);
  S.settings = Object.fromEntries((settings.data || []).map((x) => [x.key, x.value]));
  S.refs.cats = cats.data || [];
  S.refs.gls = gls.data || [];
  S.refs.levels = Object.fromEntries((levels.data || []).map((l) => [l.code, l]));
  return true;
}

// ---------------------------------------------------------------------
// หน้าเข้าสู่ระบบ
// ---------------------------------------------------------------------
function viewLogin() {
  $app.innerHTML = `
    <div class="login">
      <p class="brand-big">SINO <span>ทำเบิกออนไลน์</span></p>
      <p class="muted">เข้าสู่ระบบด้วยอีเมลบริษัท</p>
      <form id="loginForm" class="panel" novalidate>
        <label for="email">อีเมล</label>
        <input id="email" type="email" autocomplete="username" inputmode="email" required>
        <label for="pw">รหัสผ่าน</label>
        <input id="pw" type="password" autocomplete="current-password" required>
        <div id="loginErr"></div>
        <div class="actions"><button class="btn block" type="submit">เข้าสู่ระบบ</button></div>
      </form>
      <p class="small muted center">ลืมรหัสผ่าน ติดต่อ admin ของระบบ</p>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('pw').value,
    });
    btn.disabled = false;
    if (error) {
      document.getElementById('loginErr').innerHTML = `<div class="note err">อีเมลหรือรหัสผ่านไม่ถูกต้อง</div>`;
      return;
    }
    S.session = data.session;
    location.hash = '#/';
    route();
  });
}

// ---------------------------------------------------------------------
// หน้าแรก: วงเงินเดือนนี้ + ใบเบิกของฉัน
// ---------------------------------------------------------------------
async function viewHome() {
  const uid = S.profile.id;
  const thisMonth = monthStart(bkkToday());
  $app.innerHTML = `<p class="muted center pad">กำลังโหลด…</p>`;

  const [bud, claims] = await Promise.all([
    sb.rpc('budget_summary', { p_employee: uid, p_month: thisMonth }),
    sb.from('claims').select('id, ref_no, claim_month, route, project, status, total_amount, created_at')
      .eq('employee_id', uid).order('created_at', { ascending: false }).limit(50),
  ]);

  const names = { ENTERTAIN: 'Entertain', GAS: 'Gas', PHONE: 'Phone', PARKING: 'Parking' };
  let budHtml;
  if (!S.profile.level_code) {
    budHtml = `<p class="muted small">ยังไม่ได้กำหนดระดับตำแหน่ง จึงยังไม่แสดงวงเงิน (แจ้ง admin)</p>`;
  } else if (bud.error) {
    budHtml = `<div class="note err">${esc(errMsg(bud.error))}</div>`;
  } else {
    budHtml = `<div class="budget">` + (bud.data || []).map((b) => {
      const limit = Number(b.base_budget) + Number(b.memo_extra);
      const used = Number(b.used);
      const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : (used > 0 ? 100 : 0);
      return `<div class="budget-row">
        <div class="top"><span>${esc(names[b.budget_type] || b.budget_type)}</span>
        <span>${money(used)} / ${money(limit)}</span></div>
        <div class="meter"><i class="${used > limit ? 'over' : ''}" style="width:${pct}%"></i></div>
      </div>`;
    }).join('') + `</div>
      <p class="hint">นับเฉพาะใบเบิกที่ยื่นแล้ว · Memo ที่อนุมัติจะเพิ่มวงเงินของเดือนนั้น</p>`;
  }

  const rows = (claims.data || []).map((c) => `
    <li><a href="#/claim/${c.id}">
      <span><span class="ref">${esc(c.ref_no)}</span></span>
      <span class="amt">${money(c.total_amount)}</span>
      <span class="small muted">${esc(monthLabel(c.claim_month))} · ${esc(c.project || ROUTE_LABEL[c.route])}</span>
      <span>${chip(c.status)}</span>
    </a></li>`).join('');

  $app.innerHTML = `
    <h1>สวัสดี ${esc(S.profile.full_name || '')}</h1>
    <section class="panel">
      <h3 style="margin-top:0">วงเงินเดือน${esc(monthLabel(thisMonth))}</h3>
      ${budHtml}
    </section>
    <a class="btn block" href="#/new">สร้างใบเบิกใหม่</a>
    <h2>ใบเบิกของฉัน</h2>
    <section class="panel">
      ${rows ? `<ul class="list">${rows}</ul>` : `<div class="empty">ยังไม่มีใบเบิก กด "สร้างใบเบิกใหม่" เพื่อเริ่ม</div>`}
    </section>`;
}

// ---------------------------------------------------------------------
// สร้างใบเบิกใหม่
// ---------------------------------------------------------------------
function viewNew() {
  const thisMonth = monthStart(bkkToday());
  const prevMonth = addMonths(thisMonth, -1);
  $app.innerHTML = `
    <p><a href="#/" class="text-btn">‹ ใบเบิกของฉัน</a></p>
    <h1>สร้างใบเบิกใหม่</h1>
    <form id="newForm" class="panel" novalidate>
      <label>ประเภทใบเบิก <span class="req">*</span></label>
      <label class="check"><input type="radio" name="route" value="general" checked> ค่าใช้จ่ายทั่วไป (Entertain, น้ำมัน, โทรศัพท์, เดินทาง ฯลฯ)</label>
      <label class="check"><input type="radio" name="route" value="welfare"> สวัสดิการ (ฟิตเนส, ตัดแว่น)</label>
      <p class="hint">สวัสดิการต้องเบิกแยกใบ เพราะต้องผ่าน HR ก่อนถึงบัญชี</p>

      <label for="month">เดือนที่เบิก (เดือนของใบเสร็จ) <span class="req">*</span></label>
      <select id="month">
        <option value="${thisMonth}">${esc(monthLabel(thisMonth))}</option>
        <option value="${prevMonth}">${esc(monthLabel(prevMonth))}</option>
      </select>
      <p class="hint">ยื่นเบิกของแต่ละเดือนได้ถึงวันที่ 2 ของเดือนถัดไป</p>

      <label for="project">เรื่อง (PROJECT)</label>
      <input id="project" placeholder="เช่น Phone และค่าน้ำมันส่วนเกิน">

      <label for="payto">จ่ายให้ (PAY TO)</label>
      <input id="payto" value="${esc(S.profile.full_name || '')}">

      <div class="actions"><button class="btn" type="submit">สร้างใบเบิก</button></div>
    </form>`;

  document.getElementById('newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { data, error } = await sb.from('claims').insert({
      route: e.target.querySelector('input[name=route]:checked').value,
      claim_month: document.getElementById('month').value,
      project: document.getElementById('project').value.trim() || null,
      pay_to: document.getElementById('payto').value.trim() || null,
    }).select('id').single();
    btn.disabled = false;
    if (error) { toast(errMsg(error)); return; }
    location.hash = `#/claim/${data.id}`;
  });
}

// ---------------------------------------------------------------------
// หน้าใบเบิก (ดู / แก้ / ยื่น)
// ---------------------------------------------------------------------
async function loadClaim(id) {
  await sb.rpc('prepare_memos', { p_claim: id });   // สร้าง/อัปเดตร่าง Memo ถ้าเกินวงเงิน (เฉพาะใบที่ยังแก้ได้)
  const [c, items, atts, logs, memos] = await Promise.all([
    sb.from('claims').select('*').eq('id', id).single(),
    sb.from('claim_items').select('*').eq('claim_id', id).order('line_no'),
    sb.from('attachments').select('*').eq('claim_id', id).order('created_at'),
    sb.from('claim_logs').select('*').eq('claim_id', id).order('created_at'),
    sb.from('memos').select('*').eq('claim_id', id).order('memo_kind'),
  ]);
  if (c.error) throw c.error;
  const { data: emp } = await sb.from('profiles')
    .select('id, full_name, emp_code, position_title, supervisor_id, level_code, name_en, title_en, department, company, car_plate')
    .eq('id', c.data.employee_id).single();
  const attList = atts.data || [];
  const urls = {};
  if (attList.length) {
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(attList.map((a) => a.file_path), 3600);
    (signed || []).forEach((s) => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }
  return { claim: c.data, emp: emp || {}, memos: memos.data || [], items: items.data || [], atts: attList, urls, logs: logs.data || [] };
}

async function viewClaim(id) {
  $app.innerHTML = `<p class="muted center pad">กำลังโหลด…</p>`;
  let D;
  try { D = await loadClaim(id); } catch (e) {
    $app.innerHTML = `<div class="note err">เปิดใบเบิกไม่ได้: ${esc(errMsg(e))}</div><p><a href="#/">กลับหน้าแรก</a></p>`;
    return;
  }
  const { claim, emp, memos, items, atts, urls, logs } = D;
  const mine = claim.employee_id === S.profile.id;
  const editable = mine && ['draft', 'returned'].includes(claim.status);
  const role = S.profile.role;
  const canAct = !mine && (
    (claim.status === 'pending_approval' && emp.supervisor_id === S.profile.id) ||
    (claim.status === 'pending_ceo' && role === 'ceo') ||
    (claim.status === 'pending_fhr' && S.profile.is_fhr) ||
    (claim.status === 'pending_hr' && role === 'hr') ||
    (['pending_accounting', 'pending_payment'].includes(claim.status) && role === 'accounting'));
  const canAddMemo = mine && ['pending_approval', 'pending_ceo', 'pending_hr', 'pending_accounting'].includes(claim.status);
  const claimFiles = atts.filter((a) => !a.item_id);

  const fileLinks = (itemId) => atts.filter((a) => a.item_id === itemId).map((a) =>
    `<span><a href="${esc(urls[a.file_path] || '#')}" target="_blank" rel="noopener">${esc(kindLabel(a.kind))}</a>${
      editable ? `<button class="text-btn red" type="button" data-delatt="${a.id}" aria-label="ลบไฟล์">×</button>` : ''}</span>`).join(' ');

  const itemHtml = items.map((it) => {
    const cat = catOf(it.category_code);
    const fx = it.currency !== 'THB' ? ` · ${esc(it.currency)} ${money(it.amount_foreign)} × ${it.fx_rate} (${esc(it.fx_source)})` : '';
    return `<div class="item">
      <div class="head"><span>${it.line_no}. ${esc(cat ? cat.name : it.category_code)}</span><span>${money(it.amount_thb)}</span></div>
      <div>${esc(it.description)}</div>
      <div class="meta">ใบเสร็จ ${fmtDate(it.receipt_date)}${it.receipt_no ? ' เลขที่ ' + esc(it.receipt_no) : ''} · GL ${esc(it.gl_code || 'ยังไม่เลือก')}${fx}</div>
      <div class="files">${fileLinks(it.id) || '<span class="small muted">ยังไม่มีไฟล์แนบ</span>'}</div>
      ${editable ? `<div class="tools">
        <button type="button" data-edit="${it.id}">แก้ไข</button>
        <button type="button" data-del="${it.id}" class="text-btn red">ลบรายการ</button></div>` : ''}
    </div>`;
  }).join('');

  const logHtml = logs.map((l) => `<li>${fmtDateTime(l.created_at)} — ${
    l.action === 'create' ? 'สร้างใบเบิก' : esc((STATUS[l.to_status] || [l.to_status])[0])}${
    l.note ? `<div class="small muted">${esc(l.note)}</div>` : ''}</li>`).join('');

  $app.innerHTML = `
    <p>${mine ? '<a href="#/" class="text-btn">‹ ใบเบิกของฉัน</a>' : '<a href="#/approve" class="text-btn">‹ รายการรอดำเนินการ</a>'}</p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span class="ref">${esc(claim.ref_no)}</span>${chip(claim.status)}
    </div>
    <h1>${esc(claim.project || ROUTE_LABEL[claim.route])}</h1>
    <p class="muted small" style="margin-top:-8px">${esc(ROUTE_LABEL[claim.route])} · เดือน${esc(monthLabel(claim.claim_month))} · Cost center ${esc(claim.cost_center)}</p>
    ${!mine ? `<p><b>${esc(emp.full_name || '-')}</b> <span class="muted small">${esc(emp.emp_code || '')} ${esc(emp.position_title || '')}</span></p>` : ''}
    ${claim.status === 'rejected' && claim.return_note ? `<div class="note err"><b>ไม่อนุมัติ:</b> ${esc(claim.return_note)}</div>` : ''}

    ${claim.status === 'returned' && claim.return_note ? `<div class="note err"><b>ส่งกลับแก้ไข:</b> ${esc(claim.return_note)}</div>` : ''}
    ${claim.status === 'svp_approved' ? `<div class="note"><b>SVP อนุมัติแล้ว — จบขั้นตอนในระบบ</b><br>กด "ดาวน์โหลดเอกสาร" พิมพ์ แนบใบเสร็จตัวจริง แล้วส่งต่อตามขั้นตอนเดิม${D.memos.length || Number(claim.max_item_amount) > 10000 ? ' (มี Memo / รายการเกิน 10,000 ต้องให้ CEO และ SVP F&HR เซนต่อ)' : ''}</div>` : ''}
    ${claim.check_notes ? `<div class="note warn">${esc(claim.check_notes)}</div>` : ''}
    ${claim.status !== 'draft' ? `<div class="actions" style="margin-top:0"><button class="btn${claim.status === 'svp_approved' ? '' : ' ghost'}" type="button" id="dlDocs">ดาวน์โหลดเอกสาร (PDF)</button></div>` : ''}
    ${claim.memo_required ? `<div class="note warn">ใบนี้ต้องแนบไฟล์ Memo ที่อนุมัติครบแล้ว บัญชีจึงจะรับเรื่องได้ (แนบในหัวข้อ "ไฟล์แนบของใบเบิก")</div>` : ''}
    ${editable && memos.length ? `<div class="note warn">ใบเบิกนี้เกินวงเงิน ระบบสร้างร่าง Memo ให้แล้ว ${memos.length} ฉบับ (ด้านล่าง) — ตรวจข้อความ แล้วกด "ยื่นเบิก" Memo จะถูกส่งไปพร้อมใบเบิก</div>` : ''}

    ${editable ? `
    <section class="panel">
      <div class="row">
        <div><label for="h_project">เรื่อง (PROJECT)</label><input id="h_project" value="${esc(claim.project || '')}"></div>
        <div><label for="h_payto">จ่ายให้ (PAY TO)</label><input id="h_payto" value="${esc(claim.pay_to || '')}"></div>
      </div>
      <div class="actions"><button class="btn ghost" type="button" id="saveHead">บันทึกหัวใบเบิก</button></div>
    </section>` : `<p class="small">จ่ายให้: ${esc(claim.pay_to || '-')}</p>`}

    <h2>รายการ</h2>
    ${itemHtml || '<div class="panel flat empty">ยังไม่มีรายการ</div>'}
    <div id="itemForm"></div>
    ${editable ? `<button class="btn ghost block" type="button" id="addItem">เพิ่มรายการ</button>` : ''}

    <div class="total"><span>รวมทั้งสิ้น</span><span>${money(claim.total_amount)} บาท</span></div>

    ${claimFiles.length || canAddMemo ? `<h2>ไฟล์แนบของใบเบิก</h2>
    <section class="panel">
      <div class="files">${claimFiles.map((a) => `<a href="${esc(urls[a.file_path] || '#')}" target="_blank" rel="noopener">${esc(kindLabel(a.kind))}: ${esc(a.file_name || '')}</a>`).join('<br>') || '<span class="small muted">ยังไม่มี</span>'}</div>
      ${canAddMemo ? `<label for="memoFile">แนบ Memo ที่อนุมัติแล้ว (PDF หรือรูป)</label>
        <input id="memoFile" type="file" accept="image/*,application/pdf">
        <div class="actions"><button class="btn ghost" type="button" id="memoUpload">อัปโหลด Memo</button></div>` : ''}
    </section>` : ''}

    ${memos.length ? `<h2>Memo ขออนุมัติ</h2>${memos.map((m) => `
      <div class="memo-wrap" data-memo="${m.id}">
        ${memoDocHTML(m, emp)}
        ${editable && m.status === 'draft' ? `<section class="panel">
          <label for="mb_${m.id}">1. Background (แก้ไขได้) <span class="req">*</span></label>
          <textarea id="mb_${m.id}" rows="4">${esc(m.background || '')}</textarea>
          <label for="mr_${m.id}">2. เหตุผลเพิ่มเติม (ถ้ามี)</label>
          <textarea id="mr_${m.id}" rows="3">${esc(m.request_text || '')}</textarea>
          <div class="actions"><button class="btn ghost" type="button" data-savememo="${m.id}">บันทึกข้อความ Memo</button></div>
        </section>` : ''}
        <div class="actions"><button class="btn ghost" type="button" data-printmemo="${m.id}">พิมพ์ Memo</button></div>
      </div>`).join('')}` : ''}

    ${canAct ? decidePanel(claim, memos) : ''}

    ${editable ? `<div class="actions">
      <button class="btn" type="button" id="submitClaim">ยื่นเบิก</button>
      ${claim.status === 'draft' ? `<button class="btn danger" type="button" id="deleteClaim">ลบใบเบิก</button>` : ''}
    </div>
    <p class="hint">กด "ยื่นเบิก" แล้วใบเบิกจะไปรอ SVP อนุมัติ และจะแก้ไขไม่ได้จนกว่าจะถูกส่งกลับ${svpEnd() ? ' · เมื่อ SVP อนุมัติแล้วให้ดาวน์โหลดเอกสารไปส่งต่อ' : ''}</p>` : ''}

    <h2>ประวัติ</h2>
    <ul class="log">${logHtml}</ul>`;

  if (canAct) bindDecide(claim);
  const dl = document.getElementById('dlDocs');
  if (dl) dl.addEventListener('click', () => openClaimDocs(D));
  $app.querySelectorAll('[data-printmemo]').forEach((b) => b.addEventListener('click', () => {
    printMemo(memos.find((m) => m.id === b.dataset.printmemo), emp);
  }));
  $app.querySelectorAll('[data-savememo]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.savememo;
    const bg = document.getElementById('mb_' + id).value.trim();
    if (!bg) { toast('กรุณากรอก Background'); return; }
    const { error } = await sb.rpc('update_memo_text', {
      p_memo: id, p_background: bg, p_request_text: document.getElementById('mr_' + id).value,
    });
    if (error) toast(errMsg(error)); else { toast('บันทึก Memo แล้ว'); viewClaim(claim.id); }
  }));
  if (canAddMemo) {
    document.getElementById('memoUpload').addEventListener('click', async (e) => {
      const f = document.getElementById('memoFile').files[0];
      if (!f) { toast('เลือกไฟล์ Memo ก่อน'); return; }
      e.target.disabled = true;
      try {
        await uploadFile(claim.id, null, f, 'memo', 0);
        toast('แนบ Memo แล้ว');
        viewClaim(claim.id);
      } catch (err) { toast(errMsg(err)); e.target.disabled = false; }
    });
  }
  if (!editable) return;

  document.getElementById('saveHead').addEventListener('click', async () => {
    const { error } = await sb.from('claims').update({
      project: document.getElementById('h_project').value.trim() || null,
      pay_to: document.getElementById('h_payto').value.trim() || null,
    }).eq('id', claim.id);
    if (error) toast(errMsg(error)); else { toast('บันทึกแล้ว'); viewClaim(claim.id); }
  });

  document.getElementById('addItem').addEventListener('click', (e) => {
    e.target.hidden = true;
    openItemForm(D, null);
  });

  $app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    openItemForm(D, items.find((i) => i.id === b.dataset.edit));
  }));

  $app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('ลบรายการนี้และไฟล์แนบของรายการ?')) return;
    const paths = atts.filter((a) => a.item_id === b.dataset.del).map((a) => a.file_path);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    const { error } = await sb.from('claim_items').delete().eq('id', b.dataset.del);
    if (error) toast(errMsg(error)); else { toast('ลบรายการแล้ว'); viewClaim(claim.id); }
  }));

  $app.querySelectorAll('[data-delatt]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('ลบไฟล์นี้?')) return;
    const a = atts.find((x) => x.id === b.dataset.delatt);
    await sb.storage.from(BUCKET).remove([a.file_path]);
    const { error } = await sb.from('attachments').delete().eq('id', a.id);
    if (error) toast(errMsg(error)); else viewClaim(claim.id);
  }));

  document.getElementById('submitClaim').addEventListener('click', async (e) => {
    if (!confirm('ยืนยันยื่นเบิก? หลังยื่นแล้วจะแก้ไขไม่ได้')) return;
    e.target.disabled = true;
    const { data, error } = await sb.rpc('submit_claim', { p_claim: claim.id });
    e.target.disabled = false;
    if (error) { toast(errMsg(error)); return; }
    toast(data && data.memo_count ? `ยื่นเบิกพร้อม Memo ${data.memo_count} ฉบับแล้ว รอ SVP อนุมัติ`
      : data && data.memo_required ? 'ยื่นเบิกแล้ว — ต้องแนบไฟล์ Memo เพิ่ม' : 'ยื่นเบิกแล้ว รอ SVP อนุมัติ');
    viewClaim(claim.id);
  });

  const del = document.getElementById('deleteClaim');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('ลบใบเบิกนี้ทั้งใบ?')) return;
    if (atts.length) await sb.storage.from(BUCKET).remove(atts.map((a) => a.file_path));
    const { error } = await sb.from('claims').delete().eq('id', claim.id);
    if (error) toast(errMsg(error)); else { toast('ลบใบเบิกแล้ว'); location.hash = '#/'; }
  });
}

// ---------------------------------------------------------------------
// ฟอร์มรายการ (เพิ่ม / แก้ไข)
// ---------------------------------------------------------------------
const TRAVEL_FIELDS = [
  ['destination', 'ปลายทาง (จังหวัด/ประเทศ)', 'text', true],
  ['date_from', 'วันที่เริ่มเดินทาง', 'date', true],
  ['date_to', 'วันที่สิ้นสุด', 'date', true],
];
// [key, label, type, required, options]
function detailFields(code) {
  switch (code) {
    case 'ENTERTAIN': return [
      ['kind', 'ประเภทค่าเลี้ยงรับรอง', 'select', true, ['อาหารและเครื่องดื่ม', 'ที่พัก', 'อื่นๆ']],
      ['venue', 'สถานที่ (ร้าน/โรงแรม)', 'text', true],
      ['event_date', 'วันที่เลี้ยงรับรอง', 'date', true],
      ['guest_name', 'เพื่อรับรองคุณ', 'text', true],
      ['guest_company', 'บริษัทลูกค้า', 'text', true],
      ['guest_from', 'มาจาก', 'text', false],
      ['country', 'ประเทศ', 'text', false],
      ['job_ref', 'Ref. Job #', 'text', false],
      ['guests_count', 'จำนวนผู้รับรอง (คน)', 'number', false],
      ['purpose', 'วัตถุประสงค์ในการเลี้ยงรับรอง', 'textarea', true],
    ];
    case 'GIFT': return [
      ['guest_name', 'ผู้รับของขวัญ', 'text', true],
      ['guest_company', 'บริษัทลูกค้า', 'text', true],
      ['purpose', 'โอกาส / วัตถุประสงค์', 'textarea', true],
    ];
    case 'PHONE': return [['phone_period', 'งวดบิล (เช่น ต.ค. 2569)', 'text', true]];
    case 'PER_DIEM': case 'HOTEL': case 'TRAVEL_FOOD': case 'TRANSPORT': return TRAVEL_FIELDS;
    default: return [];
  }
}
const TRIP_FIELDS = [
  ['date', 'วันที่', 'date'], ['fuel', 'ค่าน้ำมัน (บาท)', 'number'], ['liters', 'จำนวน (ลิตร)', 'number'],
  ['purpose', 'เพื่อปฏิบัติงาน (จังหวัด / บริษัท)', 'text'],
  ['out_from', 'เที่ยวไป: เริ่มต้น', 'text'], ['out_to', 'เที่ยวไป: สิ้นสุด', 'text'],
  ['back_from', 'เที่ยวกลับ: เริ่มต้น', 'text'], ['back_to', 'เที่ยวกลับ: สิ้นสุด', 'text'],
  ['km', 'ระยะทางรวม (กม.)', 'number'],
];

function openItemForm(D, item) {
  const { claim, atts } = D;
  const cats = S.refs.cats.filter((c) => c.route === claim.route);
  const box = document.getElementById('itemForm');
  const addBtn = document.getElementById('addItem');
  if (addBtn) addBtn.hidden = true;

  const draft = item ? {
    category_code: item.category_code, gl_code: item.gl_code || '', description: item.description,
    receipt_date: item.receipt_date || '', receipt_no: item.receipt_no || '', receipt_type: item.receipt_type || '',
    is_overseas: item.is_overseas, currency: item.currency, amount_foreign: item.amount_foreign ?? '',
    fx_rate: item.fx_rate ?? '', fx_source: item.fx_source || 'BOT', amount_thb: item.amount_thb,
    details: { ...(item.details || {}) },
  } : {
    category_code: cats[0] ? cats[0].code : '', gl_code: '', description: '', receipt_date: '', receipt_no: '',
    receipt_type: 'tax_invoice', is_overseas: false, currency: 'USD', amount_foreign: '', fx_rate: '',
    fx_source: 'BOT', amount_thb: '', details: {},
  };
  if (!draft.gl_code) { const c = catOf(draft.category_code); draft.gl_code = (c && c.default_gl) || ''; }
  if (!Array.isArray(draft.details.trips)) draft.details.trips = [];
  if (draft.category_code === 'GAS' && !draft.details.car_plate) draft.details.car_plate = S.profile.car_plate || '';

  box.innerHTML = `
    <section class="panel" id="itemPanel">
      <h3 style="margin-top:0">${item ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h3>
      <div id="ifBody"></div>
      <label for="f_kind">แนบไฟล์ (รูปถ่ายหรือ PDF)</label>
      <select id="f_kind">${FILE_KINDS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <input id="f_files" type="file" accept="image/*,application/pdf" multiple style="margin-top:8px">
      <p class="hint">${item ? `แนบแล้ว ${atts.filter((a) => a.item_id === item.id).length} ไฟล์ · ` : ''}เลือกได้หลายไฟล์ ไฟล์ละไม่เกิน 10 MB</p>
      <div id="ifWarn"></div>
      <div class="actions">
        <button class="btn" type="button" id="ifSave">บันทึกรายการ</button>
        <button class="btn ghost" type="button" id="ifCancel">ยกเลิก</button>
      </div>
    </section>`;

  const body = document.getElementById('ifBody');

  function field(id, label, type, value, req, opts) {
    const r = req ? ' <span class="req">*</span>' : '';
    if (type === 'select') {
      return `<label for="${id}">${esc(label)}${r}</label><select id="${id}">${
        opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    }
    if (type === 'textarea') return `<label for="${id}">${esc(label)}${r}</label><textarea id="${id}">${esc(value)}</textarea>`;
    const im = type === 'number' ? ' inputmode="decimal" step="any"' : '';
    return `<label for="${id}">${esc(label)}${r}</label><input id="${id}" type="${type}" value="${esc(value)}"${im}>`;
  }

  function rateHint() {
    const lv = S.refs.levels[S.profile.level_code];
    if (!lv) return '';
    if (draft.category_code === 'PER_DIEM') return `<p class="hint">สิทธิ์เบี้ยเลี้ยง: ในประเทศ ${money(lv.per_diem_domestic)} / ต่างประเทศ ${money(lv.per_diem_overseas)} บาทต่อวัน</p>`;
    if (draft.category_code === 'HOTEL') return `<p class="hint">ที่พักไม่เกิน: ต่างจังหวัด ${lv.hotel_domestic ? money(lv.hotel_domestic) : 'N/A'} / ต่างประเทศ ${lv.hotel_overseas ? money(lv.hotel_overseas) : 'N/A'} บาทต่อคืน</p>`;
    if (draft.category_code === 'GAS') return `<p class="hint">รถส่วนตัว 8 บาท/กม. · กรุงเทพ–แหลมฉบัง เหมาจ่าย 1,000 บาท/เที่ยว (รวมทางด่วนแล้ว) · แนบแผนที่ระยะทางทุกครั้ง</p>`;
    return '';
  }

  function render() {
    const isGas = draft.category_code === 'GAS';
    const d = draft.details;
    let html = '';
    html += field('f_cat', 'ประเภทค่าใช้จ่าย', 'select', draft.category_code, true, cats.map((c) => [c.code, c.name]));
    html += rateHint();
    html += field('f_gl', 'GL Code', 'select', draft.gl_code, true,
      [['', '— เลือก GL Code —'], ...S.refs.gls.map((g) => [g.code, `${g.code} ${g.name}`])]);
    html += field('f_desc', 'รายละเอียด (DESCRIPTION)', 'text', draft.description, true);
    html += `<div class="row"><div>${field('f_rdate', 'วันที่ในใบเสร็จ', 'date', draft.receipt_date, true)}</div>
             <div>${field('f_rno', 'เลขที่ใบเสร็จ', 'text', draft.receipt_no, false)}</div></div>`;
    html += field('f_rtype', 'ประเภทหลักฐาน', 'select', draft.receipt_type, true, RECEIPT_TYPES);

    // ข้อมูลเฉพาะประเภท
    const df = detailFields(draft.category_code);
    if (df.length) {
      html += `<h3>ข้อมูลเพิ่มเติม</h3>`;
      df.forEach(([k, l, t, req, opts]) => { html += field('d_' + k, l, t, d[k] ?? '', req, opts); });
    }

    if (isGas) {
      html += `<h3>รายละเอียดเที่ยวรถ (แบบฟอร์ม Ent-Gas)</h3>`;
      html += field('d_car_plate', 'เลขทะเบียนรถ', 'text', d.car_plate || '', true);
      d.trips.forEach((t, i) => {
        html += `<div class="trip"><div class="head" style="display:flex;justify-content:space-between">
          <b>เที่ยวที่ ${i + 1}</b><button class="text-btn red" type="button" data-rmtrip="${i}">ลบเที่ยวนี้</button></div>
          <div class="row">${TRIP_FIELDS.map(([k, l, ty]) => `<div>${field(`t_${i}_${k}`, l, ty, t[k] ?? '', ['date', 'purpose', 'km'].includes(k))}</div>`).join('')}</div></div>`;
      });
      html += `<button class="btn ghost" type="button" id="addTrip">เพิ่มเที่ยว</button>`;
      html += `<p class="hint">ยอดเงินของรายการนี้ = ผลรวมค่าน้ำมันทุกเที่ยว</p>`;
    }

    // เงินตราต่างประเทศ
    if (claim.route === 'general') {
      html += `<label class="check" style="margin-top:16px"><input type="checkbox" id="f_ovs" ${draft.is_overseas ? 'checked' : ''}> ค่าใช้จ่ายต่างประเทศ / สกุลเงินต่างประเทศ</label>`;
    }
    if (draft.is_overseas) {
      html += `<div class="row">
        <div>${field('f_cur', 'สกุลเงิน (เช่น USD)', 'text', draft.currency, true)}</div>
        <div>${field('f_famt', 'ยอดเงินสกุลต่างประเทศ', 'number', draft.amount_foreign, true)}</div>
        <div>${field('f_rate', 'อัตราแลกเปลี่ยน (บาท)', 'number', draft.fx_rate, true)}</div>
        <div>${field('f_fxsrc', 'ที่มาของอัตรา', 'select', draft.fx_source, true, [['BOT', 'BOT ณ วันที่ใช้จ่าย'], ['CARD', 'ตาม Statement บัตรเครดิต']])}</div>
      </div>`;
    }
    const auto = isGas || draft.is_overseas;
    html += `<label for="f_amt">จำนวนเงิน (บาท) <span class="req">*</span></label>
      <input id="f_amt" type="number" inputmode="decimal" step="any" value="${esc(draft.amount_thb)}" ${auto ? 'readonly' : ''}>
      ${auto ? '<p class="hint">ระบบคำนวณให้อัตโนมัติ</p>' : ''}`;

    body.innerHTML = html;
    recalc();
    warn();
  }

  const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };

  function readForm() {
    draft.category_code = val('f_cat') ?? draft.category_code;
    draft.gl_code = val('f_gl') ?? draft.gl_code;
    draft.description = val('f_desc') ?? '';
    draft.receipt_date = val('f_rdate') ?? '';
    draft.receipt_no = val('f_rno') ?? '';
    draft.receipt_type = val('f_rtype') ?? '';
    const ovs = document.getElementById('f_ovs');
    draft.is_overseas = ovs ? ovs.checked : false;
    if (document.getElementById('f_cur')) {
      draft.currency = (val('f_cur') || '').trim().toUpperCase();
      draft.amount_foreign = val('f_famt');
      draft.fx_rate = val('f_rate');
      draft.fx_source = val('f_fxsrc');
    }
    draft.amount_thb = val('f_amt') ?? draft.amount_thb;
    detailFields(draft.category_code).forEach(([k]) => { const v = val('d_' + k); if (v !== undefined) draft.details[k] = v; });
    if (document.getElementById('d_car_plate')) draft.details.car_plate = val('d_car_plate');
    draft.details.trips = draft.details.trips.map((t, i) => {
      const o = {};
      TRIP_FIELDS.forEach(([k]) => { const v = val(`t_${i}_${k}`); o[k] = v !== undefined ? v : t[k]; });
      return o;
    });
  }

  function recalc() {
    const amt = document.getElementById('f_amt');
    if (!amt) return;
    if (draft.category_code === 'GAS') {
      const sum = draft.details.trips.reduce((s, t, i) => s + (num(val(`t_${i}_fuel`)) || 0), 0);
      amt.value = sum ? round2(sum) : '';
    } else if (document.getElementById('f_cur')) {
      const f = num(val('f_famt')); const r = num(val('f_rate'));
      amt.value = f && r ? round2(f * r) : '';
    }
  }

  function warn() {
    const out = [];
    const cat = catOf(val('f_cat'));
    const amt = num(val('f_amt'));
    const rdate = val('f_rdate');
    const ovs = document.getElementById('f_ovs');
    if (cat && cat.max_per_receipt && amt && amt > Number(cat.max_per_receipt)) {
      out.push(`${cat.name}: ใบเสร็จเกิน ${money(cat.max_per_receipt)} บาท กรุณาตรวจสอบเงื่อนไข`);
    }
    if (rdate && monthStart(rdate) !== claim.claim_month && !(ovs && ovs.checked)) {
      out.push(`วันที่ใบเสร็จไม่อยู่ในเดือน${monthLabel(claim.claim_month)} — ต้องเบิกในเดือนของใบเสร็จ`);
    }
    if (amt && amt > 10000) out.push('รายการนี้เกิน 10,000 บาท ใบเบิกนี้จะต้องให้ CEO อนุมัติต่อจาก SVP');
    if (cat && cat.requires_memo) out.push(`${cat.name} ต้องแนบ Memo ที่อนุมัติแล้วทุกครั้ง`);
    document.getElementById('ifWarn').innerHTML = out.map((m) => `<div class="note warn">${esc(m)}</div>`).join('');
  }

  render();

  body.addEventListener('change', (e) => {
    if (e.target.id === 'f_cat') {
      readForm();
      const c = catOf(draft.category_code);
      draft.gl_code = (c && c.default_gl) || '';
      if (draft.category_code === 'GAS' && !draft.details.car_plate) draft.details.car_plate = S.profile.car_plate || '';
      render();
    } else if (e.target.id === 'f_ovs') {
      readForm();
      render();
    } else {
      warn();
    }
  });
  body.addEventListener('input', () => { recalc(); warn(); });
  body.addEventListener('click', (e) => {
    if (e.target.id === 'addTrip') { readForm(); draft.details.trips.push({}); render(); }
    if (e.target.dataset.rmtrip !== undefined) {
      readForm(); draft.details.trips.splice(Number(e.target.dataset.rmtrip), 1); render();
    }
  });

  document.getElementById('ifCancel').addEventListener('click', () => {
    box.innerHTML = '';
    if (addBtn) addBtn.hidden = false;
  });

  document.getElementById('ifSave').addEventListener('click', async (e) => {
    readForm();
    recalc();
    draft.amount_thb = val('f_amt');
    const problems = [];
    if (!draft.category_code) problems.push('เลือกประเภทค่าใช้จ่าย');
    if (!draft.description.trim()) problems.push('ใส่รายละเอียด');
    if (!draft.receipt_date) problems.push('ใส่วันที่ในใบเสร็จ');
    const amount = num(draft.amount_thb);
    if (!amount || amount <= 0) problems.push('ใส่จำนวนเงิน');
    detailFields(draft.category_code).forEach(([k, l, , req]) => {
      if (req && !String(draft.details[k] ?? '').trim()) problems.push(l);
    });
    if (draft.category_code === 'GAS') {
      if (!draft.details.trips.length) problems.push('เพิ่มเที่ยวรถอย่างน้อย 1 เที่ยว');
      draft.details.trips.forEach((t, i) => {
        if (!t.date || !t.purpose || !t.km) problems.push(`เที่ยวที่ ${i + 1}: วันที่ / เพื่อปฏิบัติงาน / ระยะทาง`);
      });
    }
    if (draft.is_overseas && (!draft.currency || !num(draft.amount_foreign) || !num(draft.fx_rate))) {
      problems.push('สกุลเงิน ยอดเงิน และอัตราแลกเปลี่ยน');
    }
    if (problems.length) {
      document.getElementById('ifWarn').innerHTML = `<div class="note err">กรุณากรอก: ${esc(problems.join(', '))}</div>`;
      return;
    }

    const details = { ...draft.details };
    if (draft.category_code !== 'GAS') { delete details.trips; delete details.car_plate; }
    const keep = new Set([...detailFields(draft.category_code).map((f) => f[0]), 'trips', 'car_plate']);
    Object.keys(details).forEach((k) => { if (!keep.has(k)) delete details[k]; });

    const payload = {
      claim_id: claim.id,
      category_code: draft.category_code,
      gl_code: draft.gl_code || null,
      description: draft.description.trim(),
      receipt_date: draft.receipt_date || null,
      receipt_no: draft.receipt_no.trim() || null,
      receipt_type: draft.receipt_type || null,
      is_overseas: !!draft.is_overseas,
      currency: draft.is_overseas ? draft.currency : 'THB',
      amount_foreign: draft.is_overseas ? num(draft.amount_foreign) : null,
      fx_rate: draft.is_overseas ? num(draft.fx_rate) : null,
      fx_source: draft.is_overseas ? draft.fx_source : null,
      amount_thb: round2(amount),
      details,
    };

    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    try {
      let itemId = item && item.id;
      if (itemId) {
        const { error } = await sb.from('claim_items').update(payload).eq('id', itemId);
        if (error) throw error;
      } else {
        payload.line_no = (D.items.reduce((m, i) => Math.max(m, i.line_no), 0)) + 1;
        const { data, error } = await sb.from('claim_items').insert(payload).select('id').single();
        if (error) throw error;
        itemId = data.id;
      }
      const files = Array.from(document.getElementById('f_files').files || []);
      const kind = val('f_kind');
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `กำลังอัปโหลดไฟล์ ${i + 1}/${files.length}…`;
        await uploadFile(claim.id, itemId, files[i], kind, i);
      }
      toast('บันทึกรายการแล้ว');
      viewClaim(claim.id);
    } catch (err) {
      toast(errMsg(err));
      btn.disabled = false;
      btn.textContent = 'บันทึกรายการ';
    }
  });

  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------
// อัปโหลดไฟล์ (ย่อรูปใหญ่ก่อน เพื่อประหยัดเน็ตมือถือ)
// ---------------------------------------------------------------------
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
    return blob ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : file;
  } catch (_) {
    return file;
  }
}

async function uploadFile(claimId, itemId, file, kind, idx) {
  const f = await shrinkImage(file);
  if (f.size > 10 * 1024 * 1024) throw new Error(`ไฟล์ ${file.name} ใหญ่เกิน 10 MB`);
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
  const ext = extMap[f.type] || (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${S.profile.id}/${claimId}/${itemId || 'claim'}-${Date.now()}-${idx}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
  if (up.error) throw new Error(`อัปโหลด ${file.name} ไม่สำเร็จ: ${up.error.message}`);
  const { error } = await sb.from('attachments').insert({
    claim_id: claimId, item_id: itemId, kind, file_path: path, file_name: file.name.slice(0, 200),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// หน้ารอดำเนินการ (SVP / CEO / HR / บัญชี)
// ---------------------------------------------------------------------
async function viewApprove() {
  $app.innerHTML = `<p class="muted center pad">กำลังโหลด…</p>`;
  const { data, error } = await queueQuery(true);
  if (error) { $app.innerHTML = `<div class="note err">${esc(errMsg(error))}</div>`; return; }
  const list = data || [];
  const groups = queueStatuses().map((st) => {
    const mine = list.filter((c) => c.status === st);
    const rows = mine.map((c) => `
      <li><a href="#/claim/${c.id}">
        <span><b>${esc(c.employee ? c.employee.full_name : '-')}</b></span>
        <span class="amt">${money(c.total_amount)}</span>
        <span class="small muted"><span class="ref">${esc(c.ref_no)}</span> ${esc(monthLabel(c.claim_month))} · ${esc(c.project || ROUTE_LABEL[c.route])}</span>
        <span class="small">${c.memo_required ? '<span class="chip wait">ต้องมี Memo</span>' : ''}${Number(c.max_item_amount) > 10000 ? ' <span class="chip">เกิน 10,000</span>' : ''}</span>
      </a></li>`).join('');
    return `<h2>${esc(STATUS[st][0])} <span class="muted small">(${mine.length})</span></h2>
      <section class="panel">${rows ? `<ul class="list">${rows}</ul>` : '<div class="empty">ไม่มีรายการ</div>'}</section>`;
  }).join('');
  $app.innerHTML = `<h1>${S.profile.role === 'admin' ? 'ใบเบิกที่ค้างอยู่' : 'รอดำเนินการ'}</h1>${groups}
    ${S.profile.role === 'admin' ? '<p class="hint">admin ดูได้อย่างเดียว การอนุมัติต้องใช้บัญชีของผู้อนุมัติแต่ละขั้น</p>' : ''}`;
}

function decidePanel(claim, memos) {
  const st = claim.status;
  if (st === 'pending_payment') {
    return `<section class="panel decide" id="decide">
      <h3 style="margin-top:0">โอนเงิน</h3>
      <p class="small">ยอดโอน <b>${money(claim.total_amount)} บาท</b> ให้ ${esc(claim.pay_to || '-')}</p>
      <label for="dNote">หมายเหตุ (ถ้ามี)</label><input id="dNote" placeholder="เช่น วันที่โอน / เลขอ้างอิงการโอน">
      <div class="actions"><button class="btn" type="button" data-act="mark_paid">บันทึกว่าโอนเงินแล้ว</button></div>
    </section>`;
  }
  const isAcc = st === 'pending_accounting';
  const hasMemo = (memos || []).some((m) => m.status === 'pending');
  const title = { pending_approval: 'การอนุมัติของ SVP', pending_ceo: 'การอนุมัติของ CEO',
    pending_fhr: 'การอนุมัติ Memo ของ SVP Finance & HR',
    pending_hr: 'การตรวจของ HR', pending_accounting: 'การตรวจของฝ่ายบัญชี' }[st];
  const memoBox = (isAcc && claim.memo_required
    ? '<div class="note warn">ใบนี้ต้องมีไฟล์ Memo — ตรวจไฟล์ในหัวข้อ "ไฟล์แนบของใบเบิก" ก่อนรับเรื่อง</div>' : '')
    + (hasMemo && ['pending_approval', 'pending_ceo', 'pending_fhr'].includes(st)
      ? '<div class="note">การอนุมัติครั้งนี้ จะอนุมัติทั้งใบเบิกและ Memo ด้านบนพร้อมกัน</div>' : '')
    + (svpEnd() && st === 'pending_approval'
      ? '<div class="note">อนุมัติแล้วจบในระบบ พนักงานจะดาวน์โหลดเอกสารไปส่งต่อ CEO / SVP F&amp;HR / บัญชี ด้านนอก</div>' : '');
  return `<section class="panel decide" id="decide">
    <h3 style="margin-top:0">${esc(title)}</h3>
    ${isAcc ? '<p class="small muted">รับเรื่องเมื่อได้รับเอกสารตัวจริงครบ และตรวจถูกต้องแล้ว</p>' : ''}
    ${memoBox}
    <label for="dNote">ความเห็น / เหตุผล <span class="muted small">(ต้องใส่เมื่อส่งกลับหรือไม่อนุมัติ)</span></label>
    <textarea id="dNote"></textarea>
    <div class="actions">
      <button class="btn" type="button" data-act="approve">${isAcc ? 'ตรวจแล้ว รับเรื่อง' : st === 'pending_hr' ? 'HR ตรวจแล้ว' : 'อนุมัติ'}</button>
      <button class="btn ghost" type="button" data-act="return">ส่งกลับแก้ไข</button>
      ${isAcc ? '' : '<button class="btn danger" type="button" data-act="reject">ไม่อนุมัติ</button>'}
    </div>
  </section>`;
}

function bindDecide(claim) {
  const panel = document.getElementById('decide');
  if (!panel) return;
  const CONFIRM = { approve: 'ยืนยันดำเนินการ?', return: 'ส่งกลับให้พนักงานแก้ไข?', reject: 'ยืนยันไม่อนุมัติใบเบิกนี้?', mark_paid: 'ยืนยันว่าโอนเงินแล้ว?' };
  const DONE = { approve: 'ดำเนินการแล้ว', return: 'ส่งกลับแก้ไขแล้ว', reject: 'ไม่อนุมัติแล้ว', mark_paid: 'บันทึกการโอนเงินแล้ว' };
  panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    const noteEl = document.getElementById('dNote');
    const note = noteEl ? noteEl.value.trim() : '';
    if ((act === 'return' || act === 'reject') && !note) {
      toast('กรุณาใส่เหตุผลก่อน');
      noteEl.focus();
      return;
    }
    if (!confirm(CONFIRM[act])) return;
    const args = { p_claim: claim.id, p_action: act, p_note: note || null };
    panel.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    const { error } = await sb.rpc('act_on_claim', args);
    if (error) {
      toast(errMsg(error));
      panel.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      return;
    }
    toast(DONE[act]);
    location.hash = '#/approve';
  }));
}

// ---------------------------------------------------------------------
// Memo (หน้าตาตามแบบฟอร์ม MEMORANDUM ของบริษัท)
// ---------------------------------------------------------------------
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const memoDate = (iso) => { if (!iso) return '-'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}-${EN_MONTHS[+m - 1]}-${y}`; };

function memoDocHTML(m, emp, forPrint) {
  const tname = (m.subject || '').replace(/^ขออนุมัติ/, '').replace(/เกินวงเงิน$/, '');
  const sign = (name, title, at, fallbackTitle, label) => `<td class="sig">
      <div class="sig-mark">${at ? `✓ ${label || 'อนุมัติออนไลน์'}<br><span>${esc(label ? fmtDate(at) : fmtDateTime(at))}</span>` : m.status === 'draft' || forPrint ? '' : '<span class="muted">รออนุมัติ</span>'}</div>
      <div class="sig-name">${esc(name || '')}</div><div class="sig-title">${esc(title || fallbackTitle || '')}</div></td>`;
  return `<article class="memo-doc">
    <table class="memo-top"><tr>
      <td class="logo">SINO<small>LOGISTICS CORPORATION</small></td>
      <td><b class="memo-title">MEMORANDUM</b> No. ${esc(m.memo_no || '(ออกเลขเมื่อยื่นเบิก)')}</td></tr></table>
    <table class="memo-head">
      <tr><th>To:</th><td>${esc(m.to_name || 'CEO')}</td></tr>
      <tr><th>CC:</th><td>${esc(m.cc || '-')}</td></tr>
      <tr><th>From:</th><td>${esc(m.from_name || emp.full_name || '')}</td></tr>
      <tr><th>Date:</th><td>${m.memo_date ? memoDate(m.memo_date) : '(วันที่ยื่น)'}</td></tr>
      <tr><th>Subject:</th><td>${esc(m.subject)}</td></tr>
    </table>
    <h4>1. Background:</h4><p>${esc(m.background || '')}</p>
    <h4>2. Requests &amp; Reasons:</h4>
    <p>จากที่กล่าวข้างต้น จึงขออนุมัติงบประมาณใช้จ่ายสำหรับ${esc(tname)}ที่เกินจาก Budget อีกจำนวนทั้งสิ้น ${money(m.amount_requested)} บาท${m.request_text ? ' ' + esc(m.request_text) : ''}</p>
    <p>We request your approval for ขออนุมัติงบประมาณใช้จ่ายเกินวงเงิน.</p>
    <table class="memo-budget">
      <tr><th>3. Budget:</th><td>${m.budget_flag === 'budgeted' ? '☑' : '☐'} Budgeted</td><td>${m.budget_flag === 'unbudgeted' ? '☑' : '☐'} Unbudgeted</td>
        <th>Account Code:</th><td>${esc(m.account_code || '')} ${esc(m.cost_center || '')}</td></tr>
      <tr><th>Budget Approved</th><td colspan="2">THB ${money(m.budget_approved)}</td><th>Budget Available:</th><td>${money(m.budget_available)}</td></tr>
      <tr><th>Budget Requested</th><td colspan="2">THB ${money(m.amount_requested)}</td><th>Budget Remaining:</th><td>-</td></tr>
    </table>
    <h4>4. Recommendation:</h4><p>${esc(m.recommendation || 'It is our recommendation to approve')}</p>
    <table class="memo-sign">
      <tr><th>Prepared by:</th><th>Vetted by:</th><th>Supported by:</th><th>Approved by:</th></tr>
      <tr>
        ${sign(m.prepared_name || emp.full_name, m.prepared_title || emp.position_title, m.status !== 'draft' ? m.memo_date : null, '', 'ยื่นออนไลน์')}
        ${sign(m.vetted_name, m.vetted_title, m.vetted_at, 'SVP')}
        ${sign(m.supported_name, m.supported_title, m.supported_at, 'SVP Finance and Human Resource')}
        ${sign(m.approved_name, m.approved_title, m.approved_at, 'CEO')}
      </tr>
    </table>
  </article>`;
}

function printMemo(m, emp) {
  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up'); return; }
  const css = new URL('style.css?v=5', location.href).href;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>${esc(m.memo_no || 'Memo')}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${css}"></head>
    <body class="print-page" onload="setTimeout(function(){window.print()},400)">${memoDocHTML(m, emp, true)}</body></html>`);
  w.document.close();
}

init();
