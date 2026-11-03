// =====================================================================
// SINO ทำเบิกออนไลน์ — เอกสารสำหรับพิมพ์ / ดาวน์โหลด PDF
// หน้าตาตามแบบฟอร์มเดิมของบริษัท:
//   1) CHEQUE / CASH REQUISITION (ใบเบิกสรุปยอดเงินโอน)
//   2) บันทึกขออนุมัติเลี้ยงรับรอง (ต่อรายการ Entertain)
//   3) แบบขอเบิกเงินชดเชยกรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงาน (Ent-Gas)
//   4) ใบรับรองแทนใบเสร็จรับเงิน (รายการที่ใช้ใบรับรองแทน)
//   5) MEMORANDUM (ถ้ามี)
// ใช้ฟังก์ชันช่วยจาก app.js (esc, money, monthLabel, catOf, memoDocHTML)
// ลายเซ็น: ใส่ของพนักงานเมื่อยื่นแล้ว และของ SVP เมื่ออนุมัติในระบบแล้วเท่านั้น
// =====================================================================
'use strict';

const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const bkkDate = (ts) => (ts ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(ts)) : '');

const COMPANY_HEAD = `
  <div class="doc-letterhead">
    <div class="lh-logo">SINO<small>LOGISTICS CORPORATION</small></div>
    <div class="lh-text">
      <b>SINO Logistics Corporation Public Company Limited</b><br>
      1011 Supalai Grand Tower 7th Floor Unit 05, Rama 3 Road, Chongnonsee, Yannawa, Bangkok, 10120 Thailand<br>
      บริษัท ไซโน โลจิสติกส์ คอร์ปอเรชั่น จำกัด (มหาชน)<br>
      1011 อาคารศุภาลัยแกรนด์ ทาวเวอร์ ชั้น 7 ยูนิต 05 ถนนพระรามสาม แขวงช่องนนทรี เขตยานนาวา กทม. 10120
    </div>
  </div>`;

const fill = (v, cls) => `<span class="fill ${cls || ''}">${esc(v ?? '') || '&nbsp;'}</span>`;
const sigImg = (url) => (url ? `<img class="sig-img" src="${esc(url)}" alt="">` : '');
const sigLine = (url, cls) => `<span class="fill ${cls || 'w40'} sigfill">${sigImg(url) || '&nbsp;'}</span>`;
const onlineMark = (ts) => (ts ? `<div class="online">✓ อนุมัติออนไลน์ ${esc(dmy(bkkDate(ts)))}</div>` : '');

// 1) ใบเบิกสรุปยอดเงินโอน
function docRequisition(D, budgets, sig) {
  const { claim, emp, items } = D;
  const rows = items.map((it) => {
    const cat = catOf(it.category_code);
    const b = cat && cat.budget_type ? budgets[cat.budget_type] : null;
    return `<tr><td class="c">${it.line_no}</td><td>${esc(it.description)}</td>
      <td class="r">THB ${money(it.amount_thb)}</td><td></td>
      <td class="r">${b != null ? money(b) : ''}</td><td></td></tr>`;
  });
  while (rows.length < 8) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>');
  return `<section class="doc-page doc-req">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)}</div>
    <p class="c b">SINO LOGISTICS CORPORATION&nbsp; PUBLIC COMPANY LIMITED</p>
    <p class="c b">CHEQUE / CASH REQUISITION</p>
    <p class="r"><b>DATE</b> ${fill(dmy(bkkDate(claim.submitted_at)))}</p>
    <p><b>PAY TO</b> ${fill(claim.pay_to || emp.full_name, 'w60')}</p>
    <p><b>PROJECT</b> ${fill(claim.project || '', 'w60')}</p>
    <table class="grid req-items">
      <colgroup><col style="width:10%"><col style="width:46%"><col style="width:17%"><col style="width:3%"><col style="width:12%"><col style="width:12%"></colgroup>
      <tr><th>ITEM</th><th>DESCRIPTION</th><th>AMOUNT (BAHT)</th><th></th><th>BUDGET</th><th>APPROVE</th></tr>
      ${rows.join('')}
      <tr><td></td><td class="r b">TOTAL</td><td class="r b">THB ${money(claim.total_amount)}</td><td></td><td></td><td></td></tr>
    </table>
    <table class="grid req-sign">
      <tr><th>REQUEST BY / DATE</th><th>APPROVE BY /DATE</th><th>PAY BY /DATE</th><th>RECEIVE BY DATE</th></tr>
      <tr>
        <td><div class="sig-space">${sigImg(sig.emp)}</div>${esc(emp.full_name || '')}<br><small>${esc(dmy(bkkDate(claim.submitted_at)))}</small></td>
        <td><div class="sig-space">${sigImg(sig.svp)}${onlineMark(claim.approved_at)}</div>${esc(claim.approved_name || '')}<br><small>${esc(dmy(bkkDate(claim.approved_at)))}</small></td>
        <td><div class="sig-space"></div></td>
        <td><div class="sig-space"></div></td>
      </tr>
    </table>
  </section>`;
}

