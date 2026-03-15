import './amazon-store.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string | number;
  title: string;
  image: string;
  category: string;
  affiliateLink: string;
  createdAt?: any;
}

interface ProductsJson {
  products: Product[];
}

// ─── State ────────────────────────────────────────────────────────────────────

let allProducts: Product[] = [];
let activeCategory = 'All';
let searchQuery = '';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const grid      = document.getElementById('productGrid')    as HTMLElement;
const searchEl  = document.getElementById('searchInput')    as HTMLInputElement;
const chipsEl   = document.getElementById('filterChips')    as HTMLElement;
const countEl   = document.getElementById('resultsCount')   as HTMLElement;
const noResults = document.getElementById('noResults')      as HTMLElement;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Helper to escape string for HTML to prevent XSS */
function escapeHTML(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

/** Returns a single ProductCard HTML string */
function productCardHTML(p: Product): string {
  const cleanLink = p.affiliateLink; // Just use provided link directly since user simplifies

  return `
    <article class="product-card">
      <div class="product-card__img-wrap">
        <span class="product-card__badge">${escapeHTML(p.category.toUpperCase())}</span>
        <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.title)}" loading="lazy" />
      </div>
      <div class="product-card__body" style="padding-bottom: 20px;">
        <p class="product-card__category">${escapeHTML(p.category)}</p>
        <h3 class="product-card__title" title="${escapeHTML(p.title)}" style="margin-bottom: auto;">
          ${escapeHTML(p.title)}
        </h3>
        <div class="product-card__footer" style="margin-top: 14px; justify-content: flex-start;">
          <a href="${escapeHTML(cleanLink)}" target="_blank" rel="noopener noreferrer" class="btn-amazon" aria-label="View ${escapeHTML(p.title)} on Amazon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.23 10.56v-.36c-1.4-.17-2.86.28-2.86 1.84 0 .83.44 1.39 1.18 1.39 1.25 0 1.68-1.16 1.68-2.87zm3.01 4.05c-.15.14-.38.15-.56.05-1.02-.85-1.2-1.24-1.77-2.05-1.7 1.73-2.9 2.25-5.1 2.25-2.6 0-4.62-1.6-4.62-4.81 0-2.5 1.36-4.21 3.3-5.04 1.68-.74 4.03-.87 5.82-1.07v-.4c0-.73.06-1.6-.37-2.23-.37-.56-1.08-.8-1.7-.8-1.16 0-2.19.6-2.44 1.83-.05.27-.27.54-.54.55l-3.03-.32c-.25-.06-.54-.26-.46-.65C5.27 1.08 8.55 0 11.5 0c1.51 0 3.48.4 4.68 1.54 1.52 1.41 1.37 3.3 1.37 5.35v4.84c0 1.46.6 2.1 1.17 2.88.2.28.24.62 0 .83l-2.48 2.17zm1.16 3.94C15.62 20.36 12.5 22 9.13 22c-2.95 0-5.6-1.09-7.6-2.9-.22-.2-.02-.47.24-.32 2.16 1.25 4.83 2 7.61 2 1.87 0 3.91-.39 5.8-1.19.28-.12.52.18.22.46zm.93-1.18c-.3-.38-1.96-.18-2.71-.09-.23.03-.26-.17-.06-.31 1.33-.93 3.5-.66 3.75-.35.26.32-.07 2.5-1.31 3.54-.19.16-.37.08-.28-.13.28-.7.9-2.27.61-2.66z"/></svg>
            View on Amazon
          </a>
        </div>
      </div>
    </article>
  `;
}

/** Skeleton placeholder card */
function skeletonCardHTML(): string {
  return `
    <div class="product-card skeleton" aria-hidden="true">
      <div class="product-card__img-wrap">
        <div class="skeleton-bg skel-img"></div>
      </div>
      <div class="product-card__body" style="gap:10px; padding-bottom: 20px;">
        <div class="skeleton-bg skel-cat"></div>
        <div class="skeleton-bg skel-title"></div>
        <div class="skeleton-bg skel-title2"></div>
        <div style="margin-top: 14px;">
          <div class="skeleton-bg skel-btn"></div>
        </div>
      </div>
    </div>
  `;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderProducts(): void {
  const q = searchQuery.toLowerCase().trim();
  const filtered = allProducts.filter((p) => {
    const matchesCat = activeCategory === 'All' || p.category === activeCategory;
    const matchesSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  // Update count label
  if (countEl) {
    countEl.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    noResults.classList.add('visible');
  } else {
    noResults.classList.remove('visible');
    grid.innerHTML = filtered.map(productCardHTML).join('');
  }
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

function buildChips(products: Product[]): void {
  const categories = ['All', ...new Set(products.map((p) => p.category))];
  if (!chipsEl) return;
  chipsEl.innerHTML = categories
    .map(
      (cat) =>
        `<button class="chip${cat === activeCategory ? ' active' : ''}" data-cat="${cat}">${cat}</button>`,
    )
    .join('');

  chipsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-cat]') as HTMLElement | null;
    if (!btn) return;
    activeCategory = btn.dataset.cat!;
    chipsEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    renderProducts();
  });
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

import { db } from './firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';

async function loadProducts(): Promise<void> {
  // Show skeletons
  grid.innerHTML = Array(8).fill(0).map(skeletonCardHTML).join('');

  try {
    const productsRef = collection(db, 'products');
    const q = query(productsRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    allProducts = [];
    querySnapshot.forEach((doc) => {
      allProducts.push({ id: doc.id, ...doc.data() } as Product);
    });

    // If Firestore is empty (e.g., right after migration), fallback to the JSON file
    // just so the site doesn't look broken while you are migrating data!
    if (allProducts.length === 0) {
      const response = await fetch('./data/amazon-products.json');
      if (response.ok) {
        const json = (await response.json()) as ProductsJson;
        allProducts = json.products ?? [];
      }
    }

    buildChips(allProducts);
    renderProducts();
  } catch (err) {
    console.error('Failed to load products', err);
    grid.innerHTML = `<p style="color:#888;padding:24px;grid-column:1/-1;text-align:center">
      Could not load products. Please try again later.
    </p>`;
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

if (searchEl) {
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value;
    renderProducts();
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

loadProducts();
