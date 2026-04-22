import './admin.css';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { storage } from './firebase';
import { ref, getDownloadURL, uploadBytesResumable } from 'firebase/storage';

// ─── DOM Elements ─────────────────────────────────────────────────────────────

const loginView = document.getElementById('loginView') as HTMLElement;
const dashboardView = document.getElementById('dashboardView') as HTMLElement;
const loginForm = document.getElementById('loginForm') as HTMLFormElement;
const adminEmailInput = document.getElementById('adminEmail') as HTMLInputElement;
const adminPasswordInput = document.getElementById('adminPassword') as HTMLInputElement;
const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
const syncAmazonBtn = document.getElementById('syncAmazonBtn') as HTMLButtonElement;
const loginStatus = document.getElementById('loginStatus') as HTMLElement;

// Amazon Products form elements
const productForm = document.getElementById('productForm') as HTMLFormElement;
const statusMessage = document.getElementById('statusMessage') as HTMLElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const cancelEditBtn = document.getElementById('cancelEditBtn') as HTMLButtonElement;
const formTitle = document.getElementById('formTitle') as HTMLElement;
const editingProductId = document.getElementById('editingProductId') as HTMLInputElement;
const productsTableBody = document.getElementById('productsTableBody') as HTMLTableSectionElement;

const pTitle = document.getElementById('pTitle') as HTMLInputElement;
const pCategorySelect = document.getElementById('pCategorySelect') as HTMLSelectElement;
const pNewCategory = document.getElementById('pNewCategory') as HTMLInputElement;
const pLink = document.getElementById('pLink') as HTMLInputElement;
const pImageFile = document.getElementById('pImageFile') as HTMLInputElement;
const pImageUrl = document.getElementById('pImageUrl') as HTMLInputElement;

// Progress elements
const uploadProgressContainer = document.getElementById('uploadProgressContainer') as HTMLElement;
const uploadProgressBar = document.getElementById('uploadProgressBar') as HTMLElement;
const uploadPercent = document.getElementById('uploadPercent') as HTMLElement;

// Cropper elements
const cropModal = document.getElementById('cropModal') as HTMLElement;
const imageToCrop = document.getElementById('imageToCrop') as HTMLImageElement;
const cancelCropBtn = document.getElementById('cancelCropBtn') as HTMLButtonElement;
const confirmCropBtn = document.getElementById('confirmCropBtn') as HTMLButtonElement;

// Itinerary form elements
const itineraryForm = document.getElementById('itineraryForm') as HTMLFormElement;
const itinFormTitle = document.getElementById('itinFormTitle') as HTMLElement;
const editingItineraryId = document.getElementById('editingItineraryId') as HTMLInputElement;
const itinTitle = document.getElementById('itinTitle') as HTMLInputElement;
const itinDescription = document.getElementById('itinDescription') as HTMLInputElement; // hidden input, value set from Quill
const itinActualPrice = document.getElementById('itinActualPrice') as HTMLInputElement;
const itinDiscountPrice = document.getElementById('itinDiscountPrice') as HTMLInputElement;
const itinCoverImage = document.getElementById('itinCoverImage') as HTMLInputElement;
const itinCoverImageUrl = document.getElementById('itinCoverImageUrl') as HTMLInputElement;
const itinPdfFile = document.getElementById('itinPdfFile') as HTMLInputElement;
const itinPdfPath = document.getElementById('itinPdfPath') as HTMLInputElement;
const itinStatusMessage = document.getElementById('itinStatusMessage') as HTMLElement;
const itinSubmitBtn = document.getElementById('itinSubmitBtn') as HTMLButtonElement;
const cancelItinEditBtn = document.getElementById('cancelItinEditBtn') as HTMLButtonElement;
const itinerariesTableBody = document.getElementById('itinerariesTableBody') as HTMLTableSectionElement;
const itinUploadProgressContainer = document.getElementById('itinUploadProgressContainer') as HTMLElement;
const itinUploadProgressBar = document.getElementById('itinUploadProgressBar') as HTMLElement;
const itinUploadPercent = document.getElementById('itinUploadPercent') as HTMLElement;

