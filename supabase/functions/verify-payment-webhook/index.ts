import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!webhookSecret) {
    return Response.json({ error: 'Payment webhook is not configured.' }, { status: 503 });
  }

  // TODO: Verify x-razorpay-signature with HMAC SHA256 over the raw body.
  // After verification, update Payment/SessionBill with the service role key only.
  return Response.json({
    status: 'configuration_required',
    message: 'Webhook signature verification and payment settlement must be completed before enabling live payments.',
  });
});
