import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { CustomerTopNav } from '../components/TopNav';
import BottomNav from '../components/BottomNav';
import CartCTA from '../components/CartCTA';
import CartSidebar from '../components/CartSidebar';
import {
  MENU_LOCALE_LABELS,
  applyMenuTranslationsToCategories,
  fetchMenu,
  fetchMenuTranslations,
  fetchRecommendations,
  getGuestProfileForSession,
  getPreferredMenuLocale,
  resetMenuLocaleToEnglish,
  sendMenuChatMessage,
} from '../lib/api';
import CallWaiterFAB from '../components/CallWaiterFAB';
import { sortRecommendedItems } from '../lib/recommendations';
import { useToast } from '../components/Toast';

const TAG_CONFIG = {
  popular: { label: 'Popular', color: 'bg-primary text-on-primary', icon: 'local_fire_department' },
  new: { label: 'New', color: 'bg-blue-500 text-white', icon: 'new_releases' },
  spicy: { label: 'Spicy', color: 'bg-red-500 text-white', icon: 'whatshot' },
  vegan: { label: 'Vegan', color: 'bg-green-600 text-white', icon: 'eco' },
  loved: { label: 'Loved', color: 'bg-green-600 text-white', icon: 'favorite' },
  trending: { label: 'Trending', color: 'bg-primary text-on-primary', icon: 'trending_up' },
  needs_review: { label: 'Needs Review', color: 'bg-error text-on-error', icon: 'priority_high' },
  ar: { label: 'AR Preview', color: 'bg-blue-600 text-white', icon: 'view_in_ar' },
};
const MENU_IMAGE_TRANSFORM = 'width=400&quality=75&format=webp';

function getMenuImageUrl(src) {
  if (!src) return '';
  if (src.startsWith('/images/') || src.startsWith('/public/images/')) return src;

  try {
    const url = new URL(src, window.location.origin);
    if (!url.pathname.includes('/storage/v1/') || !url.pathname.includes('/menu-images/')) {
      return src;
    }

    url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    url.search = MENU_IMAGE_TRANSFORM;
    return url.toString();
  } catch {
    return src;
  }
}

function DishImage({ src, alt }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <div className="menu-image-skeleton absolute inset-0" />}
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-primary/5">
          <span className="material-symbols-outlined text-primary/40 text-4xl">restaurant</span>
        </div>
      )}
    </>
  );
}