// Orders elements
const ordersTableBody = document.getElementById('ordersTableBody') as HTMLTableSectionElement;

// Tab elements
const adminTabs = document.getElementById('adminTabs') as HTMLElement;

let dropifyInstance: any = null;
let cropperInstance: any = null;
let croppedImageBlob: Blob | null = null;
let isCroppingInternal: boolean = false;

// ─── Quill instance (initialized in DOMContentLoaded) ──────────────────────
let quillEditor: any = null;

// ─── Tab Navigation ───────────────────────────────────────────────────────────

adminTabs.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest('.admin-tab') as HTMLElement | null;
  if (!tab) return;

  const tabName = tab.dataset.tab;
  if (!tabName) return;

  // Update active tab button
  adminTabs.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  // Update active tab content
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const targetContent = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (targetContent) targetContent.classList.add('active');

  // Load data for the tab if needed
  if (tabName === 'itinerary') loadItineraryProducts();
  if (tabName === 'orders') loadOrders();
});

// ─── Dropify, Cropper & Quill Setup ──────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // ── Quill Rich Text Editor ────────────────────────────────────────────────
  const QuillLib = (window as any).Quill;
  const editorEl = document.getElementById('itinDescriptionEditor');
  if (QuillLib && editorEl) {
    quillEditor = new QuillLib('#itinDescriptionEditor', {
      theme: 'snow',
      placeholder: "Describe what's included — day-by-day plan, budget tips, must-visit places, etc.",
      modules: {
        toolbar: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'blockquote'],
          ['clean'],
        ],
      },
    });
    quillEditor.on('text-change', () => {
      itinDescription.value = quillEditor.root.innerHTML === '<p><br></p>' ? '' : quillEditor.root.innerHTML;
    });
  }

  // ── Dropify ───────────────────────────────────────────────────────────────
  const $ = (window as any).$;
  if ($ && $.fn.dropify) {
    dropifyInstance = $('#pImageFile').dropify({
      messages: {
        'default': 'Drag and drop a product image here or click',
        'replace': 'Drag and drop or click to replace',
        'remove':  'Remove',
        'error':   'Oops, something wrong appended.'
      }
    });

    // Intercept file selection to open Cropper
    dropifyInstance.on('change', function() {
      if (isCroppingInternal) {
        isCroppingInternal = false; // Bypass cropper since we are just setting preview
        return;
      }

      const file = pImageFile.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            openCropper(e.target.result as string);
          }
        };
        reader.readAsDataURL(file);
      }
    });

    // Clear the cropped blob if they hit "Remove"
    dropifyInstance.on('dropify.afterClear', function() {
      croppedImageBlob = null;
    });
  }

  // Toggle New Category input
  pCategorySelect.addEventListener('change', () => {
    if (pCategorySelect.value === 'new') {
      pNewCategory.style.display = 'block';
      pNewCategory.setAttribute('required', 'true');
      pNewCategory.focus();
    } else {
      pNewCategory.style.display = 'none';
      pNewCategory.removeAttribute('required');
      pNewCategory.value = '';
    }
  });
});

function openCropper(imageSrc: string) {
  cropModal.classList.add('active');
  const Cropper = (window as any).Cropper;
  
  if (cropperInstance) cropperInstance.destroy();
  
  // Wait for the image to fully load in the modal before attaching Cropper
  // This guarantees that Cropper can calculate the correct dimensions.
  imageToCrop.onload = () => {
    cropperInstance = new Cropper(imageToCrop, {
      aspectRatio: 1, // enforce 1:1 square
      viewMode: 1,    // restrict crop box to not exceed canvas
      autoCropArea: 1
    });
    // Remove listener so it doesn't fire consecutively 
    imageToCrop.onload = null;
  };
  
  imageToCrop.src = imageSrc;
}

