-- S.R. Developers project photo/video library
-- Run once in Supabase SQL Editor. Public read is intentional so client media links can open without CRM login.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media','project-media',true,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public=true, file_size_limit=104857600, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Authenticated staff upload project media" on storage.objects;
create policy "Authenticated staff upload project media" on storage.objects
for insert to authenticated with check (bucket_id='project-media');

drop policy if exists "Authenticated staff update project media" on storage.objects;
create policy "Authenticated staff update project media" on storage.objects
for update to authenticated using (bucket_id='project-media') with check (bucket_id='project-media');

drop policy if exists "Authenticated staff delete project media" on storage.objects;
create policy "Authenticated staff delete project media" on storage.objects
for delete to authenticated using (bucket_id='project-media');

drop policy if exists "Public can view project media" on storage.objects;
create policy "Public can view project media" on storage.objects
for select to public using (bucket_id='project-media');
