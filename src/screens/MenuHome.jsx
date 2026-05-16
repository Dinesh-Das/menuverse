import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { CustomerTopNav } from '../components/TopNav';
import BottomNav from '../components/BottomNav';
import CartSidebar from '../components/CartSidebar';
import { fetchMenu } from '../lib/api';

export default function MenuHome() {
  const { restaurantSlug } = useParams();
  const { addItem, restaurantSlug: sessionSlug, setSession } = useCart();
  const navigate = useNavigate();
  const slug = restaurantSlug || sessionSlug || 'zaika-zindagi';

  const [restaurant, setRestaurant] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dietFilter, setDietFilter] = useState([]); // 'veg', 'vegan', 'non-veg'
  const [upsellModal, setUpsellModal] = useState({ isOpen: false, addedItemName: '' });
  const [upsellCandidates, setUpsellCandidates] = useState([]);

  useEffect(() => {
    fetchMenu(slug)
      .then(data => {
        setRestaurant(data.restaurant);
        setCategories(data.categories || []);
        
        // Prepare upsell candidates
        const candidates = (data.categories || []).filter(cat => {
          const name = cat.name.toLowerCase();
          return name.includes('sweet') || name.includes('liquid') || name.includes('beverage') || name.includes('dessert');
        }).flatMap(cat => cat.items);
        setUpsellCandidates(candidates);

        setLoading(false);

        // Seed context if missing (legacy route /menu)
        if (!sessionSlug && data.restaurant?.slug) {
          setSession({
            restaurantId: data.restaurant.id,
            restaurantSlug: data.restaurant.slug
          });
        }
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [slug, sessionSlug, setSession]);

  // Safe JSON parse helper for tags
  const parseTags = (json) => { try { return JSON.parse(json) || []; } catch { return []; } };

  const allItems = categories.flatMap(c => c.items);

  const filtered = allItems.filter(dish => {
    const catMatch = activeCategory === 'All' || categories.find(c => c.id === dish.category_id)?.name === activeCategory;
    const searchMatch = !search || dish.name.toLowerCase().includes(search.toLowerCase());
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

  const handleAddWithUpsell = (dish) => {
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
      <CustomerTopNav logo={restaurant?.logo_url} />

      {/* Desktop: side-by-side content + cart; Mobile: stacked */}
      <div className="flex" style={{ paddingTop: 'var(--nav-height)' }}>
        <main className="flex-1 min-w-0 pb-36 lg:pb-12 px-4 lg:px-8 xl:px-12 pt-8">

        {/* ── Hero Editorial ───────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-[2px] bg-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-primary">Est. 2024</span>
          </div>
          <h1 className="font-headline text-5xl font-bold tracking-tight text-on-surface mb-3 leading-tight">
            {restaurant?.name?.split(' - ')[0] || 'Zaika Zindagi'}{' '}
            <span className="text-primary italic block sm:inline">{restaurant?.name?.split(' - ')[1] || 'Taste of Life'}</span>
          </h1>
          <p className="text-on-surface-variant font-body text-sm max-w-[90%] leading-relaxed opacity-80 border-l-2 border-primary/20 pl-4">
            {restaurant?.description || 'Experience the fusion of high-end culinary art and immersive digital precision.'}
          </p>
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
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4 sticky top-20 bg-background/80 backdrop-blur-md z-40 -mx-4 px-4">
          {['All', ...categories.map(c => c.name)].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-none px-6 py-2 rounded-full font-bold text-xs uppercase tracking-widest transition-all cursor-pointer ${
                activeCategory === cat
                  ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary-container/20'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {cat}
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-4">
            {filtered.map(dish => (
              <div
                key={dish.id}
                className="bg-surface-container-low rounded-xl overflow-hidden flex flex-col cursor-pointer transition-all hover:shadow-xl hover:-translate-y-1 group"
                onClick={() => navigate(getDishPath(dish.id))}
              >
                <div className="h-48 overflow-hidden relative">
                  <img
                    src={dish.image_url}
                    alt={dish.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-dim/80 via-transparent to-transparent opacity-80" />
                  {dish.tags_json && parseTags(dish.tags_json).includes('popular') && (
                    <div className="absolute top-3 right-3 bg-primary text-on-primary px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-widest shadow-md">
                      Popular
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    {dish.dietary_flag === 'veg' && <span className="w-4 h-4 rounded border-2 border-green-500 bg-white flex items-center justify-center shadow-md"><span className="w-2 h-2 rounded-full bg-green-500 block" /></span>}
                    {dish.dietary_flag === 'non-veg' && <span className="w-4 h-4 rounded border-2 border-red-500 bg-white flex items-center justify-center shadow-md"><span className="w-2 h-2 rounded-full bg-red-500 block" /></span>}
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-grow">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-primary mb-1.5">
                    {categories.find(c => c.id === dish.category_id)?.name}
                  </div>
                  <h3 className="font-headline text-lg font-bold text-on-surface leading-tight mb-2">
                    {highlightText(dish.name, search)}
                  </h3>
                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-outline-variant/30">
                    <span className="text-primary font-headline text-lg font-bold">₹{dish.price}</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleAddWithUpsell(dish); }}
                      className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary hover:bg-primary hover:text-on-primary transition-colors cursor-pointer shadow-sm"
                    >
                      <span className="material-symbols-outlined text-xl">add</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </main>

        {/* Cart sidebar — only visible lg+ */}
        <CartSidebar />
      </div>

      {/* Bottom nav — hidden on desktop where CartSidebar takes over */}
      <div className="lg:hidden">
        <BottomNav />
      </div>

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
                  {upsellCandidates.slice(0, 6).map(item => (
                    <div key={item.id} className="flex-none w-32 bg-surface-container-high rounded-xl overflow-hidden border border-outline-variant/10 shadow-sm flex flex-col">
                      <div className="h-20 overflow-hidden">
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-3 flex flex-col flex-grow">
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
