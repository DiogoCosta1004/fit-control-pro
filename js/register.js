import { auth, db } from './firebase.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// Configuração do SweetAlert2
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
    const registerForm = document.getElementById('registerForm');
    
    // --- LÓGICA VISUAL: Medidor de Força da Senha ---
    const passwordInput = document.getElementById('password');
    const strengthMeter = document.getElementById('strengthMeter');
    const strengthText = document.getElementById('strengthText');

    if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
            const val = e.target.value;
            let strength = 0;
            
            if (val.length >= 6) strength += 25;
            if (val.length >= 8) strength += 25;
            if (/[A-Z]/.test(val)) strength += 25;
            if (/[0-9]/.test(val)) strength += 25;

            strengthMeter.style.width = `${strength}%`;
            
            if (strength <= 25) {
                strengthMeter.style.background = 'var(--error)';
                strengthText.innerText = 'Senha muito fraca';
            } else if (strength <= 50) {
                strengthMeter.style.background = 'var(--warning)';
                strengthText.innerText = 'Senha média';
            } else if (strength <= 75) {
                strengthMeter.style.background = '#3b82f6'; // Azul
                strengthText.innerText = 'Senha boa';
            } else {
                strengthMeter.style.background = 'var(--success)';
                strengthText.innerText = 'Senha forte';
            }
        });
    }

    // --- LÓGICA DE CADASTRO ---
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Captura dos dados do formulário
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const terms = document.getElementById('termsAgreement').checked;
            const registerBtn = document.getElementById('registerBtn');

            // Validações Front-end
            if (password !== confirmPassword) {
                Toast.fire({ icon: 'error', title: 'As senhas não coincidem!' });
                return;
            }

            if (!terms) {
                Toast.fire({ icon: 'error', title: 'Você precisa aceitar os termos!' });
                return;
            }

            // Feedback visual de carregamento
            const originalBtnContent = registerBtn.innerHTML;
            registerBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Criando Conta...';
            registerBtn.disabled = true;

            try {
                // 1. Criar usuário no Firebase Authentication
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. Criar o Perfil do Usuário no Firestore
                // Isso é essencial para o seu dashboard.js (loadUserProfile) funcionar!
                await setDoc(doc(db, "users", user.uid), {
                    nome: firstName,
                    sobrenome: lastName,
                    email: email,
                    fotoPerfil: "", // Pode deixar vazio ou colocar o caminho do default-avatar
                    plano: "Gratuito",
                    criadoEm: new Date().toISOString()
                });

                Toast.fire({
                    icon: 'success',
                    title: 'Bem-vindo(a)! Conta criada com sucesso.'
                });

                // 3. Redirecionar para o dashboard após sucesso
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1000);

            } catch (error) {
                console.error("Erro no cadastro:", error);
                
                let errorMessage = "Ocorreu um erro ao criar a conta. Tente novamente.";
                
                // Tratamento de erros comuns do Firebase Auth
                if (error.code === 'auth/email-already-in-use') {
                    errorMessage = "Este e-mail já está cadastrado. Tente fazer login.";
                } else if (error.code === 'auth/weak-password') {
                    errorMessage = "A senha é muito fraca. Use pelo menos 6 caracteres.";
                } else if (error.code === 'auth/invalid-email') {
                    errorMessage = "O formato do e-mail é inválido.";
                }

                Swal.fire({
                    icon: 'error',
                    title: 'Ops, algo deu errado',
                    text: errorMessage,
                    background: '#1E293B',
                    color: '#FFF',
                    confirmButtonColor: '#4F46E5'
                });

            } finally {
                // Restaura o botão caso dê erro
                registerBtn.innerHTML = originalBtnContent;
                registerBtn.disabled = false;
            }
        });
    }
});