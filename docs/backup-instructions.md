# Database Backup & Disaster Recovery Guide

**Database**: `service_platform_db`  
**Host**: `127.0.0.1:5432`  
**Engine**: PostgreSQL 18.6 (Windows x64)  
**Primary Backup File**: `backups/service_platform_db_backup_20261103_191149.sql`  
**File Size**: 34,392 bytes (1,132 SQL lines, 94 DDL/DML statements)  
**Creation Date**: November 03, 2026

---

## 1. Verified Backup Inventory

| Backup Filename | Format | Content Verified | Status |
| :--- | :--- | :--- | :--- |
| `backups/service_platform_db_backup_20261103_191149.sql` | Plain Text SQL | All 13 existing tables, sequences, constraints, and seeded master records (`roles`, `service_categories`) | Verified & Intact |

---

## 2. Restoration Instructions (Disaster Recovery)

If the database ever needs to be rolled back to the clean baseline state:

### Step 1: Open Terminal / Command Prompt
Ensure PostgreSQL binaries are in PATH or refer to `C:\Program Files\PostgreSQL\18\bin\psql.exe`.

### Step 2: Set Password Environment Variable
```cmd
set PGPASSWORD=your_postgres_password
```
*(In PowerShell: `$env:PGPASSWORD = 'your_postgres_password'`)*

### Step 3: Terminate Active Connections (if any)
```sql
-- Run inside psql as postgres superuser
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'service_platform_db' AND pid <> pg_backend_pid();
```

### Step 4: Recreate Clean Database
```cmd
"C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -h 127.0.0.1 -p 5432 -U postgres service_platform_db
"C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h 127.0.0.1 -p 5432 -U postgres service_platform_db
```

### Step 5: Restore Schema & Data from Backup
```cmd
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -f backups/service_platform_db_backup_20261103_191149.sql
```

---

## 3. Creating Future Backups Before Migrations

Har migration se pehle backup lene ke liye PowerShell script:

```powershell
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$envContent = Get-Content -Raw .env
$dbPass = ($envContent -split "`n" | Where-Object { $_ -match "^DB_PASSWORD=" }) -replace "^DB_PASSWORD=", ""
$env:PGPASSWORD = $dbPass.Trim()

& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db --format=plain --file="backups/backup_$timestamp.sql"
$env:PGPASSWORD = ''
```

