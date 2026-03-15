import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = {
  apiKey: "AIzaSyCITqkoUxhvdxS4mUZFOWP4GSabwBKaLn4",
  authDomain: "onroadcouple-store.firebaseapp.com",
  projectId: "onroadcouple-store",
  storageBucket: "onroadcouple-store.firebasestorage.app",
  messagingSenderId: "401126042425",
  appId: "1:401126042425:web:4c0cd8d3deb8fbdaa696e8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Read existing JSON
const json = JSON.parse(fs.readFileSync('./public/data/amazon-products.json', 'utf8'));

async function migrate() {
  const products = json.products || [];
  console.log(`Migrating ${products.length} products to Firestore...`);
  
  if (products.length === 0) {
    console.log("No products found in JSON.");
    process.exit(0);
  }

  for (let i = products.length - 1; i >= 0; i--) {
    const product = products[i]; // Reverse order so newest (index 0) is added last to have the latest timestamp!
    const newDoc = {
      title: product.title,
      price: product.price,
      rating: product.rating,
      image: product.image,
      description: product.description,
      category: product.category,
      affiliateLink: product.affiliateLink,
      createdAt: serverTimestamp(),
    };
    
    try {
      await addDoc(collection(db, 'products'), newDoc);
      console.log(`✅ Added: ${product.title}`);
    } catch (e) {
      console.error(`❌ Failed to add: ${product.title}`, e);
    }
    
    // Slight delay to ensure sequence order in timestamps
    await new Promise(res => setTimeout(res, 500));
  }
  
  console.log("\nMigration complete! 🎉");
  process.exit(0);
}

migrate();
