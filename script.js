/* script.js - integrado: admin add/remove users, professores pré-cadastrados, reservas, catálogo ampliado */
(() => {
  'use strict';

  /* =========================
     Configurações e constantes
     ========================= */
  const livrosKey = 'sis_bibl_livros_v1';
  const usuariosKey = 'sis_bibl_usuarios_v1';
  const horariosKey = 'sis_bibl_horarios_v1';
  const TARGET_CATALOG_SIZE = 150;

  const SERIES_ORDER = ['6º Ano','7º Ano','8º Ano','9º Ano','1º EM','2º EM','3º EM'];
  const AREAS = ['Literatura','Enciclopédia','Ciências','História','Artes','Tecnologia','Matemática','Filosofia','Biologia','Química'];
  const AUTORES = ['Vários','Equipe Didática','Editora Escolar','Autor Desconhecido','Coleção Didática'];
  const DIAS_SEMANA = ['Segunda','Terça','Quarta','Quinta','Sexta'];

  /* =========================
     Dados iniciais (amostra)
     ========================= */
  const livrosInit = [
    { id:1,titulo:"Matemática Básica - 6º Ano",autor:"Equipe Didática",serie:"6º Ano",disponivel:true,dataDevolucao:null,locatario:null,turma:null },
    { id:2,titulo:"Ciências Naturais - 6º Ano",autor:"Equipe Didática",serie:"6º Ano",disponivel:true,dataDevolucao:null,locatario:null,turma:null },
    { id:3,titulo:"História Antiga - 7º Ano",autor:"Equipe Didática",serie:"7º Ano",disponivel:true,dataDevolucao:null,locatario:null,turma:null },
    { id:4,titulo:"Geografia Ilustrada - 7º Ano",autor:"Equipe Didática",serie:"7º Ano",disponivel:true,dataDevolucao:null,locatario:null,turma:null },
    { id:5,titulo:"Química Básica - 8º Ano",autor:"Equipe Didática",serie:"8º Ano",disponivel:true,dataDevolucao:null,locatario:null,turma:null }
  ];

  const usuariosInit = [
    { id:1, nome:"Administrador", email:"admin@escola.local", senha:"admin123", tipo:"administrador" },
    { id:2, nome:"Prof. Ana Silva", email:"ana.silva@escola.local", senha:"prof2024", tipo:"professor" },
    { id:3, nome:"Prof. Carlos Souza", email:"carlos.souza@escola.local", senha:"prof2024", tipo:"professor" },
    { id:4, nome:"Prof. Maria Lima", email:"maria.lima@escola.local", senha:"prof2024", tipo:"professor" }
  ];

  /* =========================
     Helpers: storage, util
     ========================= */
  function loadOrInit(key, initValue){
    const raw = localStorage.getItem(key);
    if(!raw){
      localStorage.setItem(key, JSON.stringify(initValue));
      return deepClone(initValue);
    }
    try {
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length === 0){
        localStorage.setItem(key, JSON.stringify(initValue));
        return deepClone(initValue);
      }
      return parsed;
    } catch {
      localStorage.setItem(key, JSON.stringify(initValue));
      return deepClone(initValue);
    }
  }
  function save(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  function persistAll(){ save(livrosKey, livros); save(usuariosKey, usuarios); save(horariosKey, horarios); }
  function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

  function debounce(fn, delay=300){
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(()=> fn(...args), delay);
    };
  }

  /* =========================
     Horários generator
     ========================= */
  function gerarHorarios(inicio, fim, duracao, turno){
    const horariosGerados = [];
    let atual = new Date(`1970-01-01T${inicio}:00`);
    const limite = new Date(`1970-01-01T${fim}:00`);
    let idx = 0;
    while(atual < limite){
      let fimBloco = new Date(atual.getTime() + duracao*60000);
      if(fimBloco > limite) fimBloco = limite;
      horariosGerados.push({
        id: `${turno}-${idx}`,
        periodo: `${atual.toTimeString().substring(0,5)} - ${fimBloco.toTimeString().substring(0,5)}`,
        status: "Disponível",
        classe: "disponivel",
        professor: null,
        diaSemana: null
      });
      atual = fimBloco;
      idx++;
    }
    return horariosGerados;
  }

  /* =========================
     Inicialização de dados
     ========================= */
  let livros = loadOrInit(livrosKey, livrosInit);
  let usuarios = loadOrInit(usuariosKey, usuariosInit);
  let horarios = loadOrInit(horariosKey, [
    ...gerarHorarios("07:30","11:55",50,"manha"),
    ...gerarHorarios("13:00","17:30",50,"tarde"),
    ...gerarHorarios("18:30","22:45",50,"noite")
  ]);

  let currentUser = null;

  /* =========================
     Catalog expansion
     ========================= */
  function expandirCatalogoSeNecessario(){
    const current = livros.length;
    if(current >= TARGET_CATALOG_SIZE) return;
    let id = livros.reduce((m,x)=>Math.max(m,x.id),0) + 1;
    const counters = {};
    SERIES_ORDER.forEach(s => counters[s] = (livros.filter(l => l.serie === s).length || 0));
    let i = current;
    let seriesIndex = 0;
    while(i < TARGET_CATALOG_SIZE){
      const serie = SERIES_ORDER[seriesIndex % SERIES_ORDER.length];
      const area = AREAS[i % AREAS.length];
      const autor = AUTORES[i % AUTORES.length];
      counters[serie] = (counters[serie] || 0) + 1;
      livros.push({
        id: id++,
        titulo: `${area} - ${serie} Vol. ${counters[serie]}`,
        autor: autor,
        serie: serie,
        disponivel: true,
        dataDevolucao: null,
        locatario: null,
        turma: null
      });
      i++; seriesIndex++;
    }
    persistAll();
  }

  /* =========================
     Google Books API cache
     ========================= */
  const capaCache = new Map();
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

  async function buscarLivroGoogle(titulo){
    if(!titulo) return { capa: null, descricao: '' };
    const key = titulo.toLowerCase();
    const cached = capaCache.get(key);
    const now = Date.now();
    if(cached && (now - cached.fetchedAt) < CACHE_TTL_MS){
      return cached.data;
    }
    try{
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(titulo)}&maxResults=1`);
      const dados = await res.json();
      if(dados && dados.items && dados.items.length>0){
        const info = dados.items[0].volumeInfo || {};
        const data = { capa: info.imageLinks ? info.imageLinks.thumbnail : null, description: info.description || '' };
        capaCache.set(key, { data, fetchedAt: now });
        return data;
      }
    } catch(e){
      console.warn('buscarLivroGoogle erro', e);
    }
    const fallback = { capa: null, descricao: '' };
    capaCache.set(key, { data: fallback, fetchedAt: now });
    return fallback;
  }

  /* =========================
     UI helpers: modais, notificações
     ========================= */
  function abrirModal(id){
    const modal = document.getElementById(id);
    if(!modal) return;
    modal.setAttribute('aria-hidden','false');
    modal.classList.add('open');
    const first = modal.querySelector('input, select, textarea, button');
    if(first) first.focus();
    document.body.classList.add('modal-open');
  }
  function fecharModal(id){
    const modal = document.getElementById(id);
    if(!modal) return;
    modal.setAttribute('aria-hidden','true');
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
  }
  function toast(msg){
    try {
      const container = document.getElementById('toast-container');
      if(container){
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(()=> el.classList.add('visible'), 10);
        setTimeout(()=> el.remove(), 3500);
      } else {
        console.log('TOAST:', msg);
      }
    } catch(e){
      console.log(msg);
    }
  }

  /* =========================================
     Atualizar contagens, badges e Nova Aba Perfil
     ========================================= */
  function atualizarContagemCatalogo(){
    const el = document.getElementById('catalogo-contagem');
    if(el) el.textContent = `Livros no catálogo: ${livros.length}`;
    const sidebarUser = document.getElementById('sidebar-usuario');
    if(sidebarUser) sidebarUser.textContent = currentUser ? currentUser.nome : 'Convidado';
    const userBadge = document.getElementById('user-badge');
    if(userBadge) userBadge.textContent = currentUser ? `${currentUser.nome} (${currentUser.tipo})` : 'Convidado';
    const adminActions = document.getElementById('admin-actions');
    const logoutBtn = document.getElementById('btn-logout');
    
    if(currentUser && currentUser.tipo === 'administrador'){
      if(adminActions) adminActions.style.display = 'block';
      if(logoutBtn) logoutBtn.style.display = 'inline-block';
    } else {
      if(adminActions) adminActions.style.display = 'none';
      if(logoutBtn) logoutBtn.style.display = currentUser ? 'inline-block' : 'none';
    }
  }

  // NOVA FUNÇÃO: Sincroniza dinamicamente as informações com a aba "Minha Conta"
  function atualizarPerfilUI(){
    const perfNome = document.getElementById('perfil-nome');
    const perfEmail = document.getElementById('perfil-email');
    const perfNivel = document.getElementById('perfil-nivel');

    if (currentUser) {
      if (perfNome) perfNome.textContent = currentUser.nome;
      if (perfEmail) perfEmail.textContent = currentUser.email;
      if (perfNivel) {
        perfNivel.textContent = currentUser.tipo.charAt(0).toUpperCase() + currentUser.tipo.slice(1);
      }
    } else {
      if (perfNome) perfNome.textContent = 'Convidado';
      if (perfEmail) perfEmail.textContent = 'Não autenticado';
      if (perfNivel) perfNivel.textContent = 'Visitante';
    }
  }

  /* =========================
     Render: Biblioteca
     ========================= */
  async function renderBiblioteca(filterSerie='all', busca=''){
    const container = document.getElementById('series-grid');
    if(!container) return;
    container.innerHTML = '';
    const series = SERIES_ORDER.filter(s => livros.some(l => l.serie === s));
    if(series.length === 0){
      container.innerHTML = '<p>Nenhum livro cadastrado.</p>';
      return;
    }

    const termo = (busca || '').toLowerCase();
    const frag = document.createDocumentFragment();

    for(const s of series){
      if(filterSerie !== 'all' && filterSerie !== s) continue;
      const bloco = document.createElement('section');
      bloco.className = 'series-block';
      const titulo = document.createElement('h4');
      titulo.textContent = s;
      bloco.appendChild(titulo);
      const grid = document.createElement('div');
      grid.className = 'grid-livros';

      const subset = livros.filter(l => l.serie === s && (
        termo === '' ||
        l.titulo.toLowerCase().includes(termo) ||
        (l.autor && l.autor.toLowerCase().includes(termo))
      ));

      if(subset.length === 0){
        const vazio = document.createElement('p');
        vazio.className = 'small';
        vazio.textContent = 'Nenhum livro nesta série com os critérios informados.';
        grid.appendChild(vazio);
      } else {
        for(const livro of subset){
          const card = document.createElement('div');
          card.className = 'card';
          const img = document.createElement('img');
          img.alt = `Capa de ${livro.titulo}`;
          img.src = 'https://via.placeholder.com/300x150?text=Carregando...';
          img.dataset.titulo = livro.titulo;
          const h3 = document.createElement('h3');
          h3.textContent = livro.titulo;
          const meta = document.createElement('p');
          meta.className = 'meta';
          meta.textContent = `Autor: ${livro.autor || '—'}`;
          const status = document.createElement('p');
          status.className = `status ${livro.disponivel ? 'disponivel' : 'alugado'}`;
          status.textContent = livro.disponivel ? 'Disponível' : `Reservado até ${livro.dataDevolucao || '—'}`;
          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex;gap:8px;margin-top:6px';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn';
          btn.style.padding = '4px 8px';
          btn.style.fontSize = '0.85rem';
          btn.textContent = livro.disponivel ? 'Reservar' : 'Reservado';
          btn.disabled = !livro.disponivel;
          btn.dataset.action = 'reservar-livro';
          btn.dataset.id = livro.id;
          actions.appendChild(btn);

          card.appendChild(img);
          card.appendChild(h3);
          card.appendChild(meta);
          card.appendChild(status);
          card.appendChild(actions);

          grid.appendChild(card);

          (async () => {
            const dadosAPI = await buscarLivroGoogle(livro.titulo);
            if(dadosAPI && dadosAPI.capa){
              img.src = dadosAPI.capa;
            } else {
              img.src = 'https://via.placeholder.com/300x150?text=Sem+Capa';
            }
          })();
        }
      }
      bloco.appendChild(grid);
      frag.appendChild(bloco);
    }

    container.appendChild(frag);

    container.removeEventListener('click', onBibliotecaClick);
    container.addEventListener('click', onBibliotecaClick);

    atualizarContagemCatalogo();
  }

  function onBibliotecaClick(e){
    const btn = e.target.closest('button[data-action="reservar-livro"]');
    if(!btn) return;
    const id = Number(btn.dataset.id);
    abrirModalAlugar(id);
  }

  /* =========================
     Render: Horários
     ========================= */
  function renderHorarios(){
    const manha = document.getElementById('grid-manha');
    const tarde = document.getElementById('grid-tarde');
    const noite = document.getElementById('grid-noite');
    if(!manha || !tarde || !noite) return;
    manha.innerHTML = '';
    tarde.innerHTML = '';
    noite.innerHTML = '';

    const fragManha = document.createDocumentFragment();
    const fragTarde = document.createDocumentFragment();
    const fragNoite = document.createDocumentFragment();

    horarios.forEach(h=>{
      const card = document.createElement('div');
      card.className = 'card';
      const titulo = document.createElement('h3');
      titulo.textContent = h.periodo;
      const info = document.createElement('div');
      if(h.status === 'Reservado'){
        info.innerHTML = `<p class="status alugado">Reservado por ${h.professor} (${h.diaSemana})</p>`;
      } else {
        info.innerHTML = `<p class="status ${h.classe}">${h.status}</p>`;
      }
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;margin-top:8px';
      if(h.status === 'Reservado'){
        const btnCancel = document.createElement('button');
        btnCancel.type = 'button';
        btnCancel.className = 'remove-btn';
        btnCancel.textContent = 'Cancelar';
        btnCancel.dataset.action = 'cancelar';
        btnCancel.dataset.id = h.id;
        actions.appendChild(btnCancel);
      } else {
        const btnRes = document.createElement('button');
        btnRes.type = 'button';
        btnRes.className = 'btn';
        btnRes.style.padding = '4px 10px';
        btnRes.textContent = 'Reservar';
        btnRes.dataset.action = 'reservar';
        btnRes.dataset.id = h.id;
        actions.appendChild(btnRes);
      }
      card.appendChild(titulo);
      card.appendChild(info);
      card.appendChild(actions);

      if(h.id.startsWith('manha')) fragManha.appendChild(card);
      else if(h.id.startsWith('tarde')) fragTarde.appendChild(card);
      else if(h.id.startsWith('noite')) fragNoite.appendChild(card);
    });

    manha.appendChild(fragManha);
    tarde.appendChild(fragTarde);
    noite.appendChild(fragNoite);

    ['grid-manha','grid-tarde','grid-noite'].forEach(id => {
      const el = document.getElementById(id);
      if(!el) return;
      el.removeEventListener('click', onHorarioClick);
      el.addEventListener('click', onHorarioClick);
    });
  }

  function onHorarioClick(e){
    const btn = e.target.closest('button[data-action="reservar"], button[data-action="cancelar"]');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if(action === 'reservar') abrirModalReserva(id);
    if(action === 'cancelar') cancelarReserva(id);
  }

  /* =========================
     Reservas: ações e controles
     ========================= */
  function cancelarReserva(slotId){
    const slot = horarios.find(h => h.id === slotId);
    if(!slot) return alert('Slot não encontrado.');
    if(!confirm(`Cancelar reserva de ${slot.professor} para ${slot.periodo} (${slot.diaSemana})?`)) return;
    slot.status = 'Disponível';
    slot.classe = 'disponivel';
    slot.professor = null;
    slot.diaSemana = null;
    persistAll();
    renderHorarios();
    renderReservados();
    toast('Reserva cancelada.');
  }

  let reservaSlotId = null;
  function abrirModalReserva(slotId){
    reservaSlotId = slotId;
    const slot = horarios.find(h=>h.id===slotId);
    const infoEl = document.getElementById('reserva-slot-info');
    if(infoEl && slot) infoEl.textContent = `Bloco: ${slot.periodo}`;
    const profEl = document.getElementById('reserva-professor');
    const diaEl = document.getElementById('reserva-dia');
    if(profEl) profEl.value = currentUser && currentUser.tipo === 'professor' ? currentUser.nome : '';
    if(diaEl) diaEl.value = '';
    abrirModal('modal-reserva');
  }
  function fecharModalReserva(){ fecharModal('modal-reserva'); reservaSlotId = null; }

  function confirmarReserva(){
    const profEl = document.getElementById('reserva-professor');
    const diaEl = document.getElementById('reserva-dia');
    const prof = profEl ? profEl.value.trim() : '';
    const dia = diaEl ? diaEl.value : '';
    if(!prof || !dia) return alert('Preencha professor e dia.');
    const slot = horarios.find(h=>h.id===reservaSlotId);
    if(!slot || slot.status!=='Disponível') return alert('Slot inválido.');
    slot.status = 'Reservado';
    slot.classe = 'reservado';
    slot.professor = prof;
    slot.diaSemana = dia;
    persistAll();
    renderHorarios();
    renderReservados();
    fecharModalReserva();
    toast('Reserva confirmada.');
  }

  /* =========================
     Reservar livro: fluxos
     ========================= */
  let alugarLivroId = null;
  function abrirModalAlugar(livroId){
    alugarLivroId = livroId;
    const livro = livros.find(l=>l.id===livroId);
    if(!livro) return alert('Livro não encontrado.');
    const infoEl = document.getElementById('alugar-livro-info');
    if(infoEl) infoEl.textContent = `${livro.titulo} — ${livro.autor}`;
    const nomeEl = document.getElementById('alugar-nome');
    const turmaEl = document.getElementById('alugar-turma');
    if(nomeEl) nomeEl.value = currentUser ? currentUser.nome : '';
    if(turmaEl) turmaEl.value = '';
    abrirModal('modal-alugar');
  }
  function fecharModalAlugar(){ fecharModal('modal-alugar'); alugarLivroId = null; }

  function confirmarAluguel(){
    const nomeEl = document.getElementById('alugar-nome');
    const turmaEl = document.getElementById('alugar-turma');
    const nome = nomeEl ? nomeEl.value.trim() : '';
    const turma = turmaEl ? turmaEl.value.trim() : '';
    if(!nome || !turma) return alert('Preencha nome e turma.');
    const livro = livros.find(l=>l.id===alugarLivroId);
    if(!livro || !livro.disponivel) return alert('Livro indisponível.');
    livro.disponivel = false;
    livro.locatario = nome;
    livro.turma = turma;
    const hoje = new Date();
    hoje.setDate(hoje.getDate()+7);
    livro.dataDevolucao = hoje.toISOString().split('T')[0];
    persistAll();
    fecharModalAlugar();
    
    const filtroEl = document.getElementById('filtro-serie');
    const buscaEl = document.getElementById('busca-livro');
    renderBiblioteca(filtroEl ? filtroEl.value : 'all', buscaEl ? buscaEl.value : '');
    renderReservados();
    toast('Livro reservado com sucesso.');
  }

  function devolverLivro(id){
    const l = livros.find(x=>x.id===id);
    if(!l) return;
    l.disponivel = true;
    l.locatario = null;
    l.dataDevolucao = null;
    l.turma = null;
    persistAll();
    
    const filtroEl = document.getElementById('filtro-serie');
    const buscaEl = document.getElementById('busca-livro');
    renderBiblioteca(filtroEl ? filtroEl.value : 'all', buscaEl ? buscaEl.value : '');
    renderReservados();
    toast('Devolução registrada.');
  }

  /* =========================
     Render: Reservados
     ========================= */
  async function renderReservados(){
    const contLivros = document.getElementById('lista-livros-alugados');
    if(!contLivros) return;
    contLivros.innerHTML = '';
    const alugados = livros.filter(l=>!l.disponivel);
    if(alugados.length===0){
      contLivros.innerHTML = '<p>Nenhum livro reservado no momento.</p>';
    } else {
      const frag = document.createDocumentFragment();
      for(const l of alugados){
        const dadosAPI = await buscarLivroGoogle(l.titulo);
        const card = document.createElement('div');
        card.className = 'card';
        const img = document.createElement('img');
        img.src = dadosAPI.capa || 'https://via.placeholder.com/300x150?text=Sem+Capa';
        img.alt = `Capa de ${l.titulo}`;
        const h3 = document.createElement('h3');
        h3.textContent = l.titulo;
        const pLoc = document.createElement('p');
        pLoc.style.fontSize = '0.85rem';
        pLoc.textContent = `Reservado por: ${l.locatario}`;
        const pTurma = document.createElement('p');
        pTurma.style.fontSize = '0.85rem';
        pTurma.textContent = `Turma: ${l.turma || '—'}`;
        const status = document.createElement('p');
        status.className = 'status alugado';
        status.textContent = `Até ${l.dataDevolucao}`;
        const actions = document.createElement('div');
        actions.style.marginTop = '8px';
        const btnDevolver = document.createElement('button');
        btnDevolver.type = 'button';
        btnDevolver.className = 'remove-btn';
        btnDevolver.dataset.action = 'devolver';
        btnDevolver.dataset.id = l.id;
        btnDevolver.textContent = 'Devolver';
        actions.appendChild(btnDevolver);
        card.appendChild(img);
        card.appendChild(h3);
        card.appendChild(pLoc);
        card.appendChild(pTurma);
        card.appendChild(status);
        card.appendChild(actions);
        frag.appendChild(card);
      }
      contLivros.appendChild(frag);
      contLivros.removeEventListener('click', onReservadosClick);
      contLivros.addEventListener('click', onReservadosClick);
    }

    const contDias = document.getElementById('lista-reservas-por-dia');
    if(!contDias) return;
    contDias.innerHTML = '';
    const fragDias = document.createDocumentFragment();
    DIAS_SEMANA.forEach(d=>{
      const blocos = horarios.filter(h => h.status==='Reservado' && h.diaSemana && h.diaSemana.toLowerCase().startsWith(d.substring(0,3).toLowerCase()));
      const blocoDiv = document.createElement('div');
      blocoDiv.className = 'reservas-dia';
      blocoDiv.style.marginBottom = '12px';
      const h4 = document.createElement('h4');
      h4.textContent = d;
      blocoDiv.appendChild(h4);
      if(blocos.length===0){
        const p = document.createElement('p');
        p.className = 'small muted';
        p.textContent = `Nenhuma reserva para ${d}.`;
        blocoDiv.appendChild(p);
      } else {
        blocos.forEach(b=>{
          const item = document.createElement('div');
          item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px;border-bottom:1px solid #eee';
          const meta = document.createElement('span');
          meta.textContent = b.periodo;
          const prof = document.createElement('strong');
          prof.textContent = b.professor;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'remove-btn';
          btn.style.padding = '2px 6px';
          btn.style.fontSize = '0.8rem';
          btn.dataset.action = 'cancelar-reserva';
          btn.dataset.id = b.id;
          btn.textContent = 'Excluir';
          item.appendChild(meta);
          item.appendChild(prof);
          item.appendChild(btn);
          blocoDiv.appendChild(item);
        });
      }
      fragDias.appendChild(blocoDiv);
    });
    contDias.appendChild(fragDias);
    contDias.removeEventListener('click', onReservasPorDiaClick);
    contDias.addEventListener('click', onReservasPorDiaClick);
  }

  function onReservadosClick(e){
    const btn = e.target.closest('button[data-action="devolver"]');
    if(!btn) return;
    const id = Number(btn.dataset.id);
    if(confirm('Confirmar devolução?')) devolverLivro(id);
  }
  function onReservasPorDiaClick(e){
    const btn = e.target.closest('button[data-action="cancelar-reserva"]');
    if(!btn) return;
    cancelarReserva(btn.dataset.id);
  }

  /* =========================
     Render: Usuários e Professores
     ========================= */
  function renderUsuarios(){
    const contOutros = document.getElementById('lista-usuarios');
    if(contOutros){
      contOutros.innerHTML = '';
      const outros = usuarios.filter(u => u.tipo !== 'professor');
      if(outros.length === 0){
        contOutros.innerHTML = '<p>Nenhum outro usuário cadastrado.</p>';
      } else {
        const frag = document.createDocumentFragment();
        outros.forEach(u => {
          const card = document.createElement('div');
          card.className = 'card';
          const h3 = document.createElement('h3');
          h3.textContent = u.nome;
          const pEmail = document.createElement('p');
          pEmail.textContent = u.email;
          const pTipo = document.createElement('p');
          pTipo.className = 'muted';
          pTipo.textContent = u.tipo;
          const actions = document.createElement('div');
          actions.className = 'user-actions';
          if(currentUser && currentUser.tipo === 'administrador' && u.tipo !== 'administrador'){
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'remove-btn';
            btn.style.marginTop = '6px';
            btn.textContent = 'Remover';
            btn.addEventListener('click', ()=> { if(confirm(`Remover usuário ${u.nome}?`)) removeUsuario(u.id); });
            actions.appendChild(btn);
          }
          card.appendChild(h3);
          card.appendChild(pEmail);
          card.appendChild(pTipo);
          card.appendChild(actions);
          frag.appendChild(card);
        });
        contOutros.appendChild(frag);
      }
    }
    renderProfessores();
  }

  function renderProfessores(){
    const contProf = document.getElementById('lista-professores');
    if(!contProf) return;
    contProf.innerHTML = '';
    const professores = usuarios.filter(u => u.tipo === 'professor');
    if(professores.length === 0){
      contProf.innerHTML = '<p>Nenhum professor cadastrado.</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    professores.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card';
      const h3 = document.createElement('h3');
      h3.textContent = p.nome;
      const pEmail = document.createElement('p');
      pEmail.textContent = p.email;
      const pTipo = document.createElement('p');
      pTipo.className = 'muted';
      pTipo.textContent = p.tipo;
      const actions = document.createElement('div');
      actions.className = 'user-actions';
      if(currentUser && currentUser.tipo === 'administrador'){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'remove-btn';
        btn.style.marginTop = '6px';
        btn.textContent = 'Remover';
        btn.addEventListener('click', ()=> { if(confirm(`Remover professor ${p.nome}?`)) removeUsuario(p.id); });
        actions.appendChild(btn);
      }
      card.appendChild(h3);
      card.appendChild(pEmail);
      card.appendChild(pTipo);
      card.appendChild(actions);
      frag.appendChild(card);
    });
    contProf.appendChild(frag);
  }

  function removeUsuario(id){
    const user = usuarios.find(u => u.id === id);
    if(!user) return alert('Usuário não encontrado.');
    if(user.tipo === 'administrador') return alert('Não é permitido remover o administrador.');
    if(!confirm(`Confirmar remoção de ${user.nome} (${user.email})?`)) return;
    usuarios = usuarios.filter(u => u.id !== id);
    persistAll();
    renderUsuarios();
    atualizarContagemCatalogo();
    toast('Usuário removido.');
  }

  /* =========================
     Autenticação e Funções Globais
     ========================= */
  function signupConfirm(){
    const nome = (document.getElementById('signup-nome') || {}).value || '';
    const email = (document.getElementById('signup-email') || {}).value || '';
    const senha = (document.getElementById('signup-senha') || {}).value || '';
    const tipo = (document.getElementById('signup-tipo') || {}).value || 'aluno';
    if(!nome.trim() || !email.trim() || !senha) return alert('Preencha todos os campos.');
    if(usuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())) return alert('Email já cadastrado.');
    const id = usuarios.length ? Math.max(...usuarios.map(u=>u.id))+1 : 1;
    usuarios.push({ id, nome: nome.trim(), email: email.trim(), senha, tipo });
    persistAll();
    fecharModal('modal-signup');
    renderUsuarios();
    toast('Cadastro realizado.');
  }

  function addProfessorConfirm(){
    const nome = (document.getElementById('add-nome') || {}).value || '';
    const email = (document.getElementById('add-email') || {}).value || '';
    const senha = (document.getElementById('add-senha') || {}).value || '';
    if(!currentUser || currentUser.tipo !== 'administrador') return alert('Apenas administrador pode adicionar professores.');
    if(!nome.trim() || !email.trim() || !senha) return alert('Preencha todos os campos.');
    if(usuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())) return alert('Email já cadastrado.');
    const id = usuarios.length ? Math.max(...usuarios.map(u=>u.id))+1 : 1;
    usuarios.push({ id, nome: nome.trim(), email: email.trim(), senha, tipo:'professor' });
    persistAll();
    fecharModal('modal-add-prof');
    renderUsuarios();
    toast('Professor adicionado.');
  }

  function addUserConfirm(){
    if(!currentUser || currentUser.tipo !== 'administrador') return alert('Apenas administrador pode adicionar usuários.');
    const nome = (document.getElementById('adduser-nome') || {}).value || '';
    const email = (document.getElementById('adduser-email') || {}).value || '';
    const senha = (document.getElementById('adduser-senha') || {}).value || '';
    const tipo  = (document.getElementById('adduser-tipo') || {}).value || 'aluno';
    if(!nome.trim() || !email.trim() || !senha) return alert('Preencha nome, email e senha.');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(email)) return alert('Email inválido.');
    if(usuarios.some(u => u.email.toLowerCase() === email.toLowerCase())) return alert('Email já cadastrado.');
    const id = usuarios.length ? Math.max(...usuarios.map(u=>u.id)) + 1 : 1;
    usuarios.push({ id, nome: nome.trim(), email: email.trim(), senha, tipo });
    persistAll();
    fecharModal('modal-add-user');
    renderUsuarios();
    atualizarContagemCatalogo();
    toast('Usuário adicionado com sucesso.');
  }

  function loginConfirm(){
    const email = (document.getElementById('login-email') || {}).value || '';
    const senha = (document.getElementById('login-senha') || {}).value || '';
    const u = usuarios.find(x=>x.email===email && x.senha===senha);
    if(!u) return alert('Credenciais inválidas.');
    currentUser = { ...u };
    fecharModal('modal-login');
    onSessionChange();
    toast(`Bem-vindo(a), ${u.nome} (${u.tipo})`);
  }

  function logout(){
    currentUser = null;
    onSessionChange();
    toast('Sessão encerrada.');
  }

  function onSessionChange(){
    atualizarContagemCatalogo();
    renderUsuarios();
    atualizarPerfilUI(); // Modificado aqui para atualizar a tela de perfil do usuário logado
    const filtroEl = document.getElementById('filtro-serie');
    const buscaEl = document.getElementById('busca-livro');
    const filtro = filtroEl ? filtroEl.value : 'all';
    const busca = buscaEl ? buscaEl.value : '';
    renderBiblioteca(filtro, busca);
    renderHorarios();
    renderReservados();
  }

  /* ========================================================
     EXPOSIÇÃO GLOBAL: Libera as funções para o HTML tradicional
     ======================================================== */
  window.abrirModal = abrirModal;
  window.fecharModal = fecharModal;
  window.signupConfirm = signupConfirm;
  window.addProfessorConfirm = addProfessorConfirm;
  window.addUserConfirm = addUserConfirm;
  window.loginConfirm = loginConfirm;
  window.logout = logout;

  /* =========================
     Inicialização do App
     ========================= */
  document.addEventListener('DOMContentLoaded', () => {
    expandirCatalogoSeNecessario();
    onSessionChange();

    // Mapeamento programático de segurança para botões comuns no topo/nav
    const ligarBotao = (btnId, modalId) => {
      const btn = document.getElementById(btnId);
      if(btn) btn.addEventListener('click', () => abrirModal(modalId));
    };

    ligarBotao('btn-open-login', 'modal-login');
    ligarBotao('btn-nav-login', 'modal-login');
    ligarBotao('btn-open-signup', 'modal-signup');
    ligarBotao('btn-nav-signup', 'modal-signup');
    ligarBotao('btn-open-add-user', 'modal-add-user');
    ligarBotao('btn-open-add-prof', 'modal-add-prof');

    // Fechamento inteligente ao clicar em botões de fechar internos
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if(e.target === modal || e.target.classList.contains('close-btn') || e.target.classList.contains('btn-fechar')) {
          fecharModal(modal.id);
        }
      });
    });

    // Vinculação de envios dos formulários internos dos modais
    const btnConfirmarAluguel = document.getElementById('btn-confirmar-aluguel');
    if(btnConfirmarAluguel) btnConfirmarAluguel.addEventListener('click', confirmarAluguel);

    const btnConfirmarReserva = document.getElementById('btn-confirmar-reserva');
    if(btnConfirmarReserva) btnConfirmarReserva.addEventListener('click', confirmarReserva);

    const btnLoginConfirm = document.getElementById('btn-login-confirm');
    if(btnLoginConfirm) btnLoginConfirm.addEventListener('click', loginConfirm);

    const btnLogout = document.getElementById('btn-logout');
    if(btnLogout) btnLogout.addEventListener('click', logout);

    // Monitoramento dos filtros da biblioteca
    const filtroSerie = document.getElementById('filtro-serie');
    if(filtroSerie) {
      filtroSerie.addEventListener('change', (e) => {
        const buscaEl = document.getElementById('busca-livro');
        renderBiblioteca(e.target.value, buscaEl ? buscaEl.value : '');
      });
    }

    const buscaLivro = document.getElementById('busca-livro');
    if(buscaLivro) {
      buscaLivro.addEventListener('input', debounce((e) => {
        const filtroEl = document.getElementById('filtro-serie');
        renderBiblioteca(filtroEl ? filtroEl.value : 'all', e.target.value);
      }, 300));
    }
  });
})();