import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Razorpay from "razorpay";
import * as crypto from "crypto";
import cors from "cors";

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

// ─── Razorpay Configuration ──────────────────────────────────────────────────
// Set these via: firebase functions:config:set razorpay.key_id="rzp_..." razorpay.key_secret="..."
const getRazorpayInstance = () => {
  const config = functions.config();
  return new Razorpay({
    key_id: config.razorpay?.key_id || process.env.RAZORPAY_KEY_ID || "",
    key_secret: config.razorpay?.key_secret || process.env.RAZORPAY_KEY_SECRET || "",
  });
};

// CORS middleware
const corsHandler = cors({ origin: true });

// ─── Create Order ─────────────────────────────────────────────────────────────
// Called when user clicks "Buy Now" — creates a Razorpay order and stores it
export const createOrder = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { productId, buyerEmail, buyerName, buyerPhone } = req.body;

      if (!productId) {
        res.status(400).json({ error: "productId is required" });
        return;
      }

      // Fetch product from Firestore
      const productDoc = await db.collection("itinerary-products").doc(productId).get();
      if (!productDoc.exists) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      const product = productDoc.data()!;
      const amountInPaise = Math.round((product.discountedPrice || product.actualPrice) * 100);

      // Create Razorpay order
      const razorpay = getRazorpayInstance();
      const order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `orc_${productId}_${Date.now()}`,
        notes: {
          productId: productId,
          productTitle: product.title,
          buyerEmail: buyerEmail || "",
        },
      });

      // Store order in Firestore
      const orderData = {
        productId: productId,
        productTitle: product.title,
        razorpayOrderId: order.id,
        amount: amountInPaise,
        status: "created",
        buyerEmail: buyerEmail || "",
        buyerName: buyerName || "",
        buyerPhone: buyerPhone || "",
        pdfPath: product.pdfPath,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection("orders").doc(order.id).set(orderData);

      res.status(200).json({
        orderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        key: functions.config().razorpay?.key_id || process.env.RAZORPAY_KEY_ID || "",
        productTitle: product.title,
      });
    } catch (error: any) {
      console.error("createOrder error:", error);
      res.status(500).json({ error: error.message || "Failed to create order" });
    }
  });
});

// ─── Verify Payment ──────────────────────────────────────────────────────────
// Called after Razorpay checkout completes — verifies signature and returns download URL
export const verifyPayment = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        res.status(400).json({ error: "Missing payment details" });
        return;
      }

      // Verify signature using HMAC SHA256
      const keySecret = functions.config().razorpay?.key_secret || process.env.RAZORPAY_KEY_SECRET || "";
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        // Mark order as failed
        await db.collection("orders").doc(razorpay_order_id).update({
          status: "failed",
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(400).json({ error: "Payment verification failed — invalid signature" });
        return;
      }

      // Payment is authentic — fetch buyer details from Razorpay API (server-side)
      const razorpay = getRazorpayInstance();
      let buyerName = '';
      let buyerEmail = '';
      let buyerPhone = '';
      try {
        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        buyerName  = (payment as any).contact_name || (payment as any).name || '';
        buyerEmail = (payment as any).email || '';
        buyerPhone = (payment as any).contact || '';
      } catch (e) {
        // Non-fatal: buyer details not critical to complete the order
        console.warn('Could not fetch buyer details from Razorpay:', e);
      }

      // Update order status
      const orderDoc = await db.collection("orders").doc(razorpay_order_id).get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      const orderData = orderDoc.data()!;

      await db.collection("orders").doc(razorpay_order_id).update({
        status: "paid",
        razorpayPaymentId: razorpay_payment_id,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        // Save buyer details collected at checkout
        buyerName: buyerName || "",
        buyerEmail: buyerEmail || "",
        buyerPhone: buyerPhone || "",
      });

      // Generate a time-limited signed download URL (15 minutes)
      const pdfPath = orderData.pdfPath;
      let downloadUrl = "";

      if (pdfPath) {
        const bucket = storage.bucket();
        const file = bucket.file(pdfPath);

        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });
        downloadUrl = url;
      }

      res.status(200).json({
        success: true,
        downloadUrl: downloadUrl,
        productTitle: orderData.productTitle,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      });
    } catch (error: any) {
      console.error("verifyPayment error:", error);
      res.status(500).json({ error: error.message || "Payment verification failed" });
    }
  });
});

// ─── Get Download Link ───────────────────────────────────────────────────────
// Re-generates a download link for a paid order (if user needs to re-download)
export const getDownloadLink = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { orderId, paymentId } = req.body;

      if (!orderId || !paymentId) {
        res.status(400).json({ error: "orderId and paymentId are required" });
        return;
      }

      const orderDoc = await db.collection("orders").doc(orderId).get();
      if (!orderDoc.exists) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      const orderData = orderDoc.data()!;

      // Verify the order is paid and payment ID matches
      if (orderData.status !== "paid" || orderData.razorpayPaymentId !== paymentId) {
        res.status(403).json({ error: "Invalid or unpaid order" });
        return;
      }

      // Generate new signed URL
      const bucket = storage.bucket();
      const file = bucket.file(orderData.pdfPath);

      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
      });

      res.status(200).json({
        success: true,
        downloadUrl: url,
        productTitle: orderData.productTitle,
      });
    } catch (error: any) {
      console.error("getDownloadLink error:", error);
      res.status(500).json({ error: error.message || "Failed to generate download link" });
    }
  });
});
