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

-- Marcha atrás: drop table role_permissions;  (la app vuelve a los permisos de siempre)
