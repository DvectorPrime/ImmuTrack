/* store.js — load, save and change records. localStorage for the demo.
   To move to IndexedDB later, keep this file's public API and swap the load()/save() internals. */
(function (root) {
  'use strict';
  var S = root.Schedule, KEY = 'immutrack.v1';
  var state = blank(), saveOk = true;

  function blank() {
    return { v: 1, clinicName: '', scheduleVerified: null, verifiedBy: '', seeded: false, children: [], visits: [], messageLog: [], templates: {}, lastBackupAt: null };
  }
  function uid() {
    return (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function normalise(d) {
    var b = blank();
    d = d && typeof d === 'object' ? d : {};
    b.clinicName = typeof d.clinicName === 'string' ? d.clinicName : '';
    b.scheduleVerified = typeof d.scheduleVerified === 'boolean' ? d.scheduleVerified : null;
    b.verifiedBy = typeof d.verifiedBy === 'string' ? d.verifiedBy : '';
    b.seeded = !!d.seeded;
    b.children = Array.isArray(d.children) ? d.children.map(function (c) {
      if (c && typeof c.name === 'string') c.name = c.name.replace(/^Demo\s+/i, '');
      return c;
    }) : [];
    b.visits = Array.isArray(d.visits) ? d.visits : [];
    b.messageLog = Array.isArray(d.messageLog) ? d.messageLog : [];
    b.templates = d.templates && typeof d.templates === 'object' ? d.templates : {};
    b.lastBackupAt = typeof d.lastBackupAt === 'string' ? d.lastBackupAt : null;
    return b;
  }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { saveOk = false; }
    if (raw) {
      try { state = normalise(JSON.parse(raw)); }
      catch (e) {
        // Never silently throw records away: keep the unreadable copy for recovery.
        try { root.localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
        state = blank();
      }
    }
    ensureVisits();
    return state;
  }
  function save() {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); saveOk = true; }
    catch (e) { saveOk = false; }
    return saveOk;
  }
  function ensureVisits() {            // a visit record per child per configured visit
    var changed = false;
    state.children.forEach(function (c) {
      S.CONFIG.visits.forEach(function (v) {
        if (!visitOf(c.id, v.key)) { state.visits.push({ childId: c.id, visitKey: v.key, doneDate: null }); changed = true; }
      });
    });
    if (changed) save();
  }

  /* ------------------------------ reads ------------------------------ */
  function children() { return state.children; }
  function child(id) { return state.children.filter(function (c) { return c.id === id; })[0] || null; }
  function visitOf(childId, key) {
    for (var i = 0; i < state.visits.length; i++)
      if (state.visits[i].childId === childId && state.visits[i].visitKey === key) return state.visits[i];
    return null;
  }
  function key(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function findDuplicate(name, dob, phone, exceptId) {
    return state.children.filter(function (c) {
      return c.id !== exceptId && key(c.name) === key(name) && c.dob === dob && c.phone === phone;
    })[0] || null;
  }

  /* ----------------------------- changes ----------------------------- */
  function applyCustomVisits(childId, dob, customVisits) {
    if (!customVisits || typeof customVisits !== 'object') return;
    S.CONFIG.visits.forEach(function (v) {
      var cv = customVisits[v.key]; if (!cv) return;
      var rec = visitOf(childId, v.key); if (!rec) return;
      var stdDue = S.dueDate(dob, v);
      if (cv.customDue !== undefined) rec.customDue = (cv.customDue && cv.customDue !== stdDue) ? cv.customDue : null;
      if (cv.doneDate !== undefined) rec.doneDate = cv.doneDate || null;
    });
  }
  function addChild(f) {
    var c = { id: uid(), name: f.name.trim(), dob: f.dob, phone: f.phone, altPhone: f.altPhone || '',
      consent: !!f.consent, createdAt: new Date().toISOString() };
    if (f.demo) c.demo = true;
    state.children.push(c);
    S.CONFIG.visits.forEach(function (v) { state.visits.push({ childId: c.id, visitKey: v.key, doneDate: null, customDue: null }); });
    applyCustomVisits(c.id, c.dob, f.customVisits);
    save();
    return c;
  }
  function updateChild(id, f) {
    var c = child(id); if (!c) return null;
    c.name = f.name.trim(); c.dob = f.dob; c.phone = f.phone; c.altPhone = f.altPhone || ''; c.consent = !!f.consent;
    applyCustomVisits(c.id, c.dob, f.customVisits);
    save();
    return c;
  }
  function removeChild(id) {
    state.children = state.children.filter(function (c) { return c.id !== id; });
    state.visits = state.visits.filter(function (v) { return v.childId !== id; });
    state.messageLog = state.messageLog.filter(function (m) { return m.childId !== id; });
    save();
  }
  function setDone(childId, visitKey, date) {   // date = "YYYY-MM-DD" or null (undo)
    var v = visitOf(childId, visitKey);
    if (!v) { v = { childId: childId, visitKey: visitKey, doneDate: null, customDue: null }; state.visits.push(v); }
    var prev = v.doneDate; v.doneDate = date || null; save();
    return prev;
  }
  function setCustomDue(childId, visitKey, date) { // date = "YYYY-MM-DD" or null (reset to standard)
    var v = visitOf(childId, visitKey), c = child(childId);
    if (!v) { v = { childId: childId, visitKey: visitKey, doneDate: null, customDue: null }; state.visits.push(v); }
    var def = c ? S.dueDate(c.dob, S.CONFIG.visits.filter(function (x) { return x.key === visitKey; })[0]) : null;
    var prev = v.customDue || null;
    v.customDue = (date && date !== def) ? date : null;
    save();
    return prev;
  }
  function setFollowup(childId, visitKey, info) { // { contactOutcome, missedReason, contactNote, contactDate }
    var v = visitOf(childId, visitKey);
    if (!v) { v = { childId: childId, visitKey: visitKey, doneDate: null, customDue: null }; state.visits.push(v); }
    var prev = {
      contactOutcome: v.contactOutcome || null,
      missedReason: v.missedReason || null,
      contactNote: v.contactNote || '',
      contactDate: v.contactDate || null
    };
    info = info || {};
    v.contactOutcome = info.contactOutcome || null;
    v.missedReason = info.missedReason || null;
    v.contactNote = String(info.contactNote || '').trim().slice(0, 120);
    v.contactDate = (v.contactOutcome || v.missedReason || v.contactNote) ? (info.contactDate || S.today()) : null;
    save();
    return prev;
  }
  function removeDemo() {
    var ids = state.children.filter(function (c) { return c.demo; }).map(function (c) { return c.id; });
    ids.forEach(removeChild);
    state.seeded = true;
    save();
    return ids.length;
  }
  function loadDemo(today) {
    removeDemo();
    var d = function (daysAgo) { return S.addDays(today, -daysAgo); };
    var rows = [
      { name: 'Amina',  dob: d(63),  phone: '+2348030000101', alt: '+2348020000199', consent: true,  done: [],
        followup: { wk6: { contactOutcome: 'reached_coming', missedReason: 'forgot_date', contactNote: 'Mother promised to come on next clinic day', contactDate: d(1) } } },
      { name: 'Chidi',  dob: d(79),  phone: '+2348050000102', consent: true,  done: ['wk6'] },
      { name: 'Zainab', dob: d(112), phone: '+2348060000103', consent: false, done: ['wk6', 'wk10'],
        followup: { wk14: { contactOutcome: 'no_answer', missedReason: '', contactNote: 'Tried calling twice; will try second visit call', contactDate: today } } },
      { name: 'Tunde',  dob: d(45),  phone: '+2348070000104', consent: true,  done: [] },
      { name: 'Ngozi',  dob: d(75),  phone: '+2348080000105', consent: true,  done: ['wk6'],
        followup: { wk10: { contactOutcome: 'reached_coming', missedReason: 'child_ill', contactNote: 'Child had mild fever on due date', contactDate: today } } },
      { name: 'Bello',  dob: d(42),  phone: '+2348090000106', consent: true,  done: [] },
      { name: 'Halima', dob: d(69),  phone: '+2348100000107', consent: true,  done: ['wk6'] },
      { name: 'Emeka',  dob: d(96),  phone: '+2348120000108', consent: true,  done: ['wk6', 'wk10'] },
      { name: 'Kemi',   dob: d(36),  phone: '+2348130000109', consent: true,  done: [] },
      { name: 'Musa',   dob: d(60),  phone: '+2348140000110', consent: true,  done: ['wk6'] },
      { name: 'Adaeze', dob: d(250), phone: '+2348150000111', consent: true,  done: ['wk6', 'wk10', 'wk14'] },
      { name: 'Sadiq',  dob: d(500), phone: '+2348160000112', consent: true,  done: ['wk6', 'wk10', 'wk14', 'mo9', 'mo15'] }
    ];
    rows.forEach(function (r) {
      var c = addChild({ name: r.name, dob: r.dob, phone: r.phone, altPhone: r.alt || '', consent: r.consent, demo: true });
      r.done.forEach(function (k) {
        var v = S.CONFIG.visits.filter(function (x) { return x.key === k; })[0];
        if (v) setDone(c.id, k, S.dueDate(c.dob, v));
      });
      if (r.followup) {
        Object.keys(r.followup).forEach(function (k) {
          setFollowup(c.id, k, r.followup[k]);
        });
      }
    });
    state.seeded = true;
    save();
    return rows.length;
  }

  /* --------------------------- message log --------------------------- */
  function hasLog(childId, visitKey, type, sendOn) {
    return state.messageLog.some(function (m) {
      return m.childId === childId && m.visitKey === visitKey && m.type === type && m.sendOn === sendOn;
    });
  }
  function addLog(e) {
    state.messageLog.push({ childId: e.childId, visitKey: e.visitKey, type: e.type, sendOn: e.sendOn,
      status: e.status, text: e.text, loggedAt: new Date().toISOString() });
  }

  /* --------------------------- settings etc. ------------------------- */
  function setClinicName(n) { state.clinicName = String(n).slice(0, 60); save(); }
  function clinicName() { return state.clinicName.trim(); }
  function isVerified() { return state.scheduleVerified !== null ? state.scheduleVerified : S.CONFIG.verified; }
  function verifiedBy() { return (state.verifiedBy || S.CONFIG.verifiedBy || '').trim(); }
  function setVerified(val, by) {
    state.scheduleVerified = !!val;
    state.verifiedBy = String(by == null ? state.verifiedBy : by).slice(0, 60);
    save();
  }
  function template(type) { return state.templates[type] != null ? state.templates[type] : S.CONFIG.templates[type]; }
  function setTemplate(type, text) { if (text === S.CONFIG.templates[type]) delete state.templates[type]; else state.templates[type] = text; save(); }
  function markBackup() { state.lastBackupAt = new Date().toISOString(); save(); }

  /* ------------------------ backup and restore ----------------------- */
  function exportData() {
    return { app: 'immutrack', version: 1, exportedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) };
  }
  function validateBackup(obj) {
    if (!obj || obj.app !== 'immutrack' || !obj.data) return { ok: false, error: 'This file is not an ImmuTrack backup.' };
    var d = obj.data;
    if (!Array.isArray(d.children) || !Array.isArray(d.visits)) return { ok: false, error: 'The backup is missing its child or visit records.' };
    var ids = {};
    for (var i = 0; i < d.children.length; i++) {
      var c = d.children[i];
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !S.isISO(c.dob) || typeof c.phone !== 'string')
        return { ok: false, error: 'Child record ' + (i + 1) + ' is damaged, so nothing was restored.' };
      ids[c.id] = true;
    }
    for (var j = 0; j < d.visits.length; j++) {
      var v = d.visits[j];
      if (!v || typeof v.childId !== 'string' || typeof v.visitKey !== 'string' || (v.doneDate !== null && !S.isISO(v.doneDate)) || (v.customDue != null && !S.isISO(v.customDue)))
        return { ok: false, error: 'Visit record ' + (j + 1) + ' is damaged, so nothing was restored.' };
    }
    return { ok: true, children: d.children.length, visits: d.visits.filter(function (v) { return v.doneDate; }).length, exportedAt: obj.exportedAt || null };
  }
  function restore(obj) {
    var n = normalise(obj.data), ids = {};
    n.children.forEach(function (c) { ids[c.id] = true; });
    n.visits = n.visits.filter(function (v) { return ids[v.childId]; });   // drop orphans
    n.messageLog = n.messageLog.filter(function (m) { return !m.childId || ids[m.childId]; });
    state = n; ensureVisits(); save();
  }

  root.Store = {
    load: load, save: save, isSaving: function () { return saveOk; },
    isSeeded: function () { return !!state.seeded; },
    hasDemo: function () { return state.children.some(function (c) { return c.demo; }); },
    children: children, child: child, visitOf: visitOf, findDuplicate: findDuplicate,
    addChild: addChild, updateChild: updateChild, removeChild: removeChild, setDone: setDone, setCustomDue: setCustomDue, setFollowup: setFollowup,
    loadDemo: loadDemo, removeDemo: removeDemo,
    hasLog: hasLog, addLog: addLog, log: function () { return state.messageLog; },
    clinicName: clinicName, setClinicName: setClinicName,
    isVerified: isVerified, verifiedBy: verifiedBy, setVerified: setVerified,
    template: template, setTemplate: setTemplate,
    lastBackupAt: function () { return state.lastBackupAt; }, markBackup: markBackup,
    exportData: exportData, validateBackup: validateBackup, restore: restore
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
