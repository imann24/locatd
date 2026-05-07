drop policy if exists "users_select_self_or_accepted_friends" on public.users;

create policy "users_select_self_or_related" on public.users
for select
using (
  auth.uid() = id
  or exists (
    select 1
    from public.friendships f
    where (
      (f.requester_id = auth.uid() and f.addressee_id = users.id)
      or (f.addressee_id = auth.uid() and f.requester_id = users.id)
    )
  )
);

create or replace function public.search_users(query_text text)
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.full_name, u.avatar_url
  from public.users u
  where auth.uid() is not null
    and u.id <> auth.uid()
    and (
      coalesce(u.username, '') ilike ('%' || query_text || '%')
      or coalesce(u.full_name, '') ilike ('%' || query_text || '%')
    )
  order by u.username nulls last, u.created_at desc
  limit 20;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;
