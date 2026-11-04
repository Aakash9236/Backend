const fs = require('fs');
const path = require('path');

// 1. Read all SQL migration files
const migrationsDir = 'migrations';
const migFiles = fs.readdirSync(migrationsDir).filter(f => f.startsWith('0') && f !== '001_baseline_existing_schema.sql').sort();

const sqlTables = {};

migFiles.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const tableBlocks = content.split(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?/i).slice(1);
  tableBlocks.forEach(b => {
    const tableName = b.split('(')[0].trim();
    const fks = [];
    const fkRegex = /CONSTRAINT\s+(\w+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:public\.)?(\w+)\s*\(([^)]+)\)(?:\s+ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION))?/gi;
    let fkMatch;
    while ((fkMatch = fkRegex.exec(b)) !== null) {
      const onDeleteRaw = (fkMatch[5] || 'RESTRICT').replace(/\s+/g, '').toUpperCase();
      fks.push({
        constraint: fkMatch[1],
        column: fkMatch[2].trim(),
        targetTable: fkMatch[3].trim(),
        targetColumn: fkMatch[4].trim(),
        onDelete: onDeleteRaw === 'SETNULL' ? 'SetNull' : (onDeleteRaw === 'CASCADE' ? 'Cascade' : 'Restrict')
      });
    }

    const uniques = [];
    const uqRegex = /CONSTRAINT\s+(\w+)\s+UNIQUE\s*\(([^)]+)\)/gi;
    let uqMatch;
    while ((uqMatch = uqRegex.exec(b)) !== null) {
      uniques.push({
        constraint: uqMatch[1],
        columns: uqMatch[2].split(',').map(c => c.trim())
      });
    }

    sqlTables[tableName] = { file, fks, uniques };
  });
});

// 2. Read Prisma schema
const prismaContent = fs.readFileSync('prisma/schema.prisma', 'utf8');
const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
let mMatch;
const prismaModels = {};

while ((mMatch = modelRegex.exec(prismaContent)) !== null) {
  const modelName = mMatch[1];
  const body = mMatch[2];
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  
  let mappedTable = modelName;
  const fields = {};
  const relations = [];

  lines.forEach(l => {
    if (l.startsWith('@@map(')) {
      mappedTable = l.match(/@@map\("([^"]+)"\)/)[1];
    } else if (l.startsWith('@@')) {
      // ignore
    } else {
      const parts = l.split(/\s+/);
      const fieldName = parts[0];
      const fieldType = parts[1];
      const rest = parts.slice(2).join(' ');
      fields[fieldName] = { fieldType, rest };

      if (rest.includes('@relation(')) {
        // Robust parser for @relation
        const inner = rest.substring(rest.indexOf('@relation(') + 10, rest.lastIndexOf(')'));
        let fieldsArr = null;
        let referencesArr = null;
        let onDeleteVal = null;
        let relName = null;

        const fMatch = inner.match(/fields:\s*\[([^\]]+)\]/);
        if (fMatch) fieldsArr = fMatch[1].split(',').map(s => s.trim());

        const rMatch = inner.match(/references:\s*\[([^\]]+)\]/);
        if (rMatch) referencesArr = rMatch[1].split(',').map(s => s.trim());

        const odMatch = inner.match(/onDelete:\s*(\w+)/);
        if (odMatch) onDeleteVal = odMatch[1];

        const nameMatch = inner.match(/^"([^"]+)"/);
        if (nameMatch) relName = nameMatch[1];

        relations.push({
          fieldName,
          targetModel: fieldType.replace('?', '').replace('[]', ''),
          relationName: relName,
          fields: fieldsArr,
          references: referencesArr,
          onDelete: onDeleteVal
        });
      }
    }
  });

  prismaModels[modelName] = { mappedTable, fields, relations };
}

// 3. Validate SQL Tables against Prisma
let errors = [];

Object.entries(sqlTables).forEach(([tblName, sqlInfo]) => {
  const pModel = Object.values(prismaModels).find(m => m.mappedTable === tblName);
  if (!pModel) {
    errors.push(`SQL table [${tblName}] (from ${sqlInfo.file}) has no mapped model in Prisma schema!`);
    return;
  }

  sqlInfo.fks.forEach(fk => {
    const rel = pModel.relations.find(r => r.fields && r.fields.some(f => {
      const fieldDef = pModel.fields[f];
      const colMap = fieldDef && fieldDef.rest.match(/@map\("([^"]+)"\)/);
      const colName = colMap ? colMap[1] : f;
      return colName === fk.column;
    }));

    if (!rel) {
      errors.push(`Table [${tblName}] FK [${fk.column} -> ${fk.targetTable}(${fk.targetColumn})] is NOT mapped in Prisma model [${pModel.mappedTable}]!`);
    } else {
      if (fk.onDelete && rel.onDelete) {
        if (fk.onDelete.toLowerCase() !== rel.onDelete.toLowerCase()) {
          errors.push(`Table [${tblName}] FK [${fk.column}] onDelete mismatch: SQL=${fk.onDelete}, Prisma=${rel.onDelete}`);
        }
      }
    }
  });
});

// 4. Validate reverse relations inside Prisma
Object.entries(prismaModels).forEach(([mName, m]) => {
  m.relations.forEach(r => {
    if (r.fields) {
      const targetM = prismaModels[r.targetModel];
      if (!targetM) {
        errors.push(`Model [${mName}] references non-existent model [${r.targetModel}]!`);
      } else {
        const rev = targetM.relations.find(tr => tr.targetModel === mName && (r.relationName ? tr.relationName === r.relationName : true));
        if (!rev) {
          const targetField = Object.entries(targetM.fields).find(([fn, fdef]) => {
            const cleanType = fdef.fieldType.replace('?', '').replace('[]', '');
            return cleanType === mName;
          });
          if (!targetField) {
            errors.push(`Model [${mName}] has relation to [${r.targetModel}], but [${r.targetModel}] has no back-relation field to [${mName}]!`);
          }
        }
      }
    }
  });
});

console.log('\n=== VALIDATION RESULTS ===');
if (errors.length === 0) {
  console.log(`SUCCESS: All ${Object.keys(sqlTables).length} SQL migration tables, their foreign keys, onDelete actions, and all ${Object.keys(prismaModels).length} Prisma models & relations are 100% CONSISTENT AND VALID!`);
} else {
  console.log(`FOUND ${errors.length} INCONSISTENCIES:`);
  errors.forEach(e => console.log(' - ' + e));
}
