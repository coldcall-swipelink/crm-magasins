// scripts/set-user-password.ts
//
// Fixe (au préalable) l'email et le mot de passe d'un utilisateur du CRM.
// Crée le compte s'il n'existe pas encore, sinon met à jour ses identifiants.
//
// Utilisation :
//   npm run user:set-password -- --email prenom@swipelink.fr --password "MonMotDePasse" --name "Prénom Nom"
//
// Options :
//   --email     (obligatoire) email de connexion
//   --password  (obligatoire) mot de passe en clair (sera haché avant stockage)
//   --name      (facultatif)  nom affiché ; par défaut, la partie avant @ de l'email
//   --color     (facultatif)  couleur d'avatar hex (ex : #6366f1)
//
// Le mot de passe n'est jamais stocké en clair : seul le hash scrypt l'est.
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';

const prisma = new PrismaClient();

// Réimplémenté ici (plutôt qu'importé de src/lib/password) pour rester
// autonome sous ts-node avec le tsconfig du projet.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const USER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#0ea5e9',
];
function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

async function main() {
  const email = (getArg('--email') || '').trim().toLowerCase();
  const password = getArg('--password') || '';
  const name = (getArg('--name') || '').trim() || (email ? email.split('@')[0] : '');
  const color = getArg('--color');

  if (!email || !password) {
    console.error('❌ --email et --password sont obligatoires.');
    console.error('   Ex : npm run user:set-password -- --email prenom@swipelink.fr --password "MotDePasse" --name "Prénom Nom"');
    process.exit(1);
  }

  const passwordHash = hashPassword(password);

  // Retrouve le compte par email, puis en secours par nom (pour rattacher les
  // identifiants à un utilisateur historique créé sans email).
  let existing = await prisma.user.findFirst({ where: { email } });
  if (!existing && name) existing = await prisma.user.findFirst({ where: { name } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { email, passwordHash, name: name || existing.name, ...(color ? { color } : {}) },
    });
    console.log(`✅ Mot de passe mis à jour pour ${email} (${name || existing.name}).`);
  } else {
    await prisma.user.create({
      data: { email, name, passwordHash, color: color || pickColor(name) },
    });
    console.log(`✅ Compte créé : ${email} (${name}).`);
  }
}

main()
  .catch((e) => { console.error('❌ Erreur:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
