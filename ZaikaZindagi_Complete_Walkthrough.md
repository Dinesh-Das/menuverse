# Menuverse — Complete Technical & Process Flow Walkthrough
**Version:** Final · Based on all Stitch designs, HTML source, DESIGN.md, and SRD  
**Admin App:** Kitchen Command (Studio Mode)  
**Customer Brand:** Gourmet Tech / The Grand Brasserie  
**Platform:** Mobile-first PWA (Customer) · Desktop Web (Admin)  
**Themes:** Dark `#131313` · Light `#FDFCFB` — all screens support both

---

## DESIGN SYSTEM REFERENCE

| Token | Dark Value | Light Value | Usage |
|---|---|---|---|
| `background` | `#131313` | `#FDFCFB` | Page base |
| `surface-container-low` | `#1c1b1b` | `#F9F7F4` | Section fills |
| `surface-container` | `#201f1f` | `#F2EFE9` | Card backgrounds |
| `surface-container-high` | `#2a2a2a` | `#EBE7DF` | Elevated elements |
| `primary` | `#f0c372` | `#C5A368` | Gold accent |
| `primary-container` | `#d2a85a` | `#F4EFE6` | CTA buttons |
| `on-surface` | `#e5e2e1` | `#1A1918` | Primary text |
| `on-surface-variant` | `#d2c5b3` | `#7A7670` | Secondary text |
| `outline-variant` | `#4e4638` | `#E8E4DF` | Ghost borders |

**Core Rules:**
- No 1px divider lines — use tonal background shifts between sections
- Glassmorphism: `background/60-80%` opacity + `backdrop-blur(20–40px)` for floating nav/overlays
- Shadows: diffused `0px 20px 40px rgba(0,0,0,0.4)` — never pure black
- Corners: `DEFAULT` 0.125rem (admin/sharp) · `xl` 0.5–0.75rem (cards) · `full` 9999px (pills)
- Typography: Noto Serif (headlines/display) + Manrope (body/labels/UI)
- Labels: UPPERCASE + `tracking-[0.15em]` + `font-bold` + tiny size (0.6875rem–0.75rem)

---

## COMPLETE SCREEN INVENTORY

| # | Screen | Route | User | Views |
|---|---|---|---|---|
| A | QR Table Landing | `/t/:tableId` | Customer | 3 states |
| B | Customer Menu Home | `/menu/:rid?table=:tid` | Customer | Dark + Light |
| C | Dish Detail + AR View | `/menu/dish/:dishId` | Customer | Dark + Light |
| D | Cart & Checkout | `/checkout?table=:tid` | Customer | Dark + Light |
| E | Live Order Status | `/order/:orderId` | Customer | Dark + Light |
| F | Admin Login | `/admin/login` | Admin | Dark + Light |
| G | Admin Dashboard | `/admin/dashboard` | Admin | Dark + Light |
| H | Management Terminal | `/admin/settings` | Admin | Dark + Light |
| I | Menu Inventory | `/admin/menu` | Admin | Dark + Light |
| J | AR Studio Pipeline | `/admin/ar-pipeline` | Admin | Dark + Light |
| K | QR Code Factory | `/admin/qr-factory` | Admin | Dark + Light |
| L | Kitchen Display System | `/admin/kds` | Admin | Dark + Light |

---

---

# PART 1 — CUSTOMER SCREENS (Mobile PWA)

---

## SCREEN A: QR Table Landing
**Route:** `/t/:tableId?r=:restaurantId`  
**Triggered by:** Customer scanning physical QR code on their dining table

### Three Visual States

#### State 1 — Cinematic Immersive (Default first-time)
- Full-bleed background: cinematic photo of chef plating food (dark, dramatic)
- Centered glassmorphic card:
  - `surface-variant` at 60% opacity + `backdrop-blur(24px)` + gold border `1px rgba(212,175,55,0.3)`
  - H1: `"Table 14"` — Noto Serif, large, warm white
  - CTA button: `"Begin Experience"` — gold fill, full-width
  - Text link below: `"Scan another table"` — underlined, muted

#### State 2 — Welcome with Guest Name Input
- Full-bleed restaurant interior photo (elegant dining room)
- Glassmorphic card centered:
  - `"Welcome"` (gold Noto Serif) + `"to"` (white) + `"Table 14"` (white bold, display size)
  - Input: `"Guest Name (Optional)"` — glass-style field, gold border on focus
  - CTA: `"Start Dining"` — gold full-width button

#### State 3 — Brand Splash (after QR decode + branding loaded)
- Background: deep `#131313`
- Center: Restaurant logo — *"The Grand Brasserie"* in Noto Serif gold, large
- Hero text: `"You are at Table 14"` — white serif, display size
- Primary CTA: `"EXPLORE MENU"` — gold fill button, full-width, uppercase tracked
- `"TODAY'S CHEF SPECIALS"` card below:
  - Gold label, 2 dish specials with name + brief description, separated by thin lines

### Process Flow
```
1. Admin prints/laminates QR code (generated from QR Factory)
   QR URL format: https://app.menuverse.com/t/14?r=rest123
2. Customer scans → browser opens URL → parse tableId, restaurantId
3. GET /api/restaurant/:restaurantId/config
   → Load: name, logo, primaryColor, theme, todaySpecials
4. Render landing in restaurant's brand theme
5. Guest optionally enters name → store in sessionStorage
6. CTA tap → navigate to /menu/:restaurantId?table=14
7. tableId + restaurantId stored in app state for all downstream API calls
```

**State:**
```js
{ tableId: 14, restaurantId: 'rest123', guestName: '', config: {} }
```

---

## SCREEN B: Customer Menu Home — Curated Selection
**Route:** `/menu/:restaurantId?table=:tableId`  
**Files:** `customer_menu_home_1` (dark) · `customer_menu_home_2` (light)

### Fixed Top Navigation Bar
- **Dark:** `rgba(19,19,19,0.6)` + `backdrop-blur(xl)` + shadow `0px 20px 40px rgba(0,0,0,0.4)`
- **Light:** `rgba(253,252,251,0.8)` + `backdrop-blur(xl)` + border-bottom `outline-variant/30`
- Left: *"Menuverse"* — italic Noto Serif, gold/amber
- Right: `shopping_cart` icon (with gold dot badge when items in cart) · `notifications` · chef avatar (32px, rounded-full)

### Hero Editorial Section
- H1: `"Curated"` (bold serif, `on-surface`) + `"Selection"` (italic, `text-primary`) — 4rem, `tracking-tight`
- Subtext: *"Experience the fusion of high-end culinary art and immersive digital precision."* — 14px, `text-on-surface-variant`, max-width 80–85%

### Sticky Category Tabs
- Position: `sticky top-[72px]` — sticks below top nav while scrolling
- Background: `background/80–95%` + `backdrop-blur-md`
- Tabs: rounded-full pills, `text-[10px] uppercase tracking-[0.15em] font-bold`, no scrollbar
- **Active:** Dark = `bg-primary-container text-on-primary-container` · Light = `bg-primary text-white` + shadow
- **Inactive:** `bg-surface-container-high text-on-surface-variant`, hover to `highest`
- Categories: **Starters · Mains · Desserts · Wines** (horizontally scrollable)

