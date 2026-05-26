-- Menuverse Supabase Row Level Security Policies
-- Run after all migrations. Public customers can read catalog data, but orders,
-- payments, sessions, and staff requests must go through RPC/Edge Functions.

alter table "Restaurant" enable row level security;
alter table "User" enable row level security;
alter table "Table" enable row level security;
alter table "MenuCategory" enable row level security;
alter table "MenuItem" enable row level security;
alter table "ModifierGroup" enable row level security;
alter table "ModifierOption" enable row level security;
alter table "Order" enable row level security;
alter table "OrderItem" enable row level security;
alter table "Payment" enable row level security;
alter table if exists "OrderFeedback" enable row level security;
alter table if exists "StaffRequest" enable row level security;
alter table if exists "TableSession" enable row level security;
alter table if exists "SessionBill" enable row level security;
alter table if exists "StaffInvite" enable row level security;
alter table if exists "IntegrationJob" enable row level security;
alter table if exists "GuestContact" enable row level security;

drop policy if exists "restaurant_public_read" on "Restaurant";
drop policy if exists "restaurant_owner_update" on "Restaurant";
drop policy if exists "user_self_read" on "User";
drop policy if exists "user_admin_same_restaurant_read" on "User";
drop policy if exists "user_self_update" on "User";
drop policy if exists "table_public_read" on "Table";
drop policy if exists "table_public_qr_read" on "Table";
drop policy if exists "table_staff_update" on "Table";
drop policy if exists "table_staff_manage" on "Table";
drop policy if exists "table_admin_insert" on "Table";
drop policy if exists "table_owner_delete" on "Table";
drop policy if exists "category_public_read" on "MenuCategory";
drop policy if exists "category_admin_manage" on "MenuCategory";
drop policy if exists "menuitem_public_read" on "MenuItem";
drop policy if exists "menuitem_admin_manage" on "MenuItem";
drop policy if exists "modgroup_public_read" on "ModifierGroup";
drop policy if exists "modgroup_admin_manage" on "ModifierGroup";
drop policy if exists "modoption_public_read" on "ModifierOption";
drop policy if exists "modoption_admin_manage" on "ModifierOption";
drop policy if exists "order_anon_insert" on "Order";
drop policy if exists "order_table_read" on "Order";
drop policy if exists "order_staff_read" on "Order";
drop policy if exists "order_staff_update" on "Order";
drop policy if exists "orderitem_anon_insert" on "OrderItem";
drop policy if exists "orderitem_public_read" on "OrderItem";
drop policy if exists "orderitem_staff_read" on "OrderItem";
drop policy if exists "payment_anon_insert" on "Payment";
drop policy if exists "payment_staff_read" on "Payment";
do $$
begin
  if to_regclass('"OrderFeedback"') is not null then
    drop policy if exists "feedback_anon_insert" on "OrderFeedback";
    drop policy if exists "feedback_staff_read" on "OrderFeedback";
  end if;

  if to_regclass('"StaffRequest"') is not null then
    drop policy if exists "staffreq_anon_insert" on "StaffRequest";
    drop policy if exists "staffreq_staff_read" on "StaffRequest";
    drop policy if exists "staffreq_staff_update" on "StaffRequest";
  end if;

  if to_regclass('"StaffInvite"') is not null then
    drop policy if exists "staffinvite_admin_select" on "StaffInvite";
    drop policy if exists "staffinvite_owner_insert" on "StaffInvite";
    drop policy if exists "staffinvite_owner_update" on "StaffInvite";
  end if;

  if to_regclass('"IntegrationJob"') is not null then
    drop policy if exists "integrationjob_staff_select" on "IntegrationJob";
    drop policy if exists "integrationjob_staff_insert" on "IntegrationJob";
    drop policy if exists "integrationjob_staff_update" on "IntegrationJob";
  end if;

  if to_regclass('"GuestContact"') is not null then
    drop policy if exists "guestcontact_staff_select" on "GuestContact";
    drop policy if exists "guestcontact_staff_update" on "GuestContact";
  end if;

  if to_regclass('"TableSession"') is not null then
    drop policy if exists "tablesession_staff_read" on "TableSession";
  end if;

  if to_regclass('"SessionBill"') is not null then
    drop policy if exists "sessionbill_staff_read" on "SessionBill";
  end if;
end $$;

create policy "restaurant_public_read" on "Restaurant"
  for select using (true);

create policy "restaurant_owner_update" on "Restaurant"
  for update using (app_admin_can_access("Restaurant".id))
  with check (app_admin_can_access("Restaurant".id));

create policy "user_self_read" on "User"
  for select using (id = auth.uid()::text);

create policy "user_admin_same_restaurant_read" on "User"
  for select using (app_admin_can_access("User".restaurant_id));

create policy "user_self_update" on "User"
  for update using (id = auth.uid()::text)
  with check (id = auth.uid()::text);

create policy "table_public_qr_read" on "Table"
  for select using (coalesce(qr_enabled, true) = true);

create policy "table_staff_manage" on "Table"
  for all using (app_admin_can_access("Table".restaurant_id))
  with check (app_admin_can_access("Table".restaurant_id));

create policy "category_public_read" on "MenuCategory"
  for select using (archived = false);

