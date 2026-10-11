require('dotenv').config();
const db = require('./db');

(async () => {
  await db.init();
  const tables = await db.q('SHOW TABLES');
  for (const t of tables) {
    const name = Object.values(t)[0];
    const { c } = await db.one(`SELECT COUNT(*) AS c FROM \`${name}\``);
    console.log(`\n=== ${name} (${c} rows) ===`);
    const rows = await db.q(`SELECT * FROM \`${name}\` LIMIT 5`);
    rows.forEach((r) => { if (r.password_hash) r.password_hash = '***'; });
    console.table(rows);
  }
  process.exit(0);
})().catch((e) => { console.error('DB error:', e.message); process.exit(1); });