### Dish Grid — Asymmetric Bento Layout
Three distinct card types within a single-column scroll:

**① Hero / Highlight Card (Full-width)**
- Image: `h-72` full-width with `overflow-hidden` + `group-hover:scale-105` transition (1000ms)
- Gradient overlay: `bg-gradient-to-t from-surface-dim/background` fades bottom
- `"CHEF'S CHOICE"` badge: top-right, gold/primary, tiny uppercase — `text-[9px] tracking-[0.2em]`
- Content area (padding `p-6–p-8`):
  - H3: Noto Serif 2xl bold — `"Black Truffle Carpaccio"`
  - Subtitle: `text-[10px] uppercase tracking-[0.1em]` — `"AGED WAGYU, SUMMER TRUFFLE, PINE NUT EMULSION"`
  - Price: right-aligned, `text-primary text-2xl font-medium` — `"$24"`
  - Star rating: `star` icon (filled) + score — `text-primary text-xs`
  - `"+ QUICK ADD"` button: gold fill, `rounded-full` (dark) or `rounded-sm` (light), `text-xs font-bold tracking-widest`

**② Two-Column Grid (Smaller dishes)**
- Side-by-side, `gap-4–6`
- Each: image `h-40–44` + padding `p-4–5`
- Dish name: Noto Serif `text-lg font-bold`
- Price: `text-primary font-headline`
- `+` add button: small `w-8 h-8 rounded-full`, dark = `bg-surface-container-highest` / light = `bg-surface-container-high`
- Hover: `hover:bg-primary hover:text-white`

**③ Asymmetric Feature Card (1/3 image + 2/3 text)**
- Horizontal flex card, `min-h-[160–180px]`
- Left 1/3: dish photo, `h-full object-cover`
- Right 2/3: `p-5–7 flex-col justify-center`
  - H3: Noto Serif `text-xl font-bold`
  - Description: `text-xs italic opacity-80 line-clamp-2`
  - Price: `text-primary font-headline font-bold`
  - `"ADD TO SELECTION"` — text-link style, `text-[10px] uppercase tracking-[0.2em] text-primary border-b-2 border-primary/20`

### Fixed Bottom Navigation Bar
4 tabs, `justify-around items-end`, glassmorphic footer:
- **DISCOVER** (active) — gold filled circle `rounded-full p-3` elevated, `scale-110`, shadow
- **AR VIEW** — `view_in_ar` icon, muted
- **CART** — `shopping_bag` icon, gold dot badge if items
- **ACCOUNT** — `person` icon, muted

### Process Flow
```
1. Mount → GET /api/menu/:restaurantId → load all categories + dishes
2. GET /api/restaurant/:restaurantId/config → apply branding (already cached)
3. Render hero + category tabs + dish grid
4. Sticky tabs: on category tap → filter dish array by category locally
5. `"+ Quick Add"` / `"+"` → add item to local cart state
   - If first item: animate cart badge appearing
   - Cart badge updates count
6. Tap dish card → navigate to /menu/dish/:dishId
7. Cart icon tap → navigate to /checkout?table=14
8. "AR VIEW" tab → navigate to /ar-view (camera screen)
```

**State:**
```js
{
  menu: { categories: [], items: [] },
  activeCategory: 'starters',
  cart: { items: [], count: 0, total: 0 },
  tableId: 14,
  restaurantId: 'rest123'
}
```

---

## SCREEN C: Dish Detail + AR View
**Route:** `/menu/dish/:dishId`  
**Files:** `dish_detail_ar_view_1` (dark) · `dish_detail_ar_view_2` (light)

### Top Navigation
- Back arrow (`arrow_back`) left
- *"Menuverse"* center — Noto Serif italic gold (dark) or bold `on-surface` (light)
- Right: `shopping_cart` + `notifications`

### Hero Dish Image Section
- **Dark:** Full-width square (`aspect-square`) image — dish on dark ceramic, dramatic lighting
- **Light:** `aspect-[4/5]` slightly taller, softer styling

- **"VIEW IN AR" / "VIEW ON MY TABLE" Button** (floating over image, bottom-right):
  - **Dark:** `bg-primary-container text-on-primary-container` rounded-full, with `view_in_ar` filled icon
  - **Light:** `bg-white/90 backdrop-blur-md` frosted glass, with gold `view_in_ar` icon + sharp corners
  - On tap → opens AR camera experience (see AR sub-section below)

### Dish Info Section (`px-6–8`)

**Header row:**
- H1: `"Butter Chicken"` — Noto Serif `text-4xl–5xl font-bold tracking-tight`
- Subhead: *"Murgh Makhani"* — `text-primary italic font-headline text-lg–xl`
- Price: `"$24.00"` — right-aligned, `text-2xl–3xl` (dark: `text-primary-container font-bold` / light: `font-light on-surface`)
- **Light version only:** bottom border `border-b border-outline-variant pb-8` under header row

**Nutrition Stats Row (3 columns):**
- **Dark:** `bg-surface-container-low rounded-xl p-1` container with 3 inner cards `bg-surface-container-high rounded-lg p-4 text-center`
- **Light:** Simple 3-column grid `gap-8 py-4` with center column bordered `border-x border-outline-variant`
- Stats: CALORIES `480` · PROTEIN `32g` · PREP `15m`
- Label: `text-[10px] uppercase tracking-widest text-on-surface-variant`
- Value: `text-lg–xl font-body font-bold/medium`

**Description Section:**
- **Dark:** H2 `"Description"` Noto Serif, plain
- **Light:** Label `"THE STORY"` — `text-xs uppercase tracking-[0.3em] text-on-surface-variant font-bold` (more editorial)
- Body: `text-on-surface-variant leading-loose/relaxed` — rich description paragraph

**Bento Detail Cards (2-column grid):**
- Card 1: `restaurant` icon (gold) + **"Chef's Choice"** title + recommendation text
- Card 2: `allergy` icon (gold/tertiary) + **"Allergens"** title + allergen list
- **Dark:** `bg-surface-container rounded-xl p-5`
- **Light:** No card bg — pure whitespace, icon `text-3xl`, title `uppercase tracking-widest`

### AR Preview Section (bottom of scroll)
- Section: `rounded-3xl overflow-hidden` (dark) or `overflow-hidden border border-outline-variant/30` (light)
- Background: table photo (slightly desaturated/grayscale in light mode)
- Gradient overlay: fades from transparent to background
- Center: Animated 3D dish mockup image floating (`animate-pulse`)
- AR Reticle corners: 4 corner brackets `border-t/b border-l/r border-primary` — creates targeting frame
- Label: `"LIVE AR SIMULATION"` / `"AUGMENTED REALITY PREVIEW"` — `text-[10px] uppercase tracking-[0.4em] text-primary`
- Sub-label: `"Position dish on your table for real-size preview"` — tiny, muted

### Fixed Bottom Action Bar
- **Qty controller:** `remove` / `add` icons with number display — dark: `rounded-full bg-surface-container-high` / light: `border border-outline-variant` square style
- **"ADD TO ORDER"** button:
  - Dark: `bg-primary-container text-on-primary-container rounded-full` flex-1 + `shopping_basket` icon
  - Light: `bg-on-surface text-background` dark rectangle, `hover:bg-primary`, sharp corners
  - Text: `uppercase tracking-[0.2em] text-[10px] font-bold`

