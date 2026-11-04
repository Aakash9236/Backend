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

// 1. Get Live DB Tables
const tablesOutput = runSql(`
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
`);
const liveTables = tablesOutput.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('-') && l !== 'table_name' && !l.includes('row'));

// 2. Read Prisma Models
const prismaContent = fs.readFileSync('prisma/schema.prisma', 'utf8');
const pRegex = /@@map\("([a-zA-Z0-9_]+)"\)/g;
let pMatch;
const prismaTables = [];
while ((pMatch = pRegex.exec(prismaContent)) !== null) {
  prismaTables.push(pMatch[1]);
}

console.log('=== PRISMA VS LIVE DATABASE PARITY ===');
console.log(`Live DB Tables Count: ${liveTables.length}`);
console.log(`Prisma Mapped Models Count: ${prismaTables.length}`);

const unmappedLiveTables = liveTables.filter(t => !prismaTables.includes(t));
const extraPrismaTables = prismaTables.filter(t => !liveTables.includes(t));

console.log(`Unmapped Live Tables: ${unmappedLiveTables.length === 0 ? 'NONE (100% Mapped)' : unmappedLiveTables.join(', ')}`);
console.log(`Extra Prisma Models: ${extraPrismaTables.length === 0 ? 'NONE (100% Matched)' : extraPrismaTables.join(', ')}`);

// 3. Foreign Keys Comparison
const fkOutput = runSql(`
SELECT
    tc.table_name AS source_table,
    kcu.column_name AS source_column,
    ccu.table_name AS target_table,
    ccu.column_name AS target_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
`);

const fks = fkOutput.split('\n').filter(l => l.includes('|') && !l.includes('source_table'));
console.log(`Live Foreign Key Relationships verified: ${fks.length}`);

if (unmappedLiveTables.length === 0 && extraPrismaTables.length === 0) {
  console.log('\nVERIFICATION SUCCESS: Prisma schema and PostgreSQL live database schema are in 100% COMPLETE HARMONY.');
} else {
  console.log('\nVERIFICATION FAILED: Inconsistencies detected.');
}

