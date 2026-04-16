import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Note: Replace these values with your actual Firebase project config 
// from the Firebase Console -> Project Settings -> General
const firebaseConfig = {
  apiKey: "AIzaSyDXLkLkKMlFcDvhkMXFaPbG-5s_49VlyAE",
  authDomain: "studio-8201154858-c15c0.firebaseapp.com",
  projectId: "studio-8201154858-c15c0",
  storageBucket: "studio-8201154858-c15c0.firebasestorage.app",
  messagingSenderId: "312134462400",
  appId: "1:312134462400:web:8f05f9212174465dd97625"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
