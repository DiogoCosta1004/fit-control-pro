import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let cashflowChartInstance = null;
let categoryChartInstance = null;
let currentUserUid = null;
let unsubscribeTransactions = null;

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
    configurarData();
    configurarMenuMobile();
    configurarNavegacaoSPA();

    document.getElementById('logoutBtn').addEventListener('click', realizarLogout);
    document.getElementById('btnNovaReceita').addEventListener('click', () => openTransactionModal('receita'));
    document.getElementById('btnNovaDespesa').addEventListener('click', () => openTransactionModal('despesa'));
});

// ==========================================
// 1. AUTENTICAÇÃO E INICIALIZAÇÃO
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserUid = user.uid;
        await loadUserProfile(user.uid);
        initCharts(); 
        iniciarEscutaTransacoes(user.uid); // Começa a ouvir o banco de dados em tempo real

        const loader = document.getElementById('pageLoader');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    } else {
        window.location.replace('login.html');
    }
});

async function loadUserProfile(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            document.getElementById('displayUserName').innerText = `${userData.nome} ${userData.sobrenome}`;
            document.getElementById('displayUserPhoto').src = userData.fotoPerfil || `https://ui-avatars.com/api/?name=${userData.nome}+${userData.sobrenome}&background=4F46E5&color=fff`;
        }
    } catch (error) {
        console.error("Erro ao buscar perfil:", error);
    }
}

// ==========================================
// 2. LÓGICA DE NAVEGAÇÃO SPA
// ==========================================
function configurarNavegacaoSPA() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const views = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('pageTitle');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active de todos os menus e esconde todas as views
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            // Adiciona active no clicado
            item.classList.add('active');
            const targetView = item.getAttribute('data-view');
            document.getElementById(`view-${targetView}`).classList.add('active');

            // Atualiza o título do Topbar
            pageTitle.innerText = item.querySelector('span').innerText;

            // Fecha sidebar no mobile ao clicar
            if(window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });
}

// ==========================================
// 3. FIREBASE REAL-TIME (onSnapshot)
// ==========================================
function iniciarEscutaTransacoes(uid) {
    const q = query(
        collection(db, "transactions"), 
        where("uid", "==", uid),
        orderBy("data", "desc")
    );

    unsubscribeTransactions = onSnapshot(q, (snapshot) => {
        let totalReceitas = 0;
        let totalDespesas = 0;
        const transacoes = [];
        const categoriasDespesa = {}; // Para o gráfico de pizza

        snapshot.forEach((doc) => {
            const data = doc.data();
            transacoes.push({ id: doc.id, ...data });

            if (data.tipo === 'receita') {
                totalReceitas += data.valor;
            } else {
                totalDespesas += data.valor;
                // Soma por categoria
                if(categoriasDespesa[data.categoria]) {
                    categoriasDespesa[data.categoria] += data.valor;
                } else {
                    categoriasDespesa[data.categoria] = data.valor;
                }
            }
        });

        atualizarDashboard(totalReceitas, totalDespesas, transacoes, categoriasDespesa);
    });
}

