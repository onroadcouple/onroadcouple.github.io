import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCITqkoUxhvdxS4mUZFOWP4GSabwBKaLn4",
  authDomain: "onroadcouple-store.firebaseapp.com",
  projectId: "onroadcouple-store",
  storageBucket: "onroadcouple-store.firebasestorage.app",
  messagingSenderId: "401126042425",
  appId: "1:401126042425:web:4c0cd8d3deb8fbdaa696e8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