// 2) บันทึกขออนุมัติเลี้ยงรับรอง
function docEntertain(D, it, sig) {
  const { claim, emp } = D;
  const d = it.details || {};
  const sub = bkkDate(claim.submitted_at);
  const [y, m, dd] = sub ? sub.split('-') : ['', '', ''];
  const box = (label) => `<span class="box">${d.kind === label ? 'x' : '&nbsp;'}</span> ${label}`;
  const ceo = Number(it.amount_thb) > 10000;
  return `<section class="doc-page doc-ent">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)} / รายการที่ ${it.line_no}</div>
    ${COMPANY_HEAD}
    <h2 class="c">บันทึกขออนุมัติเลี้ยงรับรอง</h2>
    <p class="r">วันที่ ${fill(dd, 'w8')} / ${fill(m, 'w8')} / ${fill(y, 'w12')}</p>
    <p>เรื่อง&nbsp; ขออนุมัติเงินค่าเลี้ยงรับรอง</p>
    <p>เรียน&nbsp; กรรมการผู้จัดการ/กรรมการ</p>
    <p class="gap">ด้วยข้าพเจ้า ${fill(emp.name_en || emp.full_name, 'w45')} มีความประสงค์ขออนุมัติเงินค่าเลี้ยงรับรอง ดังรายละเอียดต่อไปนี้</p>
    <p class="boxes">${box('อาหารและเครื่องดื่ม')}&emsp;&emsp;${box('ที่พัก')}&emsp;&emsp;${box('อื่นๆ')}</p>
    <p>ที่ ${fill(d.venue, 'w45')} เพื่อรับรองคุณ ${fill(d.guest_name, 'w30')}</p>
    <p>บริษัท ${fill(d.guest_company, 'w45')} มาจาก ${fill(d.guest_from, 'w30')}</p>
    <p>ประเทศ ${fill(d.country, 'w45')} Ref. Job # ${fill(d.job_ref, 'w30')}</p>
    <p class="ind">วัตถุประสงค์ในการเลี้ยงรับรอง ${fill(d.purpose, 'w60')}</p>
    <p>ในวันที่ ${fill(dmy(d.event_date), 'w20')}</p>
    <p class="ind">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติเงินค่าเลี้ยงรับรองจำนวน ${fill(money(it.amount_thb), 'w20')} บาท</p>
    <div class="sign-block">
      <p>ลงชื่อ ${sigLine(sig.emp)} ผู้ขออนุมัติ</p>
      <p>( ${fill(emp.name_en || emp.full_name, 'w40')} )</p>
      <p>ตำแหน่ง ${fill(emp.title_en || emp.position_title, 'w40')}</p>
    </div>
    <hr class="thick">
    <div class="sign-block">
      ${!ceo ? onlineMark(claim.approved_at) : ''}
      <p>ลงชื่อ ${sigLine(ceo ? null : sig.svp)} ผู้อนุมัติ</p>
      <p>( ${fill(ceo ? '' : claim.approved_name, 'w40')} )</p>
      <p>ตำแหน่ง ${fill(ceo ? 'CEO' : claim.approved_title, 'w40')}</p>
    </div>
  </section>`;
}