export default function MenuHome() {
  const { restaurantSlug } = useParams();
  const { addItem, items, restaurantSlug: sessionSlug, setSession, updateQty, tableSessionToken } = useCart();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const slug = restaurantSlug || sessionSlug || null;
  const menuChatEnabled = String(import.meta.env.VITE_ENABLE_MENU_CHAT || '').toLowerCase() === 'true';

  const [restaurant, setRestaurant] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dietFilter, setDietFilter] = useState([]); // 'veg', 'vegan', 'non-veg'
  const [upsellModal, setUpsellModal] = useState({ isOpen: false, addedItemName: '' });
  const [upsellCandidates, setUpsellCandidates] = useState([]);
  const [serverRecommendations, setServerRecommendations] = useState([]);
  const [guestProfile, setGuestProfile] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [preferredLocale, setPreferredLocale] = useState(getPreferredMenuLocale);

  useEffect(() => {
    if (!slug) {
      setError('Restaurant context is required. Please scan a valid QR code.');
      setLoading(false);
      return;
    }

    let mounted = true;
    async function loadMenu() {
      setLoading(true);
      try {
        const data = await fetchMenu(slug);
        let nextCategories = data.categories || [];
        if (preferredLocale !== 'en') {
          const menuItemIds = nextCategories.flatMap(cat => (cat.items || []).map(item => item.id));
          try {
            const translations = await fetchMenuTranslations(menuItemIds, preferredLocale);
            nextCategories = applyMenuTranslationsToCategories(nextCategories, translations);
          } catch {
            nextCategories = data.categories || [];
          }
        }
        if (!mounted) return;
        setRestaurant(data.restaurant);
        setCategories(nextCategories);

        // Prepare session-aware recommendation candidates.
        const candidates = nextCategories
          .flatMap(cat => cat.items || [])
          .filter(item => item.available);
        setUpsellCandidates(candidates);

        setLoading(false);

        // Seed context if missing (legacy route /menu)
        if (!sessionSlug && data.restaurant?.slug) {
          setSession({
            restaurantId: data.restaurant.id,
            restaurantSlug: data.restaurant.slug,
            gstRate: data.restaurant.gst_rate
          });
        }
      } catch (err) {
        if (!mounted) return;
        setError(err.message);
        setLoading(false);
      }
    }

    loadMenu();
    return () => {
      mounted = false;
    };
  }, [slug, sessionSlug, setSession, preferredLocale]);

  useEffect(() => {
    if (!tableSessionToken) {
      setGuestProfile(null);
      return;
    }
    getGuestProfileForSession(tableSessionToken)
      .then(profile => setGuestProfile(profile))
      .catch(() => setGuestProfile(null));
  }, [tableSessionToken]);

  // Safe JSON parse helper for tags
  const parseTags = (value) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const allItems = categories.flatMap(c => c.items);
  const languageLabel = preferredLocale !== 'en' ? MENU_LOCALE_LABELS[preferredLocale] || preferredLocale.toUpperCase() : null;
  const cartItemIdsKey = items.map(item => item.id).join(',');
  const modalRecommendations = serverRecommendations.length > 0
    ? serverRecommendations
    : sortRecommendedItems(upsellCandidates, items, categories, guestProfile).slice(0, 6);

  useEffect(() => {
    if (!restaurant?.id || upsellCandidates.length === 0) return;
    fetchRecommendations({
      restaurantId: restaurant.id,
      cartItemIds: cartItemIdsKey ? cartItemIdsKey.split(',') : [],
      guestProfileId: guestProfile?.id || null,
      limit: 6,
    })
      .then(setServerRecommendations)
      .catch(() => setServerRecommendations([]));
  }, [restaurant?.id, upsellCandidates.length, cartItemIdsKey, guestProfile?.id]);

  const filtered = allItems.filter(dish => {
    const catMatch = activeCategory === 'All' || categories.find(c => c.id === dish.category_id)?.name === activeCategory;
    const searchMatch = !search || (() => {
      const q = search.toLowerCase();
      const tags = parseTags(dish.tags_json);
      return (
        dish.name.toLowerCase().includes(q) ||
        (dish.description || '').toLowerCase().includes(q) ||
        tags.some(t => t.toLowerCase().includes(q))
      );
    })();
    const dietMatch = dietFilter.length === 0 || dietFilter.includes(dish.dietary_flag);
    return catMatch && searchMatch && dietMatch;
  });

  const toggleDiet = (flag) => {
    setDietFilter(prev => prev.includes(flag) ? prev.filter(f => f !== flag) : [...prev, flag]);
  };

  const highlightText = (text, query) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/20 text-primary rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  const getDishPath = (dishId) => restaurantSlug ? `/r/${restaurantSlug}/dish/${dishId}` : `/dish/${dishId}`;

  const sendChat = async (messageText = chatInput) => {
    const text = messageText.trim();
    if (!text || !restaurant?.id || chatLoading) return;
    const nextMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    try {
      const result = await sendMenuChatMessage({
        restaurantId: restaurant.id,
        message: text,
        history: chatMessages,
      });
      setChatMessages([...nextMessages, { role: 'assistant', content: result.reply || 'I found a few options for you.' }]);
      if (result.action?.items?.length) {
        result.action.items.forEach(actionItem => {
          const dish = allItems.find(item => item.id === actionItem.id);
          if (dish) addItem(dish, Number(actionItem.qty || 1), []);
        });
        addToast(`${result.action.items[0]?.name || 'Item'} added to your cart.`, 'success');
      }
    } catch (err) {
      setChatMessages([...nextMessages, { role: 'assistant', content: err.message.includes('configured') ? 'Chat is not available right now.' : 'I could not reach the menu assistant right now.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleAddWithUpsell = (dish) => {
    if (!dish.available) return;

    // MF-12: If dish has required modifier groups, navigate to detail to let user configure
    const hasModifiers = dish.modifier_groups && dish.modifier_groups.length > 0;
    if (hasModifiers) {
      navigate(getDishPath(dish.id));
      return;
    }

    addItem(dish);
    
    // Only show upsell if adding a main course (not a drink/dessert already)
    const catName = categories.find(c => c.id === dish.category_id)?.name.toLowerCase() || '';
    const isMain = !catName.includes('sweet') && !catName.includes('liquid') && !catName.includes('beverage') && !catName.includes('dessert');
    
    if (isMain && upsellCandidates.length > 0) {
      setUpsellModal({ isOpen: true, addedItemName: dish.name });
    }
  };

  const getPrimaryTag = (tagsJson) => {
    const tags = parseTags(tagsJson);
    for (const key of ['loved', 'trending', 'needs_review', 'popular', 'new', 'spicy', 'vegan']) {
      if (tags.includes(key)) return TAG_CONFIG[key];
    }
    return null;
  };

  const DishCard = ({ dish }) => {
    const isSoldOut = !dish.available;
    const imageUrl = getMenuImageUrl(dish.image_url);
    const tag = (() => {
      if (dish.sentiment_badge && TAG_CONFIG[dish.sentiment_badge]) return TAG_CONFIG[dish.sentiment_badge];
      if (Number(dish.order_count_7d || 0) >= 10) return TAG_CONFIG.trending;
      if (dish.has_ar_preview || dish.ar_preview_enabled) return TAG_CONFIG.ar;
      return getPrimaryTag(dish.tags_json);
    })();
    const cartItems = items.filter(i => i.id === dish.id);
    const totalQty = cartItems.reduce((sum, i) => sum + i.qty, 0);
    const hasModifiers = dish.modifier_groups && dish.modifier_groups.length > 0;
    const firstCartItem = cartItems[0];

    return (
      <div
        className={`bg-surface-container-low rounded-xl overflow-hidden flex flex-col transition-all group ${
          isSoldOut
            ? 'opacity-60 grayscale cursor-not-allowed'
            : 'cursor-pointer hover:shadow-xl hover:-translate-y-1'
        }`}
        onClick={() => !isSoldOut && navigate(getDishPath(dish.id))}
      >
        <div className="h-48 overflow-hidden relative bg-surface-container">
          <DishImage src={imageUrl} alt={dish.name} />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-dim/80 via-transparent to-transparent opacity-80" />
          
          {isSoldOut && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center backdrop-blur-[2px] z-10">
               <span className="bg-surface-container-highest text-on-surface-variant px-4 py-2 rounded-full font-bold uppercase tracking-widest text-sm shadow-lg rotate-12 border border-outline-variant/30">Unavailable</span>
            </div>
          )}

          {!isSoldOut && tag && (
            <div className={`absolute top-3 right-3 ${tag.color} px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-widest shadow-md flex items-center gap-1 z-10`}>
              <span className="material-symbols-outlined text-[12px]">{tag.icon}</span>
              {tag.label}
            </div>
          )}
          
          <div className="absolute top-3 left-3 z-10">
            {dish.dietary_flag === 'veg' && <span className="w-4 h-4 rounded border-2 border-green-500 bg-white flex items-center justify-center shadow-md"><span className="w-2 h-2 rounded-full bg-green-500 block" /></span>}
            {dish.dietary_flag === 'non-veg' && <span className="w-4 h-4 rounded border-2 border-red-500 bg-white flex items-center justify-center shadow-md"><span className="w-2 h-2 rounded-full bg-red-500 block" /></span>}
          </div>
        </div>
        <div className="p-5 flex flex-col flex-grow">
          <div className="text-[10px] uppercase tracking-widest font-bold text-primary mb-1.5">
            {categories.find(c => c.id === dish.category_id)?.name}
          </div>
          <h3 className="font-headline text-lg font-bold text-on-surface leading-tight mb-2" title={dish.original_name || undefined}>
            {highlightText(dish.name, search)}
          </h3>
          <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 mb-3 opacity-80" title={dish.original_description || undefined}>
            {dish.description}
          </p>
          <div className="mt-auto pt-4 flex items-center justify-between border-t border-outline-variant/30">
            <span className="text-primary font-headline text-lg font-bold">₹{dish.price}</span>
            
            {isSoldOut ? (
               <span className="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Not orderable</span>
            ) : totalQty > 0 && hasModifiers ? (
              <button
                onClick={e => { e.stopPropagation(); navigate(getDishPath(dish.id)); }}
                className="h-9 px-3 rounded-full bg-primary text-on-primary flex items-center gap-1.5 hover:bg-primary-fixed-dim transition-colors text-[10px] font-bold uppercase tracking-widest"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                Edit
              </button>
            ) : totalQty > 0 ? (
              <div className="flex items-center bg-primary text-on-primary rounded-full overflow-hidden shadow-md">
                <button 
                  onClick={e => {
                    e.stopPropagation();
                    if (firstCartItem) updateQty(firstCartItem._cartKey || firstCartItem.id, firstCartItem.qty - 1);
                  }}
                  className="w-8 h-8 flex items-center justify-center hover:bg-primary-fixed-dim transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">remove</span>
                </button>
                <span className="text-xs font-bold px-2">{totalQty}</span>
                <button 
                  onClick={e => { e.stopPropagation(); handleAddWithUpsell(dish); }} 
                  className="w-8 h-8 flex items-center justify-center hover:bg-primary-fixed-dim transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); handleAddWithUpsell(dish); }}
                className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary hover:bg-primary hover:text-on-primary transition-colors cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-xl">add</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
    </div>
  );

  if (error) return (
    <div className="min-h-dvh bg-background text-on-surface flex items-center justify-center p-6">
      <p className="text-error text-center">{error}</p>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background text-on-surface selection:bg-primary-container/30">
      <CustomerTopNav
        logo={restaurant?.logo_url}
        guestProfile={guestProfile}
        languageLabel={languageLabel}
        onLanguageReset={() => setPreferredLocale(resetMenuLocaleToEnglish())}
      />

      {/* Desktop: side-by-side content + cart; Mobile: stacked */}
      <div className="flex" style={{ paddingTop: 'var(--nav-height)' }}>
        <main className="flex-1 min-w-0 pb-36 lg:pb-12 px-4 lg:px-8 xl:px-12 pt-8">

        {/* ── Hero Editorial ───────────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-[2px] bg-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-primary">Est. 2024</span>
          </div>
          <h1 className="font-headline text-4xl lg:text-5xl font-bold tracking-tight text-on-surface mb-3 leading-tight">
            {restaurant?.name?.split(' - ')[0] || 'Menuverse'}{' '}
            <span className="text-primary italic block sm:inline">{restaurant?.name?.split(' - ')[1] || 'Digital Dining'}</span>
          </h1>
          {Number(guestProfile?.loyalty_points || 0) >= 100 && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-2 mb-3 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-primary text-base">stars</span>
              <span>
                You have <strong>{guestProfile.loyalty_points} points</strong> worth <strong> Rs. {Math.floor(guestProfile.loyalty_points / 10)}</strong> off your bill.
              </span>
            </div>
          )}
          <p className="text-on-surface-variant font-body text-sm max-w-[90%] leading-relaxed opacity-80 border-l-2 border-primary/20 pl-4 mb-6">
            {restaurant?.description || 'Experience the fusion of high-end culinary art and immersive digital precision.'}
          </p>

          {activeCategory === 'All' && !search && dietFilter.length === 0 && (() => {
            const hero = allItems.find(d => parseTags(d.tags_json).includes('popular') && d.available) || allItems.find(d => d.available);
            if (!hero) return null;
            return (
              <div className="relative rounded-3xl overflow-hidden h-64 md:h-80 cursor-pointer group shadow-xl" onClick={() => navigate(getDishPath(hero.id))}>
                <img src={getMenuImageUrl(hero.image_url)} alt={hero.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                       <span className="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
                         <span className="material-symbols-outlined text-[12px]">star</span>
                         Chef's Special
                       </span>
                    </div>
                    <h2 className="text-3xl font-headline font-bold text-white mb-1 drop-shadow-md" title={hero.original_name || undefined}>{hero.name}</h2>
                    <p className="text-white/80 text-sm line-clamp-1 max-w-sm drop-shadow" title={hero.original_description || undefined}>{hero.description}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleAddWithUpsell(hero); }} className="w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg cursor-pointer">
                    <span className="material-symbols-outlined">add</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </section>

        {/* ── Search Bar ───────────────────────────────────── */}
        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-xl">search</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search dishes..."
            className="w-full bg-surface-container-high rounded-xl pl-10 pr-10 py-3 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant text-xl cursor-pointer hover:text-on-surface"
            >close</button>
          )}
        </div>

        {/* ── Dietary Filter Chips ─────────────────────────── */}
        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
          {[['veg', 'Veg', 'eco'], ['vegan', 'Vegan', 'spa'], ['non-veg', 'Non-Veg', 'ramen_dining']].map(([flag, label, icon]) => (
            <button
              key={flag}
              onClick={() => toggleDiet(flag)}
              className={`flex-none flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${
                dietFilter.includes(flag)
                  ? 'bg-primary text-on-primary shadow-md'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              <span className="material-symbols-outlined text-sm">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* ── Category Tabs ────────────────────────────────── */}
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-4 sticky top-20 bg-background/80 backdrop-blur-md z-40 -mx-4 px-4 pt-2">
          <button
            onClick={() => setActiveCategory('All')}
            className={`flex-none px-5 py-2 rounded-full font-bold text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 ${
              activeCategory === 'All'
                ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary-container/20'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            All
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeCategory === 'All' ? 'bg-primary/20 text-on-primary-container' : 'bg-surface-container text-on-surface-variant'}`}>{allItems.length}</span>
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.name)}
              className={`flex-none px-5 py-2 rounded-full font-bold text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 ${
                activeCategory === cat.name
                  ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary-container/20'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {cat.name}
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeCategory === cat.name ? 'bg-primary/20 text-on-primary-container' : 'bg-surface-container text-on-surface-variant'}`}>{cat.items?.length || 0}</span>
            </button>
          ))}
        </div>

        {/* ── Dish Grid ────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-on-surface-variant text-5xl mb-4 block">sentiment_dissatisfied</span>
            <p className="text-on-surface-variant">
              {dietFilter.length > 0
                ? `No ${dietFilter.join('/')} options in ${activeCategory === 'All' ? 'this menu' : activeCategory} — try another category`
                : 'No dishes found for your search'}
            </p>
          </div>
        ) : activeCategory === 'All' && !search && dietFilter.length === 0 ? (
          <div className="mt-4 space-y-12">
            {categories.map(cat => {
              const catItems = cat.items.filter(dish => filtered.some(f => f.id === dish.id));
              if (catItems.length === 0) return null;
              return (
                <div key={cat.id} className="scroll-mt-32" id={`category-${cat.id}`}>
                  <h2 className="font-headline text-2xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    {cat.name}
                    <span className="text-sm font-normal text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">{catItems.length}</span>
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {catItems.map(dish => <DishCard key={dish.id} dish={dish} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-4">
            {filtered.map(dish => <DishCard key={dish.id} dish={dish} />)}
          </div>
        )}
        </main>

        {/* Cart sidebar — only visible lg+ */}
        <CartSidebar />
      </div>

      {/* Bottom nav — hidden on desktop where CartSidebar takes over */}
      <div className="lg:hidden">
        <BottomNav />
        <CallWaiterFAB className="bottom-28 right-6" />
      </div>

      {menuChatEnabled && (
        <>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="fixed bottom-40 right-6 z-50 h-14 w-14 rounded-full bg-primary text-on-primary shadow-luxury flex items-center justify-center"
            aria-label="Open menu chat"
          >
            <span className="material-symbols-outlined">chat_bubble</span>
          </button>
          {chatOpen && (
            <div className="fixed inset-x-0 bottom-20 z-[90] mx-auto h-[60vh] max-w-lg rounded-t-3xl border border-outline-variant/20 bg-surface-container-low shadow-2xl flex flex-col">
              <div className="flex items-center justify-between border-b border-outline-variant/10 p-4">
                <p className="text-sm font-bold uppercase tracking-widest text-on-surface">Menu AI</p>
                <button type="button" onClick={() => setChatOpen(false)} className="material-symbols-outlined text-on-surface-variant">close</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 p-4">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`max-w-[82%] rounded-2xl px-4 py-2 text-sm ${message.role === 'user' ? 'ml-auto bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}`}>
                    {message.content}
                  </div>
                ))}
                {chatLoading && <div className="text-xs text-on-surface-variant">Thinking...</div>}
              </div>
              {chatMessages.length === 0 && (
                <div className="flex flex-wrap gap-2 px-4 pb-3">
                  {['Something spicy under Rs. 300', 'Best-rated dish today', 'Recommend a dessert'].map(prompt => (
                    <button key={prompt} type="button" onClick={() => sendChat(prompt)} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 border-t border-outline-variant/10 p-4">
                <input
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') sendChat(); }}
                  className="min-w-0 flex-1 rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface focus:outline-none"
                  placeholder="Ask for a dish..."
                />
                <button type="button" onClick={() => sendChat()} className="rounded-xl bg-primary px-4 text-on-primary">
                  <span className="material-symbols-outlined">send</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <CartCTA />

      {/* Upsell Bottom Sheet */}
      {upsellModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-6">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-md" onClick={() => setUpsellModal({ ...upsellModal, isOpen: false })} />
          <div className="relative w-full max-w-xl bg-surface-container-low rounded-t-[2.5rem] sm:rounded-[2.5rem] border border-outline-variant/10 shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-500">
            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-primary text-lg">check_circle</span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Added to Cart</span>
                  </div>
                  <h3 className="font-headline text-2xl font-bold text-on-surface tracking-tight">{upsellModal.addedItemName}</h3>
                </div>
                <button 
                  onClick={() => setUpsellModal({ ...upsellModal, isOpen: false })}
                  className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="bg-primary/5 rounded-2xl p-4 mb-6 border border-primary/10">
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-primary text-xl">auto_awesome</span>
                  <p className="text-xs font-bold uppercase tracking-widest text-primary">Pairs perfectly with</p>
                </div>
                
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                  {modalRecommendations.map(item => (
                    <div key={item.id} className="flex-none w-32 bg-surface-container-high rounded-xl overflow-hidden border border-outline-variant/10 shadow-sm flex flex-col">
                      <div className="h-20 overflow-hidden">
                        <img 
                          src={getMenuImageUrl(item.image_url)} 
                          alt={item.name} 
                          loading="lazy" 
                          decoding="async" 
                          className="w-full h-full object-cover transition-opacity duration-300 opacity-0" 
                          onLoad={e => e.target.classList.remove('opacity-0')} 
                        />
                      </div>
                      <div className="p-3 flex flex-col flex-grow">
                        {guestProfile && Number(item.recommendation_score || 0) >= 70 && (
                          <span className="mb-2 w-max rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">
                            Recommended for you
                          </span>
                        )}
                        <h4 className="text-[11px] font-bold text-on-surface line-clamp-1 mb-1">{item.name}</h4>
                        <div className="mt-auto flex items-center justify-between">
                          <span className="text-primary font-bold text-[10px]">₹{item.price}</span>
                          <button 
                            onClick={() => { addItem(item); setUpsellModal({ ...upsellModal, isOpen: false }); }}
                            className="w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-xs">add</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => setUpsellModal({ ...upsellModal, isOpen: false })}
                className="w-full py-4 bg-surface-container-highest text-on-surface font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-outline-variant/20 transition-colors cursor-pointer"
              >
                Continue to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
