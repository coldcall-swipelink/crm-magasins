// src/app/api/campaigns/schema-repair/route.ts
//
//   POST /api/campaigns/schema-repair  → crée ce qui manque des tables de
//        l'outil Campagnes, et renvoie ce qui a été appliqué.
//
// Pourquoi cette route en plus de /api/admin/db-sync : la synchronisation de
// schéma du build ne fait jamais échouer le déploiement (volontairement, pour
// qu'un souci de connexion ne bloque pas toutes les mises en production). Quand
// elle n'aboutit pas, l'application démarre devant une base en retard, et la
// seule issue était de coller une URL à la main dans la barre d'adresse.
//
// Le bandeau d'erreur porte désormais le bouton qui appelle cette route. Elle
// est donc volontairement PLUS ÉTROITE que db-sync : uniquement les
// instructions des tables de l'outil Campagnes, toutes en « IF NOT EXISTS ».
// Et sans jeton dans le navigateur — il n'y a pas de secret à embarquer dans
// le paquet envoyé au client.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CAMPAIGN_SCHEMA_STATEMENTS } from '@/lib/campaigns/schemaSql';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  const errors: Array<{ sql: string; error: string }> = [];
  let applied = 0;

  for (const sql of CAMPAIGN_SCHEMA_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      applied++;
    } catch (err) {
      errors.push({
        // Première ligne seulement : de quoi reconnaître l'instruction sans
        // déverser un CREATE TABLE entier dans un message d'erreur.
        sql: sql.split('\n')[0].slice(0, 120),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    applied,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
  }, { status: errors.length === 0 ? 200 : 500 });
}
