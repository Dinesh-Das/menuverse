import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// ── DEPRECATION NOTICE ───────────────────────────────────────────────────
// This Express server is being phased out in favor of Supabase-native architecture.
// The frontend now communicates directly with Supabase + Edge Functions.
// Keeping this file for reference logic (state machine, auth flow).
// ──────────────────────────────────────────────────────────────────────────

// ── Startup env validation ───────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[Zaika Zindagi] FATAL: JWT_SECRET env var is not set. Refusing to start.');
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error('[Zaika Zindagi] FATAL: JWT_SECRET must be at least 32 characters for production security.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
  console.warn('[Zaika Zindagi] WARNING: Running with weak JWT_SECRET in development mode.');
}

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
const arUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── CORS — whitelist from env, with a safe dev default ──────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map(o => o.trim());

const corsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, etc.) in dev
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

// ── Socket.io setup ──────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});

io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  socket.on('join:order', (orderId) => {
    socket.join(`order:${orderId}`);
    console.log(`[Socket] ${socket.id} joined room order:${orderId}`);
  });

  socket.on('join:restaurant', (restaurantId) => {
    socket.join(`restaurant:${restaurantId}`);
    console.log(`[Socket] ${socket.id} joined room restaurant:${restaurantId}`);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// ── Auth Middleware ──────────────────────────────────────────────────────────
const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    if (!supabaseAdmin) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

      const profile = await prisma.user.findFirst({
        where: {
          OR: [
            { id: data.user.id },
            ...(data.user.email ? [{ email: data.user.email }] : []),
          ],
        },
      });
      if (!profile) return res.status(403).json({ error: 'User profile is not linked to a restaurant.' });

      req.user = {
        userId: profile.id,
        restaurantId: profile.restaurant_id,
        role: profile.role,
        email: profile.email,
      };
      return next();
    } catch (err) {
      console.error('[Auth] Supabase token verification failed:', err);
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
  }
  next();
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const genOrderId = () => {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `SF-${dateStr}-${rand}`;
};

// Valid order state transitions — matches client-side map exactly
const VALID_TRANSITIONS = {
  pending: ['accepted', 'preparing', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served'],
  served: ['completed'],
  completed: [],
  cancelled: [],
};

const GLB_MIME_TYPES = new Set(['model/gltf-binary']);
const USDZ_MIME_TYPES = new Set(['model/vnd.usdz+zip', 'model/vnd.pixar.usd', 'application/zip', 'application/x-zip-compressed']);
const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BINARY_MIME_FALLBACKS = new Set(['application/octet-stream', '']);

function requireStorageClient() {
  if (!supabaseAdmin) {
    throw new Error('Supabase service role storage client is not configured.');
  }
  return supabaseAdmin;
}

function getFileExtension(file) {
  return file.originalname.split('.').pop()?.toLowerCase() || '';
}

function hasBytes(buffer, bytes, offset = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function isGlb(file) {
  return file.buffer.length >= 12
    && hasBytes(file.buffer, [0x67, 0x6c, 0x54, 0x46])
    && file.buffer.readUInt32LE(4) === 2;
}

function isZipArchive(file) {
  return (
    hasBytes(file.buffer, [0x50, 0x4b, 0x03, 0x04])
    || hasBytes(file.buffer, [0x50, 0x4b, 0x05, 0x06])
    || hasBytes(file.buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

function thumbnailMagicMatchesExtension(file, ext) {
  const isJpeg = hasBytes(file.buffer, [0xff, 0xd8, 0xff]);
  const isPng = hasBytes(file.buffer, [0x89, 0x50, 0x4e, 0x47]);
  const isWebp = hasBytes(file.buffer, [0x52, 0x49, 0x46, 0x46]) && hasBytes(file.buffer, [0x57, 0x45, 0x42, 0x50], 8);

  if (['jpg', 'jpeg'].includes(ext)) return isJpeg;
  if (ext === 'png') return isPng;
  if (ext === 'webp') return isWebp;
  return false;
}

function validateUpload(file, { label, maxBytes, mimeTypes, extensions, validateMagic }) {
  if (!file) throw new Error(`${label} is required.`);
  if (file.size > maxBytes) throw new Error(`${label} exceeds the allowed size.`);
  const ext = getFileExtension(file);
  if (!extensions.includes(ext)) {
    throw new Error(`${label} has an unsupported file extension.`);
  }

  const hasKnownMime = mimeTypes.has(file.mimetype);
  const hasBinaryFallback = BINARY_MIME_FALLBACKS.has(file.mimetype);
  if (!hasKnownMime && !hasBinaryFallback) {
    throw new Error(`${label} has an unsupported file type.`);
  }

  if (validateMagic && !validateMagic(file, ext)) {
    throw new Error(`${label} content does not match its file type.`);
  }
}

async function uploadToStorage(path, file) {
  const client = requireStorageClient();
  const { error } = await client.storage
    .from('ar-models')
    .upload(path, file.buffer, {
      upsert: true,
      contentType: file.mimetype,
    });
  if (error) throw new Error(error.message);

  const { data } = client.storage.from('ar-models').getPublicUrl(path);
  return data.publicUrl;
}

function storagePathFromPublicUrl(publicUrl) {
  if (!publicUrl) return null;
  const marker = '/storage/v1/object/public/ar-models/';
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + marker.length));
}

async function assertMenuItemForRestaurant(itemId, restaurantId) {
  const menuItem = await prisma.menuItem.findFirst({
    where: { id: itemId, restaurant_id: restaurantId },
  });
  if (!menuItem) {
    const error = new Error('Menu item not found for this restaurant.');
    error.status = 404;
    throw error;
  }
  return menuItem;
}

function getPublicTableSessionToken(req) {
  const token = req.query.table_session_token || req.headers['x-table-session-token'];
  return typeof token === 'string' ? token.trim() : '';
}

// ── SEED ─────────────────────────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  try {
    let restaurant = await prisma.restaurant.findFirst();

    if (!restaurant) {
      restaurant = await prisma.restaurant.create({
        data: { 
          name: 'Zaika Zindagi - Taste of Life', 
          slug: 'zaika-zindagi',
          description: 'Experience the fusion of high-end culinary art and immersive digital precision.',
          primary_color: '#B8860B',
          font_family: 'serif'
        }
      });

      const hash = await bcrypt.hash('password123', 12);
      await prisma.user.create({
        data: {
          restaurant_id: restaurant.id,
          email: 'admin@zaikazindagi.com',
          password_hash: hash,
          role: 'owner'
        }
      });

      // Create default tables
      const tables = await prisma.table.createManyAndReturn({
        data: [
          { restaurant_id: restaurant.id, number: '01', section: 'Main Hall', capacity: 4 },
          { restaurant_id: restaurant.id, number: '02', section: 'Main Hall', capacity: 4 },
          { restaurant_id: restaurant.id, number: '03', section: 'Terrace', capacity: 6 },
          { restaurant_id: restaurant.id, number: '04', section: 'Terrace', capacity: 2 },
          { restaurant_id: restaurant.id, number: '05', section: 'Bar', capacity: 4 },
          { restaurant_id: restaurant.id, number: '06', section: 'Bar', capacity: 2 },
        ]
      });

      // Generate QR codes for each table
      for (const table of tables) {
        const qrUrl = `${BASE_URL}/r/${restaurant.slug}/t/${table.id}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 2 });
        await prisma.table.update({
          where: { id: table.id },
          data: { qr_code_url: qrDataUrl }
        });
      }

      // Create categories
      const [starters, mains, desserts, drinks] = await Promise.all([
        prisma.menuCategory.create({ data: { restaurant_id: restaurant.id, name: 'Starters', display_order: 1 } }),
        prisma.menuCategory.create({ data: { restaurant_id: restaurant.id, name: 'Mains', display_order: 2 } }),
        prisma.menuCategory.create({ data: { restaurant_id: restaurant.id, name: 'Desserts', display_order: 3 } }),
        prisma.menuCategory.create({ data: { restaurant_id: restaurant.id, name: 'Drinks', display_order: 4 } }),
      ]);

      // Create menu items
      const menuItems = [
        { restaurant_id: restaurant.id, category_id: starters.id, name: 'Gilded Chicken Skewers', description: 'Tender chicken skewers marinated in saffron and grilled to perfection', price: 320, dietary_flag: 'non-veg', image_url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=80', tags_json: JSON.stringify(['popular', 'spicy']), display_order: 1 },
        { restaurant_id: restaurant.id, category_id: starters.id, name: 'Burrata Bruschetta', description: 'Creamy burrata on sourdough with heirloom tomatoes', price: 280, dietary_flag: 'veg', image_url: 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=600&q=80', tags_json: JSON.stringify(['new']), display_order: 2 },
        { restaurant_id: restaurant.id, category_id: mains.id, name: 'Butter Chicken', description: 'Classic slow-cooked in a rich tomato and cream sauce', price: 480, dietary_flag: 'non-veg', image_url: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&q=80', tags_json: JSON.stringify(['popular']), display_order: 1 },
        { restaurant_id: restaurant.id, category_id: mains.id, name: 'Truffle Risotto', description: 'Arborio rice slow-cooked with black truffle and aged parmesan', price: 560, dietary_flag: 'veg', image_url: 'https://images.unsplash.com/photo-1673752063548-b2f72c2a0dd8?w=600&q=80', tags_json: JSON.stringify(['popular']), display_order: 2 },
        { restaurant_id: restaurant.id, category_id: mains.id, name: 'Wagyu Ribeye', description: '200g A4 wagyu with peppercorn sauce', price: 1800, dietary_flag: 'non-veg', image_url: 'https://images.unsplash.com/photo-1546833998-877b37c2e5c6?w=600&q=80', tags_json: JSON.stringify(['premium']), display_order: 3 },
        { restaurant_id: restaurant.id, category_id: desserts.id, name: 'Mango Panna Cotta', description: 'Silky smooth with Alphonso mango coulis', price: 220, dietary_flag: 'veg', image_url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80', tags_json: JSON.stringify(['seasonal']), display_order: 1 },
        { restaurant_id: restaurant.id, category_id: drinks.id, name: 'Virgin Mojito', description: 'Fresh mint, lime and soda water', price: 160, dietary_flag: 'vegan', image_url: 'https://images.unsplash.com/photo-1520372638628-35d5a6f03f52?w=600&q=80', tags_json: JSON.stringify(['refreshing']), display_order: 1 },
      ];

      for (const item of menuItems) {
        const mi = await prisma.menuItem.create({ data: item });
        if (mi.name === 'Butter Chicken') {
          const group = await prisma.modifierGroup.create({
            data: { restaurant_id: restaurant.id, menu_item_id: mi.id, name: 'Spice Level', required: true }
          });
          await prisma.modifierOption.createMany({
            data: [
              { group_id: group.id, name: 'Mild', price_delta: 0 },
              { group_id: group.id, name: 'Medium', price_delta: 0 },
              { group_id: group.id, name: 'Hot', price_delta: 0 },
              { group_id: group.id, name: 'Extra Hot', price_delta: 20 },
            ]
          });
        }
      }
    }

    res.json({ message: 'Seeded successfully', restaurantId: restaurant.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, restaurantId: user.restaurant_id, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { restaurant: true }
    });

    res.json({
      token,
      user: { 
        id: fullUser.id, 
        email: fullUser.email, 
        role: fullUser.role, 
        restaurantId: fullUser.restaurant_id,
        restaurant: {
          name: fullUser.restaurant.name,
          slug: fullUser.restaurant.slug,
          logo_url: fullUser.restaurant.logo_url
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── MENU (Public) ────────────────────────────────────────────────────────────
app.get('/api/menu', async (req, res) => {
  const { restaurant_slug } = req.query;
  try {
    const restaurant = restaurant_slug
      ? await prisma.restaurant.findUnique({ where: { slug: restaurant_slug } })
      : await prisma.restaurant.findFirst();

    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const categories = await prisma.menuCategory.findMany({
      where: { restaurant_id: restaurant.id, archived: false },
      include: {
        items: {
          where: { available: true },
          include: {
            modifier_groups: {
              include: { options: true }
            }
          },
          orderBy: { display_order: 'asc' }
        }
      },
      orderBy: { display_order: 'asc' }
    });

    res.json({ restaurant, categories });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/menu/item/:id', async (req, res) => {
  try {
    const item = await prisma.menuItem.findFirst({
      where: {
        id: req.params.id,
        available: true,
        category: { is: { archived: false } },
      },
      include: {
        category: true,
        modifier_groups: {
          include: { options: true }
        }
      }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── MENU ITEMS (Admin) ───────────────────────────────────────────────────────
app.get('/api/admin/menu-items', requireAuth, async (req, res) => {
  try {
    const items = await prisma.menuItem.findMany({
      where: { restaurant_id: req.user.restaurantId },
      include: { category: true, modifier_groups: { include: { options: true } } },
      orderBy: { display_order: 'asc' }
    });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/menu-items', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  const { category_id, name, description, price, dietary_flag, image_url, tags_json, display_order } = req.body;
  try {
    const item = await prisma.menuItem.create({
      data: { restaurant_id: req.user.restaurantId, category_id, name, description, price: parseFloat(price), dietary_flag, image_url, tags_json, display_order: parseInt(display_order) || 0 }
    });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/menu-items/:id', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  const { id } = req.params;
  const { name, description, price, dietary_flag, image_url, available, tags_json } = req.body;
  try {
    const parsedPrice = price !== undefined ? parseFloat(price) : undefined;
    if (parsedPrice !== undefined && isNaN(parsedPrice)) {
      return res.status(400).json({ error: 'Invalid price' });
    }

    const item = await prisma.menuItem.updateMany({
      where: { id, restaurant_id: req.user.restaurantId },
      data: { name, description, price: parsedPrice, dietary_flag, image_url, available, tags_json }
    });
    res.json({ updated: item.count });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/menu-items/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.menuItem.deleteMany({ where: { id, restaurant_id: req.user.restaurantId } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── MENU CATEGORIES (Admin) ──────────────────────────────────────────────────
app.post(
  '/api/admin/menu-items/:itemId/ar/upload',
  requireAuth,
  requireRole('owner', 'manager'),
  arUpload.fields([
    { name: 'glb_file', maxCount: 1 },
    { name: 'usdz_file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { itemId } = req.params;
      await assertMenuItemForRestaurant(itemId, req.user.restaurantId);

      const glbFile = req.files?.glb_file?.[0];
      const usdzFile = req.files?.usdz_file?.[0];
      const thumbnailFile = req.files?.thumbnail?.[0];

      validateUpload(glbFile, {
        label: 'GLB file',
        maxBytes: 20 * 1024 * 1024,
        mimeTypes: GLB_MIME_TYPES,
        extensions: ['glb'],
        validateMagic: isGlb,
      });
      if (usdzFile) {
        validateUpload(usdzFile, {
          label: 'USDZ file',
          maxBytes: 20 * 1024 * 1024,
          mimeTypes: USDZ_MIME_TYPES,
          extensions: ['usdz'],
          validateMagic: isZipArchive,
        });
      }
      if (thumbnailFile) {
        validateUpload(thumbnailFile, {
          label: 'Thumbnail',
          maxBytes: 2 * 1024 * 1024,
          mimeTypes: THUMBNAIL_MIME_TYPES,
          extensions: ['jpg', 'jpeg', 'png', 'webp'],
          validateMagic: thumbnailMagicMatchesExtension,
        });
      }

      const basePath = `${req.user.restaurantId}/${itemId}`;
      const storageUpdates = {
        model_glb_url: await uploadToStorage(`${basePath}/model.glb`, glbFile),
        processing_status: 'ready',
        processing_error: null,
        file_size: glbFile.size + (usdzFile?.size || 0) + (thumbnailFile?.size || 0),
      };

      if (usdzFile) {
        storageUpdates.model_usdz_url = await uploadToStorage(`${basePath}/model.usdz`, usdzFile);
      }
      if (thumbnailFile) {
        const thumbExt = getFileExtension(thumbnailFile);
        storageUpdates.thumbnail_url = await uploadToStorage(`${basePath}/thumbnail.${thumbExt}`, thumbnailFile);
        storageUpdates.preview_image_url = storageUpdates.thumbnail_url;
      }

      const asset = await prisma.aRAsset.upsert({
        where: { menu_item_id: itemId },
        update: storageUpdates,
        create: {
          restaurant_id: req.user.restaurantId,
          menu_item_id: itemId,
          ...storageUpdates,
        },
      });

      await prisma.menuItem.update({
        where: { id: itemId },
        data: { has_ar_preview: true },
      });

      res.json(asset);
    } catch (err) {
      console.error(err);
      res.status(err.status || 400).json({ error: err.message });
    }
  }
);

app.patch('/api/admin/menu-items/:itemId/ar/status', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { itemId } = req.params;
    const { is_active, ar_preview_enabled } = req.body;
    await assertMenuItemForRestaurant(itemId, req.user.restaurantId);

    const existing = await prisma.aRAsset.findUnique({ where: { menu_item_id: itemId } });
    if (!existing) return res.status(404).json({ error: 'AR asset not found.' });

    const asset = await prisma.aRAsset.update({
      where: { menu_item_id: itemId },
      data: {
        ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {}),
      },
    });

    if (ar_preview_enabled !== undefined) {
      await prisma.menuItem.update({
        where: { id: itemId },
        data: { ar_preview_enabled: Boolean(ar_preview_enabled) },
      });
    }

    res.json(asset);
  } catch (err) {
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get('/api/admin/menu-items/:itemId/ar', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { itemId } = req.params;
    await assertMenuItemForRestaurant(itemId, req.user.restaurantId);
    const asset = await prisma.aRAsset.findUnique({ where: { menu_item_id: itemId } });
    if (!asset) return res.status(404).json({ error: 'AR asset not found.' });
    res.json(asset);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/admin/menu-items/:itemId/ar', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { itemId } = req.params;
    await assertMenuItemForRestaurant(itemId, req.user.restaurantId);
    const asset = await prisma.aRAsset.findUnique({ where: { menu_item_id: itemId } });
    if (!asset) return res.status(404).json({ error: 'AR asset not found.' });

    const paths = [
      asset.model_glb_url,
      asset.model_usdz_url,
      asset.thumbnail_url,
      asset.preview_image_url,
    ]
      .map(storagePathFromPublicUrl)
      .filter(Boolean);

    if (paths.length) {
      const client = requireStorageClient();
      const { error } = await client.storage.from('ar-models').remove([...new Set(paths)]);
      if (error) throw new Error(error.message);
    }

    await prisma.aRAsset.delete({ where: { menu_item_id: itemId } });
    await prisma.menuItem.update({
      where: { id: itemId },
      data: { has_ar_preview: false, ar_preview_enabled: false },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/public/menu-items/:itemId/ar', async (req, res) => {
  try {
    const item = await prisma.menuItem.findUnique({
      where: { id: req.params.itemId },
      include: { ar_asset: true },
    });

    if (!item?.has_ar_preview || !item.ar_preview_enabled || !item.ar_asset?.is_active) {
      return res.status(404).json({ error: 'AR preview is not active.' });
    }

    res.json({
      menu_item_id: item.id,
      has_ar_preview: item.has_ar_preview,
      model_glb_url: item.ar_asset.model_glb_url,
      model_usdz_url: item.ar_asset.model_usdz_url,
      thumbnail_url: item.ar_asset.thumbnail_url,
      fallback_video_url: item.ar_asset.source_video_url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/categories', requireAuth, async (req, res) => {
  try {
    const cats = await prisma.menuCategory.findMany({
      where: { restaurant_id: req.user.restaurantId },
      orderBy: { display_order: 'asc' }
    });
    res.json(cats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/categories', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name } = req.body;
    const last = await prisma.menuCategory.findFirst({ where: { restaurant_id: req.user.restaurantId }, orderBy: { display_order: 'desc' } });
    const cat = await prisma.menuCategory.create({
      data: { restaurant_id: req.user.restaurantId, name, display_order: (last?.display_order || 0) + 1 }
    });
    res.json(cat);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/categories/:id', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, display_order, archived } = req.body;
    await prisma.menuCategory.updateMany({ where: { id, restaurant_id: req.user.restaurantId }, data: { name, display_order, archived } });
    const updated = await prisma.menuCategory.findUnique({ where: { id } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ── RESTAURANT (Admin) ───────────────────────────────────────────────────────
app.patch('/api/admin/restaurant', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const { name, description, logo_url, primary_color, font_family } = req.body;
    const updated = await prisma.restaurant.update({
      where: { id: req.user.restaurantId },
      data: { name, description, logo_url, primary_color, font_family }
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ── TABLES (Admin) ───────────────────────────────────────────────────────────
app.get('/api/admin/tables', requireAuth, async (req, res) => {
  try {
    const tables = await prisma.table.findMany({
      where: { restaurant_id: req.user.restaurantId },
      orderBy: { number: 'asc' }
    });
    res.json(tables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tables', requireAuth, requireRole('owner', 'manager'), async (req, res) => {
  const { number, section, capacity } = req.body;
  try {
    const parsedCapacity = parseInt(capacity);
    if (isNaN(parsedCapacity)) {
      return res.status(400).json({ error: 'Invalid capacity' });
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.user.restaurantId } });
    const table = await prisma.table.create({
      data: { restaurant_id: req.user.restaurantId, number, section, capacity: parsedCapacity }
    });

    const qrUrl = `${BASE_URL}/r/${restaurant.slug}/t/${table.id}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 2 });
    const updated = await prisma.table.update({ where: { id: table.id }, data: { qr_code_url: qrDataUrl } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/tables/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, number, section, capacity } = req.body;
    
    const parsedCapacity = capacity ? parseInt(capacity) : undefined;
    if (parsedCapacity !== undefined && isNaN(parsedCapacity)) {
      return res.status(400).json({ error: 'Invalid capacity' });
    }

    const updated = await prisma.table.updateMany({
      where: { id, restaurant_id: req.user.restaurantId },
      data: { status, number, section, capacity: parsedCapacity }
    });
    if (updated.count > 0) {
      const table = await prisma.table.findUnique({ where: { id } });
      io.to(`restaurant:${req.user.restaurantId}`).emit('table:updated', table);
      res.json(table);
    } else {
      res.status(404).json({ error: 'Table not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Public table lookup (QR landing) — includes restaurant name
app.get('/api/tables/:id', async (req, res) => {
  try {
    const table = await prisma.table.findUnique({
      where: { id: req.params.id },
      include: { restaurant: true }
    });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    res.json(table);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── ORDERS ───────────────────────────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  const { restaurant_id, table_id, items, special_instructions, idempotency_key } = req.body;

  if (!restaurant_id || !table_id || !items?.length) {
    return res.status(400).json({ error: 'Missing required fields: restaurant_id, table_id, items' });
  }

  try {
    // True idempotency check — prevents duplicate orders on double-tap
    if (idempotency_key) {
      const existing = await prisma.order.findUnique({ where: { idempotency_key } });
      if (existing) {
        return res.json({ order_ref: existing.id, status: existing.status, total_amount: existing.total_amount });
      }
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurant_id } });
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const table = await prisma.table.findFirst({
      where: { id: table_id, restaurant_id },
    });
    if (!table) {
      return res.status(400).json({ error: 'Invalid table for this restaurant' });
    }

    const orderId = genOrderId();

    // Trustless Pricing Calculation
    let calculatedSubtotal = 0;
    const orderItemsData = [];

    // Fetch all relevant menu items and their modifiers from the DB
    const menuItemIds = items.map(i => i.menu_item_id || i.id).filter(Boolean);
    const dbItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurant_id },
      include: {
        modifier_groups: {
          include: { options: true }
        }
      }
    });

    if (dbItems.length !== new Set(menuItemIds).size) {
      return res.status(400).json({ error: 'One or more invalid menu items for this restaurant' });
    }

    const dbItemsMap = new Map(dbItems.map(i => [i.id, i]));

    for (const item of items) {
      const itemId = item.menu_item_id || item.id;
      const dbItem = dbItemsMap.get(itemId);
      if (!dbItem) continue;

      const qty = parseInt(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid quantity' });
      }

      let itemModsPrice = 0;
      const validModifiers = [];

      // Validate and price modifiers
      if (item.modifiers && Array.isArray(item.modifiers)) {
        for (const mod of item.modifiers) {
          // Find the modifier option in the dbItem's groups
          let dbModOption = null;
          for (const group of dbItem.modifier_groups) {
            const found = group.options.find(o => o.name === mod.name);
            if (found) {
              dbModOption = found;
              break;
            }
          }
          
          if (dbModOption) {
            itemModsPrice += dbModOption.price_delta;
            validModifiers.push({ name: dbModOption.name, price_delta: dbModOption.price_delta });
          }
        }
      }

      const totalItemPrice = dbItem.price + itemModsPrice;
      calculatedSubtotal += totalItemPrice * qty;

      orderItemsData.push({
        menu_item_id: dbItem.id,
        name: dbItem.name,
        quantity: qty,
        price: dbItem.price,
        modifiers_json: validModifiers.length > 0 ? JSON.stringify(validModifiers) : null,
      });
    }

    const calculatedTax = +(calculatedSubtotal * Number(restaurant.gst_rate || 0)).toFixed(2);
    const calculatedServiceCharge = +(calculatedSubtotal * Number(restaurant.service_charge_rate || 0)).toFixed(2);
    const calculatedTotalAmount = +(calculatedSubtotal + calculatedTax + calculatedServiceCharge).toFixed(2);

    if (calculatedTotalAmount <= 0) {
      return res.status(400).json({ error: 'Order total must be greater than zero' });
    }

    const order = await prisma.order.create({
      data: {
        id: orderId,
        restaurant_id,
        table_id,
        subtotal_amount: +calculatedSubtotal.toFixed(2),
        tax_amount: calculatedTax,
        service_charge_amount: calculatedServiceCharge,
        total_amount: calculatedTotalAmount,
        special_instructions,
        idempotency_key: idempotency_key || null,
        status: 'pending',
        items: {
          create: orderItemsData
        }
      },
      include: { items: true }
    });

    // Update table status
    await prisma.table.update({ where: { id: table.id }, data: { status: 'occupied' } });

    // Emit to KDS / restaurant room
    io.to(`restaurant:${restaurant_id}`).emit('order:new', order);

    res.json({ order_ref: order.id, status: order.status, total_amount: order.total_amount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to place order: ' + error.message });
  }
});

// GET /api/tables/:id/orders — get all orders for a specific table (cumulative bill)
app.get('/api/tables/:id/orders', async (req, res) => {
  try {
    const { id } = req.params;
    const tableSessionToken = getPublicTableSessionToken(req);
    if (!tableSessionToken) {
      return res.status(401).json({ error: 'table_session_token is required.' });
    }

    const session = await prisma.tableSession.findFirst({
      where: { table_id: id, token: tableSessionToken },
      select: { id: true },
    });
    if (!session) {
      return res.status(403).json({ error: 'Invalid table session token.' });
    }

    const orders = await prisma.order.findMany({
      where: { table_id: id, table_session_id: session.id },
      include: { 
        items: {
          include: { menu_item: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id — poll or track order (public)
app.get('/api/orders/:id', async (req, res) => {
  try {
    const tableSessionToken = getPublicTableSessionToken(req);
    if (!tableSessionToken) {
      return res.status(401).json({ error: 'table_session_token is required.' });
    }

    const session = await prisma.tableSession.findUnique({
      where: { token: tableSessionToken },
      select: { id: true },
    });
    if (!session) {
      return res.status(403).json({ error: 'Invalid table session token.' });
    }

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, table_session_id: session.id },
      include: { 
        items: {
          include: { menu_item: true }
        }, 
        table: true 
      }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders — admin order list
app.get('/api/admin/orders', requireAuth, async (req, res) => {
  try {
    const { status, limit = '100', offset = '0' } = req.query;
    const filter = { restaurant_id: req.user.restaurantId };
    if (status) filter.status = status;

    const orders = await prisma.order.findMany({
      where: filter,
      include: { 
        items: {
          include: { menu_item: true }
        }, 
        table: true 
      },
      orderBy: { created_at: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/orders/:id — update order status
app.patch('/api/admin/orders/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status, cancel_reason } = req.body;

  try {
    const order = await prisma.order.findFirst({
      where: { id, restaurant_id: req.user.restaurantId }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Enforce valid state transitions
    const validNext = VALID_TRANSITIONS[order.status] || [];
    if (!validNext.includes(status)) {
      return res.status(400).json({
        error: `Invalid transition: ${order.status} → ${status}. Valid next states: ${validNext.join(', ') || 'none'}`
      });
    }

    // Cancellation requires a reason
    if (status === 'cancelled' && !cancel_reason) {
      return res.status(400).json({ error: 'cancel_reason is required when cancelling an order' });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status, cancel_reason: cancel_reason || null },
      include: { 
        items: {
          include: { menu_item: true }
        }, 
        table: true 
      }
    });

    // Free table when order completes or is cancelled
    if (['completed', 'cancelled'].includes(status)) {
      const table = await prisma.table.update({ where: { id: updated.table_id }, data: { status: 'available' } });
      io.to(`restaurant:${req.user.restaurantId}`).emit('table:updated', table);
    }

    // Emit updates to customer order room and restaurant room
    io.to(`order:${id}`).emit('order:status_update', { orderId: id, status, updatedAt: new Date() });
    io.to(`restaurant:${req.user.restaurantId}`).emit('order:updated', updated);

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ── FALLBACK & ERROR HANDLERS ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.status(404).json({ error: 'API Endpoint Not Found' });
});

app.use((err, req, res, next) => {
  console.error('[Zaika Zindagi] Unhandled Error:', err);
  res.status(500).json({ error: 'Internal Server Error', details: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

// ── START ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[Zaika Zindagi] Server running on port ${PORT}`);
  console.log(`[Zaika Zindagi] Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[Zaika Zindagi] Socket.io listening`);
});
