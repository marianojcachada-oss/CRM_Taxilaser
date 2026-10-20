-- Permisos por rol (pantalla "Permisos" del panel admin, solo Superadmin).
-- Se puede correr más de una vez. Sin filas en la tabla, la app usa los
-- permisos de siempre, así que correrlo no cambia nada por sí solo.

create table if not exists role_permissions (
  role        text not null check (role in ('operador', 'admin')),
  permission  text not null,
  allowed     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (role, permission)
);

alter table role_permissions enable row level security;

drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions
  for select to authenticated using (true);

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions
  for all to authenticated
  using (exists (select 1 from operators where auth_user_id = auth.uid() and is_superadmin = true))
  with check (exists (select 1 from operators where auth_user_id = auth.uid() and is_superadmin = true));


-- Editar AI (Valeria) e Integraciones: la base de datos solo se lo permitía al
-- Superadmin. Ahora también deja escribir a un Admin si el Superadmin le dio
-- "Ver" y "Editar" de esa sección en la pantalla Permisos.
create or replace function can_edit_setting(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from operators o
    where o.auth_user_id = auth.uid()
      and (
        o.is_superadmin = true
        or (
          o.is_admin = true
          and (
            select count(*) from role_permissions rp
            where rp.role = 'admin' and rp.allowed = true
              and rp.permission in (
                case when p_key like 'NEURAL\_%' or p_key like 'AI\_%' or p_key like 'CLAUDE\_%'
                     then 'view.admin.ai' else 'view.admin.integrations' end,
                case when p_key like 'NEURAL\_%' or p_key like 'AI\_%' or p_key like 'CLAUDE\_%'
                     then 'edit.admin.ai' else 'edit.admin.integrations' end
              )
          ) = 2
        )
      )
  );
$$;

drop policy if exists integration_settings_insert_by_permission on integration_settings;
create policy integration_settings_insert_by_permission on integration_settings
  for insert to authenticated with check (can_edit_setting(key));

drop policy if exists integration_settings_update_by_permission on integration_settings;
create policy integration_settings_update_by_permission on integration_settings
  for update to authenticated using (can_edit_setting(key)) with check (can_edit_setting(key));

-- Marcha atrás:
--   drop policy integration_settings_insert_by_permission on integration_settings;
--   drop policy integration_settings_update_by_permission on integration_settings;
--   drop function can_edit_setting(text);
--   drop table role_permissions;   (la app vuelve a los permisos de siempre)
