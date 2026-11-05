const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync('.env', 'utf8');
const dbPassMatch = envContent.split('\n').find(l => l.startsWith('DB_PASSWORD='));
const dbPass = dbPassMatch ? dbPassMatch.replace('DB_PASSWORD=', '').trim() : '';

const pgDumpPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';

const now = new Date();
const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backupFileName = `service_platform_db_backup_${timestamp}_phase6d_pre_m1.sql`;
const backupDir = path.resolve('backups');

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const backupPath = path.join(backupDir, backupFileName);

console.log(`Starting database backup to: ${backupPath}`);
const env = { ...process.env, PGPASSWORD: dbPass };
const cmd = `"${pgDumpPath}" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db --clean --if-exists -f "${backupPath}"`;

execSync(cmd, { env, stdio: 'inherit' });

const stats = fs.statSync(backupPath);
console.log(`Backup completed successfully! Size: ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`);
console.log(`Backup file: ${backupPath}`);

