import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhtJAGXgXhZGb6oHdpaOtVdNDBwBJe4gE",
  authDomain: "joias-game.firebaseapp.com",
  projectId: "joias-game",
  storageBucket: "joias-game.firebasestorage.app",
  messagingSenderId: "30425658803",
  appId: "1:30425658803:web:56a2201b1453649cc847c6",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

export { db, doc, getDoc, onSnapshot, setDoc, updateDoc };