### AR Camera Experience (on "VIEW IN AR" tap)
- Native camera permission request: `navigator.mediaDevices.getUserMedia({ video: true })`
- WebXR / `<model-viewer>` component loads `.glb` model
- Surface detection → model anchors to detected flat surface
- Customer can see 3D dish floating on their physical table
- Pinch-to-scale + drag-to-rotate gestures
- `"Add to Cart"` overlay button remains accessible

### Process Flow
```
1. Navigate here from menu card tap
2. GET /api/menu/dish/:dishId → load full dish data including arModelUrl
3. Render hero image + all details
4. "VIEW IN AR" tap:
   a. Request camera permission
   b. Initialize AR session (WebXR / 8th Wall)
   c. GET arModelUrl (.glb) from CDN
   d. Load model into AR scene
   e. Surface detection → anchor model
5. Qty +/- → update local quantity state
6. "ADD TO ORDER" → append item to cart state → navigate back to menu
   or → navigate to /checkout directly
```

---

## SCREEN D: Cart & Checkout
**Route:** `/checkout?table=:tableId`  
**Files:** `cart_checkout_1` (light mobile) · `cart_checkout_2` (dark mobile)

### Fixed Header
- Back arrow + Restaurant name (e.g., `"GOURMET TECH"`) — uppercase, bold serif (light) or amber (dark)
- Right: `notifications` bell + admin avatar (32–40px rounded-full)
- **Light:** glass-header `rgba(253,252,251,0.85) backdrop-blur(20px)` + bottom border `outline-variant/30`
- **Dark:** `rgba(19,19,19,0.6) backdrop-blur(xl)` + shadow

### Page Content (scrollable, `max-w-lg mx-auto`)

**Section 1 — "Your Selection"**
- H2: `"Your Selection"` — Noto Serif bold
- Order item cards:
  - **Dark:** `bg-surface-container-low rounded-xl p-4` — no border
  - **Light:** `bg-surface rounded-2xl p-5 border border-outline-variant shadow-sm`
  - Image: `w-20–24 h-20–24 object-cover rounded-md` (dark) or `rounded-xl` (light)
  - Dish name: Noto Serif `text-lg font-bold`
  - Descriptor: `text-on-surface-variant text-sm` (e.g., "Wild Mushroom, 24k Gold")
  - Price: `text-primary font-bold text-lg`
  - Qty controls: `+/-` with count in `bg-surface-container-highest rounded-full px-3 py-1`
    - **Light:** adds `border border-outline-variant`

**Section 2 — "Special Instructions"**
- H3: Noto Serif bold
- Textarea: `min-h-[100–120px]`
  - **Dark:** `bg-surface-container-high border-none rounded-xl` `focus:ring-1 focus:ring-primary-container`
  - **Light:** `bg-surface-container-low border border-outline-variant rounded-2xl` `focus:ring-primary`
  - Placeholder: `"Add a note (e.g., allergies, seat number, preference)..."`

**Section 3 — "Payment Method"**
- H3: Noto Serif bold
- Radio-style selection buttons (full-width):
  - **UPI** (default selected):
    - Dark: `bg-surface-container-high border border-primary-container/20`
    - Light: `bg-surface-container-low border border-primary/40 shadow-sm`
    - Right icon: `check_circle` filled in gold
  - **Apple Pay** — unselected, muted
  - **Pay Later** — unselected, muted
  - Each has icon left + label + radio right

**Section 4 — "Order Summary" (Card)**
- **Dark:** `bg-surface-container-low p-6 rounded-2xl`
- **Light:** `bg-surface-container-low p-8 rounded-3xl border border-outline-variant/50`
- Line items: `flex justify-between` for Subtotal, Tax (GST 5%), Service Fees
- Divider before total: `border-t border-white/5` (dark) or `border-outline-variant/30` (light)
- Total row: label `"TOTAL AMOUNT"` uppercase tracked + price in Noto Serif `text-2xl–3xl text-primary font-bold`
- Values: `$167.00 → $8.35 → $12.00 → $187.35`

### Fixed Footer
- **"PLACE SECURE ORDER"** / **"Place Order →"** CTA:
  - Dark: `bg-primary-container text-on-primary-container rounded-xl`
  - Light: `bg-primary text-white rounded-2xl shadow-lg shadow-primary/20`
  - `uppercase tracking-wide text-sm font-bold py-4–5 w-full`
  - `arrow_forward` icon right
- Bottom nav bar (4 tabs): MENU · AR VIEW · **CART** (active, gold center circle) · STATUS

### Process Flow
```
1. Cart state loaded from app state (accumulated from menu browsing)
2. GET /api/restaurant/:restaurantId/taxes → fetch current tax config
3. Total calculated client-side: subtotal + tax + service fee
4. Payment method selection → update local state (no API call yet)
5. Qty +/- → update item quantities, recalculate total
6. "PLACE SECURE ORDER" tap:
   POST /api/orders {
     restaurantId, tableId, guestName,
     items: [{ dishId, qty, unitPrice, notes }],
     specialInstructions, paymentMethod,
     subtotal, tax, serviceFee, total
   }
7. Loading state on button (spinner)
8. Success → { orderId: "GT-8821", estimatedTime: 12 }
9. Navigate to /order/GT-8821
10. WebSocket broadcast → KDS receives new order
```

---

## SCREEN E: Live Order Status
**Route:** `/order/:orderId`  
**Files:** `live_order_status_1–5` · `live_order_status` dark + light confirmed

### Fixed Top Navigation
- Left: Restaurant name (gold, bold serif)
- Right: `notifications` + chef avatar
- **Dark:** glass blur + heavy shadow
- **Light:** `rgba(faf9f6,0.8)` + blur + bottom border

### Header Block (centered)
- Pill badge: `"ACTIVE ORDER"` — `bg-surface-container-highest text-primary` rounded-full, tiny uppercase
- H1: `"Order #GT-8821"` — Noto Serif `text-4xl font-bold tracking-tight`
- Sub: `"Table 14 • The Grand Brasserie"` — `italic text-on-surface-variant font-light text-sm`

### Live Status Hero Card
- **Dark:** `bg-surface-container-low rounded-2xl p-8` — no border
- **Light:** `bg-surface-container-low rounded-2xl p-10 border border-outline-variant/20 shadow-sm`
- Top progress bar: thin `h-[3px]` bar — `bg-surface-variant` base, `bg-primary w-[65%]` fill (dark: with glow `shadow-[0_0_15px_rgba(240,195,114,0.5)]`)
- Center icon: `restaurant` Material Symbol, `!text-7xl`, `text-primary`, `animate-pulse`
- Status text: `"The Chef is perfecting your meal"` — Noto Serif `text-2xl text-on-surface text-center`
- ETA: `"Estimated arrival in"` + `"12 mins"` (bold `text-primary`)

### 4-Step Vertical Stepper
Each step has: circle icon + vertical connector line + label text

