import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCy4-_ArImQCf0lUjVJ16wVkegKDMFcjv0",
  authDomain: "workout-app-c8565.firebaseapp.com",
  projectId: "workout-app-c8565",
  storageBucket: "workout-app-c8565.firebasestorage.app",
  messagingSenderId: "982468334712",
  appId: "1:982468334712:web:9c9dffcd19aed58bdec98d",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function deleteCollection(colName) {
  const snap = await getDocs(collection(db, colName));
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    console.log(`  삭제: ${colName}/${d.id}`);
  }
  console.log(`✓ ${colName} (${snap.size}건) 삭제 완료`);
}

async function main() {
  console.log("전체 데이터 삭제 시작...\n");
  await deleteCollection("certifications");
  await deleteCollection("users");
  await deleteDoc(doc(db, "settings", "global"));
  console.log("✓ settings/global 삭제 완료");
  console.log("\n모든 데이터가 삭제되었습니다.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
