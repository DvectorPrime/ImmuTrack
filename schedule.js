/* schedule.js — schedule config + pure date logic.
   No DOM, no storage. Runs in the browser (window.Schedule) and in Node (require) so
   it can be checked in the console:  node tests/schedule.test.js
   Dates are date-only strings "YYYY-MM-DD" and are computed in UTC, so time zones and
   daylight saving can never shift a due date by a day. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Schedule = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* CONFIG — the clinic must verify this block before real use.         */
  /* ------------------------------------------------------------------ */
  var CONFIG = {
    verified: false,            // flip to true once the clinic has checked the visits below
    verifiedBy: '',             // who checked it, and when
    // Visit ages come from the project brief. Labels are ages only (no vaccine names)
    // on purpose: the clinic decides what is given at each visit.
    visits: [
      { key: 'wk6',  label: '6 weeks',   offset: { weeks: 6 } },
      { key: 'wk10', label: '10 weeks',  offset: { weeks: 10 } },
      { key: 'wk14', label: '14 weeks',  offset: { weeks: 14 } },
      { key: 'm9',   label: '9 months',  offset: { months: 9 } },
      { key: 'm15',  label: '15 months', offset: { months: 15 } }
    ],
    // Design choices (not clinical rules). Days relative to the due date.
    soonDays: 2,        // "due soon" = due within 2 days
    defaulterDays: 7,   // defaulter = 7 or more days overdue
    reminders: [
      { type: 'reminder', daysFromDue: -2 },
      { type: 'reminder', daysFromDue: -1 },
      { type: 'recall',   daysFromDue: 1 },
      { type: 'recall',   daysFromDue: 7 }
    ],
    // Tokens: {child} {clinic} {visit} {date}. Keep under 160 characters = one SMS.
    templates: {
      reminder: "Reminder: {child}'s immunisation visit at {clinic} (age {visit}) is due on {date}. Please bring the child's health card.",
      recall: "{child}'s immunisation visit at {clinic} (age {visit}) was due on {date}. Please come soon. It is not too late."
    },
    tokens: ['child', 'clinic', 'visit', 'date']
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---------------------------- date maths --------------------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(s) { return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; }
  function ms(s) { var p = parts(s); return Date.UTC(p.y, p.m - 1, p.d); }
  function fromMs(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function isISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = parts(s), dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    return dt.getUTCFullYear() === p.y && dt.getUTCMonth() === p.m - 1 && dt.getUTCDate() === p.d;
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(s, n) { return fromMs(ms(s) + n * 86400000); }
  // Adds calendar months and clamps to the last day of the target month:
  // 31 May + 9 months = 28 Feb (2027); 29 Feb 2024 + 15 months = 29 May 2025.
  function addMonths(s, n) {
    var p = parts(s), t = (p.m - 1) + n;
    var y = p.y + Math.floor(t / 12), m = ((t % 12) + 12) % 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(p.d, daysInMonth(y, m)));
  }
  function diffDays(a, b) { return Math.round((ms(b) - ms(a)) / 86400000); } // b - a

  function today() {
    try {
      var q = new URLSearchParams(root.location.search).get('today'); // demo-date override
      if (q && isISO(q)) return q;
    } catch (e) { /* not in a browser */ }
    var n = new Date();
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  }
  function isDemoDate() {
    try { var q = new URLSearchParams(root.location.search).get('today'); return !!(q && isISO(q)); } catch (e) { return false; }
  }

  /* --------------------------- schedule rules ------------------------ */
  function dueDate(dob, visit) {
    var o = visit.offset;
    return o.weeks != null ? addDays(dob, o.weeks * 7) : addMonths(dob, o.months);
  }

  // state: done | defaulter | overdue | due | upcoming   (days: how many, always >= 0)
  function status(due, doneDate, todayISO) {
    if (doneDate) return { state: 'done', days: 0 };
    var d = diffDays(todayISO, due);
    if (d < 0) return { state: -d >= CONFIG.defaulterDays ? 'defaulter' : 'overdue', days: -d };
    if (d <= CONFIG.soonDays) return { state: 'due', days: d };
    return { state: 'upcoming', days: d };
  }
  function isLate(st) { return st.state === 'overdue' || st.state === 'defaulter'; }

  function messagesFor(due) {
    return CONFIG.reminders.map(function (r) { return { type: r.type, sendOn: addDays(due, r.daysFromDue) }; });
  }

  /* ------------------------------ phones ----------------------------- */
  // Accepts 0803 123 4567, 803 123 4567, +234 803 123 4567, 2348031234567, +234 0803... -> +2348031234567
  function normalisePhone(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
    if (!s) return { ok: false, empty: true, reason: 'Enter a phone number.' };
    if (/[^0-9+]/.test(s) || s.slice(1).indexOf('+') !== -1) return { ok: false, reason: 'Use digits only, for example 0803 123 4567.' };
    var rest;
    if (s.indexOf('+') === 0) {
      if (s.indexOf('+234') !== 0) return { ok: false, reason: 'Only Nigerian numbers (+234) can be used.' };
      rest = s.slice(4);
    } else if (s.indexOf('00234') === 0) rest = s.slice(5);
    else if (s.indexOf('234') === 0) rest = s.slice(3);
    else if (s.charAt(0) === '0') rest = s.slice(1);
    else rest = s;
    if (rest.charAt(0) === '0') rest = rest.slice(1);        // "+234 0803..." typed by habit
    if (rest.length !== 10) {
      return { ok: false, reason: rest.length < 10
        ? 'This number is too short (' + rest.length + ' digits after 0). It needs 10, for example 0803 123 4567.'
        : 'This number is too long (' + rest.length + ' digits after 0). It needs 10, for example 0803 123 4567.' };
    }
    if (!/^[789]/.test(rest)) return { ok: false, reason: 'Nigerian mobile numbers start with 07, 08 or 09.' };
    return { ok: true, value: '+234' + rest };
  }
  function formatPhone(e164) {
    var r = String(e164 || '');
    if (r.indexOf('+234') !== 0 || r.length !== 14) return r;
    return '+234 ' + r.slice(4, 7) + ' ' + r.slice(7, 10) + ' ' + r.slice(10);
  }

  /* ----------------------------- display ----------------------------- */
  function fmt(s, style) {
    var p = parts(s), wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    if (style === 'short') return p.d + ' ' + MONTHS[p.m - 1];
    if (style === 'weekday') return DAYS[wd] + ' ' + p.d + ' ' + MONTHS[p.m - 1];
    if (style === 'long') return DAYS_LONG[wd] + ' ' + p.d + ' ' + MONTHS_LONG[p.m - 1];
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function ageText(dob, todayISO) {
    var d = diffDays(dob, todayISO);
    if (d < 0) return '';
    if (d < 14) return plural(d, 'day') + ' old';
    if (d < 91) return plural(Math.floor(d / 7), 'week') + ' old';
    var a = parts(dob), b = parts(todayISO);
    var months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    if (months < 12) return plural(months, 'month') + ' old';
    var y = Math.floor(months / 12), mo = months % 12;
    return plural(y, 'year') + (mo ? ' ' + mo + ' mo' : '') + ' old';
  }
  function olderThan2Years(dob, todayISO) { return dob < addMonths(todayISO, -24); }
  function dueText(st, due) {
    switch (st.state) {
      case 'done': return 'Done';
      case 'defaulter': case 'overdue': return plural(st.days, 'day') + ' overdue';
      case 'due': return st.days === 0 ? 'Due today' : st.days === 1 ? 'Due tomorrow' : 'Due in ' + st.days + ' days';
      default: return 'Due ' + fmt(due, 'short');
    }
  }

  /* ---------------------------- templates ---------------------------- */
  function render(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function unknownTokens(tpl) {
    var bad = [], re = /\{(\w+)\}/g, m;
    while ((m = re.exec(tpl))) if (CONFIG.tokens.indexOf(m[1]) === -1 && bad.indexOf(m[0]) === -1) bad.push(m[0]);
    return bad;
  }

  return {
    CONFIG: CONFIG, today: today, isDemoDate: isDemoDate, isISO: isISO,
    addDays: addDays, addMonths: addMonths, diffDays: diffDays,
    dueDate: dueDate, status: status, isLate: isLate, messagesFor: messagesFor,
    normalisePhone: normalisePhone, formatPhone: formatPhone,
    fmt: fmt, plural: plural, ageText: ageText, olderThan2Years: olderThan2Years, dueText: dueText,
    render: render, unknownTokens: unknownTokens
  };
});
