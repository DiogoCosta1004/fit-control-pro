import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, updateDoc, deleteDoc, collection, addDoc, query, where, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ==========================================
// VARIÁVEIS GLOBAIS E ESTADO
// ==========================================
let cashflowChartInstance = null;
let categoryChartInstance = null;
let currentUserUid = null;
let unsubscribeTransactions = null;
let unsubscribeMetas = null;

// Estado local para facilitar as edições
let state = {
    transacoes: [],
    metas: []
};

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    background: '#1E293B',
    color: '#FFFFFF'
});

const formatBRL = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateBr = (dataIso) => {
    if(!dataIso) return '';
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
};

// ==========================================
// 1. INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    configurarData();
    configurarMenuMobile();
    configurarNavegacaoSPA();

    // Listeners de botões estáticos
    document.getElementById('logoutBtn').addEventListener('click', realizarLogout);
    
    // Botões de Nova Transação (visíveis em várias abas)
    document.querySelectorAll('#btnNovaReceita, .btn-success').forEach(btn => {
        if(btn.innerText.includes('Nova Receita')) btn.addEventListener('click', () => openTransactionModal('receita'));
    });
    document.querySelectorAll('#btnNovaDespesa, .btn-danger').forEach(btn => {
        if(btn.innerText.includes('Nova Despesa')) btn.addEventListener('click', () => openTransactionModal('despesa'));
    });

    // Botão Configurações
    document.getElementById('settingsForm').addEventListener('submit', atualizarPerfil);
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserUid = user.uid;
        await loadUserProfile(user.uid);
        initCharts(); 
        
        // Inicia as escutas em tempo real do Firestore
        iniciarEscutaTransacoes(user.uid);
        iniciarEscutaMetas(user.uid);

        const loader = document.getElementById('pageLoader');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    } else {
        window.location.replace('login.html');
    }
});

// ==========================================
// 2. NAVEGAÇÃO SPA
// ==========================================
function configurarNavegacaoSPA() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const views = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('pageTitle');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            item.classList.add('active');
            const targetView = item.getAttribute('data-view');
            document.getElementById(`view-${targetView}`).classList.add('active');
            pageTitle.innerText = item.querySelector('span').innerText;

            if(window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });
}

// ==========================================
// 3. LÓGICA DE PERFIL (CRUD)
// ==========================================
async function loadUserProfile(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const nomeCompleto = `${userData.nome} ${userData.sobrenome}`;
            
            // Atualiza UI
            document.getElementById('displayUserName').innerText = userData.nome;
            const fotoUrl = userData.fotoPerfil || `https://ui-avatars.com/api/?name=${userData.nome}+${userData.sobrenome}&background=4F46E5&color=fff`;
            document.getElementById('displayUserPhoto').src = fotoUrl;
            document.getElementById('settingsPhoto').src = fotoUrl;

            // Preenche o form de configurações
            const form = document.getElementById('settingsForm');
            form.querySelector('input[placeholder="Seu nome"]').value = userData.nome || '';
            form.querySelector('input[placeholder="Seu sobrenome"]').value = userData.sobrenome || '';
            form.querySelector('input[type="email"]').value = userData.email || '';
        }
    } catch (error) {
        console.error("Erro ao buscar perfil:", error);
    }
}

