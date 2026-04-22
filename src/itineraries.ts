import './itineraries.css';
import { db } from './firebase';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItineraryProduct {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string;
  pdfPath: string;
  actualPrice: number;
  discountedPrice: number;
  isActive: boolean;
  createdAt?: any;
}

// ─── Config ───────────────────────────────────────────────────────────────────

// In dev mode, use local Vite middleware; in production, use deployed Cloud Functions
const FUNCTIONS_BASE = import.meta.env.DEV
  ? ''  // empty string = relative URLs, routed through Vite dev server middleware
  : 'https://us-central1-onroadcouple-store.cloudfunctions.net';

// Razorpay Key ID (public, safe to expose in frontend)
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || '';

// ─── DOM Elements ─────────────────────────────────────────────────────────────

const heroSection = document.getElementById('heroSection') as HTMLElement;
const listingView = document.getElementById('listingView') as HTMLElement;
const detailView = document.getElementById('detailView') as HTMLElement;
const successView = document.getElementById('successView') as HTMLElement;
const failureView = document.getElementById('failureView') as HTMLElement;
const itinGrid = document.getElementById('itinGrid') as HTMLElement;

// Detail view elements
const detailBackBtn = document.getElementById('detailBackBtn') as HTMLButtonElement;
const detailImage = document.getElementById('detailImage') as HTMLImageElement;
const detailDiscount = document.getElementById('detailDiscount') as HTMLElement;
const detailTitle = document.getElementById('detailTitle') as HTMLElement;
const detailDesc = document.getElementById('detailDesc') as HTMLElement;
const detailActualPrice = document.getElementById('detailActualPrice') as HTMLElement;
const detailDiscountPrice = document.getElementById('detailDiscountPrice') as HTMLElement;
const buyNowBtn = document.getElementById('buyNowBtn') as HTMLButtonElement;
const buyNowPrice = document.getElementById('buyNowPrice') as HTMLElement;

// Success view elements
const successProductTitle = document.getElementById('successProductTitle') as HTMLElement;
const successMeta = document.getElementById('successMeta') as HTMLElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLAnchorElement;

// Failure view elements
const failureMsg = document.getElementById('failureMsg') as HTMLElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;

// Share elements
const shareWhatsApp = document.getElementById('shareWhatsApp') as HTMLButtonElement;
const shareTwitter = document.getElementById('shareTwitter') as HTMLButtonElement;
const shareCopyLink = document.getElementById('shareCopyLink') as HTMLButtonElement;
const copyToast = document.getElementById('copyToast') as HTMLElement;

// Pre-checkout modal elements
const checkoutOverlay = document.getElementById('checkoutOverlay') as HTMLElement;
const checkoutClose = document.getElementById('checkoutClose') as HTMLButtonElement;
const checkoutForm = document.getElementById('checkoutForm') as HTMLFormElement;
const checkoutPayBtn = document.getElementById('checkoutPayBtn') as HTMLButtonElement;
const inputBuyerName = document.getElementById('buyerName') as HTMLInputElement;
const inputBuyerEmail = document.getElementById('buyerEmail') as HTMLInputElement;
const inputBuyerPhone = document.getElementById('buyerPhone') as HTMLInputElement;

// ─── State ────────────────────────────────────────────────────────────────────