cancelCropBtn.addEventListener('click', () => {
  cropModal.classList.remove('active');
  if (cropperInstance) cropperInstance.destroy();
  
  // Reset dropify UI since they cancelled
  const $ = (window as any).$;
  if ($ && dropifyInstance) {
    const drEvent = $('#pImageFile').data('dropify');
    if (drEvent) {
      drEvent.resetPreview();
      drEvent.clearElement();
    }
  }
  croppedImageBlob = null;
});

confirmCropBtn.addEventListener('click', () => {
  if (!cropperInstance) return;

  const canvas = cropperInstance.getCroppedCanvas({
    width: 800, // standard output size
    height: 800
  });

  if (canvas) {
    // Generate blob from canvas
    canvas.toBlob((blob: Blob) => {
      croppedImageBlob = blob;
      
      // Update dropify preview with the cropped image visually
      const file = new File([blob], 'cropped_image.jpg', { type: 'image/jpeg' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      pImageFile.files = dataTransfer.files;
      
      const $ = (window as any).$;
      if ($) {
        isCroppingInternal = true;
        $('#pImageFile').trigger('change');
      }

      cropModal.classList.remove('active');
      cropperInstance.destroy();
      cropperInstance = null;
      setStatus('Image cropped to square!', 'success');
      setTimeout(() => setStatus(''), 3000);
    }, 'image/jpeg', 0.9);
  }
});

// ─── Authentication State ─────────────────────────────────────────────────────

function updateView(user: any) {
  if (user) {
    loginView.classList.remove('active');
    dashboardView.classList.add('active');
  } else {
    dashboardView.classList.remove('active');
    loginView.classList.add('active');
  }
}

// Listen for Firebase Auth state changes
onAuthStateChanged(auth, (user) => {
  updateView(user);
  if (user) {
    loadProducts();
    loadItineraryProducts();
    loadOrders();
  }
});

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = adminEmailInput.value.trim();
  const password = adminPasswordInput.value;
  
  if (email && password) {
    try {
      loginBtn.disabled = true;
      loginBtn.textContent = 'Authenticating...';
      if (loginStatus) loginStatus.textContent = '';
      
      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
    } catch (error: any) {
      console.error('Login error:', error);
      if (loginStatus) {
        loginStatus.textContent = `Login failed: ${error.message.replace('Firebase: ', '')}`;
        loginStatus.className = 'status-msg error';
      } else {
        alert(`Login failed: ${error.message}`);
      }
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Authenticate';
    }
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error: any) {
    console.error('Logout error:', error);
  }
});

// ─── Helpers ───────────────────────────────────────────────

function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  statusMessage.textContent = msg;
  statusMessage.className = `status-msg ${type}`;
}

function setItinStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  itinStatusMessage.textContent = msg;
  itinStatusMessage.className = `status-msg ${type}`;
}

// ─── Upload helper ────────────────────────────────────────────────────────────

async function uploadWithProgress(
  fileOrBlob: File | Blob,
  originalName: string,
  storagePath: string,
  progressBar: HTMLElement,
  progressPercent: HTMLElement,
  progressContainer: HTMLElement,
  statusFn: (msg: string, type: 'info' | 'success' | 'error') => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const isBlob = !(fileOrBlob instanceof File);
    const safeName = isBlob ? `image_${Date.now()}.jpg` : originalName.replace(/[^a-zA-Z0-9.]/g, '_');
    const storageRef = ref(storage, `${storagePath}/${Date.now()}_${safeName}`);
    
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0';
    
    const uploadTask = uploadBytesResumable(storageRef, fileOrBlob);
    
    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = `${progress}%`;
        progressPercent.textContent = Math.round(progress).toString();
        statusFn(`Uploading... ${Math.round(progress)}%`, 'info');
      }, 
      (error) => {
        progressContainer.style.display = 'none';
        reject(error);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        progressContainer.style.display = 'none';
        resolve(downloadURL);
      }
    );
  });
}

