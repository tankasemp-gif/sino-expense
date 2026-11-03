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

// จำนวนเงินเป็นตัวอักษรไทย เช่น 1,250.50 -> หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์
function bahtText(amount) {
  const D = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const read = (x, prefixed) => {
    let out = '';
    if (x >= 1e6) { out += read(Math.floor(x / 1e6), false) + 'ล้าน'; x %= 1e6; prefixed = true; }
    const s = String(x);
    for (let i = 0; i < s.length; i++) {
      const d = +s[i]; const pos = s.length - i - 1;
      if (!d || (x === 0)) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && (s.length > 1 || prefixed)) out += 'เอ็ด';
      else out += D[d] + P[pos];
    }
    return out;
  };
  const [b, st] = (Math.round(Number(amount || 0) * 100) / 100).toFixed(2).split('.').map(Number);
  return (b ? read(b, false) : 'ศูนย์') + 'บาท' + (st ? read(st, false) + 'สตางค์' : 'ถ้วน');
}

const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const bkkDate = (ts) => (ts ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(ts)) : '');

const LOGO_URL = () => new URL('sino-logo.png', location.href).href;
const DOC_FONTS = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&family=Carlito:wght@400;700&display=swap';
const companyHead = () => `
  <div class="doc-letterhead">
    <img class="lh-logo" src="${LOGO_URL()}" alt="SINO Logistics Corporation">
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
function docRequisition(D, items, budgets, sig) {
  const { claim, emp } = D;
  const total = items.reduce((t, it) => t + Number(it.amount_thb), 0);
  const ceo = total > 10000;                                   // ยอดรวมใบปะหน้าเกิน 10,000 → CEO เซน
  const welfare = items.some((it) => ['FITNESS', 'GLASSES'].includes(it.category_code));
  const rows = items.map((it, n) => {
    const cat = catOf(it.category_code);
    const b = cat && cat.budget_type ? budgets[cat.budget_type] : null;
    return `<tr><td class="c">${n + 1}</td><td>${esc(it.description)}</td>
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
    </table>
    <table class="grid req-sign">
      <tr><th>REQUEST BY / DATE</th><th>APPROVE BY /DATE</th><th>PAY BY /DATE</th><th>RECEIVE BY DATE</th></tr>
      <tr>
        <td><div class="sig-space">${sigImg(sig.emp)}</div>${esc(emp.full_name || '')}<br><small>${esc(dmy(bkkDate(claim.submitted_at)))}</small></td>
        <td>${ceo
          ? '<div class="sig-space"></div>(CEO)<br><small>&nbsp;</small>'
          : `<div class="sig-space">${sigImg(sig.svp)}${onlineMark(claim.approved_at)}</div>${esc(claim.approved_name || '')}<br><small>${esc(dmy(bkkDate(claim.approved_at)))}</small>`}
          ${welfare ? '<div class="hr-mini">HR ....................</div>' : ''}</td>
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
  const box = (kind, label) => `<span class="box">${d.kind === kind ? 'x' : '&nbsp;'}</span>&nbsp; ${label}`;
  const ceo = Number(it.amount_thb) > 10000;
  return `<section class="doc-page doc-ent">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)} / รายการที่ ${it.line_no}</div>
    ${companyHead()}
    <h2 class="c">บันทึกขออนุมัติเลี้ยงรับรอง</h2>
    <p class="r">วันที่ ${fill(dd, 'w8')} / ${fill(m, 'w8')} / ${fill(y, 'w12')}</p>
    <p>เรื่อง&nbsp; ขออนุมัติเงินค่าเลี้ยงรับรอง</p>
    <p>เรียน&nbsp; กรรมการผู้จัดการ/กรรมการ</p>
    <p class="gap">ด้วยข้าพเจ้า ${fill(emp.name_en || emp.full_name, 'w45')} มีความประสงค์ขออนุมัติเงินค่าเลี้ยงรับรอง ดังรายละเอียดต่อไปนี้</p>
    <p class="boxes">${box('อาหารและเครื่องดื่ม', 'ค่าอาหารและเครื่องดื่ม')}&emsp;&emsp;&emsp;${box('ที่พัก', 'ค่าที่พัก')}&emsp;&emsp;&emsp;${box('อื่นๆ', 'อื่นๆ')} ${fill(it.category_code === 'GIFT' ? 'ค่าของขวัญลูกค้า' : '', 'w30')}</p>
    <p>ที่ ${fill(d.venue, 'w45')} เพื่อรับรองคุณ ${fill(d.guest_name, 'w30')}</p>
    <p>บริษัท ${fill(d.guest_company, 'w45')} มาจาก ${fill(d.guest_from, 'w30')}</p>
    <p>ประเทศ ${fill(d.country, 'w45')} Ref. Job # ${fill(d.job_ref, 'w30')}</p>
    <p class="ind">วัตถุประสงค์ในการเลี้ยงรับรอง ${fill(d.purpose, 'w60')}</p>
    <p>ในวันที่ ${fill(dmy(d.event_date), 'w20')}</p>
    <p class="ind">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติเงินค่าเลี้ยงรับรองจำนวน ${fill(money(it.amount_thb), 'w20')} บาท</p>
    <div class="sign-block">
      <p>ลงชื่อ ${sigLine(sig.emp)} ผู้ขออนุมัติ</p>
      <p class="paren">( ${fill(emp.name_en || emp.full_name, 'w40')} )</p>
      <p>ตำแหน่ง ${fill(emp.title_en || emp.position_title, 'w40')}</p>
    </div>
    <hr class="thick">
    <div class="sign-block">
      ${!ceo ? onlineMark(claim.approved_at) : ''}
      <p>ลงชื่อ ${sigLine(ceo ? null : sig.svp)} ผู้อนุมัติ</p>
      <p class="paren">( ${fill(ceo ? '' : claim.approved_name, 'w40')} )</p>
      <p>ตำแหน่ง ${fill(ceo ? 'CEO' : (claim.approved_name ? claim.approved_title : ''), 'w40')}</p>
    </div>
  </section>`;
}

