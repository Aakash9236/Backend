const fs = require('fs');
const path = require('path');

// 1. Existing 13 tables from audit
const existingTables = [
  'users',
  'roles',
  'user_roles',
  'otp_verifications',
  'user_sessions',
  'customer_profiles',
  'partner_profiles',
  'partner_documents',
  'service_categories',
  'partner_skills',
  'cities',
  'areas',
  'partner_service_areas'
].sort();

// 2. Migration files 002 to 011
const migrationsDir = 'migrations';
const migFiles = fs.readdirSync(migrationsDir).filter(f => f.startsWith('0') && f !== '001_baseline_existing_schema.sql').sort();

const migrationTablesMap = {};
const migrationAllTables = [];

migFiles.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi;
  let match;
  const list = [];
  while ((match = regex.exec(content)) !== null) {
    list.push(match[1]);
    migrationAllTables.push(match[1]);
  }
  migrationTablesMap[file] = list;
});

// 3. Prisma schema tables
const prismaContent = fs.readFileSync('prisma/schema.prisma', 'utf8');
const pRegex = /@@map\("([a-zA-Z0-9_]+)"\)/g;
let pMatch;
const prismaTables = [];
while ((pMatch = pRegex.exec(prismaContent)) !== null) {
  prismaTables.push(pMatch[1]);
}

console.log('=== 1. BASELINE EXISTING TABLES (COUNT: ' + existingTables.length + ') ===');
console.log(existingTables);

console.log('\n=== 2. MIGRATION TABLES BREAKDOWN ===');
let totalMigTables = 0;
Object.entries(migrationTablesMap).forEach(([file, tbls]) => {
  console.log(`${file} (${tbls.length}): ${tbls.join(', ')}`);
  totalMigTables += tbls.length;
});
console.log('Total new tables across migrations 002-011:', totalMigTables);

console.log('\n=== 3. PRISMA SCHEMA TABLES (COUNT: ' + prismaTables.length + ') ===');
console.log(prismaTables.sort());

// Check if any migration tables overlap with existing tables
const overlap = migrationAllTables.filter(t => existingTables.includes(t));
console.log('\nOverlap between existing and migration tables:', overlap);

// Compare migration tables vs prisma tables
const totalExpected = [...existingTables, ...migrationAllTables].sort();
console.log('\nTotal Expected Tables (13 existing + ' + migrationAllTables.length + ' migration) = ' + totalExpected.length);

const missingInPrisma = totalExpected.filter(t => !prismaTables.includes(t));
const extraInPrisma = prismaTables.filter(t => !totalExpected.includes(t));
console.log('Missing in Prisma:', missingInPrisma);
console.log('Extra in Prisma:', extraInPrisma);