// Returns the storage path (not URL) for a PDF upload
async function uploadPdfWithProgress(
  file: File,
  progressBar: HTMLElement,
  progressPercent: HTMLElement,
  progressContainer: HTMLElement,
  statusFn: (msg: string, type: 'info' | 'success' | 'error') => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `itinerary-pdfs/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, storagePath);
    
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0';
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = `${progress}%`;
        progressPercent.textContent = Math.round(progress).toString();
        statusFn(`Uploading PDF... ${Math.round(progress)}%`, 'info');
      }, 
      (error) => {
        progressContainer.style.display = 'none';
        reject(error);
      }, 
      () => {
        progressContainer.style.display = 'none';
        // Return the storage path, not the download URL (PDFs are private)
        resolve(storagePath);
      }
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AMAZON PRODUCTS (existing functionality)
// ═══════════════════════════════════════════════════════════════════════════════

let allProducts: any[] = [];

async function loadProducts() {
  try {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    allProducts = [];
    snapshot.forEach(doc => {
      allProducts.push({ id: doc.id, ...doc.data() });
    });

    populateCategoryOptions();
    renderProductsTable();
  } catch (err: any) {
    console.error("Error loading products", err);
    productsTableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--error)">Error loading products.</td></tr>`;
  }
}

function populateCategoryOptions() {
  const uniqueCategories = Array.from(new Set(allProducts.map(p => p.category)));
  const sortedCategories = uniqueCategories
    .filter(cat => cat)
    .sort();
  
  // Keep first option (placeholder) and last option (Add New)
  const firstOption = pCategorySelect.options[0];
  const lastOption = pCategorySelect.options[pCategorySelect.options.length - 1];
  
  pCategorySelect.innerHTML = '';
  pCategorySelect.appendChild(firstOption);
  
  sortedCategories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    pCategorySelect.appendChild(opt);
  });
  
  pCategorySelect.appendChild(lastOption);
}

