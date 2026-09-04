const crypto = require("crypto");

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifyStripeSignature(payload, signature, secret) {
  const parts = signature.split(",");

  const timestamp = parts
    .find(p => p.startsWith("t="))
    ?.slice(2);

  const signatures = parts
    .filter(p => p.startsWith("v1="))
    .map(p => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);

  if (Math.abs(age) > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(sig)
      );
    } catch {
      return false;
    }
  });
}

async function stripeRequest(path) {
  const key = process.env.STRIPE_SECRET_KEY;

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${key}:`).toString("base64")
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are missing");
  }

  const response = await fetch(
    `${url}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response;
}

async function getCustomerEmail(customerId) {
  if (!customerId) return null;

  try {
    const customer = await stripeRequest(
      `customers/${encodeURIComponent(customerId)}`
    );

    return customer.email || null;
  } catch {
    return null;
  }
}

async function getExistingEmail(subscriptionId) {
  try {
    const response = await supabaseRequest(
      `subscriptions?stripe_subscription_id=eq.${encodeURIComponent(
        subscriptionId
      )}&select=email&limit=1`,
      {
        method: "GET"
      }
    );

    const rows = await response.json();

    return rows[0]?.email || null;
  } catch {
    return null;
  }
}

async function saveSubscription({
  email,
  customerId,
  subscriptionId,
  status,
  currentPeriodEnd
}) {
  if (!subscriptionId) {
    throw new Error("Missing Stripe subscription ID");
  }

  let finalEmail = email;

  if (!finalEmail) {
    finalEmail = await getCustomerEmail(customerId);
  }

  if (!finalEmail) {
    finalEmail = await getExistingEmail(subscriptionId);
  }

  if (!finalEmail) {
    throw new Error(
      "Could not determine customer email"
    );
  }

  await supabaseRequest(
    "subscriptions?on_conflict=stripe_subscription_id",
    {
      method: "POST",
      headers: {
        Prefer:
          "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([
        {
          email: finalEmail,
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subscriptionId,
          status: status || "pending",
          current_period_end: currentPeriodEnd
            ? new Date(
                currentPeriodEnd * 1000
              ).toISOString()
            : null,
          updated_at: new Date().toISOString()
        }
      ])
    }
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed" });
  }

  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({
      error:
        "Stripe webhook secret is not configured"
    });
  }

  try {
    const payload = await getRawBody(req);
    const signature =
      req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Missing Stripe signature"
      });
    }

    const valid = verifyStripeSignature(
      payload,
      signature,
      webhookSecret
    );

    if (!valid) {
      return res.status(400).json({
        error: "Invalid Stripe signature"
      });
    }

    const event = JSON.parse(payload);
    const object = event.data?.object;

    console.log(
      "Stripe event received:",
      event.type
    );

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      if (object?.mode === "subscription") {
        const subscriptionId =
          typeof object.subscription === "string"
            ? object.subscription
            : object.subscription?.id;

        const customerId =
          typeof object.customer === "string"
            ? object.customer
            : object.customer?.id;

        let status = "pending";
        let currentPeriodEnd = null;

        if (subscriptionId) {
          try {
            const subscription =
              await stripeRequest(
                `subscriptions/${encodeURIComponent(
                  subscriptionId
                )}`
              );

            status = subscription.status;
            currentPeriodEnd =
              subscription.current_period_end;
          } catch (error) {
            console.error(
              "Could not retrieve subscription:",
              error
            );
          }
        }

        await saveSubscription({
          email:
            object.customer_details?.email ||
            object.customer_email ||
            null,
          customerId,
          subscriptionId,
          status,
          currentPeriodEnd
        });
      }
    }

    if (
      event.type ===
        "customer.subscription.created" ||
      event.type ===
        "customer.subscription.updated"
    ) {
      const subscriptionId = object?.id;

      const customerId =
        typeof object.customer === "string"
          ? object.customer
          : object.customer?.id;

      await saveSubscription({
        email: null,
        customerId,
        subscriptionId,
        status: object.status,
        currentPeriodEnd:
          object.current_period_end
      });
    }

    if (
      event.type ===
      "customer.subscription.deleted"
    ) {
      const subscriptionId = object?.id;

      const customerId =
        typeof object.customer === "string"
          ? object.customer
          : object.customer?.id;

      await saveSubscription({
        email: null,
        customerId,
        subscriptionId,
        status: "canceled",
        currentPeriodEnd:
          object.current_period_end
      });
    }

    return res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return res.status(400).json({
      error: "Webhook processing failed"
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
