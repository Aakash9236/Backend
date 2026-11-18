const { execSync } = require('child_process');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

function runSql(sql) {
  const env = { ...process.env, PGPASSWORD: dbPass };
  const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -v ON_ERROR_STOP=1 -c "${sql}"`;
  return execSync(cmd, { env, encoding: 'utf8' });
}

console.log(runSql('CREATE EXTENSION IF NOT EXISTS btree_gist;'));
console.log(runSql("SELECT extname, extversion FROM pg_extension WHERE extname = 'btree_gist';"));