function renderProductsTable() {
  if (allProducts.length === 0) {
    productsTableBody.innerHTML = `<tr><td colspan="4" class="text-center">No products found.</td></tr>`;
    return;
  }

  productsTableBody.innerHTML = allProducts.map(p => `
    <tr>
      <td><strong>${p.title}</strong></td>
      <td>${p.category}</td>
      <td class="actions-col">
        <button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')"><i class="bi bi-pencil"></i> Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteProduct('${p.id}')" style="color:var(--error);border-color:var(--error)"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

// Attach these to the global window so inline onclick handlers work (since this is a module)
(window as any).editProduct = (id: string) => {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  editingProductId.value = id;
  pTitle.value = product.title;
  pCategorySelect.value = product.category;
  
  // If category not in list (edge case), default to empty
  if (pCategorySelect.value !== product.category) {
    pCategorySelect.value = '';
  }
  
  // Reset new category field
  pCategorySelect.dispatchEvent(new Event('change'));

  pLink.value = product.affiliateLink;
  pImageUrl.value = product.image;

  // Set Dropify preview
  const $ = (window as any).$;
  if ($ && dropifyInstance) {
    const drEvent = $('#pImageFile').data('dropify');
    if (drEvent) {
      drEvent.resetPreview();
      drEvent.clearElement();
      drEvent.settings.defaultFile = product.image;
      drEvent.destroy();
      drEvent.init();
    }
  }
  croppedImageBlob = null; // Clear any old blob

  formTitle.innerHTML = '<i class="bi bi-pencil-square"></i> Edit Product';
  submitBtn.innerHTML = '<i class="bi bi-check-circle"></i> Update Product';
  cancelEditBtn.style.display = 'inline-flex';
  
  // Scroll to form
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

(window as any).deleteProduct = async (id: string) => {
  if (!confirm("Are you sure you want to delete this product? This acton cannot be undone.")) return;
  
  try {
    await deleteDoc(doc(db, 'products', id));
    setStatus('Product deleted!', 'success');
    loadProducts(); // refresh table
  } catch (err: any) {
    console.error("Delete error", err);
    alert(`Could not delete: ${err.message}`);
  }
};

cancelEditBtn.addEventListener('click', () => {
  productForm.reset();
  editingProductId.value = '';
  formTitle.innerHTML = '<i class="bi bi-box-seam"></i> Add New Product';
  submitBtn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Save to Database';
  cancelEditBtn.style.display = 'none';

  // Reset Dropify
  const $ = (window as any).$;
  if ($ && dropifyInstance) {
    const drEvent = $('#pImageFile').data('dropify');
    if (drEvent) {
      drEvent.resetPreview();
      drEvent.clearElement();
    }
  }
  croppedImageBlob = null;
});

// Amazon Product Form Submission
productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!auth.currentUser) return;

  const isLocal = window.location.hostname === 'localhost';
  submitBtn.disabled = true;
  setStatus(editingProductId.value ? 'Updating product...' : (isLocal ? 'Saving locally & to Firebase...' : 'Saving to Firebase...'), 'info');

  try {
    let finalImageUrl = pImageUrl.value;
    
    // ─── Local Development Flow ────────────────────────────────────────────────
    if (isLocal && (croppedImageBlob || (pImageFile.files && pImageFile.files.length > 0 && !editingProductId.value))) {
      const fileOrBlob = croppedImageBlob || pImageFile.files![0];
      const fileName = croppedImageBlob ? `product_${Date.now()}.jpg` : pImageFile.files![0].name;

      // Convert Blob to Base64 for the local API
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(fileOrBlob);
      });
      
      const imageBase64 = await base64Promise;
      
      const response = await fetch('/api/save-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            title: pTitle.value.trim(),
            category: pCategorySelect.value === 'new' ? pNewCategory.value.trim() : pCategorySelect.value,
            affiliateLink: pLink.value.trim(),
            description: "" // default empty or pull from form if added
          },
          imageBase64,
          imageName: fileName
        })
      });

      if (!response.ok) throw new Error("Failed to save locally");
      const result = await response.json();
      finalImageUrl = result.imagePath;
    } 
    // ─── Remote / Production Flow ──────────────────────────────────────────────
    else if (croppedImageBlob) {
      finalImageUrl = await uploadWithProgress(
        croppedImageBlob, '.jpg', 'products',
        uploadProgressBar, uploadPercent, uploadProgressContainer, setStatus
      );
    }
    // Else if they selected a file but didn't crop (e.g. bug or bypassed), upload as is
    else if (pImageFile.files && pImageFile.files.length > 0 && !editingProductId.value) {
      const file = pImageFile.files[0];
      finalImageUrl = await uploadWithProgress(
        file, file.name, 'products',
        uploadProgressBar, uploadPercent, uploadProgressContainer, setStatus
      );
    }
    
    if (!finalImageUrl) {
      throw new Error("Please select and crop a product image!");
    }

    const selectedCategory = pCategorySelect.value === 'new' 
      ? pNewCategory.value.trim() 
      : pCategorySelect.value;

    if (!selectedCategory) {
      throw new Error("Please select or enter a category!");
    }

    const productData = {
      title: pTitle.value.trim(),
      image: finalImageUrl,
      category: selectedCategory,
      affiliateLink: pLink.value.trim(),
    };

    if (editingProductId.value) {
      // Update existing
      await updateDoc(doc(db, 'products', editingProductId.value), productData);
      setStatus('✅ Product updated!', 'success');
    } else {
      // Create new
      const newProduct = { ...productData, createdAt: serverTimestamp() };
      await addDoc(collection(db, 'products'), newProduct);
      setStatus('✅ Product added to database!', 'success');
    }
    
    // Reset form and UI state
    cancelEditBtn.click(); 
    
    // Refresh table mapping
    loadProducts();
    
    // Clear success message after 5 seconds
    setTimeout(() => setStatus(''), 5000);

  } catch (err: any) {
    console.error(err);
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// Sync Amazon data from JSON file to Firestore
syncAmazonBtn.addEventListener('click', async () => {
  if (!confirm("This will import products from your local 'amazon-products.json' to the live database. Products with the same title will be skipped. Proceed?")) return;

  syncAmazonBtn.disabled = true;
  syncAmazonBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Syncing...';
  setStatus('Syncing JSON data to Firestore...', 'info');

  try {
    const response = await fetch('/data/amazon-products.json');
    if (!response.ok) throw new Error("Could not find /data/amazon-products.json");
    
    const { products } = await response.json();
    if (!products || !Array.isArray(products)) throw new Error("Invalid JSON format");

    let addedCount = 0;
    let skippedCount = 0;

    for (const p of products) {
      // Check if product already exists (by title for simplicity during transition)
      const alreadyExists = allProducts.some(existing => existing.title === p.title);
      
      if (alreadyExists) {
        skippedCount++;
        continue;
      }

      await addDoc(collection(db, 'products'), {
        title: p.title,
        category: p.category,
        image: p.image,
        affiliateLink: p.affiliateLink,
        createdAt: serverTimestamp()
      });
      addedCount++;
    }

    setStatus(`✅ Sync Complete! Added: ${addedCount}, Skipped (duplicates): ${skippedCount}`, 'success');
    loadProducts(); // Fresh table load
  } catch (err: any) {
    console.error("Sync error", err);
    setStatus(`Sync Failed: ${err.message}`, 'error');
  } finally {
    syncAmazonBtn.disabled = false;
    syncAmazonBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Sync JSON to Database';
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ITINERARY PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

let allItineraryProducts: any[] = [];

async function loadItineraryProducts() {
  try {
    const q = query(collection(db, 'itinerary-products'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    
    allItineraryProducts = [];
    snapshot.forEach(docSnap => {
      allItineraryProducts.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderItinerariesTable();
  } catch (err: any) {
    console.error("Error loading itinerary products", err);
    itinerariesTableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--error)">Error loading itineraries.</td></tr>`;
  }
}

