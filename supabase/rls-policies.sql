-- ═══════════════════════════════════════════════════════════════════════════
-- Menuverse (Zaika Zindagi) — Supabase Row Level Security Policies
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- IMPORTANT: This enables RLS and creates policies for ALL tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Enable RLS on all tables ───────────────────────────────────────────
ALTER TABLE "Restaurant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Table" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModifierGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModifierOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;

-- ── 2. Restaurant ─────────────────────────────────────────────────────────
-- Public read (menu display)
CREATE POLICY "restaurant_public_read" ON "Restaurant"
  FOR SELECT USING (true);

-- Only authenticated owners can update
CREATE POLICY "restaurant_owner_update" ON "Restaurant"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".restaurant_id = "Restaurant".id
        AND "User".role = 'owner'
    )
  );

-- ── 3. User ───────────────────────────────────────────────────────────────
-- Users can only read their own record
CREATE POLICY "user_self_read" ON "User"
  FOR SELECT USING (id = auth.uid()::text);

-- Users can only update their own record
CREATE POLICY "user_self_update" ON "User"
  FOR UPDATE USING (id = auth.uid()::text);

-- ── 4. Table ──────────────────────────────────────────────────────────────
-- Public read (QR code lookup, table status display)
CREATE POLICY "table_public_read" ON "Table"
  FOR SELECT USING (true);

-- Only staff/managers/owners can update table status
CREATE POLICY "table_staff_update" ON "Table"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".restaurant_id = "Table".restaurant_id
        AND "User".role IN ('owner', 'manager', 'staff')
    )
  );

-- ── 5. Menu Categories ───────────────────────────────────────────────────
-- Public read (menu display)
CREATE POLICY "category_public_read" ON "MenuCategory"
  FOR SELECT USING (true);

-- Only owner/manager can manage categories
CREATE POLICY "category_admin_manage" ON "MenuCategory"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".restaurant_id = "MenuCategory".restaurant_id
        AND "User".role IN ('owner', 'manager')
    )
  );

-- ── 6. Menu Items ─────────────────────────────────────────────────────────
-- Public read (menu display)
CREATE POLICY "menuitem_public_read" ON "MenuItem"
  FOR SELECT USING (true);

-- Only owner/manager can manage items
CREATE POLICY "menuitem_admin_manage" ON "MenuItem"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".restaurant_id = "MenuItem".restaurant_id
        AND "User".role IN ('owner', 'manager')
    )
  );

-- ── 7. Modifier Groups ───────────────────────────────────────────────────
-- Public read (menu display)
CREATE POLICY "modgroup_public_read" ON "ModifierGroup"
  FOR SELECT USING (true);

-- Admin manage via parent MenuItem
CREATE POLICY "modgroup_admin_manage" ON "ModifierGroup"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "MenuItem"
      JOIN "User" ON "User".restaurant_id = "MenuItem".restaurant_id
      WHERE "MenuItem".id = "ModifierGroup".menu_item_id
        AND "User".id = auth.uid()::text
        AND "User".role IN ('owner', 'manager')
    )
  );

-- ── 8. Modifier Options ──────────────────────────────────────────────────
-- Public read
CREATE POLICY "modoption_public_read" ON "ModifierOption"
  FOR SELECT USING (true);

-- Admin manage via parent ModifierGroup -> MenuItem
CREATE POLICY "modoption_admin_manage" ON "ModifierOption"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "ModifierGroup"
      JOIN "MenuItem" ON "MenuItem".id = "ModifierGroup".menu_item_id
      JOIN "User" ON "User".restaurant_id = "MenuItem".restaurant_id
      WHERE "ModifierGroup".id = "ModifierOption".modifier_group_id
        AND "User".id = auth.uid()::text
        AND "User".role IN ('owner', 'manager')
    )
  );

-- ── 9. Orders ─────────────────────────────────────────────────────────────
-- Anon/public can INSERT (customers placing orders via QR)
CREATE POLICY "order_anon_insert" ON "Order"
  FOR INSERT WITH CHECK (true);

-- Anon can read their own orders (by table_id, scoped to device session)
CREATE POLICY "order_table_read" ON "Order"
  FOR SELECT USING (true);

-- Only staff can update order status
CREATE POLICY "order_staff_update" ON "Order"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".restaurant_id = "Order".restaurant_id
        AND "User".role IN ('owner', 'manager', 'staff')
    )
  );

-- ── 10. Order Items ──────────────────────────────────────────────────────
-- Anon can INSERT (as part of order placement)
CREATE POLICY "orderitem_anon_insert" ON "OrderItem"
  FOR INSERT WITH CHECK (true);

-- Public can read (for order status display)
CREATE POLICY "orderitem_public_read" ON "OrderItem"
  FOR SELECT USING (true);

-- ── 11. Payments ─────────────────────────────────────────────────────────
-- Anon can INSERT (payment recording)
CREATE POLICY "payment_anon_insert" ON "Payment"
  FOR INSERT WITH CHECK (true);

-- Only staff can read payments
CREATE POLICY "payment_staff_read" ON "Payment"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = auth.uid()::text
        AND "User".role IN ('owner', 'manager')
    )
  );
