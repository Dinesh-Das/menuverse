import React, { useState, createContext, useContext, useCallback } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', sub = '') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type, sub }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map(toast => (
          <Toast key={toast.id} {...toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

const ICONS = {
  success: 'cloud_done',
  info: 'info',
  error: 'error',
  alert: 'warning',
};

function Toast({ message, type, sub, onDismiss }) {
  return (
    <div
      className="pointer-events-auto flex items-start gap-3 bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-4 shadow-xl min-w-[280px] max-w-sm"
      style={{ animation: 'slideInRight 0.3s ease' }}
    >
      <span
        className={`material-symbols-outlined filled text-lg flex-shrink-0 mt-0.5 ${
          type === 'success' ? 'text-primary' : type === 'error' ? 'text-error' : 'text-tertiary'
        }`}
      >
        {ICONS[type] || 'info'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-on-surface">{message}</div>
        {sub && <div className="text-xs text-on-surface-variant mt-0.5">{sub}</div>}
      </div>
      <button onClick={onDismiss} className="material-symbols-outlined text-sm text-on-surface-variant hover:text-on-surface cursor-pointer flex-shrink-0">
        close
      </button>
    </div>
  );
}

// CSS animation to inject
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
`;
document.head.appendChild(style);