let allProducts: ItineraryProduct[] = [];
let currentProduct: ItineraryProduct | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHTML(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Strips HTML tags for plain-text previews (e.g. on card descriptions)
function stripHTML(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function formatPrice(price: number): string {
  return `₹${price.toLocaleString('en-IN')}`;
}

function calcDiscount(actual: number, discounted: number): number {
  return Math.round(((actual - discounted) / actual) * 100);
}

function showView(view: 'listing' | 'detail' | 'success' | 'failure') {
  listingView.style.display = view === 'listing' ? '' : 'none';
  detailView.style.display = view === 'detail' ? '' : 'none';
  successView.style.display = view === 'success' ? '' : 'none';
  failureView.style.display = view === 'failure' ? '' : 'none';
  heroSection.style.display = view === 'listing' ? '' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(msg: string) {
  copyToast.textContent = msg;
  copyToast.classList.add('show');
  setTimeout(() => copyToast.classList.remove('show'), 3000);
}

function showLoading(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-spinner"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function hideLoading(overlay: HTMLElement) {
  overlay.remove();
}

// ─── Product Card Rendering ───────────────────────────────────────────────────

function productCardHTML(product: ItineraryProduct): string {
  const discount = calcDiscount(product.actualPrice, product.discountedPrice);

  return `
    <article class="itin-card" data-product-id="${escapeHTML(product.id)}">
      <div class="itin-card__img">
        <img src="${escapeHTML(product.coverImageUrl)}" alt="${escapeHTML(product.title)}" loading="lazy" />
        ${discount > 0 ? `<span class="itin-card__discount-badge">${discount}% OFF</span>` : ''}
      </div>
      <div class="itin-card__body">
        <span class="itin-card__tag"><i class="bi bi-file-earmark-pdf"></i> PDF Guide</span>
        <h3 class="itin-card__title">${escapeHTML(product.title)}</h3>
        <p class="itin-card__desc">${escapeHTML(stripHTML(product.description))}</p>
        <div class="itin-card__footer">
          <div class="itin-card__price">
            <span class="itin-card__price-actual">${formatPrice(product.actualPrice)}</span>
            <span class="itin-card__price-discount">${formatPrice(product.discountedPrice)}</span>
          </div>
          <span class="itin-card__cta">View Details <i class="bi bi-arrow-right"></i></span>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const activeProducts = allProducts.filter(p => p.isActive !== false);

  if (activeProducts.length === 0) {
    itinGrid.innerHTML = `
      <div class="no-products">
        <div class="no-products__icon">🗺️</div>
        <h3>Coming Soon!</h3>
        <p>We're preparing amazing travel itineraries for you. Stay tuned!</p>
      </div>
    `;
    return;
  }

  itinGrid.innerHTML = activeProducts.map(productCardHTML).join('');

  // Attach click handlers
  itinGrid.querySelectorAll('.itin-card').forEach(card => {
    card.addEventListener('click', () => {
      const productId = (card as HTMLElement).dataset.productId;
      if (productId) openProductDetail(productId);
    });
  });
}

// ─── Product Detail ───────────────────────────────────────────────────────────

function openProductDetail(productId: string) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  currentProduct = product;
  const discount = calcDiscount(product.actualPrice, product.discountedPrice);

  // Update URL without reload
  const url = new URL(window.location.href);
  url.searchParams.set('id', productId);
  history.pushState({ productId }, '', url.toString());

  // Populate detail view
  detailImage.src = product.coverImageUrl;
  detailImage.alt = product.title;
  detailDiscount.textContent = discount > 0 ? `${discount}% OFF` : '';
  detailDiscount.style.display = discount > 0 ? '' : 'none';
  detailTitle.textContent = product.title;
  // Render rich text HTML (from Quill editor in admin)
  detailDesc.innerHTML = product.description || '';
  detailActualPrice.textContent = formatPrice(product.actualPrice);
  detailDiscountPrice.textContent = formatPrice(product.discountedPrice);
  buyNowPrice.textContent = formatPrice(product.discountedPrice);

  // Update page title
  document.title = `${product.title} – On Road Couple Itineraries`;

  // Wire up share buttons
  const shareUrl = `${window.location.origin}${window.location.pathname}?id=${productId}`;
  const shareText = `Check out this travel itinerary: ${product.title}`;

  shareWhatsApp.onclick = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`, '_blank');
  };
  shareTwitter.onclick = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
  };
  shareCopyLink.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 Link copied to clipboard!');
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('🔗 Link copied!');
    }
  };

  showView('detail');
}

// ─── Pre-Checkout Modal ───────────────────────────────────────────────────────

function openCheckoutModal() {
  checkoutOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => inputBuyerName.focus(), 350);
}

function closeCheckoutModal() {
  checkoutOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

checkoutClose.addEventListener('click', closeCheckoutModal);
checkoutOverlay.addEventListener('click', (e) => {
  if (e.target === checkoutOverlay) closeCheckoutModal();
});

checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = inputBuyerName.value.trim();
  const email = inputBuyerEmail.value.trim();
  const phone = inputBuyerPhone.value.trim();

  if (!name) { inputBuyerName.focus(); return; }
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) { inputBuyerEmail.focus(); return; }
  if (!phone || !/^[0-9]{10}$/.test(phone)) { inputBuyerPhone.focus(); return; }

  checkoutPayBtn.disabled = true;
  checkoutPayBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Opening Razorpay...';

  closeCheckoutModal();

  if (currentProduct) {
    await initiatePayment(currentProduct, { name, email, phone });
  }

  checkoutPayBtn.disabled = false;
  checkoutPayBtn.innerHTML = '<i class="bi bi-lock-fill"></i> Proceed to Secure Payment';
});

