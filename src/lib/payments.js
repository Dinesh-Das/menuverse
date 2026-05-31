const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

let razorpayScriptPromise = null;
let stripeScriptPromise = null;

export function getWalletPaymentLabel(walletPayReady = null, provider = 'razorpay') {
  if (walletPayReady) {
    return { headline: 'Pay another way', detail: 'Apple Pay or Google Pay is available above' };
  }
  if (provider === 'stripe') {
    return { headline: 'Pay by Card or Wallet', detail: 'Apple Pay, Google Pay and cards through Stripe' };
  }
  if (typeof navigator === 'undefined') {
    return { headline: 'Secure Digital Pay', detail: 'UPI, wallets, cards and netbanking' };
  }

  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|macintosh/.test(ua)) {
    return { headline: 'Pay with UPI, Card or Netbanking', detail: 'Wallet options are shown inside Razorpay when available' };
  }
  if (/android/.test(ua)) {
    return { headline: 'Pay with UPI, Card or Netbanking', detail: 'Wallet options are shown inside Razorpay when available' };
  }
  return { headline: 'Pay by UPI, Wallet or Card', detail: 'Secure checkout through Razorpay' };
}

export function humanizePaymentFailure(error, providerName = 'Digital') {
  const raw = `${error?.code || ''} ${error?.reason || ''} ${error?.description || ''} ${error?.message || error || ''}`.toLowerCase();
  if (raw.includes('card_declined') || raw.includes('card declined') || raw.includes('declined')) {
    return 'Your card was declined. Try another card or pay at the counter.';
  }
  if (raw.includes('insufficient') || raw.includes('fund')) {
    return 'The payment method does not have enough funds. Try another method or pay at the counter.';
  }
  if (raw.includes('upi') && (raw.includes('timeout') || raw.includes('timed out'))) {
    return 'The UPI request timed out. You can retry after dismissing this message or pay at the counter.';
  }
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('load') || raw.includes('offline')) {
    return 'A network issue interrupted checkout. Check your connection or pay at the counter.';
  }
  if (raw.includes('dismiss') || raw.includes('cancel')) {
    return `${providerName} checkout was closed before payment finished. You can retry or pay at the counter.`;
  }
  return `${providerName} payment could not be completed. You can retry or pay at the counter.`;
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

export function loadStripeJs() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Stripe checkout can only run in a browser.'));
  }
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeScriptPromise) return stripeScriptPromise;

  stripeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Unable to load Stripe Checkout.'));
    document.body.appendChild(script);
  });

  return stripeScriptPromise;
}

/**
 * Creates a Stripe PaymentRequest object for Apple Pay / Google Pay.
 * Returns null if the browser cannot show a native wallet button.
 */
export async function createStripePaymentRequest({
  publishableKey,
  amountPaise,
  currency,
  restaurantName,
  onSuccess,
  onDismiss,
}) {
  const Stripe = await loadStripeJs();
  const stripe = Stripe(publishableKey);

  const paymentRequest = stripe.paymentRequest({
    country: currency === 'inr' ? 'IN' : 'US',
    currency: currency.toLowerCase(),
    total: { label: restaurantName || 'Menuverse', amount: amountPaise },
    requestPayerName: false,
    requestPayerEmail: false,
  });

  const canMakePayment = await paymentRequest.canMakePayment();
  if (!canMakePayment) return null;

  paymentRequest.on('paymentmethod', async (ev) => {
    if (onSuccess) onSuccess(ev);
  });

  paymentRequest.on('cancel', () => {
    if (onDismiss) onDismiss();
  });

  const elements = stripe.elements();
  return { paymentRequest, elements, stripe };
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

export async function openStripeCheckout({
  clientSecret,
  publishableKey,
  onSuccess,
  onDismiss,
}) {
  const Stripe = await loadStripeJs();
  if (!clientSecret || !publishableKey) {
    throw new Error('Stripe checkout is missing client details.');
  }

  const stripe = Stripe(publishableKey);
  const elements = stripe.elements({ clientSecret, appearance: { theme: 'night' } });

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'background:rgba(10,10,15,0.82)',
      'backdrop-filter:blur(12px)',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(100%,420px)',
      'background:#17130d',
      'color:#f8f1e7',
      'border:1px solid rgba(184,134,11,0.24)',
      'border-radius:28px',
      'box-shadow:0 24px 80px rgba(0,0,0,0.45)',
      'padding:24px',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;">
        <div>
          <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.18em;color:#c8a24a;font-weight:700;">Menuverse</p>
          <h2 style="margin:0;font-size:20px;line-height:1.2;">Secure Payment</h2>
        </div>
        <button type="button" data-close style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:transparent;color:#f8f1e7;cursor:pointer;font-size:20px;">&times;</button>
      </div>
      <form data-form>
        <div data-payment-element></div>
        <p data-error style="min-height:18px;margin:12px 0 0;color:#ffb4ab;font-size:13px;"></p>
        <button type="submit" data-submit style="width:100%;margin-top:18px;border:0;border-radius:16px;padding:14px 18px;background:#B8860B;color:#160f05;font-weight:800;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;">Pay Securely</button>
      </form>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const paymentElement = elements.create('payment');
    paymentElement.mount(panel.querySelector('[data-payment-element]'));

    const cleanup = () => {
      paymentElement.unmount();
      overlay.remove();
    };

    panel.querySelector('[data-close]').addEventListener('click', () => {
      cleanup();
      onDismiss?.();
      resolve(false);
    });

    panel.querySelector('[data-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = panel.querySelector('[data-submit]');
      const errorBox = panel.querySelector('[data-error]');
      button.disabled = true;
      button.textContent = 'Processing...';
      errorBox.textContent = '';

      try {
        const submitResult = await elements.submit();
        if (submitResult.error) throw new Error(submitResult.error.message);

        const result = await stripe.confirmPayment({
          elements,
          clientSecret,
          redirect: 'if_required',
        });
        if (result.error) throw new Error(result.error.message);

        cleanup();
        onSuccess?.(result.paymentIntent);
        resolve(result.paymentIntent);
      } catch (err) {
        errorBox.textContent = err?.message || 'Payment could not be completed.';
        button.disabled = false;
        button.textContent = 'Pay Securely';
      }
    });
  });
}
