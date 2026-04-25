# Menuverse
## Software Requirements Document

**Document Version:** 1.0  
**Status:** Draft — For Engineering, Product & Design Review  
**Last Updated:** 2026  
**Classification:** Internal / Investor-Ready  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [User Personas](#3-user-personas)
4. [Complete User Journeys](#4-complete-user-journeys)
5. [Feature List](#5-feature-list)
6. [AR Food Visualization System](#6-ar-food-visualization-system)
7. [Video-to-3D Model Generation Pipeline](#7-video-to-3d-model-generation-pipeline)
8. [QR Code Table System](#8-qr-code-table-system)
9. [Ordering System](#9-ordering-system)
10. [Pricing & Billing](#10-pricing--billing)
11. [Technical Architecture](#11-technical-architecture)
12. [Database Design](#12-database-design)
13. [API Reference](#13-api-reference)
14. [Performance Requirements](#14-performance-requirements)
15. [Security Requirements](#15-security-requirements)
16. [Scalability Considerations](#16-scalability-considerations)
17. [Analytics & Reporting](#17-analytics--reporting)
18. [Future Roadmap](#18-future-roadmap)
19. [MVP Scope](#19-mvp-scope)
20. [Risks & Challenges](#20-risks--challenges)

---

## 1. Executive Summary

### 1.1 What Is This Product?

The **Menuverse** is a mobile-first, multi-tenant SaaS platform that digitises and elevates the in-restaurant dining experience. Customers scan a unique QR code affixed to their table, instantly opening a rich digital menu in their mobile browser — no app download required. They can browse dishes, visualise food items in Augmented Reality (AR) projected onto their physical table surface, customise their order, and submit it directly to the kitchen, all without waiting for a waiter.

Restaurant owners manage their entire menu, pricing, AR food models, table layout, and operational analytics through a dedicated Admin Dashboard. A separate AR Studio portal enables owners to upload short smartphone videos of dishes and automatically generate high-quality 3D AR models through a fully automated photogrammetry and optimisation pipeline.

### 1.2 Who Are the Users?

| User Type | Description |
|---|---|
| **Diners (Customers)** | Restaurant guests who scan a table QR code to browse and order |
| **Restaurant Owners / Admins** | Operators who manage menus, AR models, pricing, and analytics |
| **Kitchen & Wait Staff** | Staff who view, process, and fulfil incoming orders |
| **Platform Super Admins** | The SaaS operator managing tenants, billing, and infrastructure |

### 1.3 The Problem Being Solved

| Problem | Impact |
|---|---|
| Physical menus are unhygienic and expensive to reprint | High cost, poor post-pandemic hygiene perception |
| Customers cannot visualise dishes before ordering | Lower confidence, more wrong orders, higher dissatisfaction |
| Ordering is bottlenecked by waiter availability | Slower table turnover, lost revenue, frustrated customers |
| Kitchen receives orders through verbal/paper relay | Errors, lost tickets, inefficient preparation flow |
| Owners lack real-time data on dish performance | Poor menu decisions, missed revenue opportunities |

### 1.4 Value Proposition

- **For Diners:** A seamless, interactive ordering experience that removes uncertainty — customers see exactly what they are ordering in life-size AR before committing.
- **For Restaurant Owners:** A data-driven digital menu platform that reduces print costs, increases average order value, reduces waiter workload, and provides deep analytics — all for a predictable monthly subscription.
- **For Investors:** A scalable, multi-tenant SaaS business with strong network effects, high switching costs, and an expanding moat through proprietary AR model generation technology.

### 1.5 Why AR Food Visualization Matters

Augmented Reality bridges the gap between expectation and reality. Studies in e-commerce consistently show that AR product visualization increases purchase confidence and reduces return rates. Applied to food:

- Customers ordering a dish they can "see" on their table are more confident in their choice, reducing order regret and waiter callbacks.
- Dishes with AR previews receive higher tap rates, driving upsell of premium items.
- AR photo-sharing (Social Mode) turns every table into a viral marketing moment for the restaurant.
- Restaurants that offer AR menus differentiate themselves as technology-forward, attracting younger, experience-driven demographics.

---

## 2. System Overview

The platform is composed of five distinct surface areas, each with a well-defined user audience and technical boundary.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PLATFORM SURFACES                            │
├────────────────┬──────────────────┬──────────────┬─────────────────┤
│  Customer PWA  │  Admin Dashboard │  AR Studio   │  Kitchen Display │
│  menuverse.app/r/.. │  admin.menuverse.app       │  studio.menuverse.app  │  kds.menuverse.app/r/..   │
│  Mobile-first  │  Desktop/Tablet  │  Desktop     │  Wall screen    │
└────────────────┴──────────────────┴──────────────┴─────────────────┘
                            │
                    ┌───────▼────────┐
                    │   API Gateway  │
                    │  (Rate limit,  │
                    │   Auth, Route) │
                    └───────┬────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────┐  ┌─────────▼──────┐  ┌────────▼───────┐
│  Menu &      │  │  Order &       │  │  AR Pipeline   │
│  Restaurant  │  │  Payment       │  │  Service       │
│  Service     │  │  Service       │  │                │
└───────┬──────┘  └─────────┬──────┘  └────────┬───────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼────────┐
                    │   PostgreSQL   │
                    │   + Redis      │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  AWS S3 + CDN  │
                    │  (Assets, AR)  │
                    └────────────────┘
```

### 2.1 Customer Interface (PWA)

A Progressive Web App accessible via QR scan — no installation. Renders the full menu, supports AR visualization via WebXR/Model Viewer, manages cart state, and submits orders. Optimised for 4G mobile devices.

### 2.2 Restaurant Admin Dashboard

A desktop-first web application for restaurant owners and managers. Covers menu creation, item management, table QR generation, order monitoring, pricing rules, and analytics reporting.

### 2.3 AR Studio Portal

A separate desktop web application for generating AR food models. Restaurant staff upload short smartphone videos of dishes, monitor the automated photogrammetry pipeline, preview and quality-review generated 3D models, adjust scale/orientation, and publish models to the live menu.

### 2.4 Kitchen Display System (KDS)

A full-screen, wall-mounted browser interface for kitchen staff. Displays incoming orders in real time, allows status updates (Preparing / Ready), and emits audio alerts on new tickets.

### 2.5 AR Processing Pipeline

A backend set of Docker-based worker services that process uploaded videos through frame extraction, photogrammetry reconstruction, mesh optimisation, and format conversion — fully automated and queue-driven.

---

## 3. User Personas

### 3.1 Persona — The Diner (Restaurant Guest)

**Name:** Priya, 28 — Marketing professional, frequent restaurant-goer  
**Device:** iPhone 14, Safari  
**Tech comfort:** High  

| Attribute | Detail |
|---|---|
| **Goal** | Order confidently, discover dishes she hasn't tried, avoid lengthy waiter waits |
| **Pain Points** | Doesn't recognise dish names in foreign cuisines · Unsure of portion sizes · Frustrated by slow service during peak hours |
| **Key Interactions** | Scans QR → browses menu → taps "View in AR" on an unfamiliar dish → sees it on her table → adds to cart → pays → tracks status |
| **Success Criteria** | Order placed in under 3 minutes, no waiter interaction required |

### 3.2 Persona — The Restaurant Owner / Admin

**Name:** Rajan, 45 — Owner of a mid-size Indian restaurant chain (3 branches)  
**Device:** MacBook Pro, Chrome  
**Tech comfort:** Medium  

| Attribute | Detail |
|---|---|
| **Goal** | Reduce menu reprint costs, increase average order value, understand which dishes drive revenue |
| **Pain Points** | Spends ₹15,000/month on physical menu reprints · No data on which dishes are most viewed · Too many waiter errors on orders |
| **Key Interactions** | Logs into Admin Dashboard → updates dish prices → generates table QR codes → reviews analytics → uploads dish video to AR Studio |
| **Success Criteria** | Platform pays for itself within 60 days via saved printing costs and upsell lift |

### 3.3 Persona — The Kitchen / Wait Staff

**Name:** Arjun, 23 — Head kitchen staff, works evenings  
**Device:** Wall-mounted Android tablet  
**Tech comfort:** Low-medium  

| Attribute | Detail |
|---|---|
| **Goal** | See orders clearly, update status quickly, avoid miscommunication with front-of-house |
| **Pain Points** | Paper tickets get lost or misread · No visibility into pending order queue · Verbal communication fails during busy service |
| **Key Interactions** | Views KDS screen → sees new order arrive with audio alert → marks items Preparing → marks Ready when done |
| **Success Criteria** | Zero missed orders, status visible to front-of-house in real time |

### 3.4 Persona — The Platform Super Admin

**Name:** Divya, 34 — CTO / Co-founder of the SaaS platform  
**Device:** MacBook, multiple monitors  
**Tech comfort:** Expert  

| Attribute | Detail |
|---|---|
| **Goal** | Onboard restaurants quickly, ensure 99.9% uptime, grow MRR, monitor abuse |
| **Pain Points** | Tenant data isolation at scale · Abuse of AR processing pipeline (excessive uploads) · Billing disputes |
| **Key Interactions** | Manages restaurant tenants · Monitors processing job queues · Reviews platform-wide analytics · Manages subscription tiers |
| **Success Criteria** | < 5 min restaurant onboarding, < 1% processing failure rate, zero cross-tenant data leaks |

---

## 4. Complete User Journeys

### 4.1 Customer Journey

```
[TABLE] ──QR Scan──▶ [MENU LOADS] ──Browse──▶ [DISH DETAIL]
                                                     │
                                              ┌──────▼──────┐
                                              │  View in AR  │
                                              └──────┬──────┘
                                                     │
                                            [AR CAMERA OPENS]
                                            Dish placed on table
                                            Rotate / zoom / share
                                                     │
                                              ┌──────▼──────┐
                                              │  Add to Cart │
                                              └──────┬──────┘
                                                     │
                                            [CART REVIEW]
                                            Customise / remove items
                                                     │
                                              ┌──────▼──────┐
                                              │   Checkout   │
                                              └──────┬──────┘
                                                     │
                                            [PAYMENT / PAY LATER]
                                                     │
                                            [ORDER CONFIRMED]
                                            Real-time status tracker
                                            Received → Preparing → Ready → Served
```

**Step-by-Step:**

1. Customer sits at a table. A QR code card is visible on the table.
2. Customer opens phone camera and scans the QR code.
3. Browser opens the Customer PWA — no app download, no login required.
4. The menu loads in under 2 seconds, showing categories and dish cards.
5. Customer browses by category (Starters, Mains, Desserts, Drinks) or uses search.
6. Customer taps a dish card to open the detail view: image, description, nutrition, tags.
7. Customer taps **"View in AR"**. The device camera activates.
8. The system detects the table surface via WebXR plane detection.
9. A life-size 3D model of the dish is placed on the table.
10. Customer rotates (swipe), zooms (pinch), and adjusts portion size (Small/Medium/Large).
11. Optionally: Customer taps an ingredient to see its name highlighted.
12. Customer taps **"Add to Order"** from within AR or from the dish detail view.
13. Customer selects modifiers (Spice Level, Add-ons, Remove ingredients).
14. Customer reviews cart, confirms quantities, and taps **"Place Order"**.
15. Customer selects payment method (UPI / Card / Wallet / Pay Later).
16. Order is submitted. Confirmation screen shows Order ID and estimated time.
17. Customer monitors live order status on their phone.
18. Waiter brings food. Status updates to **Served**.

### 4.2 Restaurant Admin Journey

```
[LOGIN] ──▶ [DASHBOARD HOME] ──▶ [MENU MANAGEMENT]
                                         │
                          ┌──────────────┼──────────────┐
                          │              │              │
                   [Add Category]  [Add Item]    [Set Pricing]
                                         │
                                  [Upload Image]
                                  [Upload Video for AR]
                                         │
                                  [Generate AR Model]
                                  (triggers pipeline)
                                         │
                                  [Preview 3D Model]
                                  [Adjust / Approve]
                                         │
                                  [Publish to Menu]
                                         │
                              [MONITOR LIVE ORDERS]
                              [VIEW ANALYTICS]
```

**Step-by-Step:**

1. Admin navigates to `admin.menuverse.app` and logs in with email/password (or Google SSO).
2. Dashboard home shows: today's orders, revenue, top dish, active tables.
3. Admin goes to **Menu → Categories**, creates categories (e.g. Starters, Mains).
4. Admin goes to **Menu → Items → Add Item**: enters name, description, price, dietary flags.
5. Admin uploads a dish photograph.
6. Admin navigates to **AR Studio** link (opens `studio.menuverse.app` in new tab, same session).
7. In AR Studio: Admin uploads a 10–30 second smartphone video of the dish.
8. Admin clicks **"Generate AR Model"**. Pipeline starts.
9. Admin monitors progress bar: Uploading → Validating → Extracting → Reconstructing → Optimising → Ready.
10. Admin previews the 3D model in an interactive viewer: rotates, inspects quality score (A/B/C).
11. If score is A or B, Admin clicks **"Publish"**. Model is linked to the menu item.
12. Admin goes to **Tables → Manage**, creates table entries, downloads QR codes as PDF.
13. Admin goes to **Pricing → Discounts**, sets a happy hour rule (e.g. 20% off Beverages 5–7 PM).
14. Admin reviews **Analytics** dashboard: revenue trends, AR engagement, popular dishes.

### 4.3 Kitchen Staff Journey

```
[KDS SCREEN LOADS] ──▶ [IDLE: NO ORDERS]
                              │
                    [NEW ORDER ARRIVES]
                    Audio alert + card appears
                              │
                    [REVIEW ORDER CARD]
                    Table number, items, modifiers
                              │
                    [TAP: ACCEPTING] ──▶ Status: Preparing
                              │
                    [FOOD IS READY]
                    [TAP: READY] ──▶ Status: Ready
                              │
                    [WAITER COLLECTS]
                    [TAP: SERVED] ──▶ Card archived
```

---

## 5. Feature List

### 5.1 Customer Features

| # | Feature | Description |
|---|---|---|
| C1 | QR Menu Access | Scan table QR → PWA opens without app install |
| C2 | Menu Browsing | Category tabs, search, dietary filters (Veg/Vegan/GF) |
| C3 | Dish Detail View | Image, description, nutrition info, tags, rating |
| C4 | AR Visualization | WebAR camera view — dish placed on table surface |
| C5 | AR Controls | Rotate, zoom, portion size toggle (S/M/L), reset |
| C6 | Ingredient Highlight | Tap ingredient region in AR to see label |
| C7 | Nutrition Overlay | Toggle calorie/protein/fat info in AR view |
| C8 | Social Mode | Capture AR photo, share via Web Share API |
| C9 | Add to Cart | Add dish with modifier selection |
| C10 | Cart Management | Edit quantities, remove items, add more rounds |
| C11 | Order Placement | Submit order with one tap after cart review |
| C12 | Payment | UPI, Card, Wallet, Pay Later (BNPL) |
| C13 | Order Status Tracking | Live status: Received → Preparing → Ready → Served |
| C14 | Waiter Call | Tap button to notify waiter |
| C15 | Digital Receipt | SMS/email receipt post-payment |

### 5.2 Admin Dashboard Features

| # | Feature | Description |
|---|---|---|
| A1 | Menu Category Management | Create, reorder, archive menu categories |
| A2 | Menu Item Management | Add/edit/archive items with images, prices, modifiers |
| A3 | Bulk Menu Import | CSV upload for mass item creation |
| A4 | AR Model Linking | Link published 3D models to menu items |
| A5 | Table Management | Create tables, assign sections, set capacity |
| A6 | QR Code Generation | Auto-generate and download QR codes (PNG/PDF) |
| A7 | Live Order Monitor | Real-time view: Table → Items → Status → Time |
| A8 | Order Override | Manually update order status |
| A9 | Pricing Rules | Base price, modifiers, surcharges |
| A10 | Discount Engine | Time-based, combo, seasonal discount rules |
| A11 | Restaurant Branding | Logo, colour scheme, custom menu header |
| A12 | Staff Accounts | Create sub-accounts with role-based access |
| A13 | Analytics Dashboard | Revenue, dish performance, AR engagement, table turnover |
| A14 | Report Export | CSV / PDF export of analytics data |
| A15 | Notification Settings | Configure alerts (email, push) for new orders |

### 5.3 AR Studio Features

| # | Feature | Description |
|---|---|---|
| S1 | Video Upload | Upload MP4/MOV video (up to 200 MB) |
| S2 | Upload Validation | Automated quality checks with feedback |
| S3 | Pipeline Monitoring | Live progress bar per processing stage |
| S4 | 3D Model Preview | Interactive GLB viewer with rotate/zoom |
| S5 | Quality Score Display | A/B/C grade with improvement notes |
| S6 | Model Adjustment | Scale, orientation, pivot correction |
| S7 | Publish to Menu | One-click publish to link model to item |
| S8 | Job History | List of all past and active processing jobs |
| S9 | Re-generate | Trigger reprocessing with different settings |

### 5.4 Kitchen Display System Features

| # | Feature | Description |
|---|---|---|
| K1 | Live Order Feed | Real-time stream of incoming orders |
| K2 | Order Cards | Table, items, modifiers, special instructions |
| K3 | Audio Alerts | Sound on new order arrival |
| K4 | Status Controls | Tap to update: Preparing → Ready → Served |
| K5 | Urgency Indicators | Colour-coded: Normal / Delayed / Overdue |
| K6 | Filter by Section | Kitchen can filter by food type or station |

---

## 6. AR Food Visualization System

### 6.1 Overview

The AR system allows customers to place a life-size, photorealistic 3D model of any dish on their physical table surface using their phone camera — without downloading an app. The experience runs entirely in the mobile browser via WebXR and progressive enhancement.

### 6.2 Supported AR Modes by Platform

| Platform | AR Mode | Technology |
|---|---|---|
| Android Chrome | Scene Viewer | Google ARCore |
| iOS Safari | Quick Look | Apple ARKit |
| Desktop / unsupported | 3D Interactive Viewer | Three.js fallback |

### 6.3 3D Model Formats

| Format | Used For | Notes |
|---|---|---|
| **GLB** | Android, Web, Desktop | Binary GLTF — compact, widely supported |
| **GLTF** | Internal processing | Text-based, used during pipeline stages |
| **USDZ** | iOS Safari Quick Look | Required by Apple AR framework |

### 6.4 Rendering Technologies

| Technology | Role |
|---|---|
| **`<model-viewer>`** | Primary web component for AR/3D display |
| **Three.js** | Custom AR scene rendering where model-viewer is insufficient |
| **WebXR Device API** | Table surface (plane) detection, camera access |
| **AR.js** | Lightweight AR fallback for older devices |
| **8thWall** | Premium option for advanced AR features (paid SDK) |

### 6.5 AR Implementation

The primary rendering component uses Google's `<model-viewer>` web component:

```html
<model-viewer
  src="https://cdn.menuverse.app/models/butter-chicken.glb"
  ios-src="https://cdn.menuverse.app/models/butter-chicken.usdz"
  ar
  ar-modes="webxr scene-viewer quick-look"
  ar-scale="fixed"
  camera-controls
  auto-rotate
  shadow-intensity="1"
  environment-image="neutral">
</model-viewer>
```

### 6.6 Customer Interaction Controls

| Control | Gesture / Action |
|---|---|
| Place on table | Tap detected surface |
| Rotate | Swipe left/right around the model |
| Zoom | Pinch in/out |
| Move position | Drag after placing |
| Portion size | Toggle button: Small / Medium / Large (adjusts model scale) |
| Ingredient highlight | Tap a labelled region on the model |
| Nutrition overlay | Toggle button — shows floating labels |
| Social mode | Tap camera icon → capture → Web Share API |
| Exit AR | Tap X or press back |

### 6.7 Surface Detection Flow

```
Camera activates
       │
WebXR plane detection begins
       │
Horizontal surface found (table)
       │
Ring / indicator shown on surface
       │
User taps surface
       │
GLB model placed at tap origin
       │
Model anchored to surface plane
       │
User can move / rotate / scale
```

### 6.8 Performance Targets for AR

| Metric | Target |
|---|---|
| Model file size | < 10 MB (GLB) |
| AR session load time | < 3 seconds on 4G |
| Frame rate | 30–60 FPS on mid-range devices |
| Supported polygon count | 20,000–80,000 polygons |
| Texture resolution | 2K (2048 × 2048 px) |

---

## 7. Video-to-3D Model Generation Pipeline

### 7.1 Overview

The AR Studio pipeline enables restaurants to generate photorealistic 3D food models from a short smartphone video — no 3D expertise required. The pipeline is fully automated and runs in Docker-based processing workers orchestrated by Kubernetes.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AR STUDIO PIPELINE                            │
│                                                                  │
│  [Video Upload] → [Validation] → [Frame Extraction]             │
│       → [Photogrammetry] → [Mesh Optimisation]                  │
│       → [Format Conversion] → [CDN Upload] → [Published]        │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Input Video Requirements

| Requirement | Specification |
|---|---|
| Minimum resolution | 1080p (1920 × 1080) |
| Duration | 10–30 seconds |
| Camera movement | Slow, steady circular motion around dish |
| Lighting | Bright, even — no hard shadows or flash |
| Background | Plain surface, white card, or restaurant table |
| Accepted formats | MP4, MOV |
| Maximum file size | 200 MB |

### 7.3 Stage 1 — Video Upload & Validation

The video is uploaded to AWS S3 via a pre-signed URL. Before any processing begins, the system runs automated quality checks:

| Check | Method | Failure Action |
|---|---|---|
| Format validation | MIME type + file header | Reject with error |
| Virus scan | ClamAV / AWS Macie | Reject and quarantine |
| Resolution check | FFprobe metadata | Reject if < 1080p |
| Duration check | FFprobe duration | Reject if < 8s or > 35s |
| Blur detection | OpenCV Laplacian variance | Warn if > 30% frames blurry |
| Lighting analysis | Histogram analysis | Warn if under/overexposed |
| Motion coverage | Optical flow estimation | Warn if < 120° coverage |

If hard checks fail, the job status is set to `failed` and the admin receives specific re-shoot guidance. Soft warnings are logged but processing continues.

### 7.4 Stage 2 — Frame Extraction

```
Tool: FFmpeg
Settings:
  - Extract 3–5 frames per second
  - Target: 80–150 total frames
  - Format: JPEG, quality 95
  - Stored in: /tmp/jobs/{job_id}/frames/

Command:
ffmpeg -i input.mp4 -vf fps=4 -q:v 2 frames/frame%04d.jpg
```

Frames are validated individually for blur (OpenCV Laplacian), and any frame below threshold is discarded from the photogrammetry input set.

### 7.5 Stage 3 — Photogrammetry Reconstruction

The clean frame set is passed to a photogrammetry engine running in a dedicated Docker container:

**Structure-from-Motion (SfM) Pipeline:**

```
Step 1: Feature Detection
  – SIFT / SuperPoint feature extraction across all frames
  – Match features between overlapping frame pairs

Step 2: Camera Position Estimation
  – COLMAP / Meshroom SfM solver
  – Estimates camera position and intrinsics for each frame

Step 3: Sparse Point Cloud
  – Initial 3D point cloud from matched feature positions

Step 4: Dense Point Cloud
  – Multi-View Stereo (MVS) densification
  – Produces dense, detailed 3D point cloud

Step 5: Mesh Generation
  – Poisson Surface Reconstruction from dense cloud
  – Produces a watertight triangle mesh

Step 6: Texture Baking
  – Projects original frame colours onto mesh UV coordinates
  – Output: OBJ + texture atlas PNG
```

**Recommended Engines:**

| Engine | Type | Notes |
|---|---|---|
| **Meshroom** | Open source | AliceVision framework, Docker-ready |
| **COLMAP** | Open source | SfM + MVS, scriptable |
| **RealityCapture** | Commercial | Faster, higher quality, per-scan licensing |
| **Luma AI API** | AI-enhanced | Neural Radiance Field (NeRF), fewer images needed |
| **NVIDIA Instant NeRF** | AI-enhanced | Real-time NeRF, highest quality, GPU-intensive |

### 7.6 Stage 4 — Mesh Cleaning & Optimisation

Raw photogrammetry meshes are typically 500,000–2,000,000 polygons with noisy background geometry. A Blender Python script running in a headless Docker container performs:

```
Operations (Blender Python API):

1. Background Removal
   – Segment dish from background using bounding box or mask
   – Delete all geometry outside dish volume

2. Mesh Decimation
   – Target polygon count: 20,000–80,000
   – Method: Quadric Error Metrics (QEM) decimation
   – bpy.ops.object.modifier_apply(modifier="Decimate")

3. Texture Compression
   – Downscale texture atlas to 2048 × 2048 px
   – Format: JPEG (high quality) or WebP

4. Pivot Alignment
   – Move object origin to bottom-centre of dish bounding box
   – Ensures model sits correctly on AR surface

5. Scale Normalisation
   – Scale model to approximate real-world dish size
   – Reference: dinner plate ≈ 28cm diameter

6. Smoothing
   – Apply limited surface smoothing to remove scan noise
```

**Tools:** Blender 3.x (headless, Python-scripted), MeshLab (optional pre-pass)

### 7.7 Stage 5 — Format Conversion & Export

```
Input:   Optimised OBJ + texture PNG
Outputs:
  ├── model.glb     (Android, Web) — via Blender GLTF exporter
  └── model.usdz    (iOS)          — via Apple Reality Converter CLI
                                      or Blender USDZ addon

Both files are uploaded to AWS S3:
  s3://ar-assets/{restaurant_id}/{item_id}/model.glb
  s3://ar-assets/{restaurant_id}/{item_id}/model.usdz

URLs are written to food_items.ar_model_url and food_items.ar_usdz_url.
```

### 7.8 Pipeline Architecture

```
Admin uploads video (200 MB max)
          │
    API Gateway
          │
    AR Service (Node.js)
    – Creates ar_processing_job record (status: uploading)
    – Generates pre-signed S3 URL
    – Client uploads directly to S3
    – Webhook fires on upload complete
          │
    Job Queue (Redis + BullMQ)
    – Job pushed to 'ar-pipeline' queue
          │
    ┌─────┴────────────────────────┐
    │                              │
Frame Extraction Worker    (Docker / Python / FFmpeg)
    │
Photogrammetry Worker      (Docker / Python / Meshroom)
    │
Optimisation Worker        (Docker / Python / Blender)
    │
Format Conversion Worker   (Docker / Python / Blender + Reality Converter)
    │
CDN Upload Worker          (Docker / Node.js / AWS SDK)
          │
    Job status → 'completed'
    food_items record updated with model URLs
    Admin notified via email + dashboard
```

### 7.9 Quality Scoring System

Every model is automatically scored before the admin can publish to the live menu:

| Grade | Polygon Count | Texture Sharpness | Artifact Level | Admin Action |
|---|---|---|---|---|
| **A — Excellent** | 20k–80k | Sharp (SSIM > 0.85) | None | Auto-approved |
| **B — Good** | 80k–120k or < 20k | Acceptable | Minor | Review recommended |
| **C — Needs Improvement** | > 120k or < 5k | Blurry | Significant | Re-shoot prompted |

---

## 8. QR Code Table System

### 8.1 Table Structure

Each table in a restaurant is represented as a record in the database. A unique QR code is generated per table and encodes a URL that identifies the restaurant, branch, and table:

```
URL format:
https://menuverse.app/r/{restaurant_id}/t/{table_id}

Example:
https://menuverse.app/r/saffron-mumbai/t/12
```

### 8.2 QR Code Generation

QR codes are generated server-side using the `qrcode` library (Node.js) and stored as SVG / PNG in S3. The Admin Dashboard provides:

- Individual table QR download (PNG, 300 DPI print-ready)
- Bulk download as a ZIP of all table QRs
- Combined PDF with all QR codes on a single printable sheet
- QR codes embedded with restaurant logo (optional)

### 8.3 Dynamic vs. Static QR Codes

All QR codes in the system are **dynamic** in the sense that the destination URL is stable, but the content served at that URL (menu, prices, availability) is always fetched live from the API. This means:

- Menu updates are instantly live without reprinting QR codes.
- QR codes never need to change unless the restaurant is re-configured.
- Table numbers can be reassigned by updating the database record (QR URL remains the same).

### 8.4 Session Handling

When a customer scans a QR code:

1. The browser opens the PWA with `?restaurant_id=X&table_id=Y` in the URL.
2. The PWA reads these parameters and fetches the menu from the API.
3. A session token is created client-side (localStorage) to persist the cart across page refreshes.
4. The table ID is attached to every order submitted from that session.
5. Sessions expire after 4 hours of inactivity or when the table status changes to `Available`.

### 8.5 Table Status States

| Status | Description |
|---|---|
| `available` | No active session — table is empty |
| `occupied` | Active customer session, browsing or ordering |
| `awaiting_payment` | Order placed, payment pending |
| `closed` | Bill settled — admin resets to available |

---

## 9. Ordering System

### 9.1 Cart

The cart is managed entirely client-side in the customer PWA (React state + localStorage). Cart contents include:

- Item ID, name, quantity, unit price
- Modifier selections (spice level, add-ons, removed ingredients)
- Special instructions (free text, optional)
- Calculated line total and cart subtotal

The cart persists across page refreshes via localStorage and is cleared on successful order submission.

### 9.2 Order Submission

When the customer taps **Place Order**, the PWA sends a `POST /api/orders` request with the full cart payload:

```json
{
  "restaurant_id": "saffron-mumbai",
  "table_id": "12",
  "session_token": "abc123",
  "items": [
    {
      "item_id": "butter-chicken-001",
      "quantity": 1,
      "modifiers": { "spice": "medium", "extra_butter": true },
      "unit_price": 350
    },
    {
      "item_id": "garlic-naan-003",
      "quantity": 2,
      "modifiers": {},
      "unit_price": 60
    }
  ],
  "special_instructions": "No onions in the naan",
  "payment_method": "upi"
}
```

### 9.3 Order ID Generation

Order IDs are generated server-side using a combination of:
- Restaurant prefix (e.g. `SF`)
- Date (YYYYMMDD)
- Random 4-digit suffix

Example: `SF-20260108-4821`

IDs are unique per restaurant per day and human-readable for kitchen communication.

### 9.4 Order State Machine

```
[PENDING]
    │
    ▼ (Kitchen accepts or auto-accepts)
[ACCEPTED]
    │
    ▼ (Kitchen taps Preparing)
[PREPARING]
    │
    ▼ (Kitchen taps Ready)
[READY]
    │
    ▼ (Waiter delivers, taps Served)
[SERVED]
    │
    ▼ (Payment confirmed)
[COMPLETED]

Side transitions:
[PENDING] ──▶ [CANCELLED]   (customer or admin cancels before accepted)
[ACCEPTED] ──▶ [CANCELLED]  (admin cancels with reason)
```

### 9.5 Real-Time Status Updates

Order status changes are pushed to the customer PWA via **Server-Sent Events (SSE)** or **WebSocket**. The customer sees a live status tracker on their phone that updates without page refresh.

The KDS receives new orders via WebSocket — the kitchen screen updates immediately when a new order is submitted without any manual refresh.

### 9.6 Payment Flow

```
Customer selects payment method
          │
POST /api/payments/initiate
          │
Payment gateway session created
(Razorpay / Stripe / PhonePe)
          │
Customer completes payment in gateway UI
          │
Gateway sends webhook → POST /api/payments/webhook
          │
Order status → ACCEPTED
Receipt sent via SMS / email
```

Supported payment methods: UPI, Credit Card, Debit Card, Digital Wallets, Pay Later (BNPL via Simpl / LazyPay).

---

## 10. Pricing & Billing

### 10.1 Restaurant Subscription Plans

| Plan | Monthly Price | Key Features |
|---|---|---|
| **Starter** | ₹1,999 | QR menu, digital ordering, basic dashboard, up to 5 tables |
| **Pro** | ₹4,999 | Everything in Starter + AR visualization + Video-to-AR (50 dishes) + analytics + KDS + unlimited tables |
| **Enterprise** | Custom | Unlimited AR models, POS integration, custom branding, SLA, dedicated support, white-label option |

### 10.2 Add-On Pricing

| Add-On | Price |
|---|---|
| Additional AR model generation (beyond plan limit) | ₹99 per model |
| Extra branch (beyond plan allowance) | ₹999/month per branch |
| White-label domain (custom domain) | ₹500/month |

### 10.3 Billing Logic

- Subscriptions are billed monthly in advance via Stripe / Razorpay recurring.
- Plans auto-renew unless cancelled before the billing cycle end date.
- Downgrade takes effect at end of current billing cycle.
- Upgrade takes effect immediately with prorated charge.
- AR processing jobs are metered and billed in arrears if the plan limit is exceeded.

### 10.4 Free Trial

All new restaurants receive a **14-day free trial on the Pro plan** — no credit card required. At end of trial, they must select a paid plan or the account is suspended (data retained for 30 days).

---

## 11. Technical Architecture

### 11.1 Platform Surfaces & Deployment

| Surface | Framework | Deployment | URL Pattern |
|---|---|---|---|
| Customer PWA | React + Next.js | Vercel / CloudFront | `menuverse.app/r/{id}/t/{id}` |
| Admin Dashboard | React + Ant Design | Vercel / CloudFront | `admin.menuverse.app` |
| AR Studio | React + Three.js | Vercel / CloudFront | `studio.menuverse.app` |
| KDS | React (kiosk) | Vercel / CloudFront | `kds.menuverse.app/r/{id}` |

### 11.2 Backend Services

```
┌──────────────────────────────────────────────────────────────┐
│                      BACKEND MICROSERVICES                    │
├────────────────────┬─────────────────────────────────────────┤
│ Service            │ Responsibilities                        │
├────────────────────┼─────────────────────────────────────────┤
│ Auth Service       │ JWT issuance, refresh, RBAC, Google SSO │
│ Restaurant Service │ Tenant management, branding, settings   │
│ Menu Service       │ Categories, items, modifiers, search    │
│ Table Service      │ Table CRUD, QR generation, session mgmt │
│ Order Service      │ Order lifecycle, state machine, SSE/WS  │
│ Payment Service    │ Gateway integration, webhooks, receipts │
│ Notification Svc   │ Push, SMS (Twilio), email (SendGrid)    │
│ AR Asset Service   │ Model storage, CDN URLs, format routing │
│ AR Pipeline Service│ Job orchestration, worker management    │
│ Analytics Service  │ Event ingestion, aggregation, reports   │
└────────────────────┴─────────────────────────────────────────┘
```

**Primary language:** Node.js (NestJS) for all services  
**Alternative:** Python (FastAPI) for AR Pipeline and Analytics services where ML libraries are needed

### 11.3 AR Processing Workers

```
┌──────────────────────────────────────────────────────────────┐
│                      WORKER FLEET                            │
├───────────────────────┬──────────────────────────────────────┤
│ Worker                │ Runtime                              │
├───────────────────────┼──────────────────────────────────────┤
│ Frame Extraction      │ Python + FFmpeg + OpenCV (Docker)    │
│ Photogrammetry        │ Python + Meshroom / COLMAP (Docker)  │
│ Mesh Optimisation     │ Python + Blender headless (Docker)   │
│ Format Conversion     │ Python + Blender + Reality Converter │
│ CDN Upload            │ Node.js + AWS SDK (Docker)           │
└───────────────────────┴──────────────────────────────────────┘

Queue: Redis + BullMQ
Orchestration: Kubernetes Jobs (GPU nodes for photogrammetry)
Scaling: Horizontal — worker pods scale with queue depth
```

### 11.4 Infrastructure Stack

| Component | Technology | Purpose |
|---|---|---|
| Cloud | AWS (primary) | All infrastructure |
| Container Runtime | Docker | All services and workers |
| Orchestration | Kubernetes (EKS) | Service and worker management |
| API Gateway | AWS API Gateway / Kong | Rate limiting, auth, routing |
| Load Balancer | AWS ALB | Frontend and API traffic |
| CDN | AWS CloudFront | AR models, images, static assets |
| Object Storage | AWS S3 | Videos, models, images, exports |
| Database | PostgreSQL (AWS RDS) | Primary relational data |
| Cache | Redis (AWS ElastiCache) | Session cache, BullMQ queues |
| Search | PostgreSQL full-text (or Algolia) | Menu item search |
| Realtime | WebSocket (AWS API Gateway WS) | KDS, order status |
| Monitoring | Datadog / Prometheus + Grafana | Metrics, alerting |
| Logging | AWS CloudWatch + ELK | Centralised log management |
| CI/CD | GitHub Actions | Build, test, deploy pipeline |
| Secrets | AWS Secrets Manager | API keys, DB credentials |

---

## 12. Database Design

### 12.1 Schema Overview

```sql
-- RESTAURANTS (tenant root)
CREATE TABLE restaurants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,   -- used in QR URLs
  location        TEXT,
  owner_id        UUID REFERENCES users(id),
  plan_tier       VARCHAR(50) DEFAULT 'starter',  -- starter | pro | enterprise
  plan_expires_at TIMESTAMP,
  branding_json   JSONB,                          -- logo_url, primary_color, etc.
  settings_json   JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- USERS (all actor types)
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT,
  role            VARCHAR(50) NOT NULL,  -- owner | manager | staff | super_admin
  name            VARCHAR(255),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- BRANCHES (for multi-location restaurants)
CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id),
  name            VARCHAR(255),
  address         TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- TABLES
CREATE TABLE tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id),
  branch_id       UUID REFERENCES branches(id),
  table_number    VARCHAR(20) NOT NULL,
  section         VARCHAR(100),
  capacity        INTEGER,
  qr_code_url     TEXT,                           -- S3 URL of QR image
  status          VARCHAR(50) DEFAULT 'available', -- available|occupied|awaiting_payment|closed
  created_at      TIMESTAMP DEFAULT NOW()
);

-- MENU CATEGORIES
CREATE TABLE menu_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id),
  name            VARCHAR(255) NOT NULL,
  display_order   INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- MENU ITEMS
CREATE TABLE menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID REFERENCES menu_categories(id),
  restaurant_id   UUID REFERENCES restaurants(id),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  price           NUMERIC(10,2) NOT NULL,
  image_url       TEXT,
  ar_model_url    TEXT,                           -- GLB (Android/Web)
  ar_usdz_url     TEXT,                           -- USDZ (iOS)
  ar_quality_score VARCHAR(1),                    -- A | B | C
  veg_type        VARCHAR(20),                    -- veg | non-veg | vegan
  is_available    BOOLEAN DEFAULT TRUE,
  nutrition_json  JSONB,                          -- {calories, protein, fat, carbs}
  tags_json       JSONB,                          -- ['popular','spicy','new']
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ITEM MODIFIERS
CREATE TABLE item_modifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID REFERENCES menu_items(id),
  name            VARCHAR(255),                   -- 'Spice Level', 'Add-ons'
  options_json    JSONB,                          -- [{label:'Mild',price_delta:0}]
  is_required     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ORDERS
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref       VARCHAR(50) UNIQUE NOT NULL,    -- SF-20260108-4821
  restaurant_id   UUID REFERENCES restaurants(id),
  table_id        UUID REFERENCES tables(id),
  session_token   VARCHAR(255),
  status          VARCHAR(50) DEFAULT 'pending',  -- pending|accepted|preparing|ready|served|completed|cancelled
  subtotal        NUMERIC(10,2),
  tax_amount      NUMERIC(10,2),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total_amount    NUMERIC(10,2),
  payment_status  VARCHAR(50) DEFAULT 'unpaid',   -- unpaid|paid|refunded
  payment_method  VARCHAR(50),
  special_instructions TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ORDER ITEMS
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES orders(id),
  menu_item_id    UUID REFERENCES menu_items(id),
  name_snapshot   VARCHAR(255),                   -- name at time of order
  quantity        INTEGER NOT NULL,
  unit_price      NUMERIC(10,2) NOT NULL,
  modifier_json   JSONB,                          -- selected modifiers
  item_status     VARCHAR(50) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES orders(id),
  gateway         VARCHAR(50),                    -- razorpay | stripe | phonepe
  gateway_txn_id  VARCHAR(255) UNIQUE,
  amount          NUMERIC(10,2),
  currency        VARCHAR(10) DEFAULT 'INR',
  status          VARCHAR(50),                    -- initiated|success|failed|refunded
  webhook_payload JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- DISCOUNTS
CREATE TABLE discounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id),
  name            VARCHAR(255),
  type            VARCHAR(50),                    -- percentage | flat | combo
  value           NUMERIC(10,2),
  condition_json  JSONB,                          -- {category:'beverages', time_start:'17:00'}
  valid_from      TIMESTAMP,
  valid_to        TIMESTAMP,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- AR PROCESSING JOBS
CREATE TABLE ar_processing_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_item_id    UUID REFERENCES menu_items(id),
  restaurant_id   UUID REFERENCES restaurants(id),
  video_url       TEXT NOT NULL,
  status          VARCHAR(50) DEFAULT 'uploading',
  -- uploading|validating|extracting|reconstructing|optimising|converting|uploading_model|completed|failed
  progress        INTEGER DEFAULT 0,              -- 0–100
  quality_score   VARCHAR(1),
  model_url       TEXT,
  usdz_url        TEXT,
  error_log       TEXT,
  processing_meta JSONB,                          -- polygon_count, texture_res, etc.
  created_at      TIMESTAMP DEFAULT NOW(),
  completed_at    TIMESTAMP
);
```

---

## 13. API Reference

### 13.1 Authentication

All admin and staff endpoints require a Bearer JWT token in the `Authorization` header. Customer endpoints are public (identified by `restaurant_id` + `table_id`).

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 13.2 Menu Endpoints

#### GET /api/menu

Fetch full menu for a restaurant (customer-facing, public).

**Request:**
```
GET /api/menu?restaurant_id=saffron-mumbai&table_id=12
```

**Response:**
```json
{
  "restaurant": {
    "name": "Saffron",
    "logo_url": "https://cdn.menuverse.app/logos/saffron.png",
    "primary_color": "#D2A85A"
  },
  "categories": [
    {
      "id": "cat-001",
      "name": "Starters",
      "items": [
        {
          "id": "item-001",
          "name": "Paneer Tikka",
          "description": "Smoky paneer cubes marinated in yoghurt",
          "price": 280,
          "image_url": "https://cdn.menuverse.app/images/paneer-tikka.jpg",
          "ar_model_url": "https://cdn.menuverse.app/models/paneer-tikka.glb",
          "ar_usdz_url": "https://cdn.menuverse.app/models/paneer-tikka.usdz",
          "veg_type": "veg",
          "is_available": true,
          "tags": ["popular", "vegan"],
          "nutrition": { "calories": 310, "protein": "22g", "fat": "18g", "carbs": "12g" }
        }
      ]
    }
  ]
}
```

---

#### POST /api/orders

Submit a new order from a customer session.

**Request:**
```json
{
  "restaurant_id": "saffron-mumbai",
  "table_id": "12",
  "session_token": "sess_abc123",
  "items": [
    { "item_id": "item-001", "quantity": 1, "modifiers": { "spice": "medium" }, "unit_price": 280 },
    { "item_id": "item-007", "quantity": 2, "modifiers": {}, "unit_price": 60 }
  ],
  "special_instructions": "No onions please",
  "payment_method": "upi"
}
```

**Response:**
```json
{
  "order_id": "ord-uuid-001",
  "order_ref": "SF-20260108-4821",
  "status": "pending",
  "total_amount": 460,
  "payment_url": "https://rzp.io/checkout/pay-abc",
  "estimated_time_minutes": 20
}
```

---

#### GET /api/orders/:order_id

Fetch current status of an order.

**Response:**
```json
{
  "order_id": "ord-uuid-001",
  "order_ref": "SF-20260108-4821",
  "status": "preparing",
  "items": [
    { "name": "Paneer Tikka", "quantity": 1, "item_status": "preparing" },
    { "name": "Garlic Naan", "quantity": 2, "item_status": "pending" }
  ],
  "total_amount": 460,
  "estimated_ready_at": "2026-01-08T19:42:00Z"
}
```

---

#### PATCH /api/orders/:order_id/status

Update order status (staff only, requires auth).

**Request:**
```json
{ "status": "preparing" }
```

**Response:**
```json
{ "order_id": "ord-uuid-001", "status": "preparing", "updated_at": "2026-01-08T19:30:00Z" }
```

---

#### POST /api/ar/upload

Initiate a video upload and create an AR processing job.

**Request (multipart or JSON with pre-signed URL flow):**
```json
{
  "food_item_id": "item-001",
  "filename": "butter-chicken.mp4",
  "file_size_bytes": 85000000,
  "mime_type": "video/mp4"
}
```

**Response:**
```json
{
  "job_id": "job-uuid-001",
  "upload_url": "https://s3.amazonaws.com/ar-uploads/...?X-Amz-Signature=...",
  "upload_expires_at": "2026-01-08T20:00:00Z"
}
```

---

#### GET /api/ar/jobs/:job_id

Poll processing job status.

**Response:**
```json
{
  "job_id": "job-uuid-001",
  "status": "reconstructing",
  "progress": 62,
  "stage": "Photogrammetry Reconstruction",
  "quality_score": null,
  "model_url": null,
  "error": null
}
```

---

#### POST /api/ar/jobs/:job_id/publish

Publish a completed model to the live menu.

**Request:**
```json
{ "confirmed": true }
```

**Response:**
```json
{
  "job_id": "job-uuid-001",
  "food_item_id": "item-001",
  "ar_model_url": "https://cdn.menuverse.app/models/item-001.glb",
  "ar_usdz_url": "https://cdn.menuverse.app/models/item-001.usdz",
  "published_at": "2026-01-08T20:15:00Z"
}
```

---

#### GET /api/analytics/summary

Fetch analytics summary for admin dashboard.

**Request:**
```
GET /api/analytics/summary?restaurant_id=saffron-mumbai&period=7d
Authorization: Bearer ...
```

**Response:**
```json
{
  "period": "7d",
  "total_revenue": 284500,
  "total_orders": 812,
  "average_order_value": 350,
  "top_dishes": [
    { "name": "Butter Chicken", "orders": 204, "revenue": 71400 },
    { "name": "Chicken Biryani", "orders": 178, "revenue": 67640 }
  ],
  "ar_engagement": {
    "total_ar_views": 1240,
    "ar_to_order_rate": 0.68
  },
  "table_turnover_avg_minutes": 48
}
```

---

## 14. Performance Requirements

| Metric | Target | Notes |
|---|---|---|
| Menu PWA initial load | < 2 seconds | On 4G, Lighthouse score > 90 |
| Menu API response | < 200ms (p95) | Served from Redis cache |
| AR model load time | < 3 seconds | GLB < 10 MB via CloudFront CDN |
| AR frame rate | 30–60 FPS | Target mid-range Android devices (2021+) |
| Order submission latency | < 500ms | End-to-end, p95 |
| KDS order propagation | < 1 second | From order submit to KDS display |
| AR model generation | < 10 minutes | End-to-end pipeline |
| Analytics dashboard load | < 3 seconds | Pre-aggregated daily snapshots |
| Concurrent users / restaurant | 1,000+ | Tested with k6 load simulation |
| Platform-wide concurrent users | 100,000+ | Horizontal scaling via Kubernetes |
| System uptime | ≥ 99.9% | ≤ 8.7 hours downtime/year |

---

## 15. Security Requirements

### 15.1 Authentication & Authorisation

| Requirement | Implementation |
|---|---|
| Admin/staff login | Email/password with bcrypt hashing (min 12 rounds) |
| SSO | Google OAuth 2.0 |
| Session tokens | JWT (HS256), 1-hour expiry, refresh token rotation |
| Role-based access | `owner`, `manager`, `staff`, `super_admin` — enforced at API level |
| Customer access | No authentication — identified by `restaurant_id` + `table_id` from QR |

### 15.2 Data Isolation

- All database queries are scoped by `restaurant_id` — enforced at the service layer.
- Middleware validates that the JWT subject's `restaurant_id` matches the requested resource.
- AR assets are stored in S3 under `/restaurant_id/` prefix — IAM policies prevent cross-tenant access.

### 15.3 Transport Security

- HTTPS enforced on all surfaces via TLS 1.3.
- HSTS headers set on all responses.
- API Gateway enforces SSL termination — no plain HTTP requests forwarded to backend.

### 15.4 File Upload Security

| Control | Detail |
|---|---|
| MIME type validation | Server-side — Content-Type header + file magic bytes checked |
| File size enforcement | Hard limit: 200 MB for video, 10 MB for images |
| Virus scanning | ClamAV on every uploaded file before processing begins |
| S3 bucket policy | Upload-only pre-signed URLs expire in 15 minutes |
| No public bucket listing | S3 bucket is private — all assets served via CloudFront signed URLs |

### 15.5 Payment Security

- PCI-DSS compliance via gateway tokenisation (Razorpay / Stripe) — no raw card data stored.
- Webhook signature verification on all payment callbacks.
- Idempotency keys on all payment initiation requests.

### 15.6 Rate Limiting

| Endpoint | Limit |
|---|---|
| GET /api/menu | 100 requests/minute per IP |
| POST /api/orders | 10 requests/minute per session |
| POST /api/ar/upload | 10 uploads/day per restaurant |
| POST /api/auth/login | 5 attempts/minute per IP, then 15-min lockout |
| All admin APIs | 300 requests/minute per authenticated user |

### 15.7 Additional Controls

- SQL injection prevention via parameterised queries (no raw SQL concatenation).
- XSS prevention via React's default escaping + Content Security Policy headers.
- CORS restricted to known frontend domains.
- Secrets managed via AWS Secrets Manager — never in environment variables or code.

---

## 16. Scalability Considerations

### 16.1 Multi-Tenancy

- Every data entity is keyed by `restaurant_id` — the system is a true multi-tenant architecture with shared infrastructure and logical data isolation.
- Tenant onboarding is fully self-service: restaurant registration, plan selection, and initial menu setup can be completed in < 15 minutes.
- High-volume restaurants (e.g. chains with 50+ branches) can be flagged for dedicated database schemas if query isolation is needed.

### 16.2 Horizontal Scaling

```
Customer Traffic
      │
CloudFront CDN (static assets, model files)
      │
AWS ALB (load balanced)
      │
Kubernetes Deployment (Menu, Order, Auth services)
Node count: 3 (min) → auto-scale to 20+ at peak
      │
PostgreSQL RDS (read replicas for analytics queries)
      │
Redis ElastiCache (cluster mode for queue and cache)
```

### 16.3 AR Asset Delivery

- All AR models (GLB, USDZ) are stored in S3 and served through CloudFront with global edge caching.
- Models are immutable once published — cache TTL is set to 1 year.
- Model files are gzip-compressed and served with correct MIME types for browser handling.
- CloudFront regional caches ensure models load in < 3 seconds globally.

### 16.4 AR Processing Scalability

- The photogrammetry worker pool scales horizontally based on BullMQ queue depth.
- Each worker is a Kubernetes Job, spawned on demand and terminated on completion.
- GPU-enabled node pools (AWS `g4dn` instances) are used for photogrammetry — provisioned on demand via Kubernetes Cluster Autoscaler.
- At 10 uploads/day per restaurant × 1,000 restaurants = 10,000 jobs/day maximum — well within queue capacity.

### 16.5 Database Scalability

- PostgreSQL RDS with Multi-AZ deployment for high availability.
- Read replicas for analytics queries and reporting — offloads OLAP traffic from OLTP primary.
- Connection pooling via PgBouncer (pre-deployed as a sidecar).
- Table partitioning on `orders` by `created_at` month for query performance at scale.

---

## 17. Analytics & Reporting

### 17.1 Restaurant Admin Analytics

All analytics are presented in the Admin Dashboard with date range filtering (Today / 7D / 30D / Custom).

**Revenue Module:**
- Total revenue (gross, net of discounts)
- Average order value trend
- Revenue by category and by dish
- Revenue by time of day (heat map)

**Menu Performance Module:**
- Top 10 dishes by orders and revenue
- Dish view-to-order conversion rate
- Items with zero orders in the last 30 days (low-performers)
- AR interaction rate per dish (views of AR vs. item views)

**AR Engagement Module:**
- Total AR preview sessions
- AR-to-order conversion rate (did the customer order after viewing AR?)
- Top dishes viewed in AR
- Social Mode photo captures

**Operations Module:**
- Average table turnover time
- Orders per table per day
- Peak service hours (order volume heat map)
- Average order fulfilment time (placed → served)

**Customer Module (if accounts enabled):**
- Repeat visit rate
- Cart abandonment rate
- Average sessions per table per day

### 17.2 Platform Super Admin Analytics

- Total GMV across all restaurants
- MRR / ARR by plan tier
- Active restaurants (ordered at least once in last 30 days)
- AR processing jobs completed / failed (pipeline health)
- Churn rate by plan tier

### 17.3 Event Tracking

All key customer interactions are tracked as server-side events:

```
menu_viewed        { restaurant_id, table_id, timestamp }
item_tapped        { restaurant_id, item_id, timestamp }
ar_session_started { restaurant_id, item_id, device_type, timestamp }
ar_photo_taken     { restaurant_id, item_id, timestamp }
item_added_to_cart { restaurant_id, item_id, quantity, timestamp }
order_submitted    { restaurant_id, order_id, total, item_count, timestamp }
order_paid         { restaurant_id, order_id, payment_method, timestamp }
```

Events are ingested into a time-series store (Timescale DB or ClickHouse) for fast aggregation queries.

---

## 18. Future Roadmap

| Feature | Phase | Description |
|---|---|---|
| **AI NeRF Model Generation** | Phase 3 | Replace photogrammetry with NVIDIA Instant NeRF for higher-fidelity models from fewer images |
| **Steam & Shader Effects** | Phase 3 | Animated steam particles for hot dishes (soups, chai, biryani) |
| **Interactive AR Ingredients** | Phase 3 | Tap a region of the AR model to reveal ingredient name, allergen, or calorie info |
| **Multi-Dish AR Table View** | Phase 3 | Place multiple dishes simultaneously on the table to compare portion sizes |
| **AI Dish Recommendations** | Phase 3 | ML model recommending dishes based on past orders and table behaviour |
| **Voice Ordering** | Phase 4 | Multilingual voice-to-order using Whisper / Google Speech-to-Text |
| **Loyalty Programme** | Phase 4 | Points-based rewards linked to customer phone number |
| **POS Integration** | Phase 4 | Sync orders with Square, Toast, Petpooja, UrbanPiper |
| **Inventory Integration** | Phase 4 | Auto-mark items unavailable when stock runs out |
| **AR Menu Social Wall** | Phase 4 | In-restaurant digital display showing customer AR photos in real time |
| **White-Label Platform** | Phase 4 | Full white-label version for enterprise restaurant chains |
| **Nutrition AR Overlay** | Phase 3 | Real-time calorie/macro display overlaid on AR model |
| **Customer Accounts** | Phase 3 | Optional sign-in for order history, preferences, loyalty |

---

## 19. MVP Scope

The MVP targets launch within **8–12 weeks** with a lean team of 2–3 engineers and 1 designer. The goal is to validate core customer and restaurant value before building the full pipeline.

### 19.1 In Scope for MVP

| Module | MVP Features |
|---|---|
| **Customer PWA** | QR scan, menu browsing, category filter, dish detail, add to cart, place order, order status |
| **AR Visualization** | `<model-viewer>` integration for pre-uploaded GLB models (manual upload, no auto-generation) |
| **Ordering** | Full order lifecycle: Pending → Preparing → Ready → Served |
| **Payment** | UPI + Card via Razorpay |
| **Admin Dashboard** | Menu management (categories + items), table creation, QR download, live order monitor |
| **KDS** | Real-time order feed, status controls, audio alerts |
| **Auth** | Email/password login for admin and staff |

### 19.2 Out of Scope for MVP (Phase 2+)

- Video-to-AR model generation pipeline (AR Studio)
- Advanced analytics and reporting
- Discount and promotion engine
- Multi-branch management
- POS / inventory integration
- Customer accounts and loyalty
- AI recommendations
- Voice ordering

### 19.3 MVP Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Next.js (all four surfaces as a monorepo) |
| Backend | Node.js + NestJS (monolithic to start, split later) |
| Database | PostgreSQL (single instance, AWS RDS) |
| Cache | Redis (single instance) |
| Storage | AWS S3 + CloudFront |
| Payments | Razorpay |
| Notifications | Twilio (SMS) + SendGrid (email) |
| Deployment | Docker Compose → migrate to Kubernetes in Phase 2 |
| Realtime | Socket.io (WebSocket for KDS and order status) |

### 19.4 MVP Team

| Role | Count |
|---|---|
| Full-stack Engineer (frontend + backend) | 2 |
| Backend / Infra Engineer | 1 |
| Product Designer (UI/UX) | 1 |
| Product Manager | 1 (founder or PM) |

---

## 20. Risks & Challenges

### 20.1 Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **WebAR browser fragmentation** | High | Test on top 10 devices; provide 3D viewer fallback for unsupported browsers |
| **AR model load time on slow networks** | High | Enforce < 10 MB model size; serve via global CDN; show loading skeleton |
| **Photogrammetry failure on poor videos** | High | Strict upload validation; detailed re-shoot guidance; offer manual GLB upload as fallback |
| **GPU worker cost at scale** | Medium | Spot instances for GPU nodes; rate-limit uploads per plan; batch overnight processing |
| **3D model background artifacts** | Medium | Improve segmentation prompt in optimisation worker; allow admin manual cleanup trigger |
| **iOS AR Quick Look inconsistencies** | Medium | Test USDZ against all recent iOS versions; maintain separate USDZ validation step |

### 20.2 Product & Business Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Restaurant adoption friction** | High | 14-day free trial, white-glove onboarding for first 50 restaurants, video tutorials |
| **AR engagement lower than expected** | Medium | A/B test AR button placement and copy; track AR-to-order conversion closely |
| **Customer unfamiliarity with WebAR** | Medium | Onboarding tooltip on first AR tap; short in-app demo video |
| **Competition from established POS players** | Medium | Focus on AR as the differentiator; deep integrations with existing POS systems in Phase 4 |
| **Churn if AR model quality is poor** | High | Enforce quality score gating (min grade B to publish); offer manual review service for Enterprise |

### 20.3 Compliance & Legal Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Payment data compliance (PCI-DSS)** | High | Never store raw card data; gateway tokenisation only; annual PCI audit |
| **GDPR / data privacy (if expanding to EU)** | Medium | Data residency controls; data deletion API; privacy policy and consent flows |
| **Food allergen misinformation** | Medium | Disclaimer on all nutritional/allergen data; restaurants own accuracy; terms of service |

---

*Document Version: 1.0 · Classification: Internal / Investor-Ready · Menuverse · 2026*