function renderItinerariesTable() {
  if (allItineraryProducts.length === 0) {
    itinerariesTableBody.innerHTML = `<tr><td colspan="4" class="text-center">No itinerary products found. Add one above!</td></tr>`;
    return;
  }

  itinerariesTableBody.innerHTML = allItineraryProducts.map(p => `
    <tr>
      <td><strong>${p.title}</strong></td>
      <td>
        <span style="text-decoration:line-through;color:var(--text-muted);margin-right:6px;">₹${p.actualPrice}</span>
        <strong>₹${p.discountedPrice}</strong>
      </td>
      <td>
        <span class="status-badge ${p.isActive !== false ? 'active' : 'inactive'}">
          ${p.isActive !== false ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="actions-col">
        <button class="btn btn-secondary btn-sm" onclick="editItinerary('${p.id}')"><i class="bi bi-pencil"></i> Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleItinerary('${p.id}', ${p.isActive !== false})" title="${p.isActive !== false ? 'Deactivate' : 'Activate'}">
          <i class="bi bi-${p.isActive !== false ? 'eye-slash' : 'eye'}"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="deleteItinerary('${p.id}')" style="color:var(--error);border-color:var(--error)"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

// Itinerary Form Submission
itineraryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!auth.currentUser) return;

  const isLocal = window.location.hostname === 'localhost';
  itinSubmitBtn.disabled = true;
  setItinStatus(editingItineraryId.value ? 'Updating itinerary...' : 'Saving itinerary...', 'info');

  try {
    let finalCoverUrl = itinCoverImageUrl.value;
    let finalPdfPath = itinPdfPath.value;

    const hasNewCover = itinCoverImage.files && itinCoverImage.files.length > 0;
    const hasNewPdf = itinPdfFile.files && itinPdfFile.files.length > 0;

    // ─── Local Development Flow ────────────────────────────────────────────────
    if (isLocal && (hasNewCover || hasNewPdf)) {
      setItinStatus('Saving files locally...', 'info');
      
      const payload: any = {};
      
      if (hasNewCover) {
        const coverFile = itinCoverImage.files![0];
        payload.coverName = coverFile.name;
        payload.coverBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(coverFile);
        });
      }

      if (hasNewPdf) {
        const pdfFile = itinPdfFile.files![0];
        payload.pdfName = pdfFile.name;
        payload.pdfBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(pdfFile);
        });
      }

      const response = await fetch('/api/save-itinerary-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Failed to save itinerary files locally");
      const result = await response.json();
      
      if (result.coverPath) finalCoverUrl = result.coverPath;
      if (result.pdfPath) finalPdfPath = result.pdfPath;
    } 
    // ─── Remote / Production Flow ──────────────────────────────────────────────
    else {
      // Upload cover image to Firebase Storage if provided
      if (hasNewCover) {
        const coverFile = itinCoverImage.files![0];
        finalCoverUrl = await uploadWithProgress(
          coverFile, coverFile.name, 'itinerary-covers',
          itinUploadProgressBar, itinUploadPercent, itinUploadProgressContainer, setItinStatus
        );
      }

      // Upload PDF to Firebase Storage if provided
      if (hasNewPdf) {
        const pdfFile = itinPdfFile.files![0];
        finalPdfPath = await uploadPdfWithProgress(
          pdfFile,
          itinUploadProgressBar, itinUploadPercent, itinUploadProgressContainer, setItinStatus
        );
      }
    }

    // Validation
    if (!editingItineraryId.value) {
      if (!finalCoverUrl) throw new Error("Please upload a cover image!");
      if (!finalPdfPath) throw new Error("Please upload a PDF file!");
    }

    const itineraryData: any = {
      title: itinTitle.value.trim(),
      description: quillEditor.root.innerHTML === '<p><br></p>' ? '' : quillEditor.root.innerHTML,
      actualPrice: parseInt(itinActualPrice.value, 10),
      discountedPrice: parseInt(itinDiscountPrice.value, 10),
    };

    if (finalCoverUrl) itineraryData.coverImageUrl = finalCoverUrl;
    if (finalPdfPath) itineraryData.pdfPath = finalPdfPath;

    if (editingItineraryId.value) {
      await updateDoc(doc(db, 'itinerary-products', editingItineraryId.value), itineraryData);
      setItinStatus('✅ Itinerary updated!', 'success');
    } else {
      itineraryData.isActive = true;
      itineraryData.createdAt = serverTimestamp();
      await addDoc(collection(db, 'itinerary-products'), itineraryData);
      setItinStatus('✅ Itinerary added!', 'success');
    }

    // Reset form
    cancelItinEditBtn.click();
    loadItineraryProducts();
    setTimeout(() => setItinStatus(''), 5000);

  } catch (err: any) {
    console.error(err);
    setItinStatus(`Error: ${err.message}`, 'error');
  } finally {
    itinSubmitBtn.disabled = false;
  }
});

// Edit itinerary
(window as any).editItinerary = (id: string) => {
  const product = allItineraryProducts.find(p => p.id === id);
  if (!product) return;

  editingItineraryId.value = id;
  itinTitle.value = product.title;
  // Populate Quill with HTML content from Firestore
  quillEditor.root.innerHTML = product.description || '';
  itinDescription.value = product.description || '';
  itinActualPrice.value = product.actualPrice?.toString() || '';
  itinDiscountPrice.value = product.discountedPrice?.toString() || '';
  itinCoverImageUrl.value = product.coverImageUrl || '';
  itinPdfPath.value = product.pdfPath || '';

  itinFormTitle.innerHTML = '<i class="bi bi-pencil-square"></i> Edit Itinerary';
  itinSubmitBtn.innerHTML = '<i class="bi bi-check-circle"></i> Update Itinerary';
  cancelItinEditBtn.style.display = 'inline-flex';

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Delete itinerary
(window as any).deleteItinerary = async (id: string) => {
  if (!confirm("Are you sure you want to delete this itinerary? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, 'itinerary-products', id));
    setItinStatus('Itinerary deleted!', 'success');
    loadItineraryProducts();
  } catch (err: any) {
    console.error("Delete error", err);
    alert(`Could not delete: ${err.message}`);
  }
};

// Toggle itinerary active/inactive
(window as any).toggleItinerary = async (id: string, currentlyActive: boolean) => {
  try {
    await updateDoc(doc(db, 'itinerary-products', id), { isActive: !currentlyActive });
    setItinStatus(`Itinerary ${!currentlyActive ? 'activated' : 'deactivated'}!`, 'success');
    loadItineraryProducts();
    setTimeout(() => setItinStatus(''), 3000);
  } catch (err: any) {
    console.error("Toggle error", err);
    alert(`Could not toggle: ${err.message}`);
  }
};

// Cancel itinerary edit
cancelItinEditBtn.addEventListener('click', () => {
  itineraryForm.reset();
  quillEditor.root.innerHTML = '';
  itinDescription.value = '';
  editingItineraryId.value = '';
  itinCoverImageUrl.value = '';
  itinPdfPath.value = '';
  itinFormTitle.innerHTML = '<i class="bi bi-map"></i> Add New Itinerary';
  itinSubmitBtn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Save Itinerary';
  cancelItinEditBtn.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

let allOrders: any[] = [];

async function loadOrders() {
  try {
    if (import.meta.env.DEV) {
      // ── Local dev: read from .dev-orders.json via Vite middleware ──
      const r = await fetch('/api/get-orders-local');
      if (!r.ok) throw new Error('Failed to load local orders');
      const { orders } = await r.json();
      allOrders = orders;
    } else {
      // ── Production: read from Firestore ──
      const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      allOrders = [];
      snapshot.forEach(docSnap => {
        allOrders.push({ id: docSnap.id, ...docSnap.data() });
      });
    }
    renderOrdersTable();
  } catch (err: any) {
    console.error('Error loading orders', err);
    ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--error)">Error loading orders: ${err.message}</td></tr>`;
  }
}

