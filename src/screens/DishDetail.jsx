import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { fetchMenuItem } from '../lib/api';
import { CustomerTopNav } from '../components/TopNav';

const MAX_QTY = 20;

export default function DishDetail() {
  const { dishId } = useParams();
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [dish, setDish] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedModifiers, setSelectedModifiers] = useState({});
  const [addedFeedback, setAddedFeedback] = useState(false);

  useEffect(() => {
    fetchMenuItem(dishId)
      .then(data => {
        setDish(data);
        // Initialize selected modifiers for required groups
        const initial = {};
        (data.modifier_groups || []).forEach(group => {
          initial[group.id] = null;
        });
        setSelectedModifiers(initial);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [dishId]);

  // Check if all required modifier groups have selections
  const requiredGroups = useMemo(() =>
    (dish?.modifier_groups || []).filter(g => g.required),
    [dish]
  );
  const allRequiredSelected = useMemo(() =>
    requiredGroups.every(g => selectedModifiers[g.id] != null),
    [requiredGroups, selectedModifiers]
  );

  // Build the modifiers array for the cart
  const modifiersForCart = useMemo(() => {
    return Object.values(selectedModifiers)
      .filter(Boolean)
      .map(opt => ({ id: opt.id, name: opt.name, price_delta: opt.price_delta || 0 }));
  }, [selectedModifiers]);

  // Modifier price contribution
  const modsPrice = modifiersForCart.reduce((sum, m) => sum + (m.price_delta || 0), 0);

  const handleSelectModifier = (groupId, option) => {
    setSelectedModifiers(prev => ({
      ...prev,
      [groupId]: prev[groupId]?.id === option.id ? null : option,
    }));
  };

  const handleAdd = () => {
    if (!dish?.available) return;
    if (!allRequiredSelected) return;
    addItem(dish, qty, modifiersForCart);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 2000);
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

  const hasModifiers = (dish.modifier_groups || []).length > 0;
  const isUnavailable = !dish.available;
  const unitPrice = dish.price + modsPrice;

  return (
    <div className="min-h-dvh bg-background text-on-surface selection:bg-primary-container/30 pb-32 md:pb-12 relative">
      <CustomerTopNav showBack={true} />

      <div className="flex flex-col md:flex-row md:items-start md:gap-12 max-w-7xl mx-auto md:px-12 md:pt-24">
        {/* ── Image/AR Section ────────────────────────── */}
        <div className={`relative w-full aspect-square md:aspect-[4/3] md:w-1/2 md:rounded-3xl overflow-hidden md:shadow-2xl pt-16 md:pt-0 ${isUnavailable ? 'grayscale opacity-70' : ''}`}>
          <img
            src={dish.image_url}
            alt={dish.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-90 md:from-black/60 md:via-black/20" />
          {isUnavailable && (
            <div className="absolute inset-0 bg-background/40 flex items-center justify-center z-20">
              <span className="bg-surface-container-highest text-on-surface-variant px-5 py-2 rounded-full font-bold uppercase tracking-widest text-xs shadow-lg border border-outline-variant/30">
                Unavailable
              </span>
            </div>
          )}
          
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
              {modsPrice > 0 && <span className="text-base text-on-surface-variant ml-2">(+₹{modsPrice})</span>}
            </div>
          </div>

          <div className="prose prose-invert mb-6 md:text-lg">
            <p className="text-on-surface-variant text-base md:text-lg leading-relaxed">
              {dish.description}
            </p>
          </div>

          {/* Tags */}
          {dish.tags_json && (() => {
            const tags = (() => { try { return JSON.parse(dish.tags_json); } catch { return []; } })();
            return tags.length > 0 ? (
              <div className="flex gap-2 mb-6 flex-wrap">
                {tags.map(tag => (
                  <span key={tag} className="text-[10px] uppercase tracking-widest font-bold px-3 py-1 bg-surface-container-high rounded-full text-on-surface-variant">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null;
          })()}

          {/* ── Modifier Groups (CB-6) ──────────────────────────── */}
          {hasModifiers && (
            <div className="mb-8 space-y-6">
              {dish.modifier_groups.map(group => (
                <div key={group.id}>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-[10px] md:text-xs uppercase font-bold tracking-[0.2em] text-on-surface-variant">
                      {group.name}
                    </h3>
                    {group.required && (
                      <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-error/10 text-error border border-error/20">
                        Required
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(group.options || []).map(option => {
                      const isSelected = selectedModifiers[group.id]?.id === option.id;
                      return (
                        <button
                          key={option.id}
                          onClick={() => handleSelectModifier(group.id, option)}
                          disabled={isUnavailable}
                          className={`px-4 py-2.5 rounded-full text-sm font-bold transition-all cursor-pointer border disabled:cursor-not-allowed disabled:opacity-50 ${
                            isSelected
                              ? 'bg-primary text-on-primary border-primary shadow-md scale-105'
                              : 'bg-surface-container-high text-on-surface-variant border-outline-variant/20 hover:border-primary/50 hover:bg-surface-container-highest'
                          }`}
                        >
                          {option.name}
                          {option.price_delta > 0 && (
                            <span className={`ml-1 text-xs ${isSelected ? 'text-on-primary/70' : 'text-primary'}`}>
                              +₹{option.price_delta}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {group.required && !selectedModifiers[group.id] && (
                    <p className="text-[10px] text-error mt-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">warning</span>
                      Please select a {group.name.toLowerCase()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Fixed Bottom Action Bar (Becomes static on desktop) ───────────────────────── */}
          <div className="fixed bottom-0 left-0 w-full p-6 glass-bottom-dark rounded-t-3xl z-50 flex items-center justify-between gap-6 md:static md:bg-transparent md:backdrop-blur-none md:p-0 md:mt-8 md:justify-start md:border-none md:shadow-none">
            <div className="flex items-center gap-4 bg-surface-container-high md:bg-surface-container-low rounded-full px-2 py-1.5 border border-outline-variant/20 md:border-outline-variant md:scale-110 md:origin-left">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                disabled={isUnavailable}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest active:bg-surface-container-highest transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <span className="font-bold text-lg text-on-surface w-4 text-center">{qty}</span>
              <button
                onClick={() => setQty(Math.min(MAX_QTY, qty + 1))}
                disabled={isUnavailable}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest active:bg-surface-container-highest transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>

            <button
              onClick={handleAdd}
              disabled={isUnavailable || !allRequiredSelected || addedFeedback}
              className={`flex-1 md:flex-none md:px-12 md:py-5 py-4 rounded-full font-bold uppercase tracking-widest text-sm shadow-luxury transition-all duration-300 flex justify-center items-center gap-2 ${
                addedFeedback 
                  ? 'bg-green-500 text-white shadow-green-500/30'
                  : isUnavailable
                    ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed opacity-60'
                  : allRequiredSelected
                    ? 'bg-primary text-on-primary hover:bg-primary-fixed-dim active:scale-95 cursor-pointer'
                    : 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed opacity-60'
              }`}
            >
              {addedFeedback ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  Added to Order!
                </>
              ) : isUnavailable ? (
                'Unavailable'
              ) : allRequiredSelected ? (
                <>Add to Order <span className="text-xs opacity-70 ml-2 font-headline italic">₹{(unitPrice * qty).toFixed(2)}</span></>
              ) : (
                'Select Options'
              )}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
