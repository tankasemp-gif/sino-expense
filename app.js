// =====================================================================
// SINO ทำเบิกออนไลน์ — ส่วนที่ 2–9: ใบเบิก, ยื่นเบิก, อนุมัติ, Memo, เอกสาร, ลายเซ็น, ทำเบิกแทน, กติกาการเบิก
// ไฟล์นี้ไม่มีรหัสผ่านหรือ key (key อยู่ใน config.js)
// =====================================================================
'use strict';

const cfg = window.APP_CONFIG || {};
const $app = document.getElementById('app');
const sb = (cfg.SUPABASE_URL && cfg.SUPABASE_KEY && !cfg.SUPABASE_KEY.startsWith('วาง'))
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)
  : null;

const S = { session: null, profile: null, settings: {}, delegates: [], refs: { cats: [], gls: [], levels: {} } };
const canActFor = (empId) => empId === (S.profile && S.profile.id) || S.delegates.some((d) => d.id === empId);
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
  ['tax_invoice', 'ใบกำกับภาษีเต็มรูป (ตัวจริง)'], ['e_tax', 'e-Tax Invoice'],
  ['receipt', 'ใบเสร็จรับเงิน'], ['cash_bill', 'บิลเงินสด'], ['substitute', 'ไม่มีใบเสร็จ (ใช้ใบรับรองแทน)'],
];
const PAY_METHODS = [['transfer', 'โอนเงิน'], ['card', 'บัตรเครดิต'], ['cash', 'เงินสด'], ['easypass', 'Easy Pass / M-Flow']];
const FILE_KINDS = [
  ['receipt', 'ใบเสร็จ / ใบกำกับภาษี'], ['payment_proof', 'หลักฐานการจ่าย (สลิป / Statement)'], ['substitute_form', 'ใบรับรองแทนใบเสร็จ'],
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
  const h = location.hash || '#/';
  const onApprove = h === '#/approve';
  const onMe = h === '#/me';
  nav.innerHTML = `<a href="#/" class="${onApprove || onMe ? '' : 'on'}">ใบเบิกของฉัน</a>
    ${isApprover() ? `<a href="#/approve" class="${onApprove ? 'on' : ''}">${S.profile.role === 'admin' ? 'ใบเบิกที่ค้างอยู่' : 'รอดำเนินการ'}<span class="count" id="qcount"></span></a>` : ''}
    <a href="#/me" class="${onMe ? 'on' : ''}">ลายเซ็น / ข้อมูลของฉัน</a>`;
  if (!isApprover()) return;
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
  if (h === '#/me') return viewMe();
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
  const [cats, gls, levels, settings, delegs] = await Promise.all([
    sb.from('expense_categories').select('*').eq('active', true).order('sort_order'),
    sb.from('gl_codes').select('*').eq('active', true).order('code'),
    sb.from('position_levels').select('*'),
    sb.from('app_settings').select('key, value'),
    sb.from('delegates').select('employee:profiles!delegates_employee_id_fkey(id, full_name, level_code)').eq('delegate_id', p.id),
  ]);
  S.delegates = ((delegs && delegs.data) || []).map((d) => d.employee).filter(Boolean);
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
    sb.from('claims').select('id, ref_no, claim_month, route, project, status, total_amount, created_at, employee_id, employee:profiles!claims_employee_id_fkey(full_name)')
      .or(`employee_id.eq.${uid},created_by.eq.${uid}`).order('created_at', { ascending: false }).limit(50),
  ]);

  const names = { ENTERTAIN: 'Entertain (รวมของขวัญ)', GAS: 'Gas', PHONE: 'Phone' };
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
      <span class="small muted">${esc(monthLabel(c.claim_month))} · ${esc(c.project || 'ใบเบิก')}${c.employee_id !== uid ? ` · ทำแทน ${esc(c.employee ? c.employee.full_name : '')}` : ''}</span>
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
      ${S.delegates.length ? `<label for="owner">ทำเบิกให้ <span class="req">*</span></label>
      <select id="owner"><option value="${S.profile.id}">ตัวเอง (${esc(S.profile.full_name || '')})</option>
        ${S.delegates.map((d) => `<option value="${d.id}">${esc(d.full_name || '')}</option>`).join('')}</select>
      <p class="hint">ทำแทนแล้วกดยื่นแทนได้เลย ใบเบิกจะเป็นชื่อเจ้าของ และไปให้ SVP ของเจ้าของอนุมัติ</p>` : ''}

      <label for="month">เดือนที่เบิก (เดือนของใบเสร็จ) <span class="req">*</span></label>
      <select id="month">
        <option value="${thisMonth}">${esc(monthLabel(thisMonth))}</option>
        <option value="${prevMonth}">${esc(monthLabel(prevMonth))}</option>
      </select>
      <p class="hint">ยื่นเบิกของแต่ละเดือนได้ถึงวันที่ 2 ของเดือนถัดไป</p>

      <label for="project">เรื่อง (PROJECT)</label>
      <input id="project" placeholder="เช่น Phone และค่าน้ำมันส่วนเกิน">

      <label for="payto">จ่ายให้ (PAY TO)</label>
      <input id="payto" value="${esc(S.profile.full_name || '')}" placeholder="เว้นว่าง = ชื่อเจ้าของใบเบิก">

      <div class="actions"><button class="btn" type="submit">สร้างใบเบิก</button></div>
    </form>`;

  document.getElementById('newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { data, error } = await sb.from('claims').insert({
      employee_id: document.getElementById('owner') ? document.getElementById('owner').value : S.profile.id,
      claim_month: document.getElementById('month').value,
      project: document.getElementById('project').value.trim() || null,
      pay_to: (() => { const o = document.getElementById('owner'); const v = document.getElementById('payto').value.trim();
        if (o && o.value !== S.profile.id) { const d = S.delegates.find((x) => x.id === o.value); return d ? d.full_name : v; }
        return v || null; })(),
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
  const { data: emp } = await sb.from('profiles').select('*').eq('id', c.data.employee_id).single();
  // ชื่อผู้อนุมัติ (ใบเก่าที่ยังไม่มีชื่อเก็บไว้)
  if (c.data.approved_by && !c.data.approved_name) {
    const { data: ap } = await sb.from('profiles').select('full_name, name_en, title_en, position_title').eq('id', c.data.approved_by).single();
    if (ap) { c.data.approved_name = ap.name_en || ap.full_name; c.data.approved_title = ap.title_en || ap.position_title; }
  }
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
  const mine = canActFor(claim.employee_id) || claim.created_by === S.profile.id;
  const editable = canActFor(claim.employee_id) && ['draft', 'returned'].includes(claim.status);
  const canCancel = mine && !['draft', 'cancelled', 'paid', 'rejected'].includes(claim.status);
  const role = S.profile.role;
  const canAct = !mine && (
    (claim.status === 'pending_approval' && emp.supervisor_id === S.profile.id) ||
    (claim.status === 'pending_ceo' && role === 'ceo') ||
    (claim.status === 'pending_fhr' && S.profile.is_fhr) ||
    (claim.status === 'pending_hr' && role === 'hr') ||
    (['pending_accounting', 'pending_payment'].includes(claim.status) && role === 'accounting'));
  const canAddMemo = canActFor(claim.employee_id) && ['pending_approval', 'pending_ceo', 'pending_fhr', 'pending_hr', 'pending_accounting'].includes(claim.status);
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
      <div class="meta">ใบเสร็จ ${fmtDate(it.receipt_date)}${it.receipt_no ? ' เลขที่ ' + esc(it.receipt_no) : ''} ${it.gl_code ? ' · GL ' + esc(it.gl_code) : ''}${fx}</div>
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
    <h1>${esc(claim.project || 'ใบเบิก')}</h1>
    <p class="muted small" style="margin-top:-8px">เดือน${esc(monthLabel(claim.claim_month))} · Cost center ${esc(claim.cost_center)}</p>
    ${claim.employee_id !== S.profile.id ? `<p><b>${esc(emp.full_name || '-')}</b> <span class="muted small">${esc(emp.emp_code || '')} ${esc(emp.position_title || '')}</span></p>` : ''}
    ${claim.status === 'cancelled' ? `<div class="note err"><b>ยกเลิกแล้ว:</b> ${esc(claim.cancel_reason || '')}</div>` : ''}
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
    ${canCancel ? `<div class="actions"><button class="btn danger" type="button" id="cancelClaim">ยกเลิกใบเบิกนี้</button></div>
      <p class="hint">ยกเลิกแล้วต้องสร้างใบใหม่ ระบบจะแจ้งให้ SVP เห็นพร้อมเหตุผล</p>` : ''}

    ${editable ? `<div class="actions">
      <button class="btn" type="button" id="submitClaim">ยื่นเบิก</button>
      ${claim.status === 'draft' ? `<button class="btn danger" type="button" id="deleteClaim">ลบใบเบิก</button>` : ''}
    </div>
    <p class="hint">กด "ยื่นเบิก" แล้วใบเบิกจะไปรอ SVP อนุมัติ และจะแก้ไขไม่ได้จนกว่าจะถูกส่งกลับ${svpEnd() ? ' · เมื่อ SVP อนุมัติแล้วให้ดาวน์โหลดเอกสารไปส่งต่อ' : ''}</p>` : ''}

    <h2>ประวัติ</h2>
    <ul class="log">${logHtml}</ul>`;

  if (canAct) bindDecide(claim);
  const cc = document.getElementById('cancelClaim');
  if (cc) cc.addEventListener('click', async () => {
    const reason = prompt('เหตุผลที่ยกเลิกใบเบิกนี้');
    if (reason === null) return;
    if (!reason.trim()) { toast('กรุณาระบุเหตุผล'); return; }
    const { error } = await sb.rpc('cancel_claim', { p_claim: claim.id, p_reason: reason.trim() });
    if (error) toast(errMsg(error)); else { toast('ยกเลิกใบเบิกแล้ว'); viewClaim(claim.id); }
  });
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
        await uploadFile(claim, null, f, 'memo', 0);
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
// ฟอร์มรายการ (เพิ่ม / แก้ไข) — ตามกติกาการเบิกฉบับยืนยัน
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
      ['purpose', 'วัตถุประสงค์ในการเลี้ยงรับรอง', 'textarea', true],
    ];
    case 'GIFT': return [
      ['guest_name', 'ผู้รับของขวัญ (1 ลูกค้าต่อ 1 รายการ)', 'text', true],
      ['guest_company', 'บริษัทลูกค้า', 'text', true],
      ['venue', 'ร้านที่ซื้อ', 'text', true],
      ['event_date', 'วันที่ให้ของขวัญ', 'date', true],
      ['job_ref', 'Ref. Job #', 'text', false],
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
const OVERSEAS_TRAVEL = ['TRANSPORT', 'PER_DIEM', 'HOTEL', 'TRAVEL_FOOD'];

// สิ่งที่ต้องแนบของรายการนี้ (ใช้ทั้งแสดงผลและตรวจก่อนบันทึก)
function itemNeeds(d) {
  const needProof = (d.receipt_type !== 'tax_invoice' && !(d.category_code === 'PHONE' && d.receipt_type === 'e_tax'))
    || ['card', 'easypass'].includes(d.details.pay);
  return {
    proof: needProof,
    map: d.category_code === 'GAS',
    company: d.category_code !== 'PHONE' && d.receipt_type !== 'substitute',
    substituteForm: d.receipt_type === 'substitute'
      || (['ENTERTAIN', 'GIFT'].includes(d.category_code) && ['receipt', 'cash_bill'].includes(d.receipt_type)),
  };
}

function openItemForm(D, item) {
  const { claim, atts } = D;
  const cats = S.refs.cats;
  const box = document.getElementById('itemForm');
  const addBtn = document.getElementById('addItem');
  if (addBtn) addBtn.hidden = true;
  const have = (kind) => item && atts.some((a) => a.item_id === item.id && a.kind === kind);

  const draft = item ? {
    category_code: item.category_code, gl_code: item.gl_code || '', description: item.description,
    receipt_date: item.receipt_date || '', receipt_no: item.receipt_no || '', receipt_type: item.receipt_type || 'tax_invoice',
    is_overseas: item.is_overseas, currency: item.currency, amount_foreign: item.amount_foreign ?? '',
    fx_rate: item.fx_rate ?? '', fx_source: item.fx_source || 'BOT', amount_thb: item.amount_thb,
    details: { ...(item.details || {}) },
  } : {
    category_code: cats[0] ? cats[0].code : '', gl_code: '', description: '', receipt_date: '', receipt_no: '',
    receipt_type: 'tax_invoice', is_overseas: false, currency: 'USD', amount_foreign: '', fx_rate: '',
    fx_source: 'BOT', amount_thb: '', details: { pay: 'transfer' },
  };
  if (!Array.isArray(draft.details.trips)) draft.details.trips = [];
  if (draft.category_code === 'GAS' && !draft.details.car_plate) draft.details.car_plate = (D.emp && D.emp.car_plate) || '';

  box.innerHTML = `
    <section class="panel" id="itemPanel">
      <h3 style="margin-top:0">${item ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h3>
      <div id="ifBody"></div>
      <div id="ifFiles"></div>
      <div id="ifWarn"></div>
      <div class="actions">
        <button class="btn" type="button" id="ifSave">บันทึกรายการ</button>
        <button class="btn ghost" type="button" id="ifCancel">ยกเลิก</button>
      </div>
    </section>`;
  const body = document.getElementById('ifBody');
  const filesBox = document.getElementById('ifFiles');
  const picked = {};   // kind -> FileList ที่เลือกไว้ (เก็บไว้เมื่อฟอร์มวาดใหม่)

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

  function hint() {
    const lv = S.refs.levels[D.emp && D.emp.level_code];
    const c = draft.category_code;
    if (c === 'PER_DIEM' && lv) return `<p class="hint">สิทธิ์เบี้ยเลี้ยง: ในประเทศ ${money(lv.per_diem_domestic)} / ต่างประเทศ ${money(lv.per_diem_overseas)} บาทต่อวัน</p>`;
    if (c === 'HOTEL' && lv) return `<p class="hint">ที่พักไม่เกิน: ต่างจังหวัด ${lv.hotel_domestic ? money(lv.hotel_domestic) : 'N/A'} / ต่างประเทศ ${lv.hotel_overseas ? money(lv.hotel_overseas) : 'N/A'} บาทต่อคืน</p>`;
    if (c === 'GAS') return '<p class="hint">ใช้ยอดตามใบกำกับภาษีเต็มรูปของปั๊ม และแนบแผนที่เส้นทางทุกครั้ง</p>';
    if (c === 'PHONE') return '<p class="hint">เบิกได้เดือนละครั้ง ใบกำกับเป็นชื่อพนักงานได้ · เกินวงเงิน (เช่น roaming) ต้องแนบ Memo ขออนุมัติเดินทางต่างประเทศ</p>';
    if (c === 'GIFT') return '<p class="hint">1 รายการต่อ 1 ลูกค้า · ใบเสร็จไม่ควรเกิน 2,000 บาทต่อใบ · หักจากงบ Entertain</p>';
    if (c === 'EXPRESSWAY') return '<p class="hint">ค่าทางด่วนไม่มีวงเงิน ระบบจะสร้าง Memo ให้ทุกครั้ง · ใช้ Easy Pass ต้องแนบ Statement</p>';
    if (c === 'FITNESS') return '<p class="hint">สิทธิ์ 1,200 บาท/เดือน (เกินสิทธิ์ระบบตัดยอดให้อัตโนมัติ)</p>';
    if (c === 'GLASSES') return '<p class="hint">สิทธิ์ 1,500 บาท/ปี · คอนแทคเลนส์เบิกไม่ได้ (เกินสิทธิ์ระบบตัดยอดให้อัตโนมัติ)</p>';
    return '';
  }

  function glHtml() {
    const cat = catOf(draft.category_code);
    if (!cat) return '';
    if (draft.is_overseas && OVERSEAS_TRAVEL.includes(draft.category_code)) return '<p class="hint">GL 710020022 ค่าเดินทางต่างประเทศ (กำหนดโดยระบบ)</p>';
    if (cat.gl_locked) return `<p class="hint">GL ${esc(cat.default_gl)} (กำหนดโดยระบบ)</p>`;
    if (!cat.gl_required) return '';
    return field('f_gl', 'GL Code', 'select', draft.gl_code, true,
      [['', '— เลือก GL Code —'], ...S.refs.gls.map((g) => [g.code, `${g.code} ${g.name}`])]);
  }

  function render() {
    const c = draft.category_code;
    const d = draft.details;
    const lump = c === 'FITNESS' && d.lump;
    let html = '';
    html += field('f_cat', 'ประเภทค่าใช้จ่าย', 'select', c, true, cats.map((x) => [x.code, x.name]));
    html += hint();
    html += glHtml();
    html += field('f_desc', 'รายละเอียด (DESCRIPTION)', 'text', draft.description, true);
    html += `<div class="row"><div>${field('f_rdate', 'วันที่ในใบเสร็จ', 'date', draft.receipt_date, true)}</div>
             <div>${field('f_rno', 'เลขที่ใบเสร็จ', 'text', draft.receipt_no, lump)}</div></div>`;
    html += `<div class="row"><div>${field('f_rtype', 'ประเภทหลักฐาน', 'select', draft.receipt_type, true, RECEIPT_TYPES)}</div>
             <div>${field('f_pay', 'จ่ายโดย', 'select', d.pay || 'transfer', true, PAY_METHODS.filter((p) => p[0] !== 'easypass' || c === 'EXPRESSWAY'))}</div></div>`;
    if (itemNeeds(draft).company) {
      html += `<label class="check" style="margin-top:12px"><input type="checkbox" id="f_company" ${d.company_ok ? 'checked' : ''}> ใบเสร็จออกในนามบริษัท มีที่อยู่และเลขผู้เสียภาษีครบ <span class="req">*</span></label>`;
    }

    const df = detailFields(c);
    if (df.length) {
      html += '<h3>ข้อมูลเพิ่มเติม</h3>';
      df.forEach(([k, l, t, req, opts]) => { html += field('d_' + k, l, t, d[k] ?? '', req, opts); });
    }

    if (c === 'GAS') {
      html += '<h3>รายละเอียดเที่ยวรถ (แบบฟอร์ม Ent-Gas)</h3>';
      html += field('d_car_plate', 'เลขทะเบียนรถ', 'text', d.car_plate || '', true);
      d.trips.forEach((t, i) => {
        html += `<div class="trip"><div style="display:flex;justify-content:space-between">
          <b>เที่ยวที่ ${i + 1}</b><button class="text-btn red" type="button" data-rmtrip="${i}">ลบเที่ยวนี้</button></div>
          <div class="row">${TRIP_FIELDS.map(([k, l, ty]) => `<div>${field(`t_${i}_${k}`, l, ty, t[k] ?? '', ['date', 'purpose', 'km'].includes(k))}</div>`).join('')}</div></div>`;
      });
      html += '<button class="btn ghost" type="button" id="addTrip">เพิ่มเที่ยว</button>';
    }

    if (c === 'FITNESS') {
      html += `<label class="check" style="margin-top:16px"><input type="checkbox" id="f_lump" ${lump ? 'checked' : ''}> จ่ายเป็นก้อน (เช่น รายปี) เบิกเฉลี่ยรายเดือน</label>`;
      if (lump) {
        html += `<div class="row"><div>${field('d_lump_total', 'ยอดที่จ่ายทั้งก้อน (บาท)', 'number', d.lump_total ?? '', true)}</div>
          <div>${field('d_lump_months', 'แบ่งเบิกกี่เดือน', 'number', d.lump_months ?? '12', true)}</div></div>
          <p class="hint">ใช้ใบเสร็จใบเดิมเบิกได้ทุกเดือนจนครบจำนวนเดือน (ใส่เลขที่ใบเสร็จให้ตรงกันทุกครั้ง)</p>`;
      }
    }

    if (!['FITNESS', 'GLASSES', 'PHONE', 'GAS', 'EXPRESSWAY'].includes(c)) {
      html += `<label class="check" style="margin-top:16px"><input type="checkbox" id="f_ovs" ${draft.is_overseas ? 'checked' : ''}> ค่าใช้จ่ายต่างประเทศ / สกุลเงินต่างประเทศ</label>`;
    }
    if (draft.is_overseas) {
      html += `<div class="row">
        <div>${field('f_cur', 'สกุลเงิน (เช่น USD)', 'text', draft.currency, true)}</div>
        <div>${field('f_famt', 'ยอดเงินสกุลต่างประเทศ', 'number', draft.amount_foreign, true)}</div>
        <div>${field('f_rate', 'อัตราแลกเปลี่ยน (บาท)', 'number', draft.fx_rate, true)}</div>
        <div>${field('f_fxsrc', 'ที่มาของอัตรา', 'select', draft.fx_source, true, [['BOT', 'BOT ณ วันที่ใช้จ่าย'], ['CARD', 'ตาม Statement บัตรเครดิต']])}</div>
      </div>
      <p class="hint">ต้องแนบไฟล์ Memo ขออนุมัติเดินทางต่างประเทศ ในหัวข้อ "ไฟล์แนบของใบเบิก" หลังยื่น${['ENTERTAIN', 'GIFT'].includes(c) ? ' · เลี้ยงลูกค้าที่ไม่ลง Job จะรวมในใบสรุปต่างประเทศ ไม่ทำบันทึกเลี้ยงรับรอง' : ''}</p>`;
    }
    const auto = c === 'GAS' || draft.is_overseas || lump;
    html += `<label for="f_amt">จำนวนเงิน (บาท) <span class="req">*</span></label>
      <input id="f_amt" type="number" inputmode="decimal" step="any" value="${esc(draft.amount_thb)}" ${auto ? 'readonly' : ''}>
      ${auto ? '<p class="hint">ระบบคำนวณให้อัตโนมัติ</p>' : ''}`;
    body.innerHTML = html;
    renderFiles();
    recalc();
    warn();
  }

  function renderFiles() {
    const n = itemNeeds(draft);
    const slots = [['receipt', 'รูปใบเสร็จ / ใบกำกับภาษี', true]];
    if (n.proof) slots.push(['payment_proof', draft.details.pay === 'easypass' ? 'Statement Easy Pass / M-Flow' : 'หลักฐานการจ่าย (สลิปโอน / Statement บัตร)', true]);
    if (n.map) slots.push(['map', 'แผนที่เส้นทาง (Google Maps)', true]);
    slots.push(['other', 'ไฟล์อื่นๆ (ถ้ามี)', false]);
    filesBox.innerHTML = '<h3>แนบไฟล์</h3>' + slots.map(([k, l, req]) => `
      <label for="file_${k}">${esc(l)}${req ? ' <span class="req">*</span>' : ''}${have(k) ? ' <span class="chip ok">แนบแล้ว</span>' : ''}</label>
      <input id="file_${k}" data-kind="${k}" type="file" accept="image/*,application/pdf" multiple>
      ${picked[k] && picked[k].length ? `<p class="hint">เลือกไว้ ${picked[k].length} ไฟล์</p>` : ''}`).join('')
      + (n.substituteForm ? '<p class="hint">ระบบจะพิมพ์ใบรับรองแทนใบเสร็จให้ในชุดเอกสาร</p>' : '');
    filesBox.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', () => {
      picked[inp.dataset.kind] = Array.from(inp.files || []);
    }));
  }

  const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const checked = (id) => { const el = document.getElementById(id); return el ? el.checked : undefined; };

  function readForm() {
    draft.category_code = val('f_cat') ?? draft.category_code;
    draft.gl_code = val('f_gl') ?? draft.gl_code;
    draft.description = val('f_desc') ?? '';
    draft.receipt_date = val('f_rdate') ?? '';
    draft.receipt_no = val('f_rno') ?? '';
    draft.receipt_type = val('f_rtype') ?? draft.receipt_type;
    draft.details.pay = val('f_pay') ?? draft.details.pay;
    if (checked('f_company') !== undefined) draft.details.company_ok = checked('f_company');
    if (checked('f_lump') !== undefined) draft.details.lump = checked('f_lump');
    const ovs = checked('f_ovs');
    draft.is_overseas = ovs === undefined ? false : ovs;
    if (document.getElementById('f_cur')) {
      draft.currency = (val('f_cur') || '').trim().toUpperCase();
      draft.amount_foreign = val('f_famt');
      draft.fx_rate = val('f_rate');
      draft.fx_source = val('f_fxsrc');
    }
    draft.amount_thb = val('f_amt') ?? draft.amount_thb;
    detailFields(draft.category_code).forEach(([k]) => { const v = val('d_' + k); if (v !== undefined) draft.details[k] = v; });
    ['car_plate', 'lump_total', 'lump_months'].forEach((k) => { const v = val('d_' + k); if (v !== undefined) draft.details[k] = v; });
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
    } else if (draft.category_code === 'FITNESS' && checked('f_lump')) {
      const tot = num(val('d_lump_total')); const m = num(val('d_lump_months'));
      amt.value = tot && m ? round2(tot / m) : '';
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
    const lump = checked('f_lump');
    if (cat && cat.max_per_receipt && amt && amt > Number(cat.max_per_receipt)) {
      out.push(`${cat.name}: ใบเสร็จเกิน ${money(cat.max_per_receipt)} บาท ต้องแจ้งหัวหน้าและบัญชีถึงสาเหตุก่อน`);
    }
    if (rdate && monthStart(rdate) !== claim.claim_month && !checked('f_ovs') && !lump) {
      out.push(`วันที่ใบเสร็จไม่อยู่ในเดือน${monthLabel(claim.claim_month)} — ต้องเบิกในเดือนของใบเสร็จ`);
    }
    if (val('f_pay') === 'cash' && val('f_rtype') !== 'tax_invoice') {
      out.push('จ่ายเงินสดต้องมีใบกำกับภาษีเต็มรูปเท่านั้น ถ้าไม่มีจะเบิกไม่ได้ (ติดต่อบัญชี)');
    }
    if (amt && amt > 10000) out.push('รายการนี้เกิน 10,000 บาท ต้องให้ CEO เซนอนุมัติในเอกสาร');
    document.getElementById('ifWarn').innerHTML = out.map((m) => `<div class="note warn">${esc(m)}</div>`).join('');
  }

  render();

  body.addEventListener('change', (e) => {
    const id = e.target.id;
    if (['f_cat', 'f_ovs', 'f_rtype', 'f_pay', 'f_lump'].includes(id)) {
      readForm();
      if (id === 'f_cat' && draft.category_code === 'GAS' && !draft.details.car_plate) draft.details.car_plate = (D.emp && D.emp.car_plate) || '';
      render();
    } else {
      warn();
    }
  });
  body.addEventListener('input', () => { recalc(); warn(); });
  body.addEventListener('click', (e) => {
    if (e.target.id === 'addTrip') { readForm(); draft.details.trips.push({}); render(); }
    if (e.target.dataset.rmtrip !== undefined) { readForm(); draft.details.trips.splice(Number(e.target.dataset.rmtrip), 1); render(); }
  });

  document.getElementById('ifCancel').addEventListener('click', () => {
    box.innerHTML = '';
    if (addBtn) addBtn.hidden = false;
  });

  document.getElementById('ifSave').addEventListener('click', async (e) => {
    readForm();
    recalc();
    draft.amount_thb = val('f_amt');
    const c = draft.category_code;
    const cat = catOf(c);
    const n = itemNeeds(draft);
    const problems = [];
    if (!c) problems.push('ประเภทค่าใช้จ่าย');
    if (!draft.description.trim()) problems.push('รายละเอียด');
    if (!draft.receipt_date) problems.push('วันที่ในใบเสร็จ');
    const amount = num(draft.amount_thb);
    if (!amount || amount <= 0) problems.push('จำนวนเงิน');
    if (cat && cat.gl_required && !cat.gl_locked && !(draft.is_overseas && OVERSEAS_TRAVEL.includes(c)) && !draft.gl_code) problems.push('GL Code');
    if (n.company && !draft.details.company_ok) problems.push('ยืนยันใบเสร็จในนามบริษัท');
    detailFields(c).forEach(([, l, , req], i) => {
      const k = detailFields(c)[i][0];
      if (req && !String(draft.details[k] ?? '').trim()) problems.push(l);
    });
    if (c === 'GAS') {
      if (!['tax_invoice', 'e_tax'].includes(draft.receipt_type)) problems.push('ค่าน้ำมันต้องเป็นใบกำกับภาษีเต็มรูป');
      if (!draft.details.trips.length) problems.push('เที่ยวรถอย่างน้อย 1 เที่ยว');
      draft.details.trips.forEach((t, i) => { if (!t.date || !t.purpose || !t.km) problems.push(`เที่ยวที่ ${i + 1}: วันที่ / เพื่อปฏิบัติงาน / ระยะทาง`); });
    }
    if (c === 'FITNESS' && draft.details.lump && (!num(draft.details.lump_total) || !num(draft.details.lump_months) || !draft.receipt_no.trim())) {
      problems.push('ยอดก้อน / จำนวนเดือน / เลขที่ใบเสร็จ');
    }
    if (draft.details.pay === 'cash' && draft.receipt_type !== 'tax_invoice') problems.push('จ่ายเงินสดต้องเป็นใบกำกับภาษีเต็มรูป');
    if (draft.is_overseas && (!draft.currency || !num(draft.amount_foreign) || !num(draft.fx_rate))) problems.push('สกุลเงิน ยอดเงิน และอัตราแลกเปลี่ยน');
    const need = (k) => !have(k) && !(picked[k] && picked[k].length);
    if (need('receipt')) problems.push('รูปใบเสร็จ');
    if (n.proof && need('payment_proof')) problems.push('หลักฐานการจ่าย');
    if (n.map && need('map')) problems.push('แผนที่เส้นทาง');
    if (problems.length) {
      document.getElementById('ifWarn').innerHTML = `<div class="note err">กรุณากรอก / แนบ: ${esc(problems.join(', '))}</div>`;
      return;
    }

    const keep = new Set([...detailFields(c).map((f) => f[0]), 'pay', 'company_ok']);
    if (c === 'GAS') { keep.add('trips'); keep.add('car_plate'); }
    if (c === 'FITNESS' && draft.details.lump) { keep.add('lump'); keep.add('lump_total'); keep.add('lump_months'); }
    const details = {};
    Object.keys(draft.details).forEach((k) => { if (keep.has(k)) details[k] = draft.details[k]; });
    if (c === 'GIFT') details.kind = 'อื่นๆ';

    const payload = {
      claim_id: claim.id,
      category_code: c,
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
      const jobs = [];
      Object.entries(picked).forEach(([kind, files]) => (files || []).forEach((f) => jobs.push([kind, f])));
      for (let i = 0; i < jobs.length; i++) {
        btn.textContent = `กำลังอัปโหลดไฟล์ ${i + 1}/${jobs.length}…`;
        await uploadFile(claim, itemId, jobs[i][1], jobs[i][0], i);
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

async function uploadFile(claim, itemId, file, kind, idx) {
  const f = await shrinkImage(file);
  if (f.size > 10 * 1024 * 1024) throw new Error(`ไฟล์ ${file.name} ใหญ่เกิน 10 MB`);
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
  const ext = extMap[f.type] || (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  // เก็บในโฟลเดอร์ของเจ้าของใบเบิก (ผู้ทำแทนอัปโหลดได้)
  const path = `${claim.employee_id}/${claim.id}/${itemId || 'claim'}-${Date.now()}-${idx}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
  if (up.error) throw new Error(`อัปโหลด ${file.name} ไม่สำเร็จ: ${up.error.message}`);
  const { error } = await sb.from('attachments').insert({
    claim_id: claim.id, item_id: itemId, kind, file_path: path, file_name: file.name.slice(0, 200),
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
  let cancelled = '';
  if (['svp', 'admin'].includes(S.profile.role)) {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data: cx } = await sb.from('claims')
      .select('id, ref_no, total_amount, cancel_reason, updated_at, employee:profiles!claims_employee_id_fkey(full_name)')
      .eq('status', 'cancelled').neq('employee_id', S.profile.id).gte('updated_at', since)
      .order('updated_at', { ascending: false }).limit(20);
    if (cx && cx.length) {
      cancelled = `<h2>ใบที่ถูกยกเลิก (14 วันล่าสุด)</h2><section class="panel"><ul class="list">${cx.map((c) => `
        <li><a href="#/claim/${c.id}"><span><b>${esc(c.employee ? c.employee.full_name : '-')}</b></span>
          <span class="amt">${money(c.total_amount)}</span>
          <span class="small muted"><span class="ref">${esc(c.ref_no)}</span> เหตุผล: ${esc(c.cancel_reason || '-')}</span>
          <span>${chip('cancelled')}</span></a></li>`).join('')}</ul></section>`;
    }
  }
  $app.innerHTML = `<h1>${S.profile.role === 'admin' ? 'ใบเบิกที่ค้างอยู่' : 'รอดำเนินการ'}</h1>${groups}${cancelled}
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

const MEMO_TOPIC = { ENTERTAIN: 'ค่าเลี้ยงรับรอง', GAS: 'ค่าน้ำมัน', PHONE: 'ค่าโทรศัพท์', PARKING: 'ค่าที่จอดรถ', EXPRESSWAY: 'ค่าทางด่วน' };

// โครงตามไฟล์ Memo ต้นฉบับ: หัว MEMORANDUM / To-CC-From-Date-Subject / 1–4 / ตารางลงนาม 4 ช่อง
function memoDocHTML(m, emp, forPrint, sigs) {
  sigs = sigs || {};
  const st = S.settings || {};
  const topic = m.topic || MEMO_TOPIC[m.memo_kind] || (m.subject || '').replace(/^ขออนุมัติ/, '').replace(/เกินวงเงิน$/, '');
  const box = (on) => `<span class="mbox">${on ? '✓' : ''}</span>`;
  const mark = (at, label, url) => `${at && url ? `<img class="sig-img" src="${esc(url)}" alt="">` : ''}${at
    ? `<div class="sig-mark">✓ ${label}<br><span>${esc(label === 'ยื่นออนไลน์' ? fmtDate(at) : fmtDateTime(at))}</span></div>`
    : (m.status === 'draft' || forPrint ? '' : '<div class="sig-mark"><span class="muted">รออนุมัติ</span></div>')}`;
  const submitted = m.status !== 'draft' ? m.memo_date : null;
  return `<article class="memo-doc">
    <table class="memo-head">
      <tr class="memo-top"><td class="logo"><img src="${esc(new URL('sino-logo.png', location.href).href)}" alt="SINO Logistics Corporation"></td>
        <td class="memo-id"><div class="memo-title">MEMORANDUM</div><div class="memo-no">No. ${esc(m.memo_no || '(ออกเลขเมื่อยื่นเบิก)')}</div></td></tr>
      <tr><th>To:</th><td>${esc(m.to_name || st.memo_to_name || '')}</td></tr>
      <tr><th>CC:</th><td>${esc(m.cc || '-')}</td></tr>
      <tr><th>From:</th><td>${esc(m.from_name || emp.name_en || emp.full_name || '')}</td></tr>
      <tr><th>Date:</th><td>${m.memo_date ? memoDate(m.memo_date) : '(วันที่ยื่น)'}</td></tr>
      <tr><th>Subject:</th><td>${esc(m.subject)}</td></tr>
    </table>

    <div class="memo-sec"><b>1. Background:</b></div>
    <p class="memo-body">${esc(m.background || '')}</p>

    <div class="memo-sec"><b>2. Requests &amp; Reasons:</b></div>
    <p class="memo-body">จากที่กล่าวข้างต้น จึงขออนุมัติงบประมาณใช้จ่ายสำหรับ${esc(topic)}ที่เกินจาก Budget อีกจำนวน ทั้งสิ้น ${money(m.amount_requested)}&nbsp; บาท${m.request_text ? ' ' + esc(m.request_text) : ''}</p>
    <p class="memo-body">We request your approval for ขออนุมัติงบประมาณใช้จ่าย เกินวงเงิน.</p>

    <table class="memo-budget">
      <tr><th>3. Budget:</th><td>${box(m.budget_flag === 'budgeted')} Budgeted</td><td>${box(m.budget_flag !== 'budgeted')} Unbudgeted</td>
        <td>Account Code:</td><td>${esc(m.account_code || '')}&nbsp;&nbsp; ${esc(m.cost_center || '')}</td></tr>
      <tr><td>Budget Approved</td><td colspan="2">THB ${money(m.budget_approved)} บาท</td><td>Budget Available:</td><td>${money(m.budget_available)}</td></tr>
      <tr><td>Budget Requested</td><td colspan="2">THB ${money(m.amount_requested)} บาท</td><td>Budget Remaining:</td><td>-</td></tr>
    </table>

    <p class="memo-sec"><b>4. Recommendation:</b> ${esc(m.recommendation || 'It is our recommendation to approve')}</p>

    <table class="memo-sign">
      <tr><th>Prepared by:</th><th>Vetted by:</th><th>Supported by:</th><th>Approved by:</th></tr>
      <tr class="sig-row">
        <td>${mark(submitted, 'ยื่นออนไลน์', sigs.emp)}</td>
        <td>${mark(m.vetted_at, 'อนุมัติออนไลน์', sigs.svp)}</td>
        <td>${mark(m.supported_at, 'อนุมัติออนไลน์')}</td>
        <td>${mark(m.approved_at, 'อนุมัติออนไลน์')}</td>
      </tr>
      <tr class="name-row">
        <td>${esc(m.prepared_name || emp.name_en || emp.full_name || '')}</td>
        <td>${esc(m.vetted_name || '')}</td>
        <td>${esc(st.memo_supported_name || m.supported_name || '')}</td>
        <td>${esc(st.memo_approved_name || m.approved_name || '')}</td>
      </tr>
      <tr class="title-row">
        <td>${esc(m.prepared_title || emp.title_en || emp.position_title || '')}</td>
        <td>${esc(m.vetted_title || 'SVP Sales')}</td>
        <td>${esc(st.memo_supported_title || m.supported_title || '')}</td>
        <td>${esc(st.memo_approved_title || m.approved_title || '')}</td>
      </tr>
    </table>
  </article>`;
}

function printMemo(m, emp) {
  const w = window.open('', '_blank');
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up'); return; }
  const css = new URL('style.css?v=12', location.href).href;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>${esc(m.memo_no || 'Memo')}</title>
    <link href="${DOC_FONTS}" rel="stylesheet">
    <link rel="stylesheet" href="${css}"></head>
    <body class="print-page" onload="setTimeout(function(){window.print()},400)">${memoDocHTML(m, emp, true)}</body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------------
// ข้อมูลของฉัน + ลายเซ็น
// ---------------------------------------------------------------------
const SIG_BUCKET = 'signatures';
const sigPath = (uid) => `${uid}/signature.png`;
const ROLE_LABEL = { employee: 'พนักงาน', svp: 'SVP (ผู้อนุมัติ)', ceo: 'CEO', hr: 'HR', accounting: 'บัญชี', admin: 'Admin' };

// ทำพื้นขาวให้โปร่งใส + ตัดขอบว่าง แล้วคืนเป็น PNG
async function canvasToSignaturePng(src, removeWhite) {
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const px = img.data;
  let minX = cv.width, minY = cv.height, maxX = -1, maxY = -1;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (removeWhite) {
        const light = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (light > 185) px[i + 3] = 0;
        else { px[i] = Math.min(px[i], 40); px[i + 1] = Math.min(px[i + 1], 50); px[i + 2] = Math.min(px[i + 2], 110); px[i + 3] = 255; }
      }
      if (px[i + 3] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;   // ไม่มีเส้นลายเซ็น
  ctx.putImageData(img, 0, 0);
  const pad = 8;
  const w = Math.min(cv.width, maxX - minX + pad * 2);
  const h = Math.min(cv.height, maxY - minY + pad * 2);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(cv, Math.max(0, minX - pad), Math.max(0, minY - pad), w, h, 0, 0, w, h);
  return new Promise((r) => out.toBlob(r, 'image/png'));
}

async function saveSignature(blob) {
  if (!blob) { toast('ไม่พบลายเซ็นในภาพ ลองใหม่อีกครั้ง'); return false; }
  const { error } = await sb.storage.from(SIG_BUCKET).upload(sigPath(S.profile.id), blob,
    { contentType: 'image/png', upsert: true, cacheControl: '0' });
  if (error) { toast('บันทึกลายเซ็นไม่สำเร็จ: ' + error.message); return false; }
  toast('บันทึกลายเซ็นแล้ว');
  return true;
}

async function viewMe() {
  const p = S.profile;
  $app.innerHTML = `<p class="muted center pad">กำลังโหลด…</p>`;
  const { data } = await sb.storage.from(SIG_BUCKET).createSignedUrl(sigPath(p.id), 600);
  const url = data && data.signedUrl;
  const lv = S.refs.levels[p.level_code];
  $app.innerHTML = `
    <h1>ข้อมูลของฉัน</h1>
    <section class="panel small">
      <div><b>${esc(p.full_name || '-')}</b> ${p.name_en ? `<span class="muted">(${esc(p.name_en)})</span>` : ''}</div>
      <div class="muted">รหัส ${esc(p.emp_code || '-')} · ${esc(p.position_title || '-')} · ${esc(lv ? lv.name : 'ยังไม่กำหนดระดับ')}</div>
      <div class="muted">สิทธิ์ในระบบ: ${esc(ROLE_LABEL[p.role] || p.role)}${p.is_fhr ? ' + SVP Finance & HR' : ''}</div>
      <p class="hint">ถ้าข้อมูลไม่ถูกต้อง แจ้ง admin ให้แก้ไข</p>
    </section>

    <h2>ลายเซ็น</h2>
    <section class="panel">
      <p class="hint" style="margin-top:0">ลายเซ็นจะถูกใส่ในเอกสารที่ดาวน์โหลด <b>เฉพาะขั้นที่คุณยื่นหรืออนุมัติในระบบแล้วเท่านั้น</b></p>
      <div class="sig-preview">${url ? `<img src="${esc(url)}" alt="ลายเซ็นปัจจุบัน">` : '<span class="muted">ยังไม่มีลายเซ็น</span>'}</div>

      <h3>วิธีที่ 1: เซ็นบนหน้าจอ</h3>
      <canvas id="pad" class="sig-pad" width="600" height="220" aria-label="ช่องเซ็นชื่อ"></canvas>
      <div class="actions">
        <button class="btn ghost" type="button" id="padClear">ล้าง</button>
        <button class="btn" type="button" id="padSave">บันทึกลายเซ็นนี้</button>
      </div>

      <h3>วิธีที่ 2: อัปโหลดรูปลายเซ็น</h3>
      <p class="hint">เซ็นบนกระดาษขาวด้วยปากกาสีเข้ม แล้วถ่ายรูปให้ชัด ระบบจะลบพื้นหลังขาวและตัดขอบให้อัตโนมัติ</p>
      <input id="sigFile" type="file" accept="image/*">
      <div class="actions">
        <button class="btn ghost" type="button" id="sigUpload">อัปโหลดรูปนี้</button>
        ${url ? '<button class="btn danger" type="button" id="sigDelete">ลบลายเซ็น</button>' : ''}
      </div>
    </section>`;

  // ช่องเซ็นบนหน้าจอ
  const pad = document.getElementById('pad');
  const ctx = pad.getContext('2d');
  ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13235b';
  let drawing = false; let drawn = false;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; drawn = true; pad.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
  const stop = () => { drawing = false; };
  pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);
  document.getElementById('padClear').addEventListener('click', () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; });
  document.getElementById('padSave').addEventListener('click', async (e) => {
    if (!drawn) { toast('กรุณาเซ็นในช่องก่อน'); return; }
    e.target.disabled = true;
    if (await saveSignature(await canvasToSignaturePng(pad, false))) viewMe(); else e.target.disabled = false;
  });

  document.getElementById('sigUpload').addEventListener('click', async (e) => {
    const f = document.getElementById('sigFile').files[0];
    if (!f) { toast('เลือกรูปลายเซ็นก่อน'); return; }
    e.target.disabled = true;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 900 / bmp.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      if (await saveSignature(await canvasToSignaturePng(cv, true))) { viewMe(); return; }
    } catch (_) {
      toast('อ่านรูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG');
    }
    e.target.disabled = false;
  });

  const del = document.getElementById('sigDelete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('ลบลายเซ็นของคุณ?')) return;
    const { error } = await sb.storage.from(SIG_BUCKET).remove([sigPath(p.id)]);
    if (error) toast(errMsg(error)); else { toast('ลบลายเซ็นแล้ว'); viewMe(); }
  });
}

init();
