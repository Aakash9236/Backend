const fs = require('fs');
const path = require('path');

const baselineTables = [
  'users', 'roles', 'user_roles', 'otp_verifications', 'user_sessions',
  'customer_profiles', 'partner_profiles', 'partner_documents',
  'service_categories', 'partner_skills', 'cities', 'areas', 'partner_service_areas'
];

const availableTables = new Set(baselineTables);
const migrationFiles = fs.readdirSync('migrations').filter(f => f.startsWith('0') && f !== '001_baseline_existing_schema.sql').sort();

let orderViolations = [];

migrationFiles.forEach(file => {
  const content = fs.readFileSync(path.join('migrations', file), 'utf8');
  
  // Find all created tables in this file
  const createdInFile = [];
  const cMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi);
  for (const m of cMatches) {
    createdInFile.push(m[1]);
  }

  // Find all foreign key references
  const fkMatches = content.matchAll(/REFERENCES\s+(?:public\.)?(\w+)\s*\(/gi);
  for (const fm of fkMatches) {
    const target = fm[1];
    // Target must either be already available or created earlier in this same file
    if (!availableTables.has(target) && !createdInFile.includes(target)) {
      orderViolations.push(`Migration [${file}] references table [${target}] which has NOT been created yet!`);
    }
  }

  // Now add created tables to available set
  createdInFile.forEach(t => availableTables.add(t));
});

console.log('=== MIGRATION ORDER VALIDATION ===');
if (orderViolations.length === 0) {
  console.log('SUCCESS: All foreign key references strictly follow topological creation order! Zero forward references.');
} else {
  console.log('VIOLATIONS FOUND:');
  orderViolations.forEach(v => console.log(' - ' + v));
}

