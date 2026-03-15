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
const productForm = document.getElementById('productForm') as HTMLFormElement;
const statusMessage = document.getElementById('statusMessage') as HTMLElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
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

let dropifyInstance: any = null;
let cropperInstance: any = null;
let croppedImageBlob: Blob | null = null;
let isCroppingInternal: boolean = false;

document.addEventListener("DOMContentLoaded", () => {
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
      await signInWithEmailAndPassword(auth, email, password);
      loginForm.reset();
    } catch (error: any) {
      alert(`Login failed: ${error.message}`);
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

// ─── Helpers ───────────────────────────────────────────────────────

function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  statusMessage.textContent = msg;
  statusMessage.className = `status-msg ${type}`;
}

// ─── Fetch & Render Products (Manage Table) ───────────────────────────────────

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

// ─── Form Submission (Firestore Create/Update) ────────────────────────────────

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
      
      // Also sync to Firebase Storage for consistency if desired, 
      // but the local path is what we'll use for the store page during dev.
    } 
    // ─── Remote / Production Flow ──────────────────────────────────────────────
    else if (croppedImageBlob) {
      finalImageUrl = await uploadWithProgress(croppedImageBlob, '.jpg');
    }
    // Else if they selected a file but didn't crop (e.g. bug or bypassed), upload as is
    else if (pImageFile.files && pImageFile.files.length > 0 && !editingProductId.value) {
       // Only strictly enforce image if it's a new product
      const file = pImageFile.files[0];
      finalImageUrl = await uploadWithProgress(file, file.name);
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
async function uploadWithProgress(fileOrBlob: File | Blob, originalName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isBlob = !(fileOrBlob instanceof File);
    const safeName = isBlob ? `product_image_${Date.now()}.jpg` : originalName.replace(/[^a-zA-Z0-9.]/g, '_');
    const storageRef = ref(storage, `products/${Date.now()}_${safeName}`);
    
    uploadProgressContainer.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadPercent.textContent = '0';
    
    const uploadTask = uploadBytesResumable(storageRef, fileOrBlob);
    
    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        uploadProgressBar.style.width = `${progress}%`;
        uploadPercent.textContent = Math.round(progress).toString();
        setStatus(`Uploading... ${Math.round(progress)}%`, 'info');
      }, 
      (error) => {
        uploadProgressContainer.style.display = 'none';
        reject(error);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        uploadProgressContainer.style.display = 'none';
        resolve(downloadURL);
      }
    );
  });
}
