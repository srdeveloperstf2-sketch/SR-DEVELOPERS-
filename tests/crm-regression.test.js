import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const auth = read('auth.js');
const cloud = read('cloud-sync.js');
const registerPush = read('supabase/functions/register-push-device/index.ts');
const delivery = read('supabase/functions/deliver-crm-push/index.ts');
const roles = read('supabase/role_access_migration.sql');
const hardening = read('supabase/final_hardening_migration.sql');
const workflow = read('.github/workflows/android-apk.yml');

test('auth session verifies active staff profile', () => {
  assert.match(auth, /from\('profiles'\)\.select\('full_name,role,is_active,employee_code'\)/);
  assert.match(auth, /sr-auth-ready/);
});

test('RLS role helpers enforce active admin and scoped lead access', () => {
  assert.match(roles, /p\.role='admin' and p\.is_active=true/);
  assert.match(roles, /create or replace function public\.can_access_lead/);
  assert.match(roles, /l\.assigned_to=auth\.uid\(\)/);
  assert.match(roles, /create policy leads_read_scope/);
});

test('team-leader and manager access uses recursive reporting scope', () => {
  assert.match(hardening, /create or replace function public\.is_in_my_team/);
  assert.match(hardening, /with recursive team\(id\)/);
  assert.match(hardening, /create policy crm_records_read_scope/);
  assert.match(hardening, /owner_id=auth\.uid\(\)/);
});

test('cloud sync does not upload inaccessible owner records', () => {
  assert.match(cloud, /const canWriteOwner=ownerId=>!!ownerId/);
  assert.match(cloud, /if\(!canWriteOwner\(ownerId\)\)continue/);
  assert.match(cloud, /Fail closed if a parent lead is not hydrated/);
});

test('device token endpoint validates login and active profile', () => {
  assert.match(registerPush, /auth\.getUser\(\)/);
  assert.match(registerPush, /Active CRM staff account required/);
  assert.match(registerPush, /token\.length<40\|\|token\.length>4096/);
});

test('FCM dispatcher requires secret and bounded retry queue', () => {
  assert.match(delivery, /x-cron-secret/);
  assert.match(delivery, /req\.headers\.get\("x-cron-secret"\)!==secret/);
  assert.match(delivery, /\.lt\("attempts",8\)/);
  assert.match(delivery, /FCM OAuth failed/);
});

test('Android workflow validates code, Firebase config and artifact', () => {
  assert.match(workflow, /node --check push-client\.js/);
  assert.match(workflow, /GOOGLE_SERVICES_JSON_BASE64/);
  assert.match(workflow, /in\.srdevelopers\.crm/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
