const fs = require('fs');

const prismaContent = fs.readFileSync('prisma/schema.prisma', 'utf8');

// Match each model using regex: model ModelName { ... }
const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
let match;
const models = {};

while ((match = modelRegex.exec(prismaContent)) !== null) {
  const modelName = match[1];
  const body = match[2];
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  
  const fields = [];
  let mappedTable = modelName;
  const uniqueConstraints = [];
  const indexes = [];

  lines.forEach(l => {
    if (l.startsWith('@@map(')) {
      mappedTable = l.match(/@@map\("([^"]+)"\)/)[1];
    } else if (l.startsWith('@@unique(')) {
      uniqueConstraints.push(l);
    } else if (l.startsWith('@@index(')) {
      indexes.push(l);
    } else {
      const parts = l.split(/\s+/);
      const fieldName = parts[0];
      const fieldType = parts[1];
      const attributes = parts.slice(2).join(' ');
      fields.push({ fieldName, fieldType, attributes });
    }
  });

  models[modelName] = {
    mappedTable,
    fields,
    uniqueConstraints,
    indexes
  };
}

console.log('Total models parsed:', Object.keys(models).length);
Object.entries(models).forEach(([name, m]) => {
  const pk = m.fields.find(f => f.attributes.includes('@id'));
  const fks = m.fields.filter(f => f.attributes.includes('@relation'));
  console.log(`Model [${name}] -> Table [${m.mappedTable}] | PK: ${pk ? pk.fieldName : 'NONE'} | Relations: ${fks.length}`);
});