| Step | Circle Style | Line | Label Color |
|---|---|---|---|
| **Order Received** ✓ | Filled gold circle + `check` icon | Gold line | `text-on-surface/50` (muted, done) |
| **Preparing** (active) | Outlined gold border + `skillet` filled icon | Muted line | `text-primary` bold |
| **Ready** | Outlined `outline-variant` + `room_service` | Muted line | `text-on-surface-variant/60` |
| **Served** | Outlined `outline-variant` + `check_circle` | No line (last) | `text-on-surface-variant/60` |

- Step timestamp: `"19:42 • Confirmed by Maître d'"` — `text-[10px–11px] font-label tracking-wider`
- Active step text: `"Ongoing • Your starter is being plated"`
- Pending: `"Upcoming • Awaiting server"` / `"Upcoming • Bon Appétit"`

### Bento Utility Cards (2-column grid)
- **Dark:** `bg-surface-container rounded-xl border border-outline-variant/10`
- **Light:** `bg-surface-container rounded-xl border border-outline-variant/10 hover:border-primary/20`
- Card 1: `notifications_active` icon + `"CALL WAITER"` — triggers waiter alert via WebSocket
- Card 2: `receipt_long` icon + `"VIEW BILL"` — navigates to /bill/:orderId

### Order Summary Card
- **Dark:** `bg-surface-variant/20 backdrop-blur-md rounded-2xl p-6` (glassmorphic)
- **Light:** `glass-card` (rgba white 0.7 + blur) + `border border-primary/10`
- H4: `"Summary"` — Noto Serif
- Line items: dish name (light weight) + price (medium weight) — no totals shown here

### Fixed Bottom Navigation
- **STATUS tab** (active): gold filled circle, elevated, `animate-pulse-slow` (dark)
- Inactive: MENU · AR VIEW · CART

### WebSocket Real-Time Flow
```
1. Page mounts → connect ws://api/orders/GT-8821/status
2. Subscribe to order status events
3. Event: { status: 'PREPARING' } → step 2 highlights, ETA updates
4. Event: { status: 'READY' } → step 3 highlights
   → push notification if browser permission granted:
     "Your food is ready at Table 14!"
5. Event: { status: 'SERVED' } → step 4 highlights
   → prompt appears for rating/feedback
6. "CALL WAITER" → POST /api/orders/GT-8821/call-waiter
   → KDS gets alert notification
```

---

---

# PART 2 — ADMIN SCREENS (Desktop · Kitchen Command)

---

## SCREEN F: Admin Login — Kitchen Command
**Route:** `/admin/login`  
**Files:** `admin_login_1` (dark) · `admin_login_2` (light) · `admin_login_3` (variant)  
**Layout:** 12-column grid — col-span-7 (editorial left) + col-span-5 (login card right)

### Left Panel — Brand Editorial
- `"STUDIO MODE"` — `text-[0.6875rem] tracking-[0.2em] uppercase font-bold text-primary-container`
- H1: `"Menuverse"` bold + `"Kitchen Command"` italic gold — Noto Serif `text-[3.5–4.5rem]`
- 16:9 hero kitchen image:
  - Dark: `grayscale(0.2) contrast(1.1)` filter
  - Light: `saturate(0.8) contrast(1.05)` filter
  - Gradient overlay at bottom
  - Caption chip bottom-left:
    - Dark: inline avatar + text
    - Light: frosted white card `bg-white/90 backdrop-blur-md rounded-lg border border-primary/10`
    - Text: `"Executive Chef Interface"` + `"OPERATIONAL PRECISION"`
- Body text: `"Manage your digital culinary ecosystem..."` — `text-on-surface-variant text-lg/xl`

### Right Panel — Login Card
- Glass card: Dark `rgba(32,31,31,0.6) backdrop-blur(24px)` · Light `rgba(255,255,255,0.8) backdrop-blur(20px)`
- Shadow: Dark `0px 40px 80px rgba(0,0,0,0.5)` · Light `0px 40px 100px rgba(74,62,40,0.12)`
- Brand: *"Menuverse"* italic Noto Serif `text-primary` (24–30px)
- H2: `"Welcome Back"` — Noto Serif 1.75–2rem semibold
- Sub: `"Enter credentials to access the Studio."` — 14px muted

**Minimalist Line Input Fields:**
- No box border — only bottom `border-b border-outline-variant/30`
- Labels: `text-[0.6875rem] uppercase tracking-widest font-bold text-on-surface-variant`
- Focus animation: `.focus-bar` div expands `w-0 → w-100%` from center, `bg-primary`, `transition-all 300ms`
- **CHEF EMAIL** — `type="email"` placeholder `chef@kitchen.command`
- **SECURE KEY** — `type="password"` · `"FORGOT?"` link right-aligned (gold, uppercase)

**Action Buttons:**
- Primary CTA: `"LOGIN TO KITCHEN COMMAND"` — full width, 4rem tall
  - Dark: `bg-primary-container hover:bg-primary text-on-primary-container rounded-lg`
  - Light: `bg-on-background hover:bg-on-primary-container text-white rounded-lg`
- Divider: `"AUTHORIZED ACCESS ONLY"` flanked by 1px lines at 20% opacity
- Alt auth row: `fingerprint` icon + "BIOMETRIC" · `key` icon + "SSO"

**Fixed Footer (opacity 30):**
- Left: `"© 2024 MENUVERSE SYSTEMS INC."`
- Center: 3 pagination dots (first gold, rest muted)
- Right: `"V2.4.0 KITCHEN COMMAND"`

### Process Flow
```
1. Page load → check existing JWT in httpOnly cookie/localStorage
   → if valid: redirect to /admin/dashboard
2. Admin types email + password
3. Input focus → CSS-only focus-bar animation (no JS)
4. Submit → POST /api/auth/admin/login { email, password }
5. Success:
   → Store JWT (httpOnly cookie recommended)
   → Redirect to /admin/dashboard
6. 401 Failure:
   → Inline error: "Invalid credentials" red state
   → Shake animation on card
   → Password cleared, email retained
7. After 5 failures → account locked, show lockout message + cooldown timer
8. "FORGOT?" → navigate to /admin/forgot-password
9. "BIOMETRIC" → trigger WebAuthn `navigator.credentials.get()`
10. "SSO" → OAuth2 redirect (Google Workspace / Microsoft Entra)
```

---

## SCREEN G: Admin Dashboard — Daily Summary
**Route:** `/admin/dashboard`  
**Files:** `admin_dashboard_overview_1` (light) · `admin_dashboard_overview_2` (dark)  
**Layout:** Fixed left sidebar (200px) + scrollable main content

### Left Sidebar
- Top: `"Kitchen Command"` bold serif + `"STUDIO MODE"` label `text-primary`
- Navigation (icon + uppercase label, `tracking-widest`):
  - `dashboard` → **OVERVIEW** (active: left gold border + highlighted)
  - `construction` → MENU ASSETS
  - `360`/AR icon → AR PIPELINE
  - `qr_code_2` → QR FACTORY
  - `settings` → SETTINGS
- Bottom:
  - `"+ Generate 3D Model"` — dark filled button, full-width, sharp radius
  - Chef profile: `"Chef Julian / Executive Admin"` + avatar + `[→` logout icon

