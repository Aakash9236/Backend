const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

function runSql(sql) {
  const env = { ...process.env, PGPASSWORD: dbPass };
  const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -v ON_ERROR_STOP=1 -c "${sql}"`;
  return execSync(cmd, { env, encoding: 'utf8' });
}

console.log('--- MIGRATIONS IN DB ---');
console.log(runSql('SELECT id, migration_name, executed_at, status FROM public.schema_migrations ORDER BY id;'));

console.log('--- CHECK BTREE_GIST EXTENSION AVAILABILITY ---');
console.log(runSql("SELECT name, default_version, installed_version, comment FROM pg_available_extensions WHERE name = 'btree_gist';"));

console.log('--- CHECK IF BTREE_GIST ALREADY INSTALLED ---');
console.log(runSql("SELECT extname, extversion FROM pg_extension WHERE extname = 'btree_gist';"));

