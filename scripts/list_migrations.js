const { execSync } = require('child_process');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const env = { ...process.env, PGPASSWORD: dbPass };

const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -c "SELECT id, migration_name, executed_at, status FROM schema_migrations ORDER BY id;"`;
const output = execSync(cmd, { env, encoding: 'utf8' });
console.log(output);