### Main Content Header
- H1: `"Daily Summary"` — Noto Serif large bold
- Tagline: *"Refining the digital experience, one plate at a time."*
- Top-right: `"LOCAL TIME · 19:42 PM"` + `notifications` bell

### KPI Cards (3 equal-width)
Each has ghost icon watermark (`opacity-10` large icon, positioned right):

| Card | Metric | Value | Delta | Ghost Icon |
|---|---|---|---|---|
| TODAY'S ORDERS | orders count | **142** | +12% (green) | `shopping_cart` |
| NET REVENUE | revenue | **$12.4k** | +8.4% (green) | `attach_money` |
| AR ENGAGEMENT | AR interaction rate | **68.2%** | +15.1% (green) | `view_in_ar` |

- Values: Noto Serif ~3rem bold
- Card bg: `surface-container-low` (light) / `surface-container` (dark)
- No borders — tonal separation only

### Revenue Trends Chart (~60% width)
- Section: `"Revenue Trends"` + WEEKLY / MONTHLY toggle pills (selected = dark bg)
- Bar chart: 7 bars MON–SUN
  - Light: cream/taupe bars
  - Dark: muted gold-brown bars
- Minimal — no Y-axis labels, no grid lines (editorial style)
- Data: `GET /api/analytics/revenue?period=weekly`

### Recent Orders Panel (~40% width)
- `"Recent Orders"` header + `more_vert` overflow menu
- 4 order rows:
  - Circular dish thumbnail + `#ORD-XXXX` number + dish name + price + status badge
  - Status badges: `PREPARING` (amber) · `IN AR VIEW` (blue) · `COMPLETED` (muted green)
- `"VIEW KITCHEN LOG"` text link — `text-primary` centered

### System Intelligence Card (full-width bottom)
- `"SYSTEM INTELLIGENCE"` — tiny gold label
- H2: `"AR Menus Increase Dessert Sales by 24%"` — Noto Serif bold large
- Body: AI-generated insight paragraph with conversion rate data
- CTAs: `"DEPLOY UPDATE"` (filled dark) + `"VIEW HEATMAPS"` (outlined ghost)
- Right: Large portrait AI chef image — editorial, bleeds to card edge

### Process Flow
```
1. Mount → auth guard → redirect to /admin/login if no JWT
2. Parallel API fetches:
   GET /api/admin/stats/today        → KPI values
   GET /api/orders?limit=4&sort=desc → Recent Orders panel
   GET /api/analytics/revenue/week   → Chart data
   GET /api/intelligence/insights    → System Intelligence card
3. WebSocket: ws://api/admin/live
   → Subscribe: order:new, order:status_update
   → New order → TODAY'S ORDERS counter++ + new row in Recent Orders
4. WEEKLY/MONTHLY toggle → re-fetch chart: GET /api/analytics/revenue?period=monthly
5. "DEPLOY UPDATE" → POST /api/intelligence/deploy { insightId }
6. "+ Generate 3D Model" → navigate to /admin/ar-pipeline/new
```

---

## SCREEN H: Management Terminal — Branding Settings
**Route:** `/admin/settings`  
**Files:** `admin_branding_settings_1` (dark) · `admin_branding_settings_2` (light)  
**Layout:** Sidebar (shared) + main area split: ~65% form + ~35% preview panels

### Page Header
- H1: `"Management Terminal"` — Noto Serif large
- Sub: `"Configure your brand identity and operational preferences across the Menuverse ecosystem."`
- Top-right: `notifications` + admin avatar

### Main Form — Left Column

**Section 1: Restaurant Profile** (`restaurant` icon)
- **DISPLAY NAME** — text input, prefilled `"The Grand Brasserie"`
- **SERVICE TYPE** — dropdown: Fine Dining · Casual · Fast Casual · Café · Bar
- **TIME ZONE** — dropdown: `"GMT -5:00 (EST)"` and other zones
- Input style: minimal, `border-b border-outline-variant/50` bottom line only

**Section 2: Brand Identity** (`palette` icon)
- **MASTER LOGO** upload zone:
  - Dashed border rectangle, `upload` icon + `"Drag and drop high-res SVG or PNG"`
  - On upload: shows image preview
- **PRIMARY BRAND COLOR** swatches (2 rows × 3):
  - Dark variant: amber, pink, blue, green, purple, `+` (custom)
  - Light variant: champagne gold, dark teal, olive, grey, cream, `+` (custom)
  - Selected: highlighted ring
  - Helper text below: *"The selected amber (#f0c372) is used for buttons, highlights, and your digital concierge interface."* — italic, small

**Section 3: Notification Engine** (`notifications` icon)
- **Real-time Order Alerts** — "Notify KDS when a new diner order is placed" — Toggle **ON** (amber)
- **AR Asset Conflict** — "Alert me if 3D renders fail to load on diner devices" — Toggle **OFF** (muted)
- Toggles: pill-style, amber when active; separated by whitespace only (no dividers)

### Right Column — Live Preview Panels

**Customer Experience Preview Card**
- Label: `"INTERFACE PREVIEW (DINER VIEW)"` / `"CUSTOMER EXPERIENCE PREVIEW"` — tiny uppercase
- Simulated mobile frame showing live menu as diner sees it with current branding
- Label at bottom: `"REAL-TIME VISUALIZATION"` / `"LIVING PREVIEW"`
- Updates live as brand colors/logo change (CSS variable injection)

**Staff Access Card**
- `"Staff Access"` heading + `group_add` icon
- Staff list rows:
  - Avatar initials circle + full name + role
  - `"Julian Thorne — Admin / Head Chef"` (JT)
  - `"Marcus Lane — Manager / Logistics"` (ML)
  - Each has `more_vert` for edit/remove

### Footer Actions (sticky at bottom)
- `"Discard Changes"` — ghost outlined button
- `"Save Branding Updates"` — filled gold CTA

### Process Flow
```
1. Mount → GET /api/admin/settings → prefill all fields
2. GET /api/admin/staff → populate Staff Access panel
3. Logo upload:
   → POST /api/admin/media/upload (multipart/form-data)
   → Returns CDN URL → stored in form state + preview updates
4. Color swatch click → update primaryColor in local state
   → Live preview re-renders with new CSS variables (no API call yet)
5. "+" custom color → opens color picker popover
6. Toggle flip → update local state only
7. "Discard Changes" → confirm modal → reload original values
8. "Save Branding Updates":
   PUT /api/admin/settings {
     displayName, serviceType, timezone,
     logoUrl, primaryColor, notifications: { orderAlerts, arConflict }
   }
   → Toast: "Branding updated successfully"
   → Customer app reads new config on next /menu load
9. "LAUNCH LIVE MENU" (sidebar) → opens /menu/:restaurantId in new tab
```

---

## SCREEN I: Menu Inventory — Menu Assets
**Route:** `/admin/menu`  
**Files:** `menu_ar_asset_management_1` (dark) · `menu_ar_asset_management_2` (light)  
**Layout:** Sidebar + main area split: ~60% catalogue list + ~40% create/edit panel

### Page Header
- H1: `"Menu Inventory"` — Noto Serif large bold
- Sub: `"Manage your digital culinary assets and monitor AR generation progress across all platforms."` / (light: `"Refine your culinary presentation..."`)
- Top-right actions:
  - `"Filter"` — outlined button with `filter_list` icon
  - `"+ Add New Dish"` — filled gold/dark CTA

