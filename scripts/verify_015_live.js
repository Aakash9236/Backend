const { execSync } = require('child_process');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

function runSql(sql) {
  const env = { ...process.env, PGPASSWORD: dbPass };
  const cmd = `"${psqlPath}" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -v ON_ERROR_STOP=1 -f -`;
  return execSync(cmd, { env, input: sql, encoding: 'utf8' });
}

console.log('--- 1. NEW WORKER TABLES IN PUBLIC SCHEMA ---');
console.log(runSql(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
    AND table_name IN (
      'worker_profiles', 
      'worker_documents', 
      'worker_skills', 
      'worker_invitations', 
      'worker_partner_affiliations', 
      'worker_availability'
    )
  ORDER BY table_name;
`));

console.log('--- 2. CONSTRAINTS ON NEW WORKER TABLES ---');
console.log(runSql(`
  SELECT conname, contype, conrelid::regclass AS table_name, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid::regclass::text IN (
    'worker_profiles', 
    'worker_documents', 
    'worker_skills', 
    'worker_invitations', 
    'worker_partner_affiliations', 
    'worker_availability'
  )
  ORDER BY table_name, conname;
`));

console.log('--- 3. INDEXES ON NEW WORKER TABLES ---');
console.log(runSql(`
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE tablename IN (
    'worker_profiles', 
    'worker_documents', 
    'worker_skills', 
    'worker_invitations', 
    'worker_partner_affiliations', 
    'worker_availability'
  )
  ORDER BY tablename, indexname;
`));
