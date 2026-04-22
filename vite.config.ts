import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── Razorpay Local Dev Config ─────────────────────────────────────────────────
// These are used ONLY by the Vite dev server to simulate Cloud Functions locally.
// The key_secret NEVER reaches the browser — it stays in the Node.js server process.
const RAZORPAY_KEY_ID = process.env.VITE_RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RAZORPAY_KEY_SECRET && !process.env.CI) {
  console.warn('⚠️ RAZORPAY_KEY_SECRET is missing in environment variables. Local testing will fail.');
}

export default defineConfig({
  // Use '/' for Firebase Hosting (root level)
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        amazonStore: resolve(__dirname, 'amazon-store/index.html'),
        admin:       resolve(__dirname, 'admin/index.html'),
        mediaKit:    resolve(__dirname, 'media-kit/index.html'),
        itineraries: resolve(__dirname, 'itineraries/index.html')
      },
    },
  },
  plugins: [
    {
      name: 'local-api',
      configureServer(server) {
        // ─── Helper: parse JSON body from request ─────────────────────────
        function parseBody(req: any): Promise<any> {
          return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk: string) => { body += chunk; });
            req.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch (e) { reject(e); }
            });
          });
        }

        // ─── Helper: send JSON response ───────────────────────────────────
        function sendJson(res: any, status: number, data: any) {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(data));
        }

        server.middlewares.use(async (req: any, res: any, next: any) => {

          // ─── CORS preflight ─────────────────────────────────────────────
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 204;
            res.end();
            return;
          }

          // ─── Admin Route Rewrite ─────────────────────────────────────────
          // If the user requests /admin or /admin/, serve admin/index.html
          // This prevents Vite from defaulting to the root index.html
          if (req.url === '/admin' || req.url === '/admin/') {
            const adminHtml = fs.readFileSync(resolve(__dirname, 'admin/index.html'), 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(adminHtml);
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // POST /createOrder — Create a Razorpay order for local testing
          // ═══════════════════════════════════════════════════════════════
          if (req.url === '/createOrder' && req.method === 'POST') {
            try {
              const { default: Razorpay } = await import('razorpay');
              const data = await parseBody(req);
              const { productId, buyerName, buyerEmail, buyerPhone } = data;

              if (!productId) {
                sendJson(res, 400, { error: 'productId is required' });
                return;
              }

              // In local dev, we fetch from Firestore via the Firebase JS SDK
              // Since the Vite server can't easily use Firestore Admin SDK,
              // we read product info from the request or use a simple lookup.
              // For local dev, we'll accept amount from the client as a shortcut.
              // (In production, Cloud Functions fetch from Firestore server-side.)

              // Read products from Firestore via REST API (public read)
              const firestoreUrl = `https://firestore.googleapis.com/v1/projects/onroadcouple-store/databases/(default)/documents/itinerary-products/${productId}`;
              const productRes = await fetch(firestoreUrl);
              
              let productTitle = 'Itinerary';
              let amountInPaise = 9900; // default ₹99
              let pdfPath = '';

              if (productRes.ok) {
                const productDoc = await productRes.json();
                const fields = productDoc.fields || {};
                productTitle = fields.title?.stringValue || productTitle;
                const discountedPrice = parseInt(fields.discountedPrice?.integerValue || fields.discountedPrice?.doubleValue || '99', 10);
                amountInPaise = discountedPrice * 100;
                pdfPath = fields.pdfPath?.stringValue || '/itineraries/hampi-itinerary.pdf'; 
              }

              // Create Razorpay order
              const razorpay = new Razorpay({
                key_id: RAZORPAY_KEY_ID,
                key_secret: RAZORPAY_KEY_SECRET,
              });

              const order = await razorpay.orders.create({
                amount: amountInPaise,
                currency: 'INR',
                receipt: `dev_${productId}_${Date.now()}`,
                notes: {
                  productId: productId,
                  productTitle: productTitle,
                  environment: 'local-dev',
                },
              });

              // Store order info locally (in-memory for dev)
              const ordersFile = resolve(__dirname, '.dev-orders.json');
              let orders: any = {};
              if (fs.existsSync(ordersFile)) {
                orders = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
              }
              orders[order.id] = {
                productId,
                productTitle,
                amount: amountInPaise,
                pdfPath,
                status: 'created',
                buyerName: buyerName || '',
                buyerEmail: buyerEmail || '',
                buyerPhone: buyerPhone || '',
                createdAt: new Date().toISOString(),
              };
              fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

              console.log(`✅ [Dev] Created Razorpay order: ${order.id} for ₹${amountInPaise / 100}`);

              sendJson(res, 200, {
                orderId: order.id,
                amount: amountInPaise,
                currency: 'INR',
                key: RAZORPAY_KEY_ID,
                productTitle,
              });
            } catch (err: any) {
              console.error('❌ [Dev] createOrder error:', err);
              sendJson(res, 500, { error: err.message || 'Failed to create order' });
            }
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // POST /verifyPayment — Verify Razorpay signature locally
          // ═══════════════════════════════════════════════════════════════
          if (req.url === '/verifyPayment' && req.method === 'POST') {
            try {
              const data = await parseBody(req);
              const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

              if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
                sendJson(res, 400, { error: 'Missing payment details' });
                return;
              }

              // Verify HMAC signature
              const expectedSignature = crypto
                .createHmac('sha256', RAZORPAY_KEY_SECRET)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

              if (expectedSignature !== razorpay_signature) {
                console.error('❌ [Dev] Signature mismatch!');
                sendJson(res, 400, { error: 'Payment verification failed — invalid signature' });
                return;
              }

              // Update local order record
              const ordersFile = resolve(__dirname, '.dev-orders.json');
              let orders: any = {};
              if (fs.existsSync(ordersFile)) {
                orders = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
              }
              if (orders[razorpay_order_id]) {
                orders[razorpay_order_id].status = 'paid';
                orders[razorpay_order_id].paymentId = razorpay_payment_id;
                orders[razorpay_order_id].paidAt = new Date().toISOString();
                fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
              }

              console.log(`✅ [Dev] Payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);

              // Use the pdfPath stored at order creation time (set from Firestore product data)
              const orderData = orders[razorpay_order_id] || {};
              let pdfPath = orderData.pdfPath || '';

              // Validate the pdfPath actually exists on disk
              if (pdfPath) {
                const absolutePdfPath = resolve(__dirname, 'public', pdfPath.replace(/^\//, ''));
                if (!fs.existsSync(absolutePdfPath)) {
                  console.warn(`⚠️ [Dev] PDF not found at: ${absolutePdfPath}, scanning public/itineraries/...`);
                  // Fallback: find any PDF in public/itineraries
                  const pdfDir = resolve(__dirname, 'public/itineraries');
                  if (fs.existsSync(pdfDir)) {
                    const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
                    if (files.length > 0) {
                      pdfPath = `/itineraries/${files[files.length - 1]}`; // most recently added
                    }
                  }
                }
              }

              // Generate a one-time download token so the URL cannot be shared directly
              const downloadToken = crypto.randomBytes(24).toString('hex');
              orders[razorpay_order_id].downloadToken = downloadToken;
              orders[razorpay_order_id].tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
              fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

              // The download URL includes the token — it is validated before serving the file
              const downloadUrl = pdfPath
                ? `/api/download-pdf?token=${downloadToken}&order=${razorpay_order_id}`
                : '#';

              sendJson(res, 200, {
                success: true,
                downloadUrl,
                productTitle: orderData.productTitle || 'Itinerary',
                orderId: razorpay_order_id,
                paymentId: razorpay_payment_id,
              });
            } catch (err: any) {
              console.error('❌ [Dev] verifyPayment error:', err);
              sendJson(res, 500, { error: err.message || 'Payment verification failed' });
            }
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // GET /api/download-pdf — Serve PDF only with a valid one-time token
          // ═══════════════════════════════════════════════════════════════
          if (req.url?.startsWith('/api/download-pdf') && req.method === 'GET') {
            const urlObj = new URL(req.url, 'http://localhost');
            const token = urlObj.searchParams.get('token');
            const orderId = urlObj.searchParams.get('order');

            if (!token || !orderId) {
              res.statusCode = 302;
              res.setHeader('Location', '/itineraries/');
              res.end();
              return;
            }

            const ordersFile = resolve(__dirname, '.dev-orders.json');
            let orders: any = {};
            if (fs.existsSync(ordersFile)) {
              orders = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
            }

            const order = orders[orderId];

            // Validate: token must match, order must be paid, token must not be expired
            if (
              !order ||
              order.downloadToken !== token ||
              order.status !== 'paid' ||
              new Date(order.tokenExpiresAt) < new Date()
            ) {
              console.warn(`⚠️ [Dev] Invalid/expired download token for order ${orderId} — redirecting to payment page`);
              // Redirect to the itinerary product page so user pays
              const productId = order?.productId || '';
              res.statusCode = 302;
              res.setHeader('Location', productId ? `/itineraries/?id=${productId}` : '/itineraries/');
              res.end();
              return;
            }

            // Token is valid — serve the real PDF file
            const pdfPath = order.pdfPath || '';
            const absolutePdfPath = resolve(__dirname, 'public', pdfPath.replace(/^\//, ''));

            if (!pdfPath || !fs.existsSync(absolutePdfPath)) {
              sendJson(res, 404, { error: 'PDF file not found on server' });
              return;
            }

            const fileName = path.basename(absolutePdfPath);
            const fileContent = fs.readFileSync(absolutePdfPath);

            // ⚠️ SINGLE-USE: Immediately invalidate the token after the first download.
            // Anyone who shares this link will get redirected back to the payment page.
            delete orders[orderId].downloadToken;
            delete orders[orderId].tokenExpiresAt;
            fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Length', fileContent.length);
            res.end(fileContent);

            console.log(`✅ [Dev] PDF served & token invalidated: ${fileName} for order ${orderId}`);
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // GET /api/get-orders-local — Return all local dev orders for admin
          // ═══════════════════════════════════════════════════════════════
          if (req.url === '/api/get-orders-local' && req.method === 'GET') {
            try {
              const ordersFile = resolve(__dirname, '.dev-orders.json');
              let orders: any = {};
              if (fs.existsSync(ordersFile)) {
                orders = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
              }
              // Return as array, newest first
              const ordersArray = Object.entries(orders).map(([id, data]: any) => ({
                id,
                razorpayOrderId: id,
                ...data,
              })).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

              sendJson(res, 200, { orders: ordersArray });
            } catch (err: any) {
              sendJson(res, 500, { error: err.message });
            }
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // POST /api/save-itinerary-local — Save itinerary files locally
          // ═══════════════════════════════════════════════════════════════
          if (req.url === '/api/save-itinerary-local' && req.method === 'POST') {
            try {
              const data = await parseBody(req);
              const { coverBase64, coverName, pdfBase64, pdfName } = data;

              let relativeCoverPath = '';
              let relativePdfPath = '';

              // 1. Save Cover Image if provided
              if (coverBase64 && coverName) {
                const coverDir = resolve(__dirname, 'public/images/itineraries');
                if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });
                const base64Data = coverBase64.replace(/^data:image\/\w+;base64,/, "");
                const coverPath = path.join(coverDir, coverName);
                fs.writeFileSync(coverPath, base64Data, 'base64');
                relativeCoverPath = `/images/itineraries/${coverName}`;
              }

              // 2. Save PDF if provided
              if (pdfBase64 && pdfName) {
                const pdfDir = resolve(__dirname, 'public/itineraries');
                if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
                const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
                const pdfPath = path.join(pdfDir, pdfName);
                fs.writeFileSync(pdfPath, base64Data, 'base64');
                relativePdfPath = `/itineraries/${pdfName}`;
              }

              console.log(`✅ [Dev] Saved itinerary files: ${coverName || 'none'}, ${pdfName || 'none'}`);
              sendJson(res, 200, { success: true, coverPath: relativeCoverPath, pdfPath: relativePdfPath });
            } catch (err: any) {
              console.error('❌ [Dev] save-itinerary-local error:', err);
              sendJson(res, 500, { error: err.message });
            }
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // POST /api/save-local — Existing Amazon product save
          // ═══════════════════════════════════════════════════════════════
          if (req.url === '/api/save-local' && req.method === 'POST') {
            try {
              const data = await parseBody(req);
              const { product, imageBase64, imageName } = data;

              // 1. Save Image
              const imagesDir = resolve(__dirname, 'public/images/products');
              if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

              const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
              const imagePath = path.join(imagesDir, imageName);
              fs.writeFileSync(imagePath, base64Data, 'base64');
              
              const relativeImagePath = `/images/products/${imageName}`;

              // 2. Update JSON
              const jsonPath = resolve(__dirname, 'public/data/amazon-products.json');
              const productsJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
              
              const newProduct = {
                ...product,
                id: productsJson.products.length + 1,
                image: relativeImagePath
              };
              
              productsJson.products.unshift(newProduct);
              fs.writeFileSync(jsonPath, JSON.stringify(productsJson, null, 2));

              sendJson(res, 200, { success: true, imagePath: relativeImagePath, product: newProduct });
            } catch (err: any) {
              sendJson(res, 500, { error: err.message });
            }
            return;
          }

          next();
        });
      }
    }
  ]
});