### Active Catalogue List (Left Panel)
- Sub-header: `"ACTIVE CATALOGUE"` label + `"24 ITEMS"` / `"24 ITEMS TOTAL"` right-aligned — tiny uppercase

**Dish Row Items** (no divider lines — whitespace only):
Each row contains:
- Square dish thumbnail (60×60px, slightly rounded)
- Dish name: bold (e.g., `"Saffron Lobster Medallion"`)
- Category tags: `"ENTRÉES • SIGNATURE"` — tiny uppercase muted
- Price: `"$42.00"` — gold
- **AR Status Badge:**
  - `✓ AR READY` — green/teal pill with checkmark
  - `↻ GENERATING...` / `⟳ PROCESSING` — amber animated pill
  - `⊘ NO ASSET` — muted grey pill
- `more_vert` overflow menu (edit, delete, view)

Example dishes visible:
- Saffron Lobster Medallion · $42.00 · `AR READY`
- The Midnight Forest · $18.50 · `GENERATING...` / `PROCESSING`
- A5 Wagyu Tartare · $34.00 · `NO ASSET`

**Toast Notification** (bottom-right, floating):
- Icon: cloud upload
- Title: `"3D Reconstruction Complete"`
- Sub: `'"Miso Glazed Cod" is now live in AR View.'`
- `×` dismiss button

### Create New Asset Panel (Right Panel)
Form for adding or editing a dish + triggering AR generation:

- **"Create New Asset"** heading
- **DISH IDENTITY** — text input, placeholder `"e.g. Truffle Infused Risotto"`
- **DESCRIPTION** — textarea, placeholder `"Describe the sensory profile..."` / `"Describe the culinary profile..."`
- **PRICE ($)** — number input
- **CATEGORY** — dropdown `"Appetizer"` (options: Appetizer, Starter, Entrée, Dessert, Drink)
- **REFERENCE IMAGERY** upload zone:
  - Dashed border, `cloud_upload` icon
  - `"Drop HQ photos for 3D reconstruction"`
  - Supports multiple images (min 3 recommended for photogrammetry)
- `"⚡ TRIGGER AR GENERATION"` — filled CTA (gold/dark) — sends to AR pipeline
- `"SAVE ITEM TO MENU"` — outlined button below — saves dish without AR

**AR Pipeline Stats Card** (bottom of right panel):
- `"AR PIPELINE STATS"` / `"AR PIPELINE CAPACITY"` heading + expand icon
- **CURRENT UTILIZATION** label + `"82%"` (gold) right-aligned
- Progress bar: gold fill, ~80% width
- Sub-label: `"Next available slot: 14 mins"` / `"Next processing slot available in 14 minutes"`

### Process Flow
```
1. Mount → GET /api/admin/menu?restaurantId=X → load all dishes with AR status
2. GET /api/admin/ar-pipeline/stats → load utilization for stats card
3. WebSocket: ws://api/admin/ar-pipeline/updates
   → When AR job completes: toast notification appears, dish row badge updates
4. Filter button → opens filter drawer: by category, AR status, price range
5. Dish row `more_vert` → context menu: Edit · Delete · View in AR · Regenerate Model
6. Create New Asset form:
   a. Fill fields
   b. Drop images into upload zone → POST /api/admin/media/upload (each image)
   c. "TRIGGER AR GENERATION":
      POST /api/admin/ar-jobs {
        dishName, description, imageUrls[], category, price
      }
      → Returns { jobId, estimatedTime, queuePosition }
      → Navigate to /admin/ar-pipeline/:jobId to track progress
   d. "SAVE ITEM TO MENU":
      POST /api/admin/menu/dish {
        name, description, price, category, imageUrl
      }
      → Dish appears in catalogue with "NO ASSET" badge
      → Can trigger AR generation later
```

---

## SCREEN J: AR Studio Pipeline
**Route:** `/admin/ar-pipeline/:assetId`  
**Files:** `ar_studio_model_generation_1` (light) · `ar_studio_model_generation_2` (dark)  
**Layout:** Sidebar + main content area

### Page Header
- H1: `"AR Studio Pipeline"` — Noto Serif large
- Sub: `"Butter Chicken | Asset ID: #88291-BC"` — dish name + unique asset ID (`text-primary`)
- Top-right: `"MODEL STATUS"` label + `"Mesh Optimization"` value + admin avatar

### 5-Step Horizontal Progress Stepper
Horizontal stepper with connecting gold line:

| Step | Icon | Status |
|---|---|---|
| UPLOADING | `✓` filled gold | Complete |
| VALIDATION | `✓` filled gold | Complete |
| PHOTOGRAMMETRY | `✓` filled gold | Complete |
| OPTIMIZATION (MESH) | `⚙` spinning/active | **In Progress** |
| READY | `🚀` rocket | Pending |

- Complete: gold filled circle + checkmark
- Active: outlined gold border + process icon (pulsing)
- Pending: muted grey circle + icon
- Connecting line: gold between complete steps, muted for pending

### Left Content — Input Stream Analysis
- Source video player thumbnail:
  - Dish close-up video frame (e.g., swirling butter sauce)
  - `▶` play button overlay
  - Badges: `"SOURCE VIDEO"` + `"4K / 60FPS"`
- `"Input Stream Analysis"` heading:
  - **TOTAL FRAMES** stat card: `1,240`
  - **COVERAGE** / **SUBJECT COVERAGE** stat card: `94.2%`
- Live Processing Log (terminal-style):
  ```
  [09:42:11] Initializing Photogrammetry Engine...
  [09:42:15] Mapping 4,202 point cloud vectors
  [09:43:02] Extracting high-res albedo textures (8K)
  [09:45:18] Starting Mesh Optimization: Decimating triangles
  [09:45:22] CURRENT: Re-topologizing reflections...
  ```
  - Active line: `text-primary/amber`
  - Past lines: `text-on-surface-variant` muted

### Right Content — 3D Model Preview Viewer
- Dark stage area showing rendered 3D dish
- Tool icons (vertical stack, right edge):
  - `grid_on` — wireframe toggle
  - `light_mode` — lighting controls
  - `zoom_in` — zoom
- Texture quality tabs at bottom:
  - `[A]` Premium Ultra-HD · `[B]` Standard
  - Active tab: gold fill or outlined gold
- `"Publish to Menu →"` — large CTA, full-width, gold background

### Model Technical Stats (bottom row, 3 cards)
- FILE SIZE: `12.4 MB` / `"Highly Optimized"`
- TRIANGLES: `45.2K` / `"Retopology: Done"`
- DINER LOAD TIME: `0.8s` / `"On 5G Connection"`

### Process Flow
```
1. Navigate from Menu Assets → "TRIGGER AR GENERATION" or directly
2. GET /api/ar-pipeline/:assetId → load current job state + log history
3. WebSocket: ws://api/ar-pipeline/:assetId/progress
   → Stream live log lines as they're generated
   → Step updates as pipeline progresses
   → Log terminal: auto-scroll to latest line
4. Source video → GET streaming URL → HTML5 video player
5. 3D viewer:
   → GET /api/ar-assets/:assetId/model.glb (CDN URL)
   → Load into WebGL viewer (Three.js / Google model-viewer)
   → Tool buttons = local view state changes
6. Texture tab selection → reload model at selected quality
7. "Publish to Menu →":
   → Only enabled when job status = READY
   → PUT /api/admin/menu/dish/:dishId { arModelId, textureQuality: 'ultra' }
   → Toast: "Model published to live menu"
   → Navigate to /admin/menu
```

