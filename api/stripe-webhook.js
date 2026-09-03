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
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    return res.status(500).json({
      error: "Stripe webhook secret is not configured"
    });
  }

  try {
    const payload = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Missing Stripe signature"
      });
    }

    const valid = verifyStripeSignature(
      payload,
      signature,
      secret
    );

    if (!valid) {
      return res.status(400).json({
        error: "Invalid Stripe signature"
      });
    }

    const event = JSON.parse(payload);

    console.log("Stripe event received:", event.type);

    return res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      error: "Invalid webhook request"
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