// 3) แบบขอเบิกเงินชดเชยกรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงาน
function docGas(D, gasItems, sig) {
  const { claim, emp } = D;
  const trips = gasItems.flatMap((it) => (it.details && it.details.trips) || []);
  const plate = (gasItems.find((it) => it.details && it.details.car_plate) || { details: {} }).details.car_plate;
  const [cy] = claim.claim_month.split('-').map(Number);
  const fuel = trips.reduce((s, t) => s + (num(t.fuel) || 0), 0);
  const km = trips.reduce((s, t) => s + (num(t.km) || 0), 0);
  const rows = trips.map((t) => `<tr><td class="c">${esc(dmy(t.date))}</td><td class="r">${t.fuel ? money(t.fuel) : ''}</td>
    <td class="r">${esc(t.liters || '')}</td><td>${esc(t.purpose || '')}</td><td>${esc(t.out_from || '')}</td><td>${esc(t.out_to || '')}</td>
    <td>${esc(t.back_from || '')}</td><td>${esc(t.back_to || '')}</td><td class="r">${esc(t.km || '')}</td></tr>`);
  while (rows.length < 10) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  return `<section class="doc-page doc-gas">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)}</div>
    <p class="r small">SINO Logistics Corporation Public Company Limited 1011 Supalai Grand Tower 7th Floor Unit 05, Rama 3 Road, Chongnonsee, Yannawa, Bangkok, 10120 Thailand</p>
    <h2 class="c">แบบขอเบิกเงินชดเชยกรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงาน</h2>
    <p>งวดประจำเดือน ${fill(monthLabel(claim.claim_month), 'w20')}&emsp;ปี พ.ศ. ${fill(cy + 543, 'w10')}&emsp;เลขทะเบียนรถ ${fill(plate, 'w15')}</p>
    <p>เรียน&nbsp; ผู้บังคับบัญชา</p>
    <p>ชื่อ-สกุล : ${fill(emp.full_name, 'w30')}&emsp;รหัสพนักงาน : ${fill(emp.emp_code, 'w10')}&emsp;ตำแหน่ง : ${fill(emp.position_title, 'w20')}</p>
    <p>ฝ่าย : ${fill(emp.department, 'w20')}&emsp;แผนก : ${fill(emp.department, 'w20')}&emsp;บริษัท : ${fill(emp.company, 'w30')}</p>
    <p class="ind">มีความประสงค์ ขอเบิกเงินชดเชย กรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงานตามรายละเอียด ดังนี้</p>
    <table class="grid gas-table">
      <tr><th rowspan="2">วัน เดือน ปี</th><th rowspan="2">ค่าน้ำมัน (บาท)</th><th rowspan="2">จำนวน (ลิตร)</th>
        <th rowspan="2">เพื่อปฏิบัติงาน (ระบุจังหวัด / บริษัท)</th><th colspan="2">เที่ยวไป (ระบุสถานที่)</th>
        <th colspan="2">เที่ยวกลับ (ระบุสถานที่)</th><th>ระยะทางรวม</th></tr>
      <tr><th>เริ่มต้น</th><th>สิ้นสุด</th><th>เริ่มต้น</th><th>สิ้นสุด</th><th>(กิโลเมตร)</th></tr>
      ${rows.join('')}
      <tr><td class="b">Total</td><td class="r b">${money(fuel)}</td><td colspan="6" class="r b">ระยะทางรวม (กิโลเมตร)</td><td class="r b">${km || ''}</td></tr>
    </table>
    <p>หมายเหตุ : ${fill('', 'w60')}</p>
    <table class="gas-foot"><tr>
      <td class="hr-box"><b>สำหรับ HR Share Service</b><br>วันที่รับเอกสาร ...............................<br>บันทึกเพิ่มเติม ..............................................<br>หมายเหตุ :</td>
      <td>
        <p>พนักงานผู้ขอเบิก ${sigLine(sig.emp, 'w40')}</p>
        <p class="c">( ${esc(emp.full_name || '')} )</p>
        <p class="c">วันที่ ${esc(dmy(bkkDate(claim.submitted_at)))}</p>
        <p style="margin-top:18px">ผู้มีอำนาจอนุมัติ ..........................................</p>
        <p class="c">(กรรมการผู้จัดการ)&emsp;(.................................)</p>
        <p class="c">วันที่ ............... / ............ / ..............</p>
      </td></tr></table>
  </section>`;
}

