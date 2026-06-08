// scripts/test-demo-provisioning.mjs
//
// Test du provisioning Supabase (Organization + Organization_to_plan +
// Recruiter) avec des données FICTIVES, sans Neon ni Prisma.
//
// Usage :
//   SUPABASE_PRODUCT_URL="https://xxxx.supabase.co" \
//   SUPABASE_PRODUCT_SERVICE_ROLE_KEY="..." \
//   node scripts/test-demo-provisioning.mjs
//
// Options (variables d'env, mêmes défauts que l'app) :
//   SUPABASE_PRODUCT_PLAN_ID, SUPABASE_PRODUCT_RECRUITER_USER_ID,
//   SUPABASE_PRODUCT_SMARTLINK_CREDITS
//
// Nécessite Node 18+ (fetch global).

const URL = (process.env.SUPABASE_PRODUCT_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_PRODUCT_SERVICE_ROLE_KEY || '';

const PLAN_ID = process.env.SUPABASE_PRODUCT_PLAN_ID || 'de1d4cbf-5a51-4de5-9aeb-df8119a65489';
const RECRUITER_USER_ID =
  process.env.SUPABASE_PRODUCT_RECRUITER_USER_ID || 'e05bd473-a010-4658-b0b7-cfd5e344b919';
const SMARTLINK_CREDITS = Number(process.env.SUPABASE_PRODUCT_SMARTLINK_CREDITS) || 3;

if (!URL || !KEY) {
  console.error('❌ Définis SUPABASE_PRODUCT_URL et SUPABASE_PRODUCT_SERVICE_ROLE_KEY.');
  process.exit(1);
}

async function insertRow(table, row) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Insert « ${table} » (${res.status}) : ${text}`);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  // Données fictives
  const fake = {
    brandName: 'Enseigne Test',
    storeName: 'Magasin Test',
    city: 'Paris',
    contactEmail: 'test@example.com',
    phoneNumber: '0102030405',
    siret: '12345678900011',
  };
  const orgName = `${fake.brandName} — ${fake.city}`;

  console.log('→ Création Organization…');
  const org = await insertRow('Organization', {
    name: orgName,
    contact_email: fake.contactEmail,
    phone_number: fake.phoneNumber,
    siret: fake.siret,
  });
  console.log('  ✅ Organization', org.id, `(${orgName})`);

  console.log('→ Création Organization_to_plan…');
  const otp = await insertRow('Organization_to_plan', {
    organization_id: org.id,
    plan_id: PLAN_ID,
    started_at: new Date().toISOString(),
    smartlink_credit_balance: SMARTLINK_CREDITS,
  });
  console.log('  ✅ Organization_to_plan', otp.id);

  console.log('→ Création Recruiter…');
  const rec = await insertRow('Recruiter', {
    user_id: RECRUITER_USER_ID,
    organization_id: org.id,
    is_admin: true,
  });
  console.log('  ✅ Recruiter', rec.id);

  console.log('\n🎉 Provisioning fictif OK. Organization id =', org.id);
}

main().catch((err) => {
  console.error('\n❌ Échec :', err.message);
  process.exit(1);
});
