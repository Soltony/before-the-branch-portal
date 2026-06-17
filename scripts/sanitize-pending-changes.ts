import prisma from '../src/lib/prisma';

function removeSensitiveFields(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(removeSensitiveFields);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (k === 'password' || k.toLowerCase().includes('password') || k === 'passwordHash' || k === 'hashedPassword' || k === 'pass') {
      continue;
    }
    const v = obj[k];
    out[k] = (typeof v === 'object' && v !== null) ? removeSensitiveFields(v) : v;
  }
  return out;
}

function removeFileContent(obj: any) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(removeFileContent);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (k === 'fileContent') continue;
    const v = obj[k];
    out[k] = (typeof v === 'object' && v !== null) ? removeFileContent(v) : v;
  }
  return out;
}

async function run() {
  console.log('Scanning pending changes for sensitive fields...');
  const changes = await prisma.pendingChange.findMany();
  console.log(`Found ${changes.length} pending-change records.`);

  let updated = 0;
  for (const ch of changes) {
    try {
      if (!ch.payload) continue;
      // For DataProvisioningUpload and EligibilityList we preserve fileContent but still redact password-like fields
      const preserveFile = ch.entityType === 'DataProvisioningUpload' || ch.entityType === 'EligibilityList';
      let parsed: any;
      try {
        parsed = JSON.parse(ch.payload);
      } catch (e) {
        // Not JSON, skip
        continue;
      }

      ['created', 'updated', 'original'].forEach((p) => {
        if (parsed[p]) {
          if (preserveFile) {
            parsed[p] = removeSensitiveFields(parsed[p]);
          } else {
            parsed[p] = removeFileContent(parsed[p]);
            parsed[p] = removeSensitiveFields(parsed[p]);
          }
        }
      });

      const sanitized = JSON.stringify(removeSensitiveFields(parsed));
      if (sanitized !== ch.payload) {
        await prisma.pendingChange.update({ where: { id: ch.id }, data: { payload: sanitized } });
        updated++;
      }
    } catch (e) {
      console.error(`Failed to sanitize change ${ch.id}:`, e);
    }
  }

  console.log(`Sanitization complete — updated ${updated} records.`);
  await prisma.$disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
