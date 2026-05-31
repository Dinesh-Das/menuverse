import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function CartCTA() {
  const navigate = useNavigate();
  const { count, total, restaurantSlug } = useCart();
  const checkoutPath = restaurantSlug ? `/r/${restaurantSlug}/checkout` : '/checkout';

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-[84px] left-4 right-4 z-50 md:hidden"
        >
          <button
            type="button"
            onClick={() => navigate(checkoutPath)}
            aria-label={`View cart with ${count} ${count === 1 ? 'item' : 'items'}`}
            className="w-full bg-primary text-on-primary px-4 py-3 rounded-2xl shadow-luxury flex items-center justify-between hover:bg-primary-fixed-dim transition-colors active:scale-95 cursor-pointer border border-primary/20"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-on-primary/20 rounded-full flex items-center justify-center">
                <span className="font-bold text-sm">{count}</span>
              </div>
              <span className="font-bold text-sm">{count === 1 ? 'item' : 'items'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">&#8377;{total.toFixed(2)}</span>
              <span className="font-bold text-sm uppercase tracking-widest">View Cart</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
