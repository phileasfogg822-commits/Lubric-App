#!/usr/bin/env node
/**
 * pair.js — create a device pairing code from the VPS command line.
 *
 *   node pair.js desktop "Front counter PC"
 *   node pair.js mobile  "Kashif's phone"
 *
 * Prints a one-time code; the device enters it in Shop Settings → Cloud & Sync
 * (desktop) or on first launch (APK) to receive its long-lived token.
 */
import crypto from 'node:crypto';
import pool from './db.js';

const kind = (process.argv[2] || 'desktop').toLowerCase();
const name = process.argv[3] || '';
if (!['desktop', 'mobile'].includes(kind)) {
  console.error('Usage: node pair.js <desktop|mobile> [name]');
  process.exit(1);
}

const code = crypto.randomBytes(4).toString('hex').toUpperCase();
const res = await pool.query(
  'INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES ($1, $2, $3, $4) RETURNING id',
  [1, kind, name, code]
);
console.log(`Device #${res.rows[0].id} (${kind}) created.`);
console.log(`Pairing code: ${code}`);
console.log('This code is single-use. The device registers itself with it.');
await pool.end();
