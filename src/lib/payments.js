const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let razorpayScriptPromise = null;

export function getWalletPaymentLabel() {
  if (typeof navigator === 'undefined') {
    return { headline: 'Secure Digital Pay', detail: 'UPI, wallets, cards and netbanking' };
  }

  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|macintosh/.test(ua)) {
    return { headline: 'Pay with Apple Pay, UPI or Card', detail: 'Fast checkout through Razorpay' };
  }
  if (/android/.test(ua)) {
    return { headline: 'Pay with Google Pay, UPI or Card', detail: 'Fast checkout through Razorpay' };
  }
  return { headline: 'Pay by UPI, Wallet or Card', detail: 'Secure checkout through Razorpay' };
}

export function loadRazorpayCheckout() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout can only run in a browser.'));
  }
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout.'));
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

export async function openRazorpayCheckout({
  paymentOrder,
  restaurantName,
  tableNumber,
  onSuccess,
  onDismiss,
}) {
  await loadRazorpayCheckout();
  if (!paymentOrder?.key_id || !paymentOrder?.razorpay_order_id) {
    throw new Error('Payment order is missing Razorpay checkout details.');
  }

  const checkout = new window.Razorpay({
    key: paymentOrder.key_id,
    amount: paymentOrder.amount,
    currency: paymentOrder.currency || 'INR',
    name: restaurantName || 'Menuverse',
    description: tableNumber ? `Table ${tableNumber} bill` : 'Table bill',
    order_id: paymentOrder.razorpay_order_id,
    method: {
      card: true,
      netbanking: true,
      wallet: true,
      upi: true,
    },
    theme: {
      color: '#B8860B',
    },
    notes: {
      table_number: tableNumber || '',
    },
    handler(response) {
      onSuccess?.(response);
    },
    modal: {
      ondismiss() {
        onDismiss?.();
      },
    },
  });

  checkout.open();
}
