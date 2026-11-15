// Run:  node tests/schedule.test.js
const S = require('../schedule.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)));
}
const due = (dob) => S.CONFIG.visits.map((v) => S.dueDate(dob, v));

// Brief's table
eq('2026-01-10 -> 6w,10w,14w,9m,15m', due('2026-01-10'),
  ['2026-02-21', '2026-03-21', '2026-04-18', '2026-10-10', '2027-04-10']);
// Month-end clamping
eq('31 May + 9 months = 28 Feb 2027', S.dueDate('2026-05-31', S.CONFIG.visits[3]), '2027-02-28');
eq('29 Feb 2024 + 15 months = 29 May 2025', S.dueDate('2024-02-29', S.CONFIG.visits[4]), '2025-05-29');
eq('31 Aug + 9 months = 31 May', S.addMonths('2026-08-31', 9), '2027-05-31');
eq('31 Jan + 1 month, leap year = 29 Feb', S.addMonths('2024-01-31', 1), '2024-02-29');
eq('year wrap: 15 Nov + 3 months', S.addMonths('2026-11-15', 3), '2027-02-15');
eq('negative months', S.addMonths('2026-03-31', -1), '2026-02-28');

// Status rules (today = 2026-11-14)
const T = '2026-11-14', st = (d) => S.status(d, null, T);
eq('due in 3 days = upcoming', st('2026-11-17').state, 'upcoming');
eq('due in 2 days = due', st('2026-11-16'), { state: 'due', days: 2 });
eq('due today = due', st('2026-11-14'), { state: 'due', days: 0 });
eq('1 day overdue = overdue', st('2026-11-13'), { state: 'overdue', days: 1 });
eq('6 days overdue = overdue', st('2026-11-08').state, 'overdue');
eq('7 days overdue = defaulter', st('2026-11-07'), { state: 'defaulter', days: 7 });
eq('done is never overdue', S.status('2020-01-01', '2020-01-05', T).state, 'done');
eq('DST-proof day count', S.diffDays('2026-03-28', '2026-03-30'), 2);

// Reminders: -2, -1 before; +1, +7 after (design choices)
eq('message dates for due 2026-02-21', S.messagesFor('2026-02-21'),
  [{ type: 'reminder', sendOn: '2026-02-19' }, { type: 'reminder', sendOn: '2026-02-20' },
   { type: 'recall', sendOn: '2026-02-22' }, { type: 'recall', sendOn: '2026-02-28' }]);

// Phones
const ph = (x) => { const r = S.normalisePhone(x); return r.ok ? r.value : 'ERR'; };
eq('0803 123 4567', ph('0803 123 4567'), '+2348031234567');
eq('803-123-4567', ph('803-123-4567'), '+2348031234567');
eq('+234 803 123 4567', ph('+234 803 123 4567'), '+2348031234567');
eq('2348031234567', ph('2348031234567'), '+2348031234567');
eq('+234 0803 123 4567', ph('+234 0803 123 4567'), '+2348031234567');
eq('too short', ph('0803 123 456'), 'ERR');
eq('too long', ph('0803 123 45678'), 'ERR');
eq('wrong prefix', ph('0603 123 4567'), 'ERR');
eq('letters', ph('0803abc4567'), 'ERR');
eq('other country', ph('+44 7911 123456'), 'ERR');
eq('empty flagged', S.normalisePhone('').empty, true);
eq('format', S.formatPhone('+2348031234567'), '+234 803 123 4567');

// Age and DOB checks
eq('age 6 days', S.ageText('2026-11-08', T), '6 days old');
eq('age 10 weeks', S.ageText('2026-09-05', T), '10 weeks old');
eq('age 9 months', S.ageText('2026-02-14', T), '9 months old');
eq('age 1 yr 3 mo', S.ageText('2025-08-14', T), '1 year 3 mo old');
eq('over 2 years: yes', S.olderThan2Years('2024-11-13', T), true);
eq('over 2 years: exactly 2y = no', S.olderThan2Years('2024-11-14', T), false);
eq('invalid date rejected', S.isISO('2026-02-30'), false);

// Templates
eq('render', S.render('Hi {child} {x}', { child: 'Ada' }), 'Hi Ada {x}');
eq('unknown token', S.unknownTokens('{child} {foo}'), ['{foo}']);
const longest = S.render(S.CONFIG.templates.recall, { child: 'Oluwadamilare', clinic: 'Ibadan North Primary Health Centre', visit: '15 months', date: '28 Feb 2027' });
console.log('INFO longest recall message = ' + longest.length + ' chars');

// Demo date override (?today=YYYY-MM-DD)
global.location = { search: '?today=2026-12-01' };
eq('demo date override today()', S.today(), '2026-12-01');
eq('demo date override isDemoDate()', S.isDemoDate(), true);
global.location = { search: '?today=not-a-date' };
eq('invalid demo date ignored', S.isDemoDate(), false);
delete global.location;

// Store custom scheduling & verification checks
const mem = {};
global.Schedule = S;
global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
require('../store.js');
const D = global.Store;
D.load();
const child = D.addChild({
  name: 'Kola',
  dob: '2026-01-10',
  phone: '+2347047386742',
  consent: true,
  customVisits: { wk6: { doneDate: '2026-02-22' }, wk10: { customDue: '2026-04-04' } }
});
eq('custom doneDate at enrol', D.visitOf(child.id, 'wk6').doneDate, '2026-02-22');
eq('custom dueDate at enrol', D.visitOf(child.id, 'wk10').customDue, '2026-04-04');
D.setCustomDue(child.id, 'wk14', '2026-05-02');
eq('setCustomDue updates visit', D.visitOf(child.id, 'wk14').customDue, '2026-05-02');
D.setCustomDue(child.id, 'wk14', '2026-04-18'); // standard date resets customDue to null
eq('setCustomDue to standard resets to null', D.visitOf(child.id, 'wk14').customDue, null);
D.setVerified(true, 'Matron Adebayo');
eq('clinic schedule verification saved', [D.isVerified(), D.verifiedBy()], [true, 'Matron Adebayo']);
eq('backup with customDue validates', D.validateBackup(D.exportData()).ok, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