function renderOrdersTable() {
  if (allOrders.length === 0) {
    ordersTableBody.innerHTML = `<tr><td colspan="5" class="text-center">No orders yet.</td></tr>`;
    return;
  }

  ordersTableBody.innerHTML = allOrders.map(order => {
    const amountDisplay = order.amount ? `₹${(order.amount / 100).toFixed(0)}` : '—';

    let dateDisplay = '—';
    if (order.createdAt?.toDate) {
      dateDisplay = order.createdAt.toDate().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } else if (order.createdAt) {
      dateDisplay = new Date(order.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    }

    const buyerName = order.buyerName || '—';
    const buyerContact = [order.buyerEmail, order.buyerPhone].filter(Boolean).join(' · ') || '—';
    const statusClass = order.status === 'paid' ? 'paid' : order.status === 'failed' ? 'failed' : 'created';

    return `
      <tr>
        <td><strong>${order.productTitle || '—'}</strong><br><small style="color:var(--text-muted)">${order.razorpayOrderId || order.id || ''}</small></td>
        <td>${amountDisplay}</td>
        <td><span class="status-badge ${statusClass}">${order.status || 'created'}</span></td>
        <td style="font-size:0.85rem"><strong>${buyerName}</strong><br><small style="color:var(--text-muted)">${buyerContact}</small></td>
        <td style="font-size:0.85rem;white-space:nowrap">${dateDisplay}</td>
      </tr>
    `;
  }).join('');
}
