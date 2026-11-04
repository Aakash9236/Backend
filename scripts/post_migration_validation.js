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

console.log('=== STEP 4: FINAL POST-MIGRATION VALIDATION ===\n');

// 1. All Tables
const tablesOutput = runSql(`
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
`);

const allTables = tablesOutput.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('-') && l !== 'table_name' && !l.includes('row'));
console.log(`Total Tables in public schema: ${allTables.length}`);

// 2. Baseline Tables (13)
const baseline = [
  'areas', 'cities', 'customer_profiles', 'otp_verifications', 'partner_documents',
  'partner_profiles', 'partner_service_areas', 'partner_skills', 'roles',
  'service_categories', 'user_roles', 'user_sessions', 'users'
];

const missingBaseline = baseline.filter(t => !allTables.includes(t));
console.log(`Baseline Tables Check: ${missingBaseline.length === 0 ? 'ALL 13 INTACT' : 'FAILED: Missing ' + missingBaseline.join(', ')}`);

// 3. New Migration Tables (27)
const newTables = [
  'audit_logs', 'booking_assignments', 'booking_inventory_items', 'booking_items',
  'booking_labor_details', 'booking_status_history', 'bookings', 'coupons',
  'fare_breakdowns', 'inventory_categories', 'inventory_items', 'notifications',
  'partner_availability', 'partner_live_locations', 'partner_location_history',
  'partner_vehicles', 'partner_wallets', 'payments', 'pricing_rules', 'refunds',
  'reviews_ratings', 'service_rate_cards', 'services', 'user_addresses',
  'vehicle_types', 'vehicles', 'wallet_transactions'
];

const missingNew = newTables.filter(t => !allTables.includes(t));
console.log(`New Migration Tables Check: ${missingNew.length === 0 ? 'ALL 27 CREATED' : 'FAILED: Missing ' + missingNew.join(', ')}`);

// Platform Tables (40) + schema_migrations (1) = 41
console.log(`Core Business Platform Tables: ${allTables.filter(t => t !== 'schema_migrations').length} / 40`);
console.log(`Tracking Table Present: ${allTables.includes('schema_migrations') ? 'YES (schema_migrations)' : 'NO'}`);

// 4. Seed Data Integrity Check
const rolesCount = parseInt(runSql("SELECT count(*) FROM roles;").match(/\d+/)[0], 10);
const categoriesCount = parseInt(runSql("SELECT count(*) FROM service_categories;").match(/\d+/)[0], 10);
console.log(`\nSeed Data Check:`);
console.log(` - roles: ${rolesCount} (Expected: 6) -> ${rolesCount === 6 ? 'PASSED' : 'FAILED'}`);
console.log(` - service_categories: ${categoriesCount} (Expected: 14) -> ${categoriesCount === 14 ? 'PASSED' : 'FAILED'}`);

// 5. Foreign Keys Count & Constraints
const fkCount = parseInt(runSql(`
SELECT count(*) 
FROM information_schema.table_constraints 
WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY';
`).match(/\d+/)[0], 10);
console.log(`\nForeign Key Constraints in Database: ${fkCount}`);

// 6. Total Indexes Count
const indexCount = parseInt(runSql(`
SELECT count(*) 
FROM pg_indexes 
WHERE schemaname = 'public';
`).match(/\d+/)[0], 10);
console.log(`Total Indexes in Database: ${indexCount}`);

// 7. Migration Log Records
const migLogOutput = runSql("SELECT migration_name, status, execution_time_ms FROM public.schema_migrations ORDER BY id;");
console.log('\nMigration Tracking Table Log:');
console.log(migLogOutput.trim());

