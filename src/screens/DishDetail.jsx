import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { fetchMenuItem } from '../lib/api';
import { CustomerTopNav } from '../components/TopNav';

export default function DishDetail() {
  const { dishId, restaurantSlug } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [dish, setDish] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMenuItem(dishId)
      .then(data => {
        setDish(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [dishId]);

  const handleAdd = () => {
    addItem(dish, qty);
    const checkoutPath = restaurantSlug ? `/r/${restaurantSlug}/checkout` : '/checkout';
    navigate(checkoutPath);
  };

  if (loading) return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
    </div>
  );

  if (error || !dish) return (
    <div className="min-h-dvh bg-background text-on-surface flex items-center justify-center p-6">
      <p className="text-error text-center">{error || 'Dish not found'}</p>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background text-on-surface selection:bg-primary-container/30 pb-32 md:pb-12 relative">
      <CustomerTopNav showBack={true} />

      <div className="flex flex-col md:flex-row md:items-start md:gap-12 max-w-7xl mx-auto md:px-12 md:pt-24">
        {/* ── Image/AR Section ────────────────────────── */}
        <div className="relative w-full aspect-square md:aspect-[4/3] md:w-1/2 md:rounded-3xl overflow-hidden md:shadow-2xl pt-16 md:pt-0">
          <img
            src={dish.image_url}
            alt={dish.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-90 md:from-black/60 md:via-black/20" />
          
          {/* AR Overlay Button — Coming Soon */}
          <button
            disabled
            title="AR view coming soon — stay tuned!"
            className="absolute bottom-6 right-6 md:bottom-8 md:right-8 glass-dark border border-white/10 text-on-surface/50 px-4 py-2.5 rounded-full flex items-center gap-2 backdrop-blur-2xl shadow-luxury z-10 cursor-not-allowed opacity-60"
          >
            <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>view_in_ar</span>
            <span className="text-[10px] font-bold uppercase tracking-widest pt-0.5">Coming Soon</span>
          </button>
        </div>

        {/* ── Content Body ──────────────────────────────────── */}
        <main className="px-6 -mt-8 md:mt-0 relative z-10 md:w-1/2 md:flex md:flex-col md:justify-center">
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mb-2 flex items-center gap-2">
              {dish.category?.name}
              {dish.dietary_flag === 'veg' && <span className="w-4 h-4 rounded border-2 border-green-500 bg-white flex items-center justify-center inline-block"><span className="w-2 h-2 rounded-full bg-green-500 block" /></span>}
              {dish.dietary_flag === 'non-veg' && <span className="w-4 h-4 rounded border-2 border-red-500 bg-white flex items-center justify-center inline-block"><span className="w-2 h-2 rounded-full bg-red-500 block" /></span>}
              {dish.dietary_flag === 'vegan' && <span className="w-4 h-4 rounded border-2 border-green-600 bg-white flex items-center justify-center inline-block"><span className="w-2 h-2 rounded-full bg-green-600 block" /></span>}
            </div>
            <h1 className="font-headline text-3xl md:text-5xl font-bold text-on-surface leading-tight mb-2">
              {dish.name}
            </h1>
            <div className="text-3xl md:text-4xl font-headline text-primary mt-4 md:mt-6">
              ₹{dish.price}
            </div>
          </div>

          <div className="prose prose-invert mb-8 md:text-lg">
            <p className="text-on-surface-variant text-base md:text-lg leading-relaxed">
              {dish.description}
            </p>
          </div>

          {/* Tags */}
          {dish.tags_json && (() => {
            const tags = (() => { try { return JSON.parse(dish.tags_json); } catch { return []; } })();
            return tags.length > 0 ? (
              <div className="flex gap-2 mb-8 flex-wrap">
                {tags.map(tag => (
                  <span key={tag} className="text-[10px] uppercase tracking-widest font-bold px-3 py-1 bg-surface-container-high rounded-full text-on-surface-variant">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null;
          })()}

          {/* ── Fixed Bottom Action Bar (Becomes static on desktop) ───────────────────────── */}
          <div className="fixed bottom-0 left-0 w-full p-6 glass-bottom-dark rounded-t-3xl z-50 flex items-center justify-between gap-6 md:static md:bg-transparent md:backdrop-blur-none md:p-0 md:mt-8 md:justify-start md:border-none md:shadow-none">
            <div className="flex items-center gap-4 bg-surface-container-high md:bg-surface-container-low rounded-full px-2 py-1.5 border border-outline-variant/20 md:border-outline-variant md:scale-110 md:origin-left">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest active:bg-surface-container-highest transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <span className="font-bold text-lg text-on-surface w-4 text-center">{qty}</span>
              <button
                onClick={() => setQty(qty + 1)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest active:bg-surface-container-highest transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>

            <button
              onClick={handleAdd}
              className="flex-1 md:flex-none md:px-12 md:py-5 bg-primary text-on-primary py-4 rounded-full font-bold uppercase tracking-widest text-sm shadow-luxury transition-transform active:scale-95 flex justify-center items-center gap-2 cursor-pointer hover:bg-primary-fixed-dim"
            >
              Add to Order
              <span className="text-xs opacity-70 ml-2 font-headline italic">₹{(dish.price * qty).toFixed(2)}</span>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
