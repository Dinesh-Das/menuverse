create or replace function app_jwt_restaurant_id()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt()->>'restaurantId',
    auth.jwt()->'app_metadata'->>'restaurantId',
    auth.jwt()->'user_metadata'->>'restaurantId'
  );
$$;

create or replace function app_jwt_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt()->>'role',
    auth.jwt()->'app_metadata'->>'role',
    auth.jwt()->'user_metadata'->>'role'
  );
$$;

create or replace function app_rls_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      app_jwt_restaurant_id() = p_restaurant_id
      and app_jwt_app_role() in ('owner', 'manager', 'staff')
    )
    or exists (
      select 1
      from "User" u
      where u.id = auth.uid()::text
        and u.restaurant_id = p_restaurant_id
        and u.role in ('owner', 'manager', 'staff')
    );
$$;

alter table if exists "Restaurant" enable row level security;
alter table if exists "Table" enable row level security;
alter table if exists "TableSession" enable row level security;
alter table if exists "MenuCategory" enable row level security;
alter table if exists "MenuItem" enable row level security;
alter table if exists "ModifierGroup" enable row level security;
alter table if exists "ModifierOption" enable row level security;
alter table if exists "Order" enable row level security;
alter table if exists "OrderItem" enable row level security;
alter table if exists "Payment" enable row level security;
alter table if exists "OrderFeedback" enable row level security;
alter table if exists "StaffRequest" enable row level security;
alter table if exists "User" enable row level security;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'Restaurant',
        'Table',
        'TableSession',
        'MenuCategory',
        'MenuItem',
        'ModifierGroup',
        'ModifierOption',
        'Order',
        'OrderItem',
        'Payment',
        'OrderFeedback',
        'StaffRequest',
        'User'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy "restaurant_public_select" on "Restaurant"
  for select
  using (true);

create policy "restaurant_admin_select" on "Restaurant"
  for select
  using (app_rls_staff_can_access("Restaurant".id));

create policy "restaurant_admin_insert" on "Restaurant"
  for insert
  with check (app_rls_staff_can_access("Restaurant".id));

create policy "restaurant_admin_update" on "Restaurant"
  for update
  using (app_rls_staff_can_access("Restaurant".id))
  with check (app_rls_staff_can_access("Restaurant".id));

create policy "user_self_select" on "User"
  for select
  using (id = auth.uid()::text or app_rls_staff_can_access("User".restaurant_id));

create policy "user_admin_insert" on "User"
  for insert
  with check (app_rls_staff_can_access("User".restaurant_id));

create policy "user_admin_update" on "User"
  for update
  using (app_rls_staff_can_access("User".restaurant_id))
  with check (app_rls_staff_can_access("User".restaurant_id));

create policy "table_public_qr_select" on "Table"
  for select
  using (coalesce(qr_enabled, true) = true);

create policy "table_admin_select" on "Table"
  for select
  using (app_rls_staff_can_access("Table".restaurant_id));

create policy "table_admin_insert" on "Table"
  for insert
  with check (app_rls_staff_can_access("Table".restaurant_id));

create policy "table_admin_update" on "Table"
  for update
  using (app_rls_staff_can_access("Table".restaurant_id))
  with check (app_rls_staff_can_access("Table".restaurant_id));

create policy "tablesession_admin_select" on "TableSession"
  for select
  using (app_rls_staff_can_access("TableSession".restaurant_id));

create policy "tablesession_admin_insert" on "TableSession"
  for insert
  with check (app_rls_staff_can_access("TableSession".restaurant_id));

create policy "tablesession_admin_update" on "TableSession"
  for update
  using (app_rls_staff_can_access("TableSession".restaurant_id))
  with check (app_rls_staff_can_access("TableSession".restaurant_id));

create policy "menucategory_public_select_by_slug" on "MenuCategory"
  for select
  using (
    archived = false
    and restaurant_id = (
      select r.id from "Restaurant" r
      where r.slug = current_setting('app.restaurant_slug', true)
      limit 1
    )
  );

create policy "menucategory_admin_select" on "MenuCategory"
  for select
  using (app_rls_staff_can_access("MenuCategory".restaurant_id));

create policy "menucategory_admin_insert" on "MenuCategory"
  for insert
  with check (app_rls_staff_can_access("MenuCategory".restaurant_id));

create policy "menucategory_admin_update" on "MenuCategory"
  for update
  using (app_rls_staff_can_access("MenuCategory".restaurant_id))
  with check (app_rls_staff_can_access("MenuCategory".restaurant_id));

create policy "menuitem_public_select_by_slug" on "MenuItem"
  for select
  using (
    restaurant_id = (
      select r.id from "Restaurant" r
      where r.slug = current_setting('app.restaurant_slug', true)
      limit 1
    )
  );

