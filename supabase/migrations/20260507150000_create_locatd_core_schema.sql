create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  avatar_url text,
  location_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  addressee_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique(requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.locations (
  user_id uuid primary key references public.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  accuracy_meters double precision,
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  note text,
  photo_url text,
  emoji text,
  visibility text not null default 'friends' check (visibility in ('private', 'friends', 'public')),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique(pin_id, user_id, emoji)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
before update on public.friendships
for each row execute function public.set_updated_at();

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
  set
    username = excluded.username,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.users enable row level security;
alter table public.friendships enable row level security;
alter table public.locations enable row level security;
alter table public.pins enable row level security;
alter table public.reactions enable row level security;

create policy "users_select_self_or_accepted_friends" on public.users
for select
using (
  auth.uid() = id
  or exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = users.id)
        or (f.addressee_id = auth.uid() and f.requester_id = users.id)
      )
  )
);

create policy "users_insert_self" on public.users
for insert
with check (auth.uid() = id);

create policy "users_update_self" on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "friendships_select_participants" on public.friendships
for select
using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships_insert_requester" on public.friendships
for insert
with check (auth.uid() = requester_id);

create policy "friendships_update_participants" on public.friendships
for update
using (auth.uid() = requester_id or auth.uid() = addressee_id)
with check (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships_delete_participants" on public.friendships
for delete
using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "locations_select_self_or_friends_if_visible" on public.locations
for select
using (
  auth.uid() = user_id
  or (
    exists (
      select 1
      from public.users u
      where u.id = locations.user_id
        and u.location_visible = true
    )
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = locations.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = locations.user_id)
        )
    )
  )
);

create policy "locations_upsert_self" on public.locations
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "pins_select_owner_or_visible" on public.pins
for select
using (
  auth.uid() = user_id
  or visibility = 'public'
  or (
    visibility = 'friends'
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = pins.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = pins.user_id)
        )
    )
  )
);

create policy "pins_insert_owner" on public.pins
for insert
with check (auth.uid() = user_id);

create policy "pins_update_owner" on public.pins
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "pins_delete_owner" on public.pins
for delete
using (auth.uid() = user_id);

create policy "reactions_select_pin_visible" on public.reactions
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.pins p
    where p.id = reactions.pin_id
      and (
        p.visibility = 'public'
        or p.user_id = auth.uid()
        or (
          p.visibility = 'friends'
          and exists (
            select 1
            from public.friendships f
            where f.status = 'accepted'
              and (
                (f.requester_id = auth.uid() and f.addressee_id = p.user_id)
                or (f.addressee_id = auth.uid() and f.requester_id = p.user_id)
              )
          )
        )
      )
  )
);

create policy "reactions_insert_self" on public.reactions
for insert
with check (auth.uid() = user_id);

create policy "reactions_delete_self" on public.reactions
for delete
using (auth.uid() = user_id);

alter publication supabase_realtime add table public.locations;
