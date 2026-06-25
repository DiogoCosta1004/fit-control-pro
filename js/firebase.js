import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

// Sua configuração oficial do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBVbK7hm0ACHuysClMcEKLGTj8JPKgD8Xg",
  authDomain: "fincontrol-pro-1eb1d.firebaseapp.com",
  projectId: "fincontrol-pro-1eb1d",
  storageBucket: "fincontrol-pro-1eb1d.firebasestorage.app",
  messagingSenderId: "447763566535",
  appId: "1:447763566535:web:1654684ce98b9b1f7b13e2",
  measurementId: "G-V7CM7V1S7R"
};

// Inicialização do App
const app = initializeApp(firebaseConfig);

// Exportação dos serviços essenciais
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Provedores de Autenticação Social
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();