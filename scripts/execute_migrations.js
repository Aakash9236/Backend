const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read .env securely
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

console.log('=== STEP 2: CREATING MIGRATION TRACKING TABLE ===');
runSql(`
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    migration_name varchar(100) NOT NULL UNIQUE,
    executed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_time_ms integer NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'SUCCESS'
);
INSERT INTO public.schema_migrations (migration_name, status)
VALUES ('001_baseline_existing_schema.sql', 'SUCCESS')
ON CONFLICT (migration_name) DO NOTHING;
`);
console.log('schema_migrations table ready.');

// Check already executed migrations
const appliedOutput = runSql('SELECT migration_name FROM public.schema_migrations;');
const alreadyApplied = appliedOutput.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('-') && l !== 'migration_name' && !l.includes('row'));
console.log('Already registered migrations in database:', alreadyApplied);

// Sequential migrations list
const migrations = [
  '002_user_addresses.sql',
  '003_vehicle_fleet.sql',
  '004_shifting_inventory_labor.sql',
  '005_services_rate_cards.sql',
  '006_pricing_rules_coupons.sql',
  '007_bookings_assignments.sql',
  '008_payments_wallets.sql',
  '009_tracking_availability.sql',
  '010_reviews_ratings.sql',
  '011_notifications_audit_logs.sql'
];

const report = [];

for (const mig of migrations) {
  if (alreadyApplied.includes(mig)) {
    console.log(`Migration [${mig}] is already executed. Skipping.`);
    continue;
  }

  console.log(`\n======================================================`);
  console.log(`EXECUTING MIGRATION: ${mig}`);
  console.log(`======================================================`);

  const filePath = path.join('migrations', mig);
  if (!fs.existsSync(filePath)) {
    console.error(`FATAL: Migration file ${filePath} does not exist! Aborting.`);
    process.exit(1);
  }

  // Pre-count tables
  const preCount = parseInt(runSql("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';").match(/\d+/)[0], 10);

  const startTime = Date.now();
  try {
    const out = runSqlFile(filePath);
    const duration = Date.now() - startTime;
    console.log(out.trim());

    // Record success in schema_migrations
    runSql(`
      INSERT INTO public.schema_migrations (migration_name, execution_time_ms, status)
      VALUES ('${mig}', ${duration}, 'SUCCESS');
    `);

    // Post-count tables
    const postCount = parseInt(runSql("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';").match(/\d+/)[0], 10);
    const newTablesCount = postCount - preCount;

    // Check newly created tables in this migration
    const migContent = fs.readFileSync(filePath, 'utf8');
    const expectedTables = [...migContent.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)].map(m => m[1]);

    // Verify each expected table exists
    for (const tbl of expectedTables) {
      const chk = runSql(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}';`);
      if (!chk.includes('1')) {
        throw new Error(`Verification failed: Table [${tbl}] was expected but not found in information_schema!`);
      }
    }

    console.log(`SUCCESS: ${mig} executed in ${duration}ms. Created ${newTablesCount} table(s): ${expectedTables.join(', ')}`);
    report.push({
      migration: mig,
      status: 'SUCCESS',
      durationMs: duration,
      tablesCreated: expectedTables,
      totalTablesInDb: postCount
    });

  } catch (err) {
    console.error(`\nCRITICAL ERROR IN MIGRATION [${mig}]:`);
    console.error(err.message);
    console.error('EXECUTION HALTED. DO NOT PROCEED.');
    process.exit(1);
  }
}

console.log('\n======================================================');
console.log('ALL MIGRATIONS 002-011 EXECUTED SUCCESSFULLY!');
console.log('======================================================');
fs.writeFileSync('scripts/last_execution_report.json', JSON.stringify(report, null, 2));
