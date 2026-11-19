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

test('cloud sync cache quota failures do not abort initialization', () => {
  assert.match(cloud, /function safeCacheSave\(db\)\{try\{localStorage\.setItem/);
  assert.match(cloud, /CRM local cache save failed; cloud remains primary/);
  assert.equal((cloud.match(/safeCacheSave\(db\);/g)||[]).length, 3);
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

test('Supabase live preflight report is read-only and checks critical backend gates', () => {
  const preflight = read('supabase/live_preflight_readonly.sql');
  assert.match(preflight, /READ-ONLY/);
  assert.match(preflight, /push_device_tokens/);
  assert.match(preflight, /crm_push_jobs/);
  assert.match(preflight, /Duplicate active plot\/unit bookings/);
  assert.match(preflight, /FCM cron schedule/);
  assert.match(preflight, /Security helper public/);
});

test('FCM cron setup uses Supabase Vault and schedules a single named job', () => {
  const setupSql = read('supabase/fcm_cron_setup.sql');
  assert.match(setupSql, /crm_project_url/);
  assert.match(setupSql, /crm_push_dispatch_secret/);
  assert.match(setupSql, /cron\.schedule/);
  assert.match(setupSql, /deliver-crm-push/);
  assert.match(setupSql, /net\.http_post/);
  assert.match(setupSql, /Vault entries/);
});

test('Supabase Edge Function gateway auth config', () => {
  const cfg = read('supabase/config.toml');
  assert.match(cfg, /\[functions\.deliver-crm-push\]\s+verify_jwt = false/);
  assert.match(cfg, /\[functions\.register-push-device\]\s+verify_jwt = true/);
});

test('employee login accepts common stored phone formats', () => {
  const loginFn = read('supabase/functions/login-with-employee-code/index.ts');
  assert.match(loginFn, /const phoneVariants = mobile \? \[mobile, mobile\.slice\(1\), mobile\.slice\(2\), digits/);
  assert.match(loginFn, /\.in\("phone", phoneVariants\)/);
  assert.match(loginFn, /\.ilike\("employee_code", code\)/);
});

test('native push registration is disabled when Firebase config is absent', () => {
  const push = read('push-client.js');
  const html = read('index.html');
  const workflow = read('.github/workflows/android-apk.yml');
  assert.match(push, /SR_FCM_CONFIGURED!==true/);
  assert.match(html, /fcm-config-status\.js/);
  assert.match(workflow, /SR_FCM_CONFIGURED=true/);
  assert.match(workflow, /SR_FCM_CONFIGURED=false/);
});

test('auth emits readiness once and native app skips service-worker registration', () => {
  const authCode = read('auth.js');
  const html = read('index.html');
  assert.equal((authCode.match(/sr-auth-ready/g)||[]).length, 2); // one in showApp; one comment only
  assert.match(html, /!window\.Capacitor\?\.isNativePlatform\?\./);
  assert.match(read('sw.js'), /sr-crm-v46/);
});