async function initiatePayment(
  product: ItineraryProduct,
  buyer: { name: string; email: string; phone: string }
) {
  const overlay = showLoading();
  buyNowBtn.disabled = true;

  try {
    // Step 1: Create order via Cloud Function (pass buyer details so they're stored immediately)
    const orderRes = await fetch(`${FUNCTIONS_BASE}/createOrder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: product.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone,
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.json();
      throw new Error(err.error || 'Failed to create order');
    }

    const orderData = await orderRes.json();
    hideLoading(overlay);

    // Step 2: Open Razorpay Checkout
    const options = {
      key: orderData.key || RAZORPAY_KEY_ID,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'On Road Couple',
      description: product.title,
      order_id: orderData.orderId,
      image: '/profile.jpg',
      theme: {
        color: '#10B981',
        backdrop_color: 'rgba(15,23,42,0.75)',
      },
      handler: async function (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) {
        // Step 3: Verify payment
        await handlePaymentSuccess(response, product);
      },
      modal: {
        ondismiss: function () {
          buyNowBtn.disabled = false;
        },
        escape: true,
        backdropclose: false
      },
      prefill: {
        name: buyer.name,
        email: buyer.email,
        contact: `+91${buyer.phone}`,
      },
      // readonly: skips the initial "Enter Mobile" screen in Razorpay checkout
      readonly: {
        name: true,
        email: true,
        contact: true,
      },
      notes: {
        productId: product.id,
        productTitle: product.title,
      },
    };

    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', function (response: any) {
      handlePaymentFailure(response.error?.description || 'Payment failed. Please try again.');
    });
    rzp.open();
  } catch (error: any) {
    hideLoading(overlay);
    handlePaymentFailure(error.message || 'Something went wrong. Please try again.');
  }
}

async function handlePaymentSuccess(response: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}, product: ItineraryProduct) {
  const overlay = showLoading();

  try {
    const verifyRes = await fetch(`${FUNCTIONS_BASE}/verifyPayment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
        // Buyer details (name, email, phone) are fetched server-side from Razorpay API
      }),
    });

    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      throw new Error(err.error || 'Payment verification failed');
    }

    const result = await verifyRes.json();
    hideLoading(overlay);

    // Show success view
    successProductTitle.textContent = product.title;
    successMeta.textContent = `Order ID: ${response.razorpay_order_id} · Payment ID: ${response.razorpay_payment_id}`;
    
    // Set download link and proper filename
    if (result.downloadUrl) {
      downloadBtn.href = result.downloadUrl;
      const fileName = result.downloadUrl.split('/').pop() || 'itinerary.pdf';
      downloadBtn.setAttribute('download', fileName);
    } else {
      console.error("No download URL returned from server");
    }

    showView('success');

    // Track conversion in Google Analytics
    if ((window as any).gtag) {
      (window as any).gtag('event', 'purchase', {
        transaction_id: response.razorpay_payment_id,
        value: product.discountedPrice,
        currency: 'INR',
        items: [{ item_name: product.title, price: product.discountedPrice }],
      });
    }
  } catch (error: any) {
    hideLoading(overlay);
    handlePaymentFailure(error.message || 'Payment verification failed. Please contact support.');
  }
}

function handlePaymentFailure(message: string) {
  failureMsg.textContent = message;

  // Set up retry button
  retryBtn.onclick = () => {
    if (currentProduct) {
      showView('detail');
      buyNowBtn.disabled = false;
    }
  };

  showView('failure');
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadProducts(): Promise<void> {
  try {
    const productsRef = collection(db, 'itinerary-products');
    const q = query(productsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);

    allProducts = [];
    snapshot.forEach(docSnap => {
      allProducts.push({ id: docSnap.id, ...docSnap.data() } as ItineraryProduct);
    });

    renderProducts();
  } catch (err) {
    console.error('Failed to load itinerary products', err);
    itinGrid.innerHTML = `
      <div class="no-products">
        <div class="no-products__icon">⚠️</div>
        <h3>Could not load itineraries</h3>
        <p>Please try again later or contact us at brand.onroadcouple@gmail.com</p>
      </div>
    `;
  }
}

// ─── URL Routing ──────────────────────────────────────────────────────────────

async function handleRoute() {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');

  if (productId) {
    // Try to find in loaded products first
    let product = allProducts.find(p => p.id === productId);

    // If not loaded yet, fetch individually
    if (!product) {
      try {
        const docSnap = await getDoc(doc(db, 'itinerary-products', productId));
        if (docSnap.exists()) {
          product = { id: docSnap.id, ...docSnap.data() } as ItineraryProduct;
          // Add to local cache
          if (!allProducts.find(p => p.id === product!.id)) {
            allProducts.push(product);
          }
        }
      } catch (err) {
        console.error('Failed to fetch product', err);
      }
    }

    if (product) {
      openProductDetail(productId);
    } else {
      showView('listing');
    }
  } else {
    showView('listing');
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Buy Now button — opens the pre-checkout details form first
buyNowBtn.addEventListener('click', () => {
  if (currentProduct) {
    openCheckoutModal();
  }
});

// Back button from detail view
detailBackBtn.addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.delete('id');
  history.pushState({}, '', url.toString());
  document.title = 'Travel Itineraries – On Road Couple';
  showView('listing');
});

// Browser back/forward navigation
window.addEventListener('popstate', () => {
  handleRoute();
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

(async () => {
  await loadProducts();
  await handleRoute();
})();