// 3) แบบขอเบิกเงินชดเชยกรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงาน (ตามแบบฟอร์ม Ent-Gas 2023)
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dMonYY = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d}-${EN_MON[+m - 1]}-${y.slice(2)}`; };
const thb = (n) => (n || n === 0 ? `THB${money(n)}` : '');

function docGas(D, gasItems, sig) {
  const { claim, emp } = D;
  const st = S.settings || {};
  const trips = gasItems.flatMap((it) => (it.details && it.details.trips) || []);
  const plate = (gasItems.find((it) => it.details && it.details.car_plate) || { details: {} }).details.car_plate;
  const [cy, cm] = claim.claim_month.split('-').map(Number);
  const fuel = trips.reduce((s, t) => s + (num(t.fuel) || 0), 0);
  const km = trips.reduce((s, t) => s + (num(t.km) || 0), 0);
  const liters = (v) => { const n = num(v); return n == null ? '' : n.toFixed(3); };
  const rows = trips.map((t) => `<tr class="data"><td class="r">${esc(dMonYY(t.date))}</td><td class="c">${t.fuel ? thb(num(t.fuel)) : ''}</td>
    <td class="c">${esc(liters(t.liters))}</td><td>${esc(t.purpose || '')}</td><td class="c">${esc(t.out_from || '')}</td><td class="c">${esc(t.out_to || '')}</td>
    <td class="c">${esc(t.back_from || '')}</td><td class="c">${esc(t.back_to || '')}</td><td class="c">${esc(t.km || '')}</td></tr>`);
  while (rows.length < 20) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  const sub = bkkDate(claim.submitted_at);
  const [sy, sm, sd] = sub ? sub.split('-') : ['', '', ''];
  return `<section class="doc-page doc-gas">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)}</div>
    <div class="gas-head">
      <img class="gas-logo" src="${LOGO_URL()}" alt="SINO Logistics Corporation">
      <div>SINO Logistics Corporation Public Company Limited<br>
        1011 Supalai Grand Tower 7th Floor Unit 05, Rama 3 Road, Chongnonsee, Yannawa, Bangkok, 10120 Thailand</div>
    </div>
    <p class="gas-title">แบบขอเบิกเงินชดเชยกรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงาน</p>
    <table class="gas-period"><tr>
      <th>งวดประจำเดือน</th><td>${esc(TH_MONTHS[cm - 1])}</td><th>ปี พ.ศ.</th><td>${cy + 543}</td>
      <th class="r">เลขทะเบียนรถ</th><td>${esc(plate || '')}</td></tr></table>
    <p class="b" style="margin:4px 0">เรียน&nbsp;&nbsp; ผู้บังคับบัญชา</p>
    <table class="gas-info">
      <tr><td>ชื่อ-สกุล : ${esc(emp.full_name || '')}</td><td>รหัสพนักงาน : ${esc(emp.emp_code || '')}</td><td>ตำแหน่ง : ${esc(emp.position_title || '')}</td></tr>
      <tr><td>ฝ่าย : ${esc(emp.department || '')}</td><td>แผนก : ${esc(emp.department || '')}</td><td>บริษัท : ${esc(emp.company || '')}</td></tr>
    </table>
    <p class="gas-intro">มีความประสงค์ ขอเบิกเงินชดเชย กรณีนำรถยนต์ส่วนตัวมาใช้ปฏิบัติงานตามรายละเอียด ดังนี้</p>
    <table class="gas-table">
      <colgroup><col style="width:8%"><col style="width:10%"><col style="width:7%"><col style="width:17%"><col style="width:11.5%"><col style="width:11.5%"><col style="width:11.5%"><col style="width:11.5%"><col style="width:12%"></colgroup>
      <tr><th rowspan="2">วัน เดือน ปี</th><th rowspan="2">ค่าน้ำมัน (บาท)</th><th rowspan="2">จำนวน (ลิตร)</th>
        <th rowspan="2">เพื่อปฏิบัติงาน (ระบุจังหวัด / บริษัท)</th><th colspan="2">เที่ยวไป (ระบุสถานที่)</th>
        <th colspan="2">เที่ยวกลับ (ระบุสถานที่)</th><th>ระยะทางรวม</th></tr>
      <tr><th>เริ่มต้น</th><th>สิ้นสุด</th><th>เริ่มต้น</th><th>สิ้นสุด</th><th>(กิโลเมตร)</th></tr>
      ${rows.join('')}
      <tr><td>Total</td><td class="c">${thb(fuel)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr class="grey"><td colspan="8" class="c blue b">ระยะทางรวม (กิโลเมตร)</td><td class="r blue b">${km ? Math.round(km * 10) / 10 : ''}</td></tr>
      <tr><td colspan="8">หมายเหตุ :</td><td></td></tr>
      <tr><td colspan="8">&nbsp;</td><td></td></tr>
      <tr class="grey"><td colspan="8">&nbsp;</td><td></td></tr>
    </table>
    <table class="gas-foot"><tr>
      <td class="hr">
        <table class="hr-box">
          <tr><th colspan="4">สำหรับ HR Share Service</th></tr>
          <tr><td class="red">วันที่รับเอกสาร</td><td></td><td class="red">บันทึกเพิ่มเติม</td><td></td></tr>
        </table>
        <div class="red" style="margin-top:4px">หมายเหตุ :</div>
      </td>
      <td class="sigs">
        <table class="gas-sign">
          <tr><td class="lbl">พนักงานผู้ขอเบิก</td><td class="line">${sigImg(sig.emp)}</td></tr>
          <tr><td></td><td class="c">(....${esc(emp.full_name || '')}.......)</td></tr>
          <tr><td class="r">วันที่</td><td>.......${esc(sd ? String(+sd) : '')}........ / .........${esc(sm ? TH_MON_SHORT[+sm - 1] : '')}............ / .....${esc(sy)}.........</td></tr>
          <tr><td class="lbl" style="padding-top:12px">ผู้มีอำนาจอนุมัติ</td><td class="line"></td></tr>
          <tr><td class="red">(กรรมการผู้จัดการ)</td><td class="c">(......${esc(st.ceo_name_th || 'นันท์มนัส วิทยศักดิ์พันธ์')}.........)</td></tr>
          <tr><td class="r">วันที่</td><td>............... / ............ / ..............</td></tr>
        </table>
      </td></tr></table>
  </section>`;
}

// สรุปค่าใช้จ่ายเดินทางต่างประเทศ (แยกหมวดเป็นกลุ่มย่อย)
function docOverseas(D, items, sig) {
  const { claim, emp } = D;
  const groups = {};
  items.forEach((it) => { (groups[it.category_code] = groups[it.category_code] || []).push(it); });
  let grand = 0;
  const body = Object.entries(groups).map(([code, list]) => {
    const cat = catOf(code);
    const sub = list.reduce((t, it) => t + Number(it.amount_thb), 0);
    grand += sub;
    return `<tr class="grp"><td colspan="6"><b>${esc(cat ? cat.name : code)}</b></td></tr>`
      + list.map((it) => `<tr><td class="c">${esc(dmy(it.receipt_date))}</td><td>${esc(it.description)}</td>
        <td class="c">${esc(it.currency)}</td><td class="r">${it.amount_foreign != null ? money(it.amount_foreign) : ''}</td>
        <td class="r">${it.fx_rate != null ? esc(String(it.fx_rate)) : ''}${it.fx_source ? ` <small>(${esc(it.fx_source)})</small>` : ''}</td>
        <td class="r">${money(it.amount_thb)}</td></tr>`).join('')
      + `<tr><td colspan="5" class="r">รวม${esc(cat ? cat.name : code)}</td><td class="r b">${money(sub)}</td></tr>`;
  }).join('');
  return `<section class="doc-page doc-sub">
    <div class="doc-ref">Ref. ${esc(claim.ref_no)}</div>
    ${companyHead()}
    <h2 class="c">สรุปค่าใช้จ่ายเดินทางต่างประเทศ</h2>
    <p>ชื่อ ${fill(emp.full_name, 'w30')}&emsp;ตำแหน่ง ${fill(emp.position_title, 'w20')}&emsp;เดือน ${fill(monthLabel(claim.claim_month), 'w15')}</p>
    <table class="grid">
      <colgroup><col style="width:13%"><col style="width:37%"><col style="width:9%"><col style="width:13%"><col style="width:13%"><col style="width:15%"></colgroup>
      <tr><th>วันที่</th><th>รายละเอียด</th><th>สกุลเงิน</th><th>ยอดเงิน</th><th>อัตราแลกเปลี่ยน</th><th>บาท</th></tr>
      ${body}
      <tr><td colspan="5" class="r b">รวมทั้งสิ้น</td><td class="r b">${money(grand)}</td></tr>
    </table>
    <p class="small">แนบบิลทุกใบ และ Memo ขออนุมัติเดินทางต่างประเทศ</p>
    <div class="sign-block">
      <p>ลงชื่อ ${sigLine(sig.emp)} ผู้เบิก</p><p class="paren">( ${fill(emp.full_name, 'w40')} )</p>
    </div>
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
    ${companyHead()}
    <h2 class="c">ใบรับรองแทนใบเสร็จรับเงิน</h2>
    <p>ร้าน ${fill('', 'w60')} (ผู้ซื้อ/ผู้ให้บริการ)</p>
    <table class="grid">
      <colgroup><col style="width:16%"><col style="width:52%"><col style="width:16%"><col style="width:16%"></colgroup>
      <tr><th>วัน เดือน ปี</th><th>รายละเอียดรายจ่าย</th><th>จำนวนเงิน</th><th>หมายเหตุ</th></tr>
      ${rows.join('')}
    </table>
    <table class="sub-total"><tr><td class="words">(${esc(bahtText(total))})</td><td class="lbl">รวมทั้งสิ้น</td><td class="amt">${money(total)}</td></tr></table>
    <p>ข้าพเจ้า ${fill(emp.full_name, 'w30')} (ผู้เบิกจ่าย)&emsp;ตำแหน่ง ${fill(emp.position_title, 'w20')}</p>
    <p>ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และข้าพเจ้าได้จ่ายไปในงานของทาง
      บริษัท โดยแท้ ตั้งแต่วันที่ ${fill(dmy(dates[0]), 'w15')} ถึงวันที่ ${fill(dmy(dates[dates.length - 1]), 'w15')}</p>
    <div class="sign-block">
      <p>ลงชื่อ ${sigLine(sig.emp)} (ผู้เบิกจ่าย)</p><p class="paren">( ${fill(emp.full_name, 'w40')} )</p>
      <p style="margin-top:24px">ลงชื่อ ${sigLine(sig.svp)} (ผู้อนุมัติ)</p><p class="paren">( ${fill(claim.approved_name, 'w40')} )</p>
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

  // จัดชุดเอกสาร: ใบปะหน้า + เอกสารคู่ใบปะหน้า → บันทึกเลี้ยงรับรองทีละรายการ + Memo → Ent-Gas + Memo
  const isEntSet = (it) => ['ENTERTAIN', 'GIFT'].includes(it.category_code)
    && !(it.is_overseas && !String((it.details || {}).job_ref || '').trim());
  const entItems = D.items.filter(isEntSet);
  const coverItems = D.items.filter((it) => !isEntSet(it));
  const needsSub = (it) => it.receipt_type === 'substitute'
    || (['ENTERTAIN', 'GIFT'].includes(it.category_code) && ['receipt', 'cash_bill'].includes(it.receipt_type));
  const memoPage = (m) => `<section class="doc-page">${memoDocHTML(m, D.emp, true, sig)}</section>`;
  const pages = [];

  if (coverItems.length) {
    pages.push(docRequisition(D, coverItems, budgets, sig));
    const ovs = coverItems.filter((it) => it.is_overseas);
    if (ovs.length) pages.push(docOverseas(D, ovs, sig));
    const subs = coverItems.filter(needsSub);
    if (subs.length) pages.push(docSubstitute(D, subs, sig));
    D.memos.filter((m) => m.memo_kind === 'EXPRESSWAY').forEach((m) => pages.push(memoPage(m)));
  }
  entItems.forEach((it) => {
    pages.push(docEntertain(D, it, sig));
    if (needsSub(it)) pages.push(docSubstitute(D, [it], sig));
    D.memos.filter((m) => m.item_id === it.id).forEach((m) => pages.push(memoPage(m)));
  });
  const gas = D.items.filter((it) => it.category_code === 'GAS');
  if (gas.length) {
    pages.push(docGas(D, gas, sig));
    D.memos.filter((m) => m.memo_kind === 'GAS').forEach((m) => pages.push(memoPage(m)));
  }
  // Memo อื่นที่ยังไม่ได้วาง (เช่น Memo รูปแบบเดิม)
  const placed = new Set(pages.join('').match(/No\. [^<]*/g) || []);
  D.memos.filter((m) => !['EXPRESSWAY', 'GAS'].includes(m.memo_kind) && !(m.item_id && entItems.some((it) => it.id === m.item_id)))
    .forEach((m) => { if (!placed.has(`No. ${m.memo_no}`)) pages.push(memoPage(m)); });

  const css = new URL('style.css?v=13', location.href).href;
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(D.claim.ref_no)}</title>
    <link href="${DOC_FONTS}" rel="stylesheet">
    <link rel="stylesheet" href="${css}"></head>
    <body class="print-page">
      <div class="print-bar">เอกสาร ${pages.length} หน้า · เขียนเลข ${esc(D.claim.ref_no)} ที่มุมล่างขวาของใบเสร็จทุกใบ · ส่งตัวจริงภายในวันที่ 2 ของเดือนถัดไป
        <button onclick="window.print()">พิมพ์ / บันทึก PDF</button></div>
      <div class="print-ref">Ref. ${esc(D.claim.ref_no)}</div>
      ${pages.join('')}
    </body></html>`);
  w.document.close();
}
