import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';

export default function CallWaiterFAB({ className = 'bottom-24 right-6' }) {
  const { tableId, tableNumber, restaurantId } = useCart();
  const { addToast } = useToast();
  const [requestState, setRequestState] = useState('idle'); // idle, requesting, success

  const handleCallWaiter = async () => {
    setRequestState('requesting');
    
    try {
      const { error } = await supabase.from('StaffRequest').insert({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        table_id: tableId,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      setRequestState('success');
      setTimeout(() => setRequestState('idle'), 3000);
    } catch (e) {
      console.error(e);
      addToast('Failed to call waiter. Try again.', 'error');
      setRequestState('idle');
    }
  };

  if (!tableNumber) return null; // Don't show if no table is selected

  return (
    <div className={`fixed z-40 ${className}`}>
      <button
        onClick={handleCallWaiter}
        disabled={requestState !== 'idle'}
        className={`w-14 h-14 rounded-full shadow-luxury flex items-center justify-center transition-all duration-300 ${
          requestState === 'success' 
            ? 'bg-green-500 text-white scale-110' 
            : 'bg-surface-container-highest text-on-surface hover:bg-primary hover:text-on-primary'
        }`}
        aria-label="Call Waiter"
      >
        <span className="material-symbols-outlined text-2xl">
          {requestState === 'success' ? 'check' : requestState === 'requesting' ? 'hourglass_empty' : 'room_service'}
        </span>
      </button>
    </div>
  );
}