// 4) ใบรับรองแทนใบเสร็จรับเงิน
function docSubstitute(D, subItems, sig) {
  const { claim, emp } = D;
  const total = subItems.reduce((s, it) => s + Number(it.amount_thb), 0);
  const dates = subItems.map((it) => it.receipt_date).filter(Boolean).sort();
  const rows = subItems.map((it) => `<tr><td class="c">${esc(dmy(it.receipt_date))}</td><td>${esc(it.description)}</td>
    <td class="r">${money(it.amount_thb)}</td><td>${esc(it.receipt_no || '')}</td></tr>`);
  while (rows.length < 12) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>');
  return `<section class="doc-page doc-sub">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)}</div>
    ${COMPANY_HEAD}
    <h2 class="c">ใบรับรองแทนใบเสร็จรับเงิน</h2>
    <p>ร้าน ${fill('', 'w60')} (ผู้ซื้อ/ผู้ให้บริการ)</p>
    <table class="grid">
      <colgroup><col style="width:16%"><col style="width:52%"><col style="width:16%"><col style="width:16%"></colgroup>
      <tr><th>วัน เดือน ปี</th><th>รายละเอียดรายจ่าย</th><th>จำนวนเงิน</th><th>หมายเหตุ</th></tr>
      ${rows.join('')}
      <tr><td colspan="2" class="r b">รวมทั้งสิ้น</td><td class="r b">${money(total)}</td><td></td></tr>
    </table>
    <p>ข้าพเจ้า ${fill(emp.full_name, 'w30')} (ผู้เบิกจ่าย)&emsp;ตำแหน่ง ${fill(emp.position_title, 'w20')}</p>
    <p>ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และข้าพเจ้าได้จ่ายไปในงานของทาง
      บริษัท โดยแท้ ตั้งแต่วันที่ ${fill(dmy(dates[0]), 'w15')} ถึงวันที่ ${fill(dmy(dates[dates.length - 1]), 'w15')}</p>
    <div class="sign-block">
      <p>ลงชื่อ ${sigLine(sig.emp)} (ผู้เบิกจ่าย)</p><p>( ${fill(emp.full_name, 'w40')} )</p>
      <p style="margin-top:24px">ลงชื่อ ${sigLine(sig.svp)} (ผู้อนุมัติ)</p><p>( ${fill(claim.approved_name, 'w40')} )</p>
    </div>
  </section>`;
}

// รวมเอกสารทั้งหมดของใบเบิก แล้วเปิดหน้าพิมพ์
async function openClaimDocs(D) {
  const w = window.open('', '_blank');   // เปิดก่อน await เพื่อไม่ให้ถูกบล็อก pop-up
  if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up'); return; }
  w.document.write('<p style="font-family:sans-serif;padding:24px">กำลังเตรียมเอกสาร…</p>');

  const budgets = {};
  if (D.emp.level_code) {
    const { data } = await sb.from('budget_rules').select('*').eq('level_code', D.emp.level_code);
    (data || []).forEach((b) => { budgets[b.budget_type] = Number(b.monthly_amount); });
  }
  // ลายเซ็น (ถ้ามี): พนักงานเมื่อยื่นแล้ว / SVP เมื่ออนุมัติแล้ว
  const sig = { emp: null, svp: null };
  const want = [];
  if (D.claim.submitted_at) want.push(['emp', `${D.claim.employee_id}/signature.png`]);
  if (D.claim.approved_at && D.claim.approved_by) want.push(['svp', `${D.claim.approved_by}/signature.png`]);
  if (want.length) {
    const { data } = await sb.storage.from('signatures').createSignedUrls(want.map((x) => x[1]), 900);
    (data || []).forEach((r, i) => { if (r && r.signedUrl && !r.error) sig[want[i][0]] = r.signedUrl; });
  }

  const pages = [docRequisition(D, budgets, sig)];
  D.items.filter((it) => it.category_code === 'ENTERTAIN').forEach((it) => pages.push(docEntertain(D, it, sig)));
  const gas = D.items.filter((it) => it.category_code === 'GAS');
  if (gas.length) pages.push(docGas(D, gas, sig));
  const subs = D.items.filter((it) => it.receipt_type === 'substitute');
  if (subs.length) pages.push(docSubstitute(D, subs, sig));
  D.memos.forEach((m) => pages.push(`<section class="doc-page">${memoDocHTML(m, D.emp, true, sig)}</section>`));

  const css = new URL('style.css?v=6', location.href).href;
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(D.claim.ref_no)}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${css}"></head>
    <body class="print-page">
      <div class="print-bar">เอกสาร ${pages.length} หน้า · กด <b>พิมพ์</b> แล้วเลือก <b>บันทึกเป็น PDF / Save as PDF</b>
        <button onclick="window.print()">พิมพ์ / บันทึก PDF</button></div>
      ${pages.join('')}
    </body></html>`);
  w.document.close();
}
