const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

function runSql(sql, dbName = 'service_platform_db') {
  const env = { ...process.env, PGPASSWORD: dbPass };
  const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -f -`;
  return execSync(cmd, { env, input: sql, encoding: 'utf8' });
}

function runSqlFile(filePath, dbName = 'service_platform_db') {
  const env = { ...process.env, PGPASSWORD: dbPass };
  const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -f "${filePath}"`;
  return execSync(cmd, { env, encoding: 'utf8' });
}

console.log('=== EXECUTING MIGRATION: 014_driver_management_assignment.sql ===');
const migFile = path.resolve('migrations', '014_driver_management_assignment.sql');

const startTime = Date.now();
const output = runSqlFile(migFile);
const duration = Date.now() - startTime;
console.log(output);

// Record in schema_migrations
runSql(`
  INSERT INTO public.schema_migrations (migration_name, execution_time_ms, status)
  VALUES ('014_driver_management_assignment.sql', ${duration}, 'SUCCESS')
  ON CONFLICT (migration_name) DO NOTHING;
`);

console.log('Migration 014 applied and registered in schema_migrations successfully.');