create policy "category_admin_manage" on "MenuCategory"
  for all using (app_admin_can_access("MenuCategory".restaurant_id))
  with check (app_admin_can_access("MenuCategory".restaurant_id));

create policy "menuitem_public_read" on "MenuItem"
  for select using (
    available = true
    and exists (
      select 1 from "MenuCategory" c
      where c.id = "MenuItem".category_id
        and c.archived = false
    )
  );

create policy "menuitem_admin_manage" on "MenuItem"
  for all using (app_admin_can_access("MenuItem".restaurant_id))
  with check (app_admin_can_access("MenuItem".restaurant_id));

create policy "modgroup_public_read" on "ModifierGroup"
  for select using (
    exists (
      select 1 from "MenuItem" mi
      join "MenuCategory" c on c.id = mi.category_id
      where mi.id = "ModifierGroup".menu_item_id
        and mi.available = true
        and c.archived = false
    )
  );

create policy "modgroup_admin_manage" on "ModifierGroup"
  for all using (app_admin_can_access("ModifierGroup".restaurant_id))
  with check (app_admin_can_access("ModifierGroup".restaurant_id));

create policy "modoption_public_read" on "ModifierOption"
  for select using (
    exists (
      select 1
      from "ModifierGroup" mg
      join "MenuItem" mi on mi.id = mg.menu_item_id
      join "MenuCategory" c on c.id = mi.category_id
      where mg.id = "ModifierOption".group_id
        and mi.available = true
        and c.archived = false
    )
  );

create policy "modoption_admin_manage" on "ModifierOption"
  for all using (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_admin_can_access(mg.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from "ModifierGroup" mg
      where mg.id = "ModifierOption".group_id
        and app_admin_can_access(mg.restaurant_id)
    )
  );

create policy "order_staff_read" on "Order"
  for select using (app_staff_can_access("Order".restaurant_id));

create policy "order_staff_update" on "Order"
  for update using (app_staff_can_access("Order".restaurant_id))
  with check (app_staff_can_access("Order".restaurant_id));

create policy "orderitem_staff_read" on "OrderItem"
  for select using (
    exists (
      select 1 from "Order" o
      where o.id = "OrderItem".order_id
        and app_staff_can_access(o.restaurant_id)
    )
  );

create policy "payment_staff_read" on "Payment"
  for select using (
    exists (
      select 1 from "Order" o
      where o.id = "Payment".order_id
        and app_admin_can_access(o.restaurant_id)
    )
  );

do $$
begin
  if to_regclass('"OrderFeedback"') is not null then
    create policy "feedback_staff_read" on "OrderFeedback"
      for select using (app_admin_can_access("OrderFeedback".restaurant_id));
  end if;

  if to_regclass('"StaffRequest"') is not null then
    create policy "staffreq_staff_read" on "StaffRequest"
      for select using (app_staff_can_access("StaffRequest".restaurant_id));

    create policy "staffreq_staff_update" on "StaffRequest"
      for update using (app_staff_can_access("StaffRequest".restaurant_id))
      with check (app_staff_can_access("StaffRequest".restaurant_id));
  end if;

  if to_regclass('"StaffInvite"') is not null then
    create policy "staffinvite_admin_select" on "StaffInvite"
      for select using (app_staff_can_access("StaffInvite".restaurant_id));

    create policy "staffinvite_owner_insert" on "StaffInvite"
      for insert with check (app_admin_can_access("StaffInvite".restaurant_id));

    create policy "staffinvite_owner_update" on "StaffInvite"
      for update using (app_admin_can_access("StaffInvite".restaurant_id))
      with check (app_admin_can_access("StaffInvite".restaurant_id));
  end if;

  if to_regclass('"IntegrationJob"') is not null then
    create policy "integrationjob_staff_select" on "IntegrationJob"
      for select using (app_staff_can_access("IntegrationJob".restaurant_id));

    create policy "integrationjob_staff_insert" on "IntegrationJob"
      for insert with check (app_staff_can_access("IntegrationJob".restaurant_id));

    create policy "integrationjob_staff_update" on "IntegrationJob"
      for update using (app_staff_can_access("IntegrationJob".restaurant_id))
      with check (app_staff_can_access("IntegrationJob".restaurant_id));
  end if;

  if to_regclass('"GuestContact"') is not null then
    create policy "guestcontact_staff_select" on "GuestContact"
      for select using (app_staff_can_access("GuestContact".restaurant_id));

    create policy "guestcontact_staff_update" on "GuestContact"
      for update using (app_staff_can_access("GuestContact".restaurant_id))
      with check (app_staff_can_access("GuestContact".restaurant_id));
  end if;
end $$;

do $$
begin
  if to_regclass('"TableSession"') is not null then
    create policy "tablesession_staff_read" on "TableSession"
      for select using (app_staff_can_access("TableSession".restaurant_id));
  end if;

  if to_regclass('"SessionBill"') is not null and to_regclass('"TableSession"') is not null then
    create policy "sessionbill_staff_read" on "SessionBill"
      for select using (
        exists (
          select 1 from "TableSession" ts
          where ts.id = "SessionBill".table_session_id
            and app_staff_can_access(ts.restaurant_id)
        )
      );
  end if;
end $$;
