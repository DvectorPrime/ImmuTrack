/* app.js — all screens and behaviour. Hash routes: #/today #/children #/enrol
   #/child/<id> #/edit/<id> #/reminders #/settings */
(function () {
  'use strict';
  var S = window.Schedule, D = window.Store, C = S.CONFIG;
  var $main = document.getElementById('main'), $tabs = document.getElementById('tabs'),
      $toast = document.getElementById('toast'), $dlg = document.getElementById('dlg'),
      $banner = document.getElementById('banner'), $file = document.getElementById('restoreFile');
  var ui = { remindTab: 'queue', search: '', dupOk: false, doneCtx: null, pendingRestore: null };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ------------------------------ icons ------------------------------ */
  var I = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
    bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    today: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 0 8h-3"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17.5v.01"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
    edit: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    mark: '<circle cx="16.8" cy="5.2" r="2.4" fill="#FFC56B" stroke="none"/><path d="M5 14.5l3.8 3.8L16 11"/>'
  };
  function ic(n, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + I[n] + '</svg>'; }

  /* ------------------------------ data helpers ----------------------- */
  function visitList(c, t) {
    return C.visits.map(function (v) {
      var rec = D.visitOf(c.id, v.key), due = S.dueDate(c.dob, v), done = rec ? rec.doneDate : null;
      return { key: v.key, label: v.label, due: due, done: done, st: S.status(due, done, t) };
    });
  }
  function urgentRow(c, t) {
    var all = visitList(c, t);
    var q = all.filter(function (x) { return x.st.state === 'overdue' || x.st.state === 'defaulter' || x.st.state === 'due'; });
    return q.length ? { child: c, visit: q[0], extra: q.length - 1, all: all } : null;
  }
  function byUrgency(a, b) {
    return a.visit.due < b.visit.due ? -1 : a.visit.due > b.visit.due ? 1 : a.child.name.localeCompare(b.child.name);
  }
  function callRows(t) { return D.children().map(function (c) { return urgentRow(c, t); }).filter(Boolean).sort(byUrgency); }
  function childChip(all) {
    var p = all.filter(function (x) { return !x.done; })[0];
    if (!p) return { cls: 'c-ok', text: 'All visits done', icon: 'check' };
    return chip(p.st, p.due);
  }
  function chip(st, due, doneDate) {
    switch (st.state) {
      case 'defaulter': return { cls: 'c-def', text: 'Defaulter · ' + st.days + 'd late', icon: 'alert' };
      case 'overdue': return { cls: 'c-late', text: S.dueText(st, due), icon: 'alert' };
      case 'due': return { cls: 'c-soon', text: S.dueText(st, due), icon: 'today' };
      case 'done': return { cls: 'c-ok', text: 'Done' + (doneDate ? ' ' + S.fmt(doneDate, 'short') : ''), icon: 'check' };
      default: return { cls: 'c-up', text: S.dueText(st, due), icon: null };
    }
  }
  function chipHtml(c) { return '<span class="chip ' + c.cls + '">' + (c.icon ? ic(c.icon, 'sm') : '') + esc(c.text) + '</span>'; }
  function badge(st) {
    var n, u, cls;
    if (st.state === 'defaulter' || st.state === 'overdue') { n = st.days; u = st.days === 1 ? 'day late' : 'days late'; cls = st.state === 'defaulter' ? 'b-def' : 'b-late'; }
    else if (st.state === 'due') { cls = 'b-soon'; if (st.days === 0) { n = 'Today'; u = 'due'; } else { n = st.days; u = st.days === 1 ? 'day to go' : 'days to go'; } }
    else if (st.state === 'done') { n = '✓'; u = 'done'; cls = 'b-ok'; }
    else { n = st.days; u = 'days to go'; cls = 'b-up'; }
    return '<span class="badge ' + cls + '"><b' + (typeof n === 'string' && n.length > 2 ? ' class="txt"' : '') + '>' + n + '</b><small>' + u + '</small></span>';
  }
  function firstName(c) { return (c.name.replace(/^demo\s+/i, '').trim() || c.name).split(/\s+/)[0]; }
  function clinicLabel() { return D.clinicName() || 'Your clinic'; }
  function telLink(c, which, cls, label) {
    var num = which === 'alt' ? c.altPhone : c.phone;
    var aria = 'Call ' + (which === 'alt' ? 'second contact for ' : 'caregiver of ') + c.name + ' on ' + S.formatPhone(num);
    var inner = ic('phone') + (label ? '<span>' + label + '</span>' : '');
    if (c.demo) return '<button class="btn ' + cls + '" data-action="demo-call" aria-label="' + esc(aria) + ' (demo number)">' + inner + '</button>';
    return '<a class="btn ' + cls + '" href="tel:' + num + '" aria-label="' + esc(aria) + '">' + inner + '</a>';
  }

  /* ------------------------------ messages --------------------------- */
  function msgText(c, v, tpl) {
    return S.render(tpl, { child: firstName(c), clinic: D.clinicName() || 'our clinic', visit: v.label, date: S.fmt(v.due) });
  }
  function eachPlanned(t, fn) {
    D.children().forEach(function (c) {
      if (!c.consent) return;
      visitList(c, t).forEach(function (v) {
        if (v.done) return;
        S.messagesFor(v.due).forEach(function (m) { fn(c, v, m); });
      });
    });
  }
  // Sending is simulated: a message "sent" today is written to the log and goes nowhere.
  function processToday(t) {
    var added = 0;
    eachPlanned(t, function (c, v, m) {
      if (m.sendOn === t && !D.hasLog(c.id, v.key, m.type, m.sendOn)) {
        D.addLog({ childId: c.id, visitKey: v.key, type: m.type, sendOn: m.sendOn, status: 'simulated', text: msgText(c, v, D.template(m.type)) });
        added++;
      }
    });
    if (added) D.save();
    return added;
  }
  function queueItems(t, horizon) {
    var out = [], end = S.addDays(t, horizon);
    eachPlanned(t, function (c, v, m) {
      if (m.sendOn > t && m.sendOn <= end && !D.hasLog(c.id, v.key, m.type, m.sendOn))
        out.push({ child: c, visit: v, type: m.type, sendOn: m.sendOn, text: msgText(c, v, D.template(m.type)) });
    });
    return out.sort(function (a, b) { return a.sendOn < b.sendOn ? -1 : a.sendOn > b.sendOn ? 1 : a.child.name.localeCompare(b.child.name); });
  }

  /* ------------------------------ chrome ----------------------------- */
  function topHtml() {
    var off = !navigator.onLine;
    return '<header class="top"><div class="brand"><span class="logo">' + ic('mark') + '</span><span class="clinic">' + esc(clinicLabel()) + '</span></div>' +
      '<span class="pill' + (off ? ' off' : '') + '" id="netpill"><span class="dot"></span>' + (off ? 'Offline' : 'Saved on device') + '</span></header>';
  }
  function renderTabs(route, defCount) {
    var tabs = [['today', 'Today', 'today'], ['children', 'Children', 'users'], ['enrol', 'Enrol', 'plus'], ['reminders', 'Reminders', 'bell'], ['settings', 'Settings', 'sliders']];
    var cur = route.name === 'child' || route.name === 'edit' ? 'children' : route.name;
    $tabs.innerHTML = tabs.map(function (t) {
      var inner = ic(t[2]);
      var dot = t[0] === 'today' && defCount ? '<span class="dot" aria-hidden="true">' + defCount + '</span>' : '';
      var aria = t[0] === 'today' && defCount ? ' aria-label="Today, ' + defCount + ' defaulters"' : '';
      return '<a href="#/' + t[0] + '"' + (cur === t[0] ? ' aria-current="page"' : '') + aria + '>' + inner + dot + '<span>' + t[1] + '</span></a>';
    }).join('');
  }
  function updateBanner() {
    var b = '';
    if (!D.isSaving()) b += '<div class="callout bad" role="alert">' + ic('alert') + '<div><strong>Records are not being saved.</strong> This browser is blocking storage (private mode?). Open the app in a normal window, or you will lose what you enter.</div></div>';
    if (S.isDemoDate()) b += '<div class="callout warn" style="margin-top:8px">' + ic('info') + '<div><strong>Demo date: ' + esc(S.fmt(S.today())) + '.</strong> Remove <code>?today=</code> from the address to use the real date.</div></div>';
    $banner.innerHTML = b;
  }
  var toastTimer = null, toastAt = 0;
  function toast(msg, undo, ms) {
    clearTimeout(toastTimer); toastAt = Date.now();
    $toast.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-action="toast-undo">Undo</button>' : '');
    $toast._undo = undo || null;
    requestAnimationFrame(function () { $toast.classList.add('show'); });
    toastTimer = setTimeout(hideToast, ms || (undo ? 8000 : 4000));
  }
  function hideToast() { $toast.classList.remove('show'); $toast._undo = null; }
  function openDlg(html) { $dlg.innerHTML = html; if (!$dlg.open) $dlg.showModal(); }
  function closeDlg() { if ($dlg.open) $dlg.close(); }

  /* ------------------------------ router ----------------------------- */
  function route() {
    var h = (location.hash || '#/today').replace(/^#\/?/, '').split('/');
    return { name: h[0] || 'today', id: h[1] ? decodeURIComponent(h[1]) : null };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  var lastRouteKey = '';
  function render(opts) {
    var r = route(), t = S.today();
    processToday(t);
    var defCount = callRows(t).filter(function (x) { return x.visit.st.state === 'defaulter'; }).length;
    var views = { today: viewToday, children: viewChildren, enrol: viewEnrol, edit: viewEnrol, child: viewChild, reminders: viewReminders, settings: viewSettings };
    var v = views[r.name] || viewToday;
    var key = r.name + '/' + (r.id || '');
    var res = v(r, t);
    $main.innerHTML = res.html;
    document.title = res.title + ' · ImmuTrack';
    renderTabs(r, defCount);
    updateBanner();
    if (res.after) res.after();
    if (key !== lastRouteKey || (opts && opts.focus)) {
      window.scrollTo(0, 0);
      $main.focus({ preventScroll: true });
      lastRouteKey = key;
    }
  }

  /* ============================== TODAY ============================== */
  function rowHtml(r) {
    var c = r.child, v = r.visit;
    // Status is said once (the badge). Extra overdue visits and missing consent fold into the meta line.
    var notes = [];
    if (r.extra) notes.push('+' + r.extra + ' more overdue');
    if (!c.consent) notes.push('no reminders');
    return '<li class="card row"><a class="rowmain" href="#/child/' + c.id + '">' + badge(v.st) +
      '<span class="who"><strong>' + esc(c.name) + '</strong><span class="meta">' + 'Visit at ' + esc(v.label) + ' · due ' + S.fmt(v.due, 'short') + '</span>' +
      (notes.length ? '<span class="meta note">' + esc(notes.join(' · ')) + '</span>' : '') + '</span></a>' +
      '<div class="actions">' + telLink(c, 'main', 'primary', 'Call') +
      '<button class="btn" data-action="quick-done" data-child="' + c.id + '" data-key="' + v.key + '">' + ic('check') + '<span>Mark done</span></button></div></li>';
  }
  function viewToday(r, t) {
    var kids = D.children(), rows = callRows(t);
    var defs = rows.filter(function (x) { return x.visit.st.state === 'defaulter'; });
    var late = rows.filter(function (x) { return x.visit.st.state === 'overdue'; });
    var soon = rows.filter(function (x) { return x.visit.st.state === 'due'; });
    var h = topHtml() + '<div><p class="eyebrow">' + S.fmt(t, 'long') + '</p><h1>Today</h1></div>';

    if (!kids.length) {
      return { title: 'Today', html: h + '<div class="card empty"><span class="art">' + ic('users') + '</span><h2>No children yet</h2><p>Enrol a child and the due dates, call list and reminders fill in by themselves.</p><a class="btn primary" href="#/enrol">' + ic('plus') + 'Enrol first child</a><button class="btn quiet" data-action="load-demo">Or try it with demo data</button></div>' };
    }
    // Overview first (counts), then the work in order of urgency. One list, no second filter to learn.
    var stats = '<dl class="stats" aria-label="Summary">' + [['Defaulters', defs.length, 'def'], ['Overdue', late.length, 'late'], ['Due soon', soon.length, 'soon']].map(function (s) {
      return '<div class="stat s-' + s[2] + (s[1] ? '' : ' zero') + '"><dd>' + s[1] + '</dd><dt>' + s[0] + '</dt></div>';
    }).join('') + '</dl>';
    var body = '';
    var backup = D.lastBackupAt(), stale = !backup || S.diffDays(backup.slice(0, 10), t) >= 7;

    if (!rows.length) {
      body += allClear(t, 'All clear', 'Nobody is overdue or due in the next 2 days.');
    } else {
      [['Defaulters', '7+ days overdue', defs], ['Overdue', '', late], ['Due soon', 'within 2 days', soon]].forEach(function (g) {
        if (!g[2].length) return;
        body += '<section class="group"><div class="sec-h"><h2>' + g[0] + '</h2><span class="n">' + (g[1] ? g[1] : '') + '</span></div><ul class="list">' + g[2].map(rowHtml).join('') + '</ul></section>';
      });
    }
    var nudge = stale ? '<div class="callout info">' + ic('download') + '<div><strong>Back up your records.</strong> ' + (backup ? 'Last backup ' + S.fmt(backup.slice(0, 10)) + '.' : 'No backup yet.') + ' If this phone is lost, so are they.<div class="btns"><button class="btn" data-action="export">Export backup</button></div></div></div>' : '';
    return { title: 'Today', html: h + (rows.length ? stats : '') + body + nudge };
  }
  function allClear(t, title, sub) {
    var next = null;
    D.children().forEach(function (c) {
      visitList(c, t).forEach(function (v) { if (!v.done && v.due > t && (!next || v.due < next.v.due)) next = { c: c, v: v }; });
    });
    return '<div class="card empty"><span class="art">' + ic('check') + '</span><h2>' + title + '</h2><p>' + sub + '</p>' +
      (next ? '<p class="small muted">Next due: <strong>' + esc(next.c.name) + '</strong>, ' + S.fmt(next.v.due, 'weekday') + '</p>' : '') + '</div>';
  }

  /* ============================== CHILDREN =========================== */
  function phoneMatch(phone, qd) {
    if (!phone || qd.length < 3) return false;
    var local = phone.indexOf('+234') === 0 ? '0' + phone.slice(4) : phone;
    return phone.indexOf(qd) !== -1 || local.indexOf(qd) !== -1;
  }
  function listItems() {
    var t = S.today(), q = ui.search.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    var kids = D.children().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).filter(function (c) {
      return !q || c.name.toLowerCase().indexOf(q) !== -1 || phoneMatch(c.phone, qd) || phoneMatch(c.altPhone, qd);
    });
    return { kids: kids, html: kids.map(function (c) {
      var all = visitList(c, t);
      return '<li class="card" style="padding:0"><a class="item" href="#/child/' + c.id + '"><span class="who"><strong>' + esc(c.name) + '</strong><span class="meta">' + esc(S.ageText(c.dob, t)) + ' · born ' + S.fmt(c.dob, 'short') + '</span>' + chipHtml(childChip(all)) + '</span>' + ic('chev') + '</a></li>';
    }).join('') };
  }
  function viewChildren() {
    var total = D.children().length;
    var html = topHtml() + '<h1>Children</h1>';
    if (!total) return { title: 'Children', html: html + '<div class="card empty"><span class="art">' + ic('users') + '</span><h2>No children yet</h2><p>Enrolled children appear here.</p><a class="btn primary" href="#/enrol">' + ic('plus') + 'Enrol a child</a></div>' };
    html += '<div class="search"><label class="sr" for="q" style="position:absolute;left:-999px">Search children</label>' + ic('search') +
      '<input id="q" type="search" placeholder="Search name or phone" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ui.search) + '"></div>' +
      '<p class="muted small" id="ccount" aria-live="polite"></p><ul class="list" id="clist"></ul>';
    return { title: 'Children', html: html, after: updateChildren };
  }
  function updateChildren() {
    var r = listItems(), n = D.children().length;
    $('#clist').innerHTML = r.html || '<li class="card empty"><span class="art">' + ic('search') + '</span><h2>No match</h2><p>No child matches “' + esc(ui.search) + '”.</p></li>';
    $('#ccount').textContent = ui.search.trim() ? r.kids.length + ' of ' + n + ' children' : n + (n === 1 ? ' child' : ' children');
  }

  /* ============================== ENROL / EDIT ======================= */
  function viewEnrol(r, t) {
    var edit = r.name === 'edit', c = edit ? D.child(r.id) : null;
    if (edit && !c) return { title: 'Not found', html: topHtml() + '<div class="card empty"><h2>Child not found</h2><a class="btn" href="#/children">Back to children</a></div>' };
    var v = c || { name: '', dob: '', phone: '', altPhone: '', consent: false };
    var title = edit ? 'Edit ' + c.name : 'Enrol a child';
    var html = (edit
      ? '<div class="topbar"><a class="btn icon quiet" href="#/child/' + c.id + '" aria-label="Back to ' + esc(c.name) + '">' + ic('back') + '</a><h1>Edit child</h1><span></span></div>'
      : topHtml() + '<h1>Enrol a child</h1>') +
      '<form id="enrolForm" novalidate data-edit="' + (edit ? c.id : '') + '"><div class="card">' +
      field('name', 'Child’s first name', '<input id="f-name" name="name" type="text" autocomplete="off" autocapitalize="words" maxlength="40" value="' + esc(v.name) + '" required aria-describedby="e-name">', '', 'e-name') +
      field('dob', 'Date of birth', '<input id="f-dob" name="dob" type="date" max="' + t + '" value="' + esc(v.dob) + '" required aria-describedby="e-dob h-dob">', '<p class="hint" id="h-dob"></p>', 'e-dob') +
      field('phone', 'Caregiver phone', '<input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="0803 123 4567" value="' + esc(v.phone ? S.formatPhone(v.phone) : '') + '" required aria-describedby="e-phone">', '', 'e-phone') +
      field('alt', 'Second contact <span class="opt">(optional)</span>', '<input id="f-alt" name="alt" type="tel" inputmode="tel" autocomplete="off" placeholder="0803 123 4567" value="' + esc(v.altPhone ? S.formatPhone(v.altPhone) : '') + '" aria-describedby="e-alt">', '', 'e-alt') +
      '<div style="margin-top:18px"><label class="consent" for="f-consent"><input id="f-consent" name="consent" type="checkbox"' + (v.consent ? ' checked' : '') + '><span><strong>Caregiver agrees to reminder messages</strong><span class="hint">Ask them, then tick. If left unticked the child is still tracked and appears on the call list, but no messages are queued.</span></span></label></div></div>' +
      '<div class="card" id="preview" hidden style="margin-top:16px"></div>' +
      '<div id="dup" class="callout warn" hidden style="margin-top:16px" role="alert"></div>' +
      '<div class="form-actions"><button class="btn primary block" type="submit">' + (edit ? 'Save changes' : 'Enrol child') + '</button>' +
      (edit ? '<a class="btn block" href="#/child/' + c.id + '">Cancel</a>' : '') + '</div></form>';
    return { title: title, html: html, after: function () { ui.dupOk = false; touched = {}; updateEnrolLive(); } };
  }
  function field(id, label, input, extra, errId) {
    return '<div class="field" data-field="' + id + '"><label for="f-' + id + '">' + label + '</label>' + input + extra + '<p class="msg" id="' + errId + '"></p></div>';
  }
  function readForm() {
    var f = $('#enrolForm');
    return { name: f.name.value.trim(), dob: f.dob.value, phoneRaw: f.phone.value, altRaw: f.alt.value, consent: f.consent.checked, exceptId: f.getAttribute('data-edit') || null };
  }
  function validate(v, t) {
    var errs = {}, warn = {}, out = { phone: null, alt: null };
    if (!v.name) errs.name = 'Enter the child’s first name.';
    if (!v.dob) errs.dob = 'Enter the date of birth.';
    else if (!S.isISO(v.dob)) errs.dob = 'That date is not valid.';
    else if (v.dob > t) errs.dob = 'Date of birth can’t be in the future.';
    else if (S.olderThan2Years(v.dob, t)) warn.dob = 'This child is ' + S.ageText(v.dob, t).replace(' old', '') + ' old. The schedule ends at 15 months. Check the date is right.';
    var p = S.normalisePhone(v.phoneRaw);
    if (!p.ok) errs.phone = p.reason; else out.phone = p.value;
    if (v.altRaw.trim()) { var a = S.normalisePhone(v.altRaw); if (!a.ok) errs.alt = a.reason; else out.alt = a.value; }
    return { errs: errs, warn: warn, phone: out.phone, alt: out.alt };
  }
  function setField(id, msg, kind) {
    var wrap = $('[data-field="' + id + '"]'); if (!wrap) return;
    var el = $('.msg', wrap), input = $('input', wrap);
    wrap.classList.toggle('bad', kind === 'err');
    if (input) input.setAttribute('aria-invalid', kind === 'err' ? 'true' : 'false');
    el.className = 'msg ' + (kind || '');
    el.innerHTML = msg ? (kind === 'err' ? ic('alert', 'sm') : kind === 'ok' ? ic('check', 'sm') : kind === 'warn' ? ic('info', 'sm') : '') + '<span>' + esc(msg) + '</span>' : '';
  }
  var touched = {};
  function updateEnrolLive(submitted) {
    var t = S.today(), v = readForm(), r = validate(v, t);
    var show = function (k) { return submitted || touched[k]; };
    // Date of birth: echo the age so a wrong year is obvious (recognition over recall)
    var hint = $('#h-dob');
    hint.textContent = v.dob && S.isISO(v.dob) && v.dob <= t ? S.ageText(v.dob, t) : 'Use the health card or birth record.';
    if (r.errs.dob && show('dob')) setField('dob', r.errs.dob, 'err'); else if (r.warn.dob) setField('dob', r.warn.dob, 'warn'); else setField('dob', '', '');
    if (r.errs.name && show('name')) setField('name', r.errs.name, 'err'); else setField('name', '', '');
    if (r.phone) setField('phone', S.formatPhone(r.phone), 'ok'); else if (r.errs.phone && show('phone')) setField('phone', r.errs.phone, 'err'); else setField('phone', '', '');
    if (r.alt) setField('alt', S.formatPhone(r.alt), 'ok'); else if (r.errs.alt && show('alt')) setField('alt', r.errs.alt, 'err'); else setField('alt', '', '');
    // Live schedule preview
    var pv = $('#preview');
    if (v.dob && S.isISO(v.dob) && v.dob <= t) {
      pv.hidden = false;
      var past = 0;
      pv.innerHTML = '<h2 style="margin-bottom:8px">Due dates</h2><ul class="sched">' + C.visits.map(function (x) {
        var due = S.dueDate(v.dob, x), st = S.status(due, null, t); if (S.isLate(st)) past++;
        return '<li><span>Visit at ' + esc(x.label) + '</span><span>' + S.fmt(due) + (S.isLate(st) ? ' <span class="chip ' + (st.state === 'defaulter' ? 'c-def' : 'c-late') + '">Past</span>' : '') + '</span></li>';
      }).join('') + '</ul>' + (past ? '<p class="hint" style="margin-top:8px">' + past + ' of these ' + (past === 1 ? 'date has' : 'dates have') + ' already passed. After enrolling, mark any visits the child has already had.</p>' : '');
      if (!C.verified) pv.innerHTML += '<p class="hint" style="margin-top:8px">Schedule not yet verified by the clinic.</p>';
    } else pv.hidden = true;
  }
  function submitEnrol() {
    var t = S.today(), v = readForm(), r = validate(v, t), f = $('#enrolForm');
    updateEnrolLive(true);
    var order = ['name', 'dob', 'phone', 'alt'];
    for (var i = 0; i < order.length; i++) if (r.errs[order[i]]) { $('#f-' + order[i]).focus(); return; }
    var dup = D.findDuplicate(v.name, v.dob, r.phone, v.exceptId);
    if (dup && !ui.dupOk) {
      var box = $('#dup'); box.hidden = false;
      box.innerHTML = ic('alert') + '<div><strong>Possible duplicate.</strong> ' + esc(dup.name) + ' with the same date of birth and phone is already enrolled.<div class="btns"><a class="btn" href="#/child/' + dup.id + '">Open that record</a><button type="button" class="btn" data-action="enrol-anyway">Enrol anyway</button></div></div>';
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var data = { name: v.name, dob: v.dob, phone: r.phone, altPhone: r.alt || '', consent: v.consent };
    if (v.exceptId) { D.updateChild(v.exceptId, data); toast('Changes saved'); go('#/child/' + v.exceptId); return; }
    var c = D.addChild(data), n = urgentRow(c, t);
    toast(n ? v.name + ' enrolled. ' + (n.visit.st.state === 'due' ? 'A visit is due soon.' : 'Past visits need marking.') : v.name + ' enrolled.');
    touched = {}; go('#/child/' + c.id);
  }

  /* ============================== CHILD DETAIL ======================= */
  function viewChild(r, t) {
    var c = D.child(r.id);
    if (!c) return { title: 'Not found', html: topHtml() + '<div class="card empty"><span class="art">' + ic('search') + '</span><h2>Child not found</h2><p>This record may have been removed.</p><a class="btn" href="#/children">Back to children</a></div>' };
    var all = visitList(c, t), firstPending = all.filter(function (x) { return !x.done; })[0];
    var html = '<div class="topbar"><a class="btn icon quiet" href="#/children" aria-label="Back to children">' + ic('back') + '</a><h1>' + esc(c.name) + '</h1><a class="btn icon quiet" href="#/edit/' + c.id + '" aria-label="Edit ' + esc(c.name) + '">' + ic('edit') + '</a></div>' +
      '<div class="card"><p class="lead"><strong>' + esc(S.ageText(c.dob, t)) + '</strong> · born ' + S.fmt(c.dob) + '</p>' +
      '<div style="margin-top:12px"><div class="contact"><div><p class="small muted">Caregiver</p><p class="num">' + S.formatPhone(c.phone) + '</p></div>' + telLink(c, 'main', 'primary', 'Call') + '</div>' +
      (c.altPhone ? '<div class="contact"><div><p class="small muted">Second contact</p><p class="num">' + S.formatPhone(c.altPhone) + '</p></div>' + telLink(c, 'alt', '', 'Call') + '</div>' : '') + '</div>' +
      '<p style="margin-top:12px">' + (c.consent ? '<span class="chip c-ok">' + ic('check', 'sm') + 'Reminders on</span>' : '<span class="chip c-up">No reminder consent · call only</span>') + '</p></div>' +
      '<div class="sec-h"><h2>Visits</h2><span class="n">' + all.filter(function (x) { return x.done; }).length + ' of ' + all.length + ' done</span></div>' +
      '<div class="card" style="padding:4px 16px"><ol class="visits">' + all.map(function (x) {
        var ch = chip(x.st, x.due, x.done), mk;
        if (x.done) mk = '<span class="mark b-ok">' + ic('check') + '</span>';
        else mk = '<span class="mark ' + (x.st.state === 'defaulter' ? 'b-def' : x.st.state === 'overdue' ? 'b-late' : x.st.state === 'due' ? 'b-soon' : 'b-up') + '">' + (C.visits.indexOf(C.visits.filter(function (z) { return z.key === x.key; })[0]) + 1) + '</span>';
        var sub = x.done ? 'Given ' + S.fmt(x.done) : 'Due ' + S.fmt(x.due);
        var act = x.done ? '<button class="btn quiet" data-action="undo-visit" data-child="' + c.id + '" data-key="' + x.key + '" aria-label="Undo ' + esc(x.label) + ' visit">' + ic('undo') + 'Undo</button>'
          : '<button class="btn' + (firstPending && firstPending.key === x.key ? ' primary' : ' quiet') + '" data-action="open-done" data-child="' + c.id + '" data-key="' + x.key + '" aria-label="Mark ' + esc(x.label) + ' visit done">Mark done</button>';
        return '<li>' + mk + '<div><p class="v-title">' + esc(x.label) + '</p><p class="v-sub">' + sub + '</p>' + (x.done || x.st.state === 'upcoming' ? '' : '<p style="margin-top:4px">' + chipHtml(ch) + '</p>') + '</div>' + act + '</li>';
      }).join('') + '</ol></div>' +
      '<button class="btn quiet danger block remove" data-action="ask-remove" data-child="' + c.id + '">' + ic('trash') + 'Remove child</button>';
    return { title: c.name, html: html };
  }
  function openDoneSheet(childId, key) {
    var c = D.child(childId), v = C.visits.filter(function (x) { return x.key === key; })[0]; if (!c || !v) return;
    ui.doneCtx = { childId: childId, key: key };
    openDlg('<form id="doneForm" novalidate><h2 id="dlgTitle">Mark visit done</h2><p class="muted">' + esc(c.name) + ' · visit at ' + esc(v.label) + '</p>' +
      '<div class="field" style="margin-top:16px" data-field="dd"><label for="f-dd">Date given</label><input id="f-dd" type="date" min="' + c.dob + '" max="' + S.today() + '" value="' + S.today() + '" aria-describedby="e-dd"><p class="msg" id="e-dd"></p></div>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-action="close-dlg">Cancel</button><button type="submit" class="btn primary">Save</button></div></form>');
  }
  function submitDone() {
    var ctx = ui.doneCtx, c = D.child(ctx.childId), d = $('#f-dd').value, t = S.today();
    if (!S.isISO(d)) return setField('dd', 'Enter the date it was given.', 'err');
    if (d > t) return setField('dd', 'The date can’t be in the future.', 'err');
    if (d < c.dob) return setField('dd', 'That is before the child was born.', 'err');
    D.setDone(ctx.childId, ctx.key, d); closeDlg(); render();
    toast('Visit marked done', function () { D.setDone(ctx.childId, ctx.key, null); render(); });
  }

  /* ============================== REMINDERS ========================== */
  function smsCount(s) { return s.length <= 160 ? '1 SMS' : Math.ceil(s.length / 153) + ' SMS'; }
  function viewReminders(r, t) {
    var q = queueItems(t, 14), log = D.log().slice().sort(function (a, b) { return a.loggedAt < b.loggedAt ? 1 : -1; }).slice(0, 60);
    var noConsent = D.children().filter(function (c) { return !c.consent; }).length;
    var html = topHtml() + '<h1>Reminders</h1><div class="callout info">' + ic('info') + '<div><strong>Sending is simulated.</strong> Messages below show what would be sent. Nothing leaves this device.</div></div>' +
      '<div class="seg" role="group" aria-label="Reminders view">' + [['queue', 'Queue', q.length], ['log', 'Log', log.length], ['templates', 'Templates', null]].map(function (x) {
        return '<button type="button" data-action="tab-remind" data-tab="' + x[0] + '" aria-pressed="' + (ui.remindTab === x[0]) + '">' + x[1] + (x[2] != null ? ' <span class="count">' + x[2] + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    if (ui.remindTab === 'queue') {
      html += '<p class="muted small">Next 14 days' + (noConsent ? ' · ' + noConsent + ' ' + (noConsent === 1 ? 'child has' : 'children have') + ' no reminder consent and ' + (noConsent === 1 ? 'is' : 'are') + ' not listed' : '') + '.</p>' +
        '<details class="more"><summary>How reminders are timed</summary><p class="small muted">Reminders go 2 days and 1 day before a visit. Recalls go 1 day and 7 days after a missed visit. These are clinic design choices, not clinical rules.</p></details>';
      if (!q.length) html += '<div class="card empty"><span class="art">' + ic('bell') + '</span><h2>Nothing queued</h2><p>No messages are due to go in the next 14 days.</p></div>';
      else {
        var cur = '';
        html += q.map(function (m) {
          var head = '';
          if (m.sendOn !== cur) {
            head = (cur ? '</ul>' : '') + '<div class="sec-h"><h2>' + (m.sendOn === S.addDays(t, 1) ? 'Tomorrow · ' : '') + S.fmt(m.sendOn, 'weekday') + '</h2></div><ul class="list">';
            cur = m.sendOn;
          }
          return head + msgCard(m.child, m.visit, m.type, m.text, 'Queued');
        }).join('') + '</ul>';
      }
    } else if (ui.remindTab === 'log') {
      if (!log.length) html += '<div class="card empty"><span class="art">' + ic('bell') + '</span><h2>No messages yet</h2><p>Messages whose send day arrives are recorded here as simulated.</p></div>';
      else html += '<ul class="list">' + log.map(function (m) {
        var c = D.child(m.childId), v = C.visits.filter(function (x) { return x.key === m.visitKey; })[0];
        return c && v ? msgCard(c, { label: v.label }, m.type, m.text, 'Simulated · ' + S.fmt(m.sendOn, 'weekday')) : '';
      }).join('') + '</ul>';
      html += '<button class="btn block" data-action="run-now">Run today’s messages now</button>';
    } else {
      html += '<p class="muted small">Edit the wording. Tokens: <code>{child}</code> <code>{clinic}</code> <code>{visit}</code> <code>{date}</code>. Only the first name is used.</p>';
      ['reminder', 'recall'].forEach(function (k) {
        html += '<div class="card"><div class="field"><label for="tpl-' + k + '">' + (k === 'reminder' ? 'Reminder (before the visit)' : 'Recall (after a missed visit)') + '</label><textarea id="tpl-' + k + '" data-tpl="' + k + '" rows="4">' + esc(D.template(k)) + '</textarea><p class="msg" id="tw-' + k + '"></p></div>' +
          '<p class="label" style="margin:14px 0 8px">Preview</p><div class="sms" id="tp-' + k + '"></div><div class="count-line"><span id="tc-' + k + '"></span><button class="btn quiet" style="min-height:44px;padding:0 8px" data-action="reset-tpl" data-tpl="' + k + '">Reset wording</button></div></div>';
      });
    }
    return { title: 'Reminders', html: html, after: ui.remindTab === 'templates' ? function () { ['reminder', 'recall'].forEach(updateTpl); } : null };
  }
  function msgCard(c, v, type, text, status) {
    return '<li class="card msgcard"><div class="head"><div><span class="kind ' + (type === 'reminder' ? 'rem' : 'rec') + '">' + (type === 'reminder' ? 'Reminder' : 'Recall') + '</span> <strong>· ' + esc(c.name) + '</strong></div><span class="chip c-up">' + esc(status) + '</span></div>' +
      '<p class="muted small">' + esc(S.formatPhone(c.phone)) + ' · visit at ' + esc(v.label) + '</p><p class="text">' + esc(text) + '</p></li>';
  }
  function updateTpl(k) {
    var ta = $('#tpl-' + k); if (!ta) return;
    var sample = S.render(ta.value, { child: 'Ada', clinic: D.clinicName() || 'our clinic', visit: '6 weeks', date: S.fmt(S.addDays(S.today(), k === 'reminder' ? 2 : -1)) });
    $('#tp-' + k).textContent = sample;
    $('#tc-' + k).textContent = sample.length + ' characters · ' + smsCount(sample);
    var bad = S.unknownTokens(ta.value);
    setField_(k, bad.length ? 'Unknown ' + bad.join(', ') + '. Use only {child} {clinic} {visit} {date}.' : '');
  }
  function setField_(k, msg) { var el = $('#tw-' + k); el.className = 'msg ' + (msg ? 'err' : ''); el.innerHTML = msg ? ic('alert', 'sm') + '<span>' + esc(msg) + '</span>' : ''; }

  /* ============================== SETTINGS =========================== */
  function viewSettings(r, t) {
    var demoN = D.children().filter(function (c) { return c.demo; }).length, backup = D.lastBackupAt();
    var html = topHtml() + '<h1>Settings</h1>' +
      '<div class="card"><div class="field"><label for="clinicName">Clinic name</label><input id="clinicName" type="text" maxlength="60" autocomplete="off" value="' + esc(D.clinicName()) + '" placeholder="e.g. Oluyole Primary Health Centre"><p class="hint">Shown at the top and used in reminder messages. <span id="saved" aria-live="polite"></span></p></div></div>' +
      '<div class="sec-h"><h2>Your data</h2></div><div class="card stack"><p class="small muted">Records live only on this device. ' + (backup ? 'Last backup: ' + S.fmt(backup.slice(0, 10)) + '.' : 'You have not made a backup yet.') + '</p>' +
      '<button class="btn primary block" data-action="export">' + ic('download') + 'Export backup</button>' +
      '<button class="btn block" data-action="pick-restore">' + ic('upload') + 'Restore from backup</button>' +
      '<p class="hint">A backup file contains names and phone numbers. Keep it somewhere private.</p></div>' +
      // Rarely-used detail is folded away (progressive disclosure); the status stays visible on the summary line.
      '<details class="card fold"><summary><span>Visit schedule</span>' + (C.verified ? '<span class="chip c-ok">' + ic('check', 'sm') + 'Verified</span>' : '<span class="chip c-late">' + ic('alert', 'sm') + 'Not verified</span>') + ic('chev') + '</summary><div class="fold-body">' +
      (C.verified ? (C.verifiedBy ? '<p class="small muted">Verified by ' + esc(C.verifiedBy) + '.</p>' : '') : '<div class="callout warn">' + ic('alert') + '<div><strong>Not yet verified by the clinic.</strong> Check these ages before real use. They are set in the app’s schedule file.</div></div>') +
      '<ul class="sched">' + C.visits.map(function (v) { return '<li><span>' + esc(v.label) + '</span><span class="muted">' + (v.offset.weeks ? v.offset.weeks + ' weeks' : v.offset.months + ' months') + ' from birth</span></li>'; }).join('') + '</ul>' +
      '<p class="hint">Due soon: within ' + C.soonDays + ' days · Defaulter: ' + C.defaulterDays + '+ days overdue · Reminders: 2 and 1 days before · Recalls: 1 and 7 days after. These are design choices, not clinical rules.</p></div></details>' +
      '<details class="card fold"><summary><span>Demo data</span>' + (demoN ? '<span class="chip c-up">' + demoN + ' loaded</span>' : '') + ic('chev') + '</summary><div class="fold-body stack"><p class="small muted">Fake children only, with dates set relative to today so every list has something in it.</p>' +
      '<button class="btn block" data-action="load-demo">Load demo data</button>' + (demoN ? '<button class="btn block danger" data-action="remove-demo">Remove ' + demoN + ' demo children</button>' : '') + '</div></details>';
    return { title: 'Settings', html: html };
  }

  function loadDemo() {
    D.removeDemo();
    var t = S.today(), n = 0;
    var spec = [['Demo Amina', 'wk6', -21, 1, 1], ['Demo Chidi', 'wk10', -9, 1, 0], ['Demo Ife', 'wk14', -3, 1, 1], ['Demo Bola', 'wk6', -1, 1, 0],
      ['Demo Emeka', 'wk10', 0, 1, 0], ['Demo Zainab', 'wk14', 1, 1, 1], ['Demo Tunde', 'm9', 2, 1, 0], ['Demo Ngozi', 'wk6', 12, 0, 0], ['Demo Kemi', 'm15', 40, 1, 0]];
    spec.forEach(function (s, i) {
      var v = C.visits.filter(function (x) { return x.key === s[1]; })[0], target = S.addDays(t, s[2]);
      var dob = v.offset.weeks ? S.addDays(target, -7 * v.offset.weeks) : S.addMonths(target, -v.offset.months);
      var phone = '+23480000000' + (10 + i), alt = s[4] ? '+23480000001' + (10 + i) : '';
      var c = D.addChild({ name: s[0], dob: dob, phone: phone, altPhone: alt, consent: !!s[3], demo: true });
      for (var k = 0; k < C.visits.length && C.visits[k].key !== s[1]; k++) D.setDone(c.id, C.visits[k].key, S.dueDate(dob, C.visits[k]));
      n++;
    });
    return n;
  }

  /* ============================== EVENTS ============================= */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var a = el.getAttribute('data-action'), t = S.today();
    switch (a) {
      case 'tab-remind': ui.remindTab = el.getAttribute('data-tab'); render(); break;
      case 'quick-done': {
        var id = el.getAttribute('data-child'), key = el.getAttribute('data-key'), c = D.child(id);
        var v = C.visits.filter(function (x) { return x.key === key; })[0];
        D.setDone(id, key, t); render();
        toast(c.name + ' · ' + v.label + ' marked done', function () { D.setDone(id, key, null); render(); });
        break; }
      case 'undo-visit': {
        var id2 = el.getAttribute('data-child'), key2 = el.getAttribute('data-key'), prev = D.visitOf(id2, key2).doneDate;
        D.setDone(id2, key2, null); render();
        toast('Visit set back to not done', function () { D.setDone(id2, key2, prev); render(); });
        break; }
      case 'open-done': openDoneSheet(el.getAttribute('data-child'), el.getAttribute('data-key')); break;
      case 'close-dlg': closeDlg(); break;
      case 'toast-undo': if ($toast._undo) { var fn = $toast._undo; hideToast(); fn(); } break;
      case 'demo-call': toast('Demo number. No call was placed.'); break;
      case 'enrol-anyway': ui.dupOk = true; submitEnrol(); break;
      case 'ask-remove': {
        var cr = D.child(el.getAttribute('data-child'));
        openDlg('<h2 id="dlgTitle">Remove ' + esc(cr.name) + '?</h2><p class="muted">This deletes the record, its visit history and its message log from this device. It can’t be undone unless you have a backup.</p><div class="sheet-actions"><button class="btn" data-action="close-dlg" autofocus>Keep</button><button class="btn danger" data-action="do-remove" data-child="' + cr.id + '">Remove</button></div>');
        break; }
      case 'do-remove': { var rid = el.getAttribute('data-child'), nm = D.child(rid).name; D.removeChild(rid); closeDlg(); toast(nm + ' removed'); go('#/children'); break; }
      case 'export': {
        var blob = new Blob([JSON.stringify(D.exportData(), null, 2)], { type: 'application/json' }), link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = 'immutrack-backup-' + t + '.json';
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
        D.markBackup(); toast('Backup downloaded. Keep the file somewhere safe.', null, 5000); render(); break; }
      case 'pick-restore': $file.value = ''; $file.click(); break;
      case 'confirm-restore': D.restore(ui.pendingRestore); ui.pendingRestore = null; closeDlg(); toast('Backup restored'); go('#/today'); render(); break;
      case 'load-demo': { var n = loadDemo(); toast(n + ' demo children added'); go('#/today'); render(); break; }
      case 'remove-demo': { var k = D.removeDemo(); toast(k + ' demo children removed'); render(); break; }
      case 'run-now': { var added = processToday(t); toast(added ? added + ' simulated messages logged' : 'Nothing more is due to send today'); render(); break; }
      case 'reset-tpl': { var tk = el.getAttribute('data-tpl'); D.setTemplate(tk, C.templates[tk]); $('#tpl-' + tk).value = C.templates[tk]; updateTpl(tk); break; }
    }
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'enrolForm') submitEnrol();
    else if (e.target.id === 'doneForm') submitDone();
  });
  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'q') { ui.search = e.target.value; updateChildren(); }
    else if (id === 'clinicName') {
      D.setClinicName(e.target.value);
      var cl = $('.clinic'); if (cl) cl.textContent = clinicLabel();
      var sv = $('#saved'); if (sv) sv.textContent = 'Saved.';
    } else if (e.target.getAttribute && e.target.getAttribute('data-tpl')) {
      var k = e.target.getAttribute('data-tpl'); D.setTemplate(k, e.target.value); updateTpl(k);
    } else if (e.target.form && e.target.form.id === 'enrolForm') {
      if (/^f-(name|dob|phone)$/.test(id)) { ui.dupOk = false; $('#dup').hidden = true; }
      updateEnrolLive();
    }
  });
  document.addEventListener('focusout', function (e) {
    if (e.target.form && e.target.form.id === 'enrolForm' && /^f-/.test(e.target.id)) { touched[e.target.id.slice(2)] = true; updateEnrolLive(); }
  });
  $file.addEventListener('change', function () {
    var f = $file.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var obj; try { obj = JSON.parse(rd.result); } catch (err) { obj = null; }
      var res = D.validateBackup(obj);
      if (!res.ok) { openDlg('<h2 id="dlgTitle">Can’t restore this file</h2><p class="muted">' + esc(res.error) + ' Your current records were not changed.</p><div class="sheet-actions" style="grid-template-columns:1fr"><button class="btn primary" data-action="close-dlg">OK</button></div>'); return; }
      ui.pendingRestore = obj;
      var now = D.children().length;
      openDlg('<h2 id="dlgTitle">Restore this backup?</h2><p class="muted">' + res.children + ' ' + (res.children === 1 ? 'child' : 'children') + ', ' + res.visits + ' visits recorded' + (res.exportedAt ? ', saved ' + S.fmt(res.exportedAt.slice(0, 10)) : '') + '.</p>' +
        '<div class="callout warn" style="margin-top:12px">' + ic('alert') + '<div>This <strong>replaces</strong> the ' + now + ' ' + (now === 1 ? 'child' : 'children') + ' on this device. Export a backup first if you want to keep them.</div></div>' +
        '<div class="sheet-actions"><button class="btn" data-action="close-dlg" autofocus>Cancel</button><button class="btn primary" data-action="confirm-restore">Replace records</button></div>');
    };
    rd.readAsText(f);
  });
  $dlg.addEventListener('click', function (e) {
    if (e.target !== $dlg) return;
    var r = $dlg.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) closeDlg();
  });
  window.addEventListener('hashchange', function () {
    if (Date.now() - toastAt > 400) hideToast();   // an old Undo should not follow you to another screen
    render();
  });
  window.addEventListener('online', function () { render(); toast('Back online'); });
  window.addEventListener('offline', function () { render(); toast('You are offline. Everything still works and is saved here.', null, 5000); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); }); // new day while the app stayed open

  /* ------------------------------ start ------------------------------ */
  D.load();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();   // ask the browser not to evict our records
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
  if (!location.hash) history.replaceState(null, '', '#/today');
  render();
})();