function atualizarDashboard(receitas, despesas, transacoes, categoriasDespesa) {
    const saldo = receitas - despesas;
    let percentualBalanco = 0;
    
    if (receitas > 0) {
        percentualBalanco = ((saldo / receitas) * 100).toFixed(1);
    }

    // Formatação BRL
    const formatBRL = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    document.getElementById('cardSaldo').innerText = formatBRL(saldo);
    document.getElementById('cardReceitas').innerText = formatBRL(receitas);
    document.getElementById('cardDespesas').innerText = formatBRL(despesas);
    document.getElementById('cardEconomia').innerText = `${percentualBalanco}%`;

    // Atualiza Tabela
    const tbody = document.getElementById('transactionsBody');
    tbody.innerHTML = '';
    
    if (transacoes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhuma movimentação recente.</td></tr>`;
    } else {
        transacoes.slice(0, 10).forEach(t => { // Mostra as últimas 10
            const tr = document.createElement('tr');
            const corValor = t.tipo === 'receita' ? 'var(--success)' : 'var(--error)';
            const sinal = t.tipo === 'receita' ? '+' : '-';
            
            // Formata a data de YYYY-MM-DD para DD/MM/YYYY
            const dataParts = t.data.split('-');
            const dataFormatada = `${dataParts[2]}/${dataParts[1]}/${dataParts[0]}`;

            tr.innerHTML = `
                <td><strong>${t.descricao}</strong></td>
                <td>${t.categoria}</td>
                <td>${dataFormatada}</td>
                <td style="color: ${corValor}; font-weight: 600;">${sinal} ${formatBRL(t.valor)}</td>
                <td><span style="background: ${t.tipo === 'receita' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; color: ${corValor}; text-transform: capitalize;">${t.tipo}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Atualiza Gráfico de Categorias Dinamicamente
    if(categoryChartInstance) {
        categoryChartInstance.data.labels = Object.keys(categoriasDespesa);
        categoryChartInstance.data.datasets[0].data = Object.values(categoriasDespesa);
        categoryChartInstance.update();
    }
}

// ==========================================
// 4. INICIALIZAÇÃO DOS GRÁFICOS (Vazios)
// ==========================================
function initCharts() {
    Chart.defaults.color = '#94A3B8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    const ctxCash = document.getElementById('cashflowChart').getContext('2d');
    const ctxCat = document.getElementById('categoryChart').getContext('2d');

    cashflowChartInstance = new Chart(ctxCash, {
        type: 'line',
        data: {
            labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
            datasets: [
                { label: 'Receitas', data: [0, 0, 0, 0], borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.4, fill: true },
                { label: 'Despesas', data: [0, 0, 0, 0], borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 2, tension: 0.4, fill: true }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });

    categoryChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: ['Nenhuma Despesa'],
            datasets: [{
                data: [1],
                backgroundColor: ['#4F46E5', '#06B6D4', '#F59E0B', '#10B981', '#8B5CF6'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right' } } }
    });
}

// ==========================================
// 5. MODAL DE TRANSAÇÃO E SALVAMENTO
// ==========================================
function openTransactionModal(tipo) {
    const isReceita = tipo === 'receita';
    const corTema = isReceita ? '#10B981' : '#EF4444';
    const titulo = isReceita ? 'Adicionar Receita' : 'Adicionar Despesa';

    Swal.fire({
        title: `<span style="color: ${corTema}">${titulo}</span>`,
        html: `
            <div style="display: flex; flex-direction: column; gap: 12px; text-align: left;">
                <input id="swal-desc" class="swal2-input" placeholder="Descrição (ex: Salário, Mercado)" style="margin: 0; width: 100%; box-sizing: border-box;">
                <input id="swal-valor" type="number" step="0.01" class="swal2-input" placeholder="Valor (R$)" style="margin: 0; width: 100%; box-sizing: border-box;">
                <select id="swal-cat" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0F172A; color: #FFF;">
                    <option value="" disabled selected>Selecione uma Categoria</option>
                    ${isReceita ? `
                        <option value="Salário">Salário</option>
                        <option value="Investimentos">Investimentos</option>
                        <option value="Outros">Outros</option>
                    ` : `
                        <option value="Moradia">Moradia</option>
                        <option value="Alimentação">Alimentação</option>
                        <option value="Transporte">Transporte</option>
                        <option value="Lazer">Lazer</option>
                        <option value="Saúde">Saúde</option>
                    `}
                </select>
                <input id="swal-data" type="date" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box;" value="${new Date().toISOString().split('T')[0]}">
            </div>
        `,
        background: '#1E293B',
        showCancelButton: true,
        confirmButtonColor: corTema,
        cancelButtonColor: '#475569',
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const desc = document.getElementById('swal-desc').value.trim();
            const valor = document.getElementById('swal-valor').value;
            const cat = document.getElementById('swal-cat').value;
            const data = document.getElementById('swal-data').value;

            if (!desc || !valor || !cat || !data) {
                Swal.showValidationMessage('Por favor, preencha todos os campos!');
                return false;
            }

            return { descricao: desc, valor: parseFloat(valor), categoria: cat, data: data, tipo: tipo, uid: currentUserUid, criadoEm: new Date().toISOString() };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await addDoc(collection(db, "transactions"), result.value);
                Toast.fire({ icon: 'success', title: 'Registrado com sucesso!' });
            } catch (error) {
                console.error("Erro ao salvar:", error);
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível salvar.', background: '#1E293B', color: '#FFF' });
            }
        }
    });
}

// ==========================================
// 6. UTILITÁRIOS
// ==========================================
function configurarData() {
    const dataFormatada = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('currentDate').innerText = dataFormatada.charAt(0).toUpperCase() + dataFormatada.slice(1);
}

function configurarMenuMobile() {
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    }
}

async function realizarLogout(e) {
    e.preventDefault();
    if(unsubscribeTransactions) unsubscribeTransactions(); // Para de ouvir o banco antes de sair
    await signOut(auth);
    window.location.href = 'login.html';
}