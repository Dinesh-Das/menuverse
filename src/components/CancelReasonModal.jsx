import React, { useState } from 'react';

export default function CancelReasonModal({ isOpen, onConfirm, onCancel, orderId }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError('Please provide a reason for cancellation.');
      return;
    }
    onConfirm(reason.trim());
    setReason('');
    setError(null);
  };

  const handleClose = () => {
    setReason('');
    setError(null);
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-md p-8 bg-surface-container-low border border-outline-variant/10 shadow-luxury rounded-[2rem] animate-in zoom-in duration-300">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-error">cancel</span>
          </div>
          <div>
            <h3 className="font-headline text-lg font-bold text-on-surface">Cancel Order</h3>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">{orderId}</p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-[10px] uppercase font-bold tracking-[0.15em] text-on-surface-variant mb-2">
            Cancellation Reason
          </label>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setError(null); }}
            placeholder="e.g., Customer changed mind, item out of stock..."
            className="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl p-4 text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-error/50 transition-colors resize-none h-24"
            autoFocus
          />
          {error && (
            <p className="text-xs text-error mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-xs">warning</span>
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-widest border border-outline-variant/30 text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          >
            Go Back
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-widest bg-error text-white hover:bg-error/90 transition-colors cursor-pointer active:scale-95"
          >
            Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