create policy "menuitem_admin_select" on "MenuItem"
  for select
  using (app_rls_staff_can_access("MenuItem".restaurant_id));

create policy "menuitem_admin_insert" on "MenuItem"
  for insert
  with check (app_rls_staff_can_access("MenuItem".restaurant_id));

create policy "menuitem_admin_update" on "MenuItem"
  for update
  using (app_rls_staff_can_access("MenuItem".restaurant_id))
  with check (app_rls_staff_can_access("MenuItem".restaurant_id));

create policy "modifiergroup_public_select_by_slug" on "ModifierGroup"
  for select
  using (
    exists (
      select 1
      from "MenuItem" mi
      join "Restaurant" r on r.id = mi.restaurant_id
      join "MenuCategory" c on c.id = mi.category_id
      where mi.id = "ModifierGroup".menu_item_id
        and c.archived = false
        and r.slug = current_setting('app.restaurant_slug', true)
    )
  );

create policy "modifiergroup_admin_select" on "ModifierGroup"
  for select
  using (app_rls_staff_can_access("ModifierGroup".restaurant_id));

create policy "modifiergroup_admin_insert" on "ModifierGroup"
  for insert
  with check (app_rls_staff_can_access("ModifierGroup".restaurant_id));

create policy "modifiergroup_admin_update" on "ModifierGroup"
  for update
  using (app_rls_staff_can_access("ModifierGroup".restaurant_id))
  with check (app_rls_staff_can_access("ModifierGroup".restaurant_id));

create policy "modifieroption_public_select_by_slug" on "ModifierOption"
  for select
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      join "MenuItem" mi on mi.id = mg.menu_item_id
      join "Restaurant" r on r.id = mi.restaurant_id
      join "MenuCategory" c on c.id = mi.category_id
      where mg.id = "ModifierOption".group_id
        and c.archived = false
        and r.slug = current_setting('app.restaurant_slug', true)
    )
  );

create policy "modifieroption_admin_select" on "ModifierOption"
  for select
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

create policy "modifieroption_admin_insert" on "ModifierOption"
  for insert
  with check (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

create policy "modifieroption_admin_update" on "ModifierOption"
  for update
  using (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_rls_staff_can_access(mg.restaurant_id)
    )
  );

-- Public INSERT on Order is intentionally omitted. Order creation must use
-- create_order_secure(), whose SECURITY DEFINER body performs ownership,
-- price, modifier, idempotency, tax, and service-charge validation.
create policy "order_public_select_by_setting" on "Order"
  for select
  using (id = current_setting('app.order_id', true));

create policy "order_admin_select" on "Order"
  for select
  using (app_rls_staff_can_access("Order".restaurant_id));

create policy "order_admin_insert" on "Order"
  for insert
  with check (app_rls_staff_can_access("Order".restaurant_id));

create policy "order_admin_update" on "Order"
  for update
  using (app_rls_staff_can_access("Order".restaurant_id))
  with check (app_rls_staff_can_access("Order".restaurant_id));

create policy "orderitem_admin_select" on "OrderItem"
  for select
  using (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "orderitem_admin_insert" on "OrderItem"
  for insert
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "orderitem_admin_update" on "OrderItem"
  for update
  using (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_select" on "Payment"
  for select
  using (
    exists (
      select 1 from "Order" o
      where o.id = "Payment".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_insert" on "Payment"
  for insert
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "Payment".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_admin_update" on "Payment"
  for update
  using (
    exists (
      select 1 from "Order" o
      where o.id = "Payment".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from "Order" o
      where o.id = "Payment".order_id
        and app_rls_staff_can_access(o.restaurant_id)
    )
  );

create policy "feedback_admin_select" on "OrderFeedback"
  for select
  using (app_rls_staff_can_access("OrderFeedback".restaurant_id));

create policy "feedback_admin_insert" on "OrderFeedback"
  for insert
  with check (app_rls_staff_can_access("OrderFeedback".restaurant_id));

create policy "feedback_admin_update" on "OrderFeedback"
  for update
  using (app_rls_staff_can_access("OrderFeedback".restaurant_id))
  with check (app_rls_staff_can_access("OrderFeedback".restaurant_id));

create policy "staffrequest_admin_select" on "StaffRequest"
  for select
  using (app_rls_staff_can_access("StaffRequest".restaurant_id));

create policy "staffrequest_admin_insert" on "StaffRequest"
  for insert
  with check (app_rls_staff_can_access("StaffRequest".restaurant_id));

create policy "staffrequest_admin_update" on "StaffRequest"
  for update
  using (app_rls_staff_can_access("StaffRequest".restaurant_id))
  with check (app_rls_staff_can_access("StaffRequest".restaurant_id));