---

## SCREEN K: QR Code Factory
**Route:** `/admin/qr-factory`  
**Files:** `qr_factory_table_setup_1` (dark) · `qr_factory_table_setup_2` (light)  
**Layout:** Sidebar + main content split: ~35% create form (left) + ~65% print preview grid (right)

### Page Header
- Label: `"SYSTEM CONFIGURATION"` — tiny uppercase gold
- H1: `"QR Code Factory"` — Noto Serif bold large
- Sub: `"Provision high-fidelity AR access points for your dining floor. Generate unique identifiers tied to physical table assets with instantaneous menu synchronization."`
- Top-right actions:
  - `"DOWNLOAD PDF"` — outlined button with `download` icon
  - `"BULK EXPORT PNGS"` / `"BULK EXPORT"` — filled dark/gold CTA

### Create Table Entry Form (Left Panel)
- **TABLE NUMBER / LABEL** — text input, placeholder `"e.g. Table 42"`
- **SEATING CAPACITY** — dropdown `"2 Persons"` (options: 2, 4, 6, 8, 10+)
- **ZONE ASSIGNMENT** — pill button group (single-select):
  - `MAIN FLOOR` (default selected, gold)
  - `TERRACE`
  - `PRIVATE BAR`
- `"PROVISION ENTRY"` — filled CTA button, full-width (dark: dark bg / light: outlined dark)

**Factory Statistics** (below form):
- `"FACTORY STATISTICS"` label — tiny uppercase
- **Active Codes:** `124` — large bold
- Progress bar (gold fill, ~70%)
- **Sync Status:** `● LIVE PIPELINE` — green dot + label

### Print Preview Grid (Right Panel)
- Label: `"PRINT PREVIEW GRID"` + grid/list view toggle icons (`grid_view` / `list`)
- QR code cards (3 per row grid):
  - **Dark:** dark card with actual rendered QR code image (black squares on dark bg)
  - **Light:** light card with `"Menuverse"` brand + table label + stylized icon (no actual QR shown — placeholder)
  - Each card shows:
    - `"Menuverse"` brand label top-left (italic gold)
    - `"T-01"` / `"T-02"` / `"T-03"` table badge top-right
    - QR code area (center)
    - `"TABLE ONE"` / `"TABLE TWO"` label below
    - `UUID: MV-8821-X9` — unique identifier
- `"+ PROVISION NEW SLOT"` card — dashed border, `+` centered, `"PROVISION NEW SLOT"` label below

### Physical Placement Guide Section (below grid)
- H2: `"Physical Placement Guide"` — Noto Serif
- Body: *"For optimal AR anchoring, place QR codes on flat, non-reflective surfaces. Ensure at least 15cm of clearance from surrounding tabletop clutter to maintain visual fidelity for diner cameras."*
- Two spec callouts side by side:
  - `light_mode` icon + **LIGHTING** + "Min. 200 Lux recommended"
  - `straighten` icon + **SIZE** + "Optimal 60mm × 60mm"
- Right: table setup photo

### Process Flow
```
1. Mount → GET /api/admin/tables?restaurantId=X → load existing tables
2. GET /api/admin/qr-stats → load factory statistics
3. "PROVISION ENTRY":
   POST /api/admin/tables {
     label: 'Table 42',
     capacity: 2,
     zone: 'main_floor',
     restaurantId: 'rest123'
   }
   → Backend generates:
     - UUID (e.g., MV-8821-X9)
     - QR code pointing to: https://app.menuverse.com/t/42?r=rest123
     - QR rendered as PNG, stored on CDN
   → New card appears in print preview grid
4. "DOWNLOAD PDF" → GET /api/admin/tables/:id/qr?format=pdf
   → Styled PDF with branding, table name, QR code
5. "BULK EXPORT PNGS" → GET /api/admin/tables/qr/bulk?format=png
   → ZIP file download with all QR codes
6. Zone pills → filter preview grid by zone (local filter, no API)
7. Grid/list view toggle → local view state change
8. Individual QR card → click opens full QR preview modal with download options
```

---

## SCREEN L: Kitchen Display System (KDS)
**Route:** `/admin/kds`  
**Files:** `kitchen_display_system_1` (dark) · `kitchen_display_system_2` (light)  
**Layout:** Full top nav + left sidebar + main 2-column order card grid (tablet-optimized, landscape recommended)

### Top Navigation (Full-width, not sidebar style)
- Left: `"Gourmet Tech"` — gold serif bold
- Center nav links: Dashboard · Menu · AR Studio · QR Factory · **KDS** (active, underlined gold)
- Right: `"SYSTEM CLOCK 19:42:05"` (live, updates every second) + `notifications` + `settings` + admin avatar

### Left Sidebar (narrow)
- Restaurant name: `"The Grand Brasserie"` + `"ADMIN TERMINAL"` / `"OPERATIONAL TERMINAL"` label
- Same nav links as sidebar variant:
  - Analytics · Menu Builder · AR Assets · QR Generator · **Kitchen Display** (active, gold border)
- Bottom: `"LAUNCH LIVE MENU"` CTA

### New Order Alert Banner (full-width, top of main)
- Dark red/error background strip (or rose-tinted for light)
- `volume_up` icon + `"New Order Received"` bold + `"Table 14 — Express Pickup Requested"` sub
- `"ACKNOWLEDGE"` button — right aligned, outlined

### Order Cards Grid (2 columns, scrollable)
Each order card has a colored top border indicating urgency:

**Card Structure:**
- **Top border:** colored strip (red = overdue/urgent, amber = in progress, blue = new)
- **Header row:**
  - Table badge: `T-12` / `T-08` etc. — bold serif, colored background (red for urgent, amber for normal)
  - Order ID: `SF-2026-4821` — small, muted
  - Right icon: `!` for urgent (dark) / hourglass for timer
- **Timer:** `22m 14s` / `12m 45s` — `clock` icon + time elapsed since order placed (auto-incrementing)
- **Items list:**
  - Item line: `2x Truffle Risotto` (bold) + category `Entrée` (right, muted)
  - Modification bullets: `• No Parmesan garnish` · `• Extra shaved black truffle (+5g)` — small italic amber
  - Item line: `1x Wagyu Sando` + `Starters`
  - Mod: `Medium Rare - Crust off` — amber italic
- **Status Action Buttons (3 buttons):**
  - `PREPARING` · `READY` · `SERVED`
  - Active status is highlighted (filled dark or gold depending on state)
  - Tap to advance order to next status

**Card States:**
- **NEW** (just arrived): blue top border, `"NEW"` badge
- **PREPARING** (active): amber top border, `Preparing` button filled
- **READY** (plated): green? gold top border, `Ready` button filled
- **SERVED** (delivered): muted, greyed out card — `"Served"` status shown with checkmark
  - Shows: `"Order fulfilled 5 mins ago"` + `"Re-Open Order"` ghost button

