import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ⚠️ Firebase 콘솔에서 본인 프로젝트 설정으로 교체하세요!
// https://console.firebase.google.com
const firebaseConfig = {
    apiKey: "AIzaSyCy4-_ArImQCf0lUjVJ16wVkegKDMFcjv0",
  authDomain: "workout-app-c8565.firebaseapp.com",
  projectId: "workout-app-c8565",
  storageBucket: "workout-app-c8565.firebasestorage.app",
  messagingSenderId: "982468334712",
  appId: "1:982468334712:web:9c9dffcd19aed58bdec98d",
  measurementId: "G-1CRQC6ZRJR"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
