import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useToast } from './Toast';
import { createStaffRequest } from '../lib/api';

const WAITER_COOLDOWN_MS = 60_000;
const REQUEST_TYPES = [
  { type: 'waiter', label: 'Waiter', icon: 'room_service' },
  { type: 'water', label: 'Water', icon: 'water_drop' },
  { type: 'bill', label: 'Bill', icon: 'receipt_long' },
  { type: 'other', label: 'Other', icon: 'more_horiz' },
];

export default function CallWaiterFAB({ className = 'bottom-24 right-6' }) {
  const { tableId, tableNumber, restaurantId, tableSessionToken } = useCart();
  const { addToast } = useToast();
  const [requestState, setRequestState] = useState('idle'); // idle, requesting, success
  const [isOpen, setIsOpen] = useState(false);

  const handleStaffRequest = async (requestType) => {
    setRequestState('requesting');
    
    try {
      const lastRequestTime = Number(localStorage.getItem('mv_last_waiter_request') || 0);
      if (Date.now() - lastRequestTime < WAITER_COOLDOWN_MS) {
        throw new Error('Please wait a minute before calling again.');
      }
      const message = requestType === 'other'
        ? window.prompt('What do you need help with?')?.trim()
        : null;
      if (requestType === 'other' && !message) {
        setRequestState('idle');
        return;
      }
      await createStaffRequest({ restaurantId, tableId, tableSessionToken, requestType, message });
      localStorage.setItem('mv_last_waiter_request', String(Date.now()));
      setIsOpen(false);
      setRequestState('success');
      setTimeout(() => setRequestState('idle'), 3000);
    } catch (e) {
      console.error(e);
      addToast(e.message || 'Failed to call waiter. Try again.', 'error');
      setRequestState('idle');
    }
  };

  if (!tableNumber) return null; // Don't show if no table is selected

  return (
    <div className={`fixed z-40 ${className}`}>
      {isOpen && requestState === 'idle' && (
        <div className="absolute bottom-16 right-0 w-44 rounded-2xl bg-surface-container-highest border border-outline-variant/20 shadow-2xl overflow-hidden p-2">
          {REQUEST_TYPES.map(option => (
            <button
              key={option.type}
              onClick={() => handleStaffRequest(option.type)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-colors"
            >
              <span className="material-symbols-outlined text-lg">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => requestState === 'idle' && setIsOpen(open => !open)}
        disabled={requestState !== 'idle'}
        className={`w-14 h-14 rounded-full shadow-luxury flex items-center justify-center transition-all duration-300 ${
          requestState === 'success' 
            ? 'bg-green-500 text-white scale-110' 
            : 'bg-surface-container-highest text-on-surface hover:bg-primary hover:text-on-primary'
        }`}
        aria-label="Call Waiter"
      >
        <span className="material-symbols-outlined text-2xl">
          {requestState === 'success' ? 'check' : requestState === 'requesting' ? 'hourglass_empty' : isOpen ? 'close' : 'room_service'}
        </span>
      </button>
    </div>
  );
}