### Example Active Orders Visible:
- **T-12** `SF-2026-4821` · 22m 14s · 2x Truffle Risotto + 1x Wagyu Sando · Status: READY (active)
- **T-08** `SF-2026-4825` · 12m 45s · 1x Lobster Thermidor + 3x Caviar Blinis · Status: PREPARING
- **T-22** `SF-2026-4830` · 4m 12s · 4x Duck Confit · Status: NEW
- **T-04** `SF-2026-4819` · Served · `"Order fulfilled 5 mins ago"`

### Process Flow
```
1. KDS page loads → WebSocket: ws://api/kitchen/orders/live
2. GET /api/orders?status=active&restaurantId=X → load all active orders
3. New order event (ws) → NEW card appears with alert sound + banner
4. Banner "ACKNOWLEDGE" → POST /api/orders/:id/acknowledge
   → Banner dismisses, order card remains
5. Staff taps "PREPARING":
   → PATCH /api/orders/:id/status { status: 'PREPARING' }
   → Card border shifts amber, Preparing button fills
   → WebSocket broadcasts → Customer's order status screen updates to "Preparing"
6. Staff taps "READY":
   → PATCH /api/orders/:id/status { status: 'READY' }
   → Card border shifts, Ready button fills
   → WebSocket broadcasts → Customer gets push notification "Food is ready"
   → Customer's status screen advances to "Ready"
7. Staff taps "SERVED":
   → PATCH /api/orders/:id/status { status: 'SERVED' }
   → Card greys out, shows timestamp
   → Customer's status screen advances to "Served"
   → Rating prompt appears on customer's screen
8. Timer: auto-increments every second (client-side `setInterval`)
   → Visual urgency: turns red at configurable threshold (e.g., 20 mins)
9. "Re-Open Order" (on served card) → PATCH status back to PREPARING
```

---

---

# SHARED COMPONENTS

## Bottom Navigation Bar (Customer Mobile)
4 tabs, fixed bottom, glassmorphic:
- Tab 1: `restaurant` icon + "MENU"
- Tab 2: `view_in_ar` icon + "AR VIEW"
- Tab 3: **Active tab** — gold filled circle, elevated `scale-110`, shadow `shadow-primary/20`, `animate-pulse` when status has update
- Tab 4: context-dependent (CART or STATUS)

Active tab indicated by:
- Dark: gold filled rounded-full background with dark text
- Light: gold filled circle elevated with shadow

## Toast / Notification System
- Appears bottom-right (admin) or bottom of screen (customer)
- `surface-container-low` background + light border + icon
- Auto-dismisses after 4s or manual `×` close
- Types: success (cloud upload icon) · alert (warning) · info

## Glassmorphic Overlay Panels
Used for: Top navs · Bottom navs · AR overlays · KDS alert banners
- `background` at 60–85% opacity
- `backdrop-filter: blur(20–40px)`
- Thin border: `outline-variant` at 10–30% opacity
- Shadow: diffused, warm-tinted

---

---

# API ENDPOINTS MASTER LIST

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/admin/login` | Admin authentication → JWT |
| POST | `/api/auth/admin/forgot-password` | Password reset email |
| GET | `/api/restaurant/:id/config` | Load branding + today's specials |
| GET | `/api/menu/:restaurantId` | Full menu with categories + items |
| GET | `/api/menu/dish/:dishId` | Single dish with AR model URL |
| POST | `/api/orders` | Place new order |
| GET | `/api/orders/:orderId` | Get order details |
| PATCH | `/api/orders/:orderId/status` | Update order status |
| POST | `/api/orders/:orderId/call-waiter` | Alert waiter |
| POST | `/api/orders/:orderId/rating` | Submit rating + review |
| GET | `/api/admin/stats/today` | KPI metrics |
| GET | `/api/analytics/revenue` | Revenue chart data |
| GET | `/api/intelligence/insights` | AI-generated insights |
| POST | `/api/intelligence/deploy` | Deploy recommended update |
| GET | `/api/admin/settings` | Load branding config |
| PUT | `/api/admin/settings` | Save branding config |
| GET | `/api/admin/staff` | List staff members |
| GET | `/api/admin/menu` | List all dishes with AR status |
| POST | `/api/admin/menu/dish` | Create new dish |
| PUT | `/api/admin/menu/dish/:id` | Update dish |
| DELETE | `/api/admin/menu/dish/:id` | Delete dish |
| POST | `/api/admin/media/upload` | Upload image/logo → CDN URL |
| POST | `/api/admin/ar-jobs` | Start AR generation job |
| GET | `/api/ar-pipeline/:assetId` | Get job status + log |
| PUT | `/api/admin/menu/dish/:id` | Publish AR model to dish |
| GET | `/api/admin/tables` | List all tables |
| POST | `/api/admin/tables` | Create table + generate QR |
| GET | `/api/admin/tables/:id/qr` | Download QR (pdf/png) |
| GET | `/api/admin/tables/qr/bulk` | Bulk export QR codes (zip) |
| GET | `/api/admin/qr-stats` | Factory statistics |
| GET | `/api/admin/ar-pipeline/stats` | Pipeline utilization |
| GET | `/api/orders?status=active` | KDS: active orders |
| POST | `/api/orders/:id/acknowledge` | KDS: acknowledge new order |

---

# WEBSOCKET EVENTS

| Event | Direction | Consumer | Payload |
|---|---|---|---|
| `order:new` | Server → KDS | Kitchen Display | Full order object |
| `order:acknowledged` | KDS → Server | Backend | `{ orderId }` |
| `order:status_update` | Server → Customer | Status screen | `{ orderId, status, eta }` |
| `ar:job:progress` | Server → Admin | AR Pipeline screen | `{ jobId, step, log, percent }` |
| `ar:job:complete` | Server → Admin | Menu Inventory | `{ jobId, dishId, modelUrl }` |
| `waiter:called` | Customer → Server | KDS / Waiter device | `{ tableId, message }` |
| `admin:live:order` | Server → Admin | Dashboard | `{ orderId, tableId, total }` |

---

# TECH STACK RECOMMENDATIONS

| Layer | Recommendation |
|---|---|
| Customer Frontend | Next.js 14 (App Router) + TailwindCSS |
| Admin Frontend | Next.js 14 or React + TailwindCSS |
| AR Engine | `<model-viewer>` web component (WebXR) |
| 3D Models | `.glb` (Android/Web) · `.usdz` (iOS QuickLook) |
| Backend API | Node.js + Express or Next.js API Routes |
| Realtime | Socket.io or native WebSockets |
| Database | PostgreSQL (primary) + Redis (sessions, WebSocket state) |
| File Storage | AWS S3 or Cloudflare R2 (images + 3D models) |
| CDN | Cloudflare (global low-latency for AR model delivery) |
| Auth | JWT + bcrypt + WebAuthn (biometric) + OAuth2 (SSO) |
| 3D Generation | Luma AI / TripoSR / Meshy API (photogrammetry pipeline) |
| Notifications | Web Push API + Firebase Cloud Messaging |
| Deployment | Vercel (frontend) + Railway/Render (backend) |