async function atualizarPerfil(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    const form = document.getElementById('settingsForm');
    const nome = form.querySelector('input[placeholder="Seu nome"]').value.trim();
    const sobrenome = form.querySelector('input[placeholder="Seu sobrenome"]').value.trim();

    try {
        await updateDoc(doc(db, "users", currentUserUid), {
            nome: nome,
            sobrenome: sobrenome
        });
        
        Toast.fire({ icon: 'success', title: 'Perfil atualizado!' });
        loadUserProfile(currentUserUid); // Recarrega os dados visuais
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível salvar.', background: '#1E293B', color: '#FFF' });
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ==========================================
// 4. LÓGICA DE TRANSAÇÕES (CRUD)
// ==========================================
function iniciarEscutaTransacoes(uid) {
    const q = query(collection(db, "transactions"), where("uid", "==", uid), orderBy("data", "desc"));

    unsubscribeTransactions = onSnapshot(q, (snapshot) => {
        state.transacoes = [];
        let totalReceitas = 0, totalDespesas = 0;
        const categoriasDespesa = {};

        snapshot.forEach((doc) => {
            const data = doc.data();
            state.transacoes.push({ id: doc.id, ...data });

            if (data.tipo === 'receita') {
                totalReceitas += data.valor;
            } else {
                totalDespesas += data.valor;
                categoriasDespesa[data.categoria] = (categoriasDespesa[data.categoria] || 0) + data.valor;
            }
        });

        atualizarDashboardSummary(totalReceitas, totalDespesas, categoriasDespesa);
        renderizarTabelas();
    });
}

function atualizarDashboardSummary(receitas, despesas, categoriasDespesa) {
    const saldo = receitas - despesas;
    const percentual = receitas > 0 ? ((saldo / receitas) * 100).toFixed(1) : 0;

    document.getElementById('cardSaldo').innerText = formatBRL(saldo);
    document.getElementById('cardReceitas').innerText = formatBRL(receitas);
    document.getElementById('cardDespesas').innerText = formatBRL(despesas);
    document.getElementById('cardEconomia').innerText = `${percentual}%`;

    if(categoryChartInstance) {
        categoryChartInstance.data.labels = Object.keys(categoriasDespesa).length ? Object.keys(categoriasDespesa) : ['Sem dados'];
        categoryChartInstance.data.datasets[0].data = Object.values(categoriasDespesa).length ? Object.values(categoriasDespesa) : [1];
        categoryChartInstance.update();
    }
}

function renderizarTabelas() {
    // 1. Tabela do Dashboard (últimas 5)
    renderizarTabelaGenerica('transactionsBody', state.transacoes.slice(0, 5));
    
    // 2. Tabela de Receitas (Aba Específica)
    const receitas = state.transacoes.filter(t => t.tipo === 'receita');
    renderizarTabelaEspecifica('view-receitas', receitas, 'receita');

    // 3. Tabela de Despesas (Aba Específica)
    const despesas = state.transacoes.filter(t => t.tipo === 'despesa');
    renderizarTabelaEspecifica('view-despesas', despesas, 'despesa');
}

function renderizarTabelaGenerica(tbodyId, dados) {
    const tbody = document.getElementById(tbodyId);
    if(!tbody) return;
    tbody.innerHTML = '';
    
    if (dados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhuma movimentação.</td></tr>`;
        return;
    }

    dados.forEach(t => {
        const tr = document.createElement('tr');
        const corValor = t.tipo === 'receita' ? 'var(--success)' : 'var(--error)';
        const sinal = t.tipo === 'receita' ? '+' : '-';
        const bgBadge = t.tipo === 'receita' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

        tr.innerHTML = `
            <td data-label="Descrição"><strong>${t.descricao}</strong></td>
            <td data-label="Categoria">${t.categoria}</td>
            <td data-label="Data">${formatDateBr(t.data)}</td>
            <td data-label="Valor" style="color: ${corValor}; font-weight: 600;">${sinal} ${formatBRL(t.valor)}</td>
            <td data-label="Tipo"><span style="background: ${bgBadge}; padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; color: ${corValor}; text-transform: capitalize;">${t.tipo}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderizarTabelaEspecifica(viewId, dados, tipo) {
    const tableId = tipo === 'receita' ? 'tableReceitas' : 'tableDespesas';
    const table = document.getElementById(tableId);
    if(!table) return;
    const tbody = table.querySelector('tbody');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    
    if (dados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhuma ${tipo} cadastrada.</td></tr>`;
        return;
    }

    dados.forEach(t => {
        const tr = document.createElement('tr');
        const corValor = tipo === 'receita' ? 'var(--success)' : 'var(--error)';
        const sinal = tipo === 'receita' ? '+' : '-';
        
        tr.innerHTML = `
            <td data-label="Descrição"><strong>${t.descricao}</strong></td>
            <td data-label="Categoria">${t.categoria}</td>
            <td data-label="Data">${formatDateBr(t.data)}</td>
            <td data-label="Valor" style="color: ${corValor}; font-weight: 600;">${sinal} ${formatBRL(t.valor)}</td>
            <td data-label="Ações" style="text-align: right;">
                <button onclick="window.editarTransacao('${t.id}')" style="background:var(--cards); padding:8px 12px; border-radius:8px; border:1px solid var(--border); color:var(--text); cursor:pointer; margin-right:5px;"><i class="fa-solid fa-pen"></i></button>
                <button onclick="window.deletarDocumento('transactions', '${t.id}')" style="background:rgba(239, 68, 68, 0.1); padding:8px 12px; border-radius:8px; border:1px solid var(--border); color:var(--error); cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// CREATE e UPDATE Transação (Modal Unificado)
window.openTransactionModal = function(tipo, transacaoId = null) {
    const isReceita = tipo === 'receita';
    const corTema = isReceita ? '#10B981' : '#EF4444';
    
    // Se tiver ID, é edição. Buscamos o objeto no estado local
    let t = transacaoId ? state.transacoes.find(x => x.id === transacaoId) : null;
    const titulo = t ? `Editar ${isReceita ? 'Receita' : 'Despesa'}` : `Adicionar ${isReceita ? 'Receita' : 'Despesa'}`;

    Swal.fire({
        title: `<span style="color: ${corTema}">${titulo}</span>`,
        html: `
            <div style="display: flex; flex-direction: column; gap: 12px; text-align: left;">
                <input id="swal-desc" class="swal2-input" placeholder="Descrição" style="margin: 0; width: 100%; box-sizing: border-box;" value="${t ? t.descricao : ''}">
                <input id="swal-valor" type="number" step="0.01" class="swal2-input" placeholder="Valor (R$)" style="margin: 0; width: 100%; box-sizing: border-box;" value="${t ? t.valor : ''}">
                <select id="swal-cat" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box; background: #0F172A; color: #FFF;">
                    <option value="" disabled ${!t ? 'selected' : ''}>Selecione uma Categoria</option>
                    ${isReceita ? `
                        <option value="Salário" ${t && t.categoria === 'Salário' ? 'selected' : ''}>Salário</option>
                        <option value="Investimentos" ${t && t.categoria === 'Investimentos' ? 'selected' : ''}>Investimentos</option>
                        <option value="Outros" ${t && t.categoria === 'Outros' ? 'selected' : ''}>Outros</option>
                    ` : `
                        <option value="Moradia" ${t && t.categoria === 'Moradia' ? 'selected' : ''}>Moradia</option>
                        <option value="Alimentação" ${t && t.categoria === 'Alimentação' ? 'selected' : ''}>Alimentação</option>
                        <option value="Transporte" ${t && t.categoria === 'Transporte' ? 'selected' : ''}>Transporte</option>
                        <option value="Lazer" ${t && t.categoria === 'Lazer' ? 'selected' : ''}>Lazer</option>
                        <option value="Saúde" ${t && t.categoria === 'Saúde' ? 'selected' : ''}>Saúde</option>
                    `}
                </select>
                <input id="swal-data" type="date" class="swal2-input" style="margin: 0; width: 100%; box-sizing: border-box;" value="${t ? t.data : new Date().toISOString().split('T')[0]}">
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
                Swal.showValidationMessage('Preencha todos os campos!');
                return false;
            }
            return { descricao: desc, valor: parseFloat(valor), categoria: cat, data: data, tipo: tipo, uid: currentUserUid };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                if (transacaoId) {
                    await updateDoc(doc(db, "transactions", transacaoId), result.value);
                    Toast.fire({ icon: 'success', title: 'Atualizado com sucesso!' });
                } else {
                    result.value.criadoEm = new Date().toISOString();
                    await addDoc(collection(db, "transactions"), result.value);
                    Toast.fire({ icon: 'success', title: 'Registrado com sucesso!' });
                }
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao salvar no banco.', background: '#1E293B', color: '#FFF' });
            }
        }
    });
};

window.editarTransacao = (id) => {
    const t = state.transacoes.find(x => x.id === id);
    if(t) openTransactionModal(t.tipo, id);
};


// ==========================================
// 5. LÓGICA DE METAS (CRUD)
// ==========================================
function iniciarEscutaMetas(uid) {
    const q = query(collection(db, "goals"), where("uid", "==", uid));

    unsubscribeMetas = onSnapshot(q, (snapshot) => {
        state.metas = [];
        snapshot.forEach((doc) => {
            state.metas.push({ id: doc.id, ...data });
        });
        renderizarMetas();
    });

    // Injeta o listener no botão de criar meta
    const btnNovaMeta = document.querySelector('#view-metas .btn-success');
    if(btnNovaMeta) {
        btnNovaMeta.onclick = () => window.openMetaModal();
    }
}

function renderizarMetas() {
    const container = document.querySelector('#view-metas .grid-cards');
    if(!container) return;
    container.innerHTML = '';

    if (state.metas.length === 0) {
        container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">Nenhuma meta cadastrada.</div>`;
        return;
    }

    state.metas.forEach(m => {
        const percentual = m.valorAlvo > 0 ? ((m.valorAtual / m.valorAlvo) * 100).toFixed(0) : 0;
        
        container.innerHTML += `
            <div class="progress-card glass-panel" style="position: relative;">
                <div class="progress-header">
                    <h4><i class="fa-solid fa-bullseye text-secondary"></i> ${m.titulo}</h4>
                    <span class="text-secondary" style="font-weight: 700;">${percentual}%</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percentual}%; background: var(--secondary);"></div>
                </div>
                <div class="progress-stats">
                    <span>Acumulado: ${formatBRL(m.valorAtual)}</span>
                    <span>Alvo: ${formatBRL(m.valorAlvo)} ${m.prazo ? `(${m.prazo})` : ''}</span>
                </div>
                <div style="position: absolute; top: 16px; right: 16px;">
                     <button onclick="window.editarMeta('${m.id}')" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; margin-right:8px;"><i class="fa-solid fa-pen"></i></button>
                     <button onclick="window.deletarDocumento('goals', '${m.id}')" style="background:transparent; border:none; color:var(--error); cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    });
}

// CREATE e UPDATE Meta
window.openMetaModal = function(metaId = null) {
    let m = metaId ? state.metas.find(x => x.id === metaId) : null;
    const tituloModal = m ? 'Editar Meta' : 'Nova Meta Financeira';

    Swal.fire({
        title: `<span style="color: var(--secondary)">${tituloModal}</span>`,
        html: `
            <div style="display: flex; flex-direction: column; gap: 12px; text-align: left;">
                <label style="color: var(--text-muted); font-size: 0.85rem;">Ex: Casa em Fortaleza, Reserva de Emergência</label>
                <input id="swal-meta-titulo" class="swal2-input" placeholder="Título da Meta" style="margin: 0; width: 100%; box-sizing: border-box;" value="${m ? m.titulo : ''}">
                
                <label style="color: var(--text-muted); font-size: 0.85rem; margin-top: 10px;">Valor Total Necessário (R$)</label>
                <input id="swal-meta-alvo" type="number" step="0.01" class="swal2-input" placeholder="Ex: 150000" style="margin: 0; width: 100%; box-sizing: border-box;" value="${m ? m.valorAlvo : ''}">
                
                <label style="color: var(--text-muted); font-size: 0.85rem; margin-top: 10px;">Valor Já Guardado (R$)</label>
                <input id="swal-meta-atual" type="number" step="0.01" class="swal2-input" placeholder="Ex: 37500" style="margin: 0; width: 100%; box-sizing: border-box;" value="${m ? m.valorAtual : '0'}">
                
                <label style="color: var(--text-muted); font-size: 0.85rem; margin-top: 10px;">Ano Alvo (Opcional)</label>
                <input id="swal-meta-prazo" type="number" class="swal2-input" placeholder="Ex: 2030" style="margin: 0; width: 100%; box-sizing: border-box;" value="${m && m.prazo ? m.prazo : ''}">
            </div>
        `,
        background: '#1E293B',
        showCancelButton: true,
        confirmButtonColor: '#06B6D4',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Salvar Meta',
        preConfirm: () => {
            const titulo = document.getElementById('swal-meta-titulo').value.trim();
            const alvo = document.getElementById('swal-meta-alvo').value;
            const atual = document.getElementById('swal-meta-atual').value;
            const prazo = document.getElementById('swal-meta-prazo').value;

            if (!titulo || !alvo) {
                Swal.showValidationMessage('Título e Valor Alvo são obrigatórios!');
                return false;
            }
            return { 
                titulo: titulo, 
                valorAlvo: parseFloat(alvo), 
                valorAtual: parseFloat(atual || 0), 
                prazo: prazo,
                uid: currentUserUid 
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                if (metaId) {
                    await updateDoc(doc(db, "goals", metaId), result.value);
                    Toast.fire({ icon: 'success', title: 'Meta atualizada!' });
                } else {
                    result.value.criadoEm = new Date().toISOString();
                    await addDoc(collection(db, "goals"), result.value);
                    Toast.fire({ icon: 'success', title: 'Meta criada!' });
                }
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao salvar meta.', background: '#1E293B', color: '#FFF' });
            }
        }
    });
};

window.editarMeta = (id) => {
    window.openMetaModal(id);
};

// ==========================================
// 6. UTILITÁRIOS E DELETE GLOBAL
// ==========================================
window.deletarDocumento = function(colecao, id) {
    Swal.fire({
        title: 'Tem certeza?',
        text: "Você não poderá reverter esta ação!",
        icon: 'warning',
        background: '#1E293B',
        color: '#FFF',
        showCancelButton: true,
        confirmButtonColor: '#EF4444',
        cancelButtonColor: '#475569',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await deleteDoc(doc(db, colecao, id));
                Toast.fire({ icon: 'success', title: 'Registro excluído.' });
            } catch (error) {
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir.', background: '#1E293B', color: '#FFF' });
            }
        }
    });
};

function configurarData() {
    const dataFormatada = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('currentDate').innerText = dataFormatada.charAt(0).toUpperCase() + dataFormatada.slice(1);
}

function configurarMenuMobile() {
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });
    }
    
    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Fecha ao clicar em um link do menu no celular
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if(window.innerWidth <= 768) closeSidebar();
        });
    });
}

// ATUALIZAÇÃO: Fechar o Chat de IA no celular
const closeChatMobileBtn = document.getElementById('closeChatMobileBtn');
if (closeChatMobileBtn) {
    closeChatMobileBtn.addEventListener('click', () => {
        document.getElementById('aiChatWindow').classList.remove('open');
        document.getElementById('toggleAiBtn').innerHTML = '<i class="fa-solid fa-robot"></i>';
    });
}

async function realizarLogout(e) {
    e.preventDefault();
    if(unsubscribeTransactions) unsubscribeTransactions(); 
    if(unsubscribeMetas) unsubscribeMetas();
    await signOut(auth);
    window.location.href = 'login.html';
}

// INICIALIZAÇÃO GRÁFICOS (Vazios inicialmente)
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
        options: { responsive: true, maintainAspectRatio: false }
    });

    categoryChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: ['Nenhuma Despesa'],
            datasets: [{ data: [1], backgroundColor: ['#4F46E5', '#06B6D4', '#F59E0B', '#10B981', '#8B5CF6'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right' } } }
    });

    // ==========================================
// 7. INTERAÇÕES DE UI: IA E FILTROS DE TEMPO
// ==========================================

// Controlador do Chat da IA
const toggleAiBtn = document.getElementById('toggleAiBtn');
const aiChatWindow = document.getElementById('aiChatWindow');
const aiSendBtn = document.getElementById('aiSendBtn');
const aiInputMsg = document.getElementById('aiInputMsg');
const aiChatBody = document.getElementById('aiChatBody');

if(toggleAiBtn && aiChatWindow) {
    toggleAiBtn.addEventListener('click', () => {
        aiChatWindow.classList.toggle('open');
        if(aiChatWindow.classList.contains('open')) {
            toggleAiBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        } else {
            toggleAiBtn.innerHTML = '<i class="fa-solid fa-robot"></i>';
        }
    });
}

function enviarMensagemIA() {
    const msg = aiInputMsg.value.trim();
    if(!msg) return;

    // 1. Renderiza a mensagem do usuário
    aiChatBody.innerHTML += `<div class="ai-msg user">${msg}</div>`;
    aiInputMsg.value = '';
    aiChatBody.scrollTop = aiChatBody.scrollHeight; // Rola pra baixo

    // 2. Simula o "Digitando..." da IA (Aqui vamos plugar a API do Gemini depois)
    const typingId = 'typing-' + Date.now();
    setTimeout(() => {
        aiChatBody.innerHTML += `<div class="ai-msg bot" id="${typingId}">Analisando seus dados... <i class="fa-solid fa-circle-notch fa-spin"></i></div>`;
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
        
        // Simulação de resposta provisória
        setTimeout(() => {
            document.getElementById(typingId).remove();
            aiChatBody.innerHTML += `<div class="ai-msg bot">Ainda estou em fase de testes da integração de API, mas vi que sua meta é ousada! Quando conectarmos o motor de IA real, vou calcular se seu aporte atual é suficiente para atingir seus objetivos nos prazos estipulados.</div>`;
            aiChatBody.scrollTop = aiChatBody.scrollHeight;
        }, 1500);
    }, 500);
}

if(aiSendBtn) aiSendBtn.addEventListener('click', enviarMensagemIA);
if(aiInputMsg) aiInputMsg.addEventListener('keypress', (e) => { if(e.key === 'Enter') enviarMensagemIA(); });

// Controlador de Filtros Temporais
const filterBtns = document.querySelectorAll('.filter-btn');
let periodoAtivo = 'mensal'; // Default

filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        periodoAtivo = e.target.getAttribute('data-period');
        
        // Aqui notificamos o usuário que o filtro mudou.
        // No próximo passo, vamos injetar as datas de Start e End direto no `where()` do Firebase!
        Toast.fire({
            icon: 'info',
            title: `Filtro alterado para: ${periodoAtivo.charAt(0).toUpperCase() + periodoAtivo.slice(1)}`
        });
    });
});
}