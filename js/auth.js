import { auth, googleProvider, githubProvider } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    setPersistence, 
    browserLocalPersistence, 
    browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// Configuração base do SweetAlert2 para combinar com o tema
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    background: '#1E293B',
    color: '#FFFFFF'
});

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const githubLoginBtn = document.getElementById('githubLoginBtn');

    if (loginForm) {
        loginForm.addEventListener('submit', handleEmailLogin);
    }

    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', () => handleSocialLogin(googleProvider));
    }

    if (githubLoginBtn) {
        githubLoginBtn.addEventListener('click', () => handleSocialLogin(githubProvider));
    }
});

async function handleEmailLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('rememberMe').checked;
    const loginBtn = document.getElementById('loginBtn');

    // Feedback visual de carregamento
    const originalBtnContent = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Autenticando...';
    loginBtn.disabled = true;

    try {
        // Persistência de Login Baseada no Checkbox
        const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, persistenceType);

        await signInWithEmailAndPassword(auth, email, password);
        
        Toast.fire({
            icon: 'success',
            title: 'Login realizado com sucesso!'
        });

        // Redirecionamento após o login
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);

    } catch (error) {
        console.error("Erro no login:", error.code);
        let errorMessage = "Ocorreu um erro ao tentar fazer login.";
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            errorMessage = "E-mail ou senha inválidos.";
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = "Muitas tentativas falhas. Tente novamente mais tarde.";
        }

        Swal.fire({
            icon: 'error',
            title: 'Acesso Negado',
            text: errorMessage,
            background: '#1E293B',
            color: '#FFF',
            confirmButtonColor: '#4F46E5'
        });

    } finally {
        loginBtn.innerHTML = originalBtnContent;
        loginBtn.disabled = false;
    }
}

async function handleSocialLogin(provider) {
    try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithPopup(auth, provider);
        
        Toast.fire({
            icon: 'success',
            title: 'Login realizado com sucesso!'
        });

        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);

    } catch (error) {
        console.error("Erro no login social:", error);
        if (error.code !== 'auth/popup-closed-by-user') {
            Swal.fire({
                icon: 'error',
                title: 'Erro de Autenticação',
                text: 'Não foi possível concluir o login com o provedor selecionado.',
                background: '#1E293B',
                color: '#FFF',
                confirmButtonColor: '#4F46E5'
            });
        }
    }
}