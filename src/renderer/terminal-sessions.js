// Gestor de terminales multiples: cada terminal tiene su xterm, su sesion SSH/Telnet y su ejecutor de scripts.
(function (root) {
  function escapeText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function create(options) {
    const {
      container,
      tabBar,
      addButton,
      api,
      initialSlots = 5,
      maxSlots = 10,
      terminalOptions = {},
      onChange = () => {},
      tabFlags = () => ({})
    } = options;

    const slots = [];
    const bySession = new Map();
    let activeIndex = 0;
    let lastSize = { cols: 100, rows: 32 };

    function notify(slot) {
      render();
      onChange(slot || slots[activeIndex]);
    }

    function addSlot() {
      if (slots.length >= maxSlots) return null;
      const index = slots.length;
      const pane = document.createElement('div');
      pane.className = 'term-pane';
      container.appendChild(pane);

      const term = new root.Terminal({ ...terminalOptions });
      // xterm mide la fuente al abrir: el panel debe estar visible en ese momento (render() lo oculta despues).
      pane.classList.add('active');
      term.open(pane);
      term.resize(lastSize.cols, lastSize.rows);

      const slot = {
        index,
        number: index + 1,
        pane,
        term,
        sessionId: null,
        connected: false,
        status: 'idle',
        message: 'Listo para conectar',
        host: '',
        protocol: '',
        name: '',
        listeners: new Set(),
        scriptRunning: false
      };

      slot.runner = root.CiscoRunner.create({
        write: (data) => {
          if (slot.sessionId) api.write(slot.sessionId, data);
        },
        subscribe: (listener) => {
          slot.listeners.add(listener);
          return () => slot.listeners.delete(listener);
        }
      });

      term.onData((data) => {
        if (slot.scriptRunning || !slot.connected || !slot.sessionId) return;
        api.write(slot.sessionId, data);
      });
      // Alt+1..9 / Alt+0 cambian de terminal; xterm no debe enviarlos al equipo.
      term.attachCustomKeyEventHandler((event) => !(event.altKey && /^Digit[0-9]$/.test(event.code)));

      term.writeln(`Cisco Switch Console - Terminal ${slot.number}`);
      term.writeln('Complete los datos de conexion y presione Conectar.');

      slots.push(slot);
      render();
      return slot;
    }

    function render() {
      tabBar.innerHTML = '';
      slots.forEach((slot) => {
        const flags = tabFlags(slot) || {};
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `session-tab${slot.index === activeIndex ? ' active' : ''}`;
        button.dataset.status = slot.status;
        button.title = [
          `Terminal ${slot.number}${slot.number <= 10 ? ` (Alt+${slot.number % 10})` : ''}`,
          slot.host ? `${slot.protocol.toUpperCase()} ${slot.host}` : 'Libre',
          slot.message
        ].join('\n');
        button.innerHTML = [
          '<span class="dot"></span>',
          `<span class="tab-num">${slot.number}</span>`,
          `<span class="tab-name">${escapeText(slot.name || slot.host || 'Libre')}</span>`,
          flags.running ? '<span class="tab-flag" title="Enviando configuracion">TX</span>' : '',
          flags.rollback ? '<span class="tab-flag" title="Rollback programado">R</span>' : ''
        ].join('');
        button.addEventListener('click', () => select(slot.index));
        tabBar.appendChild(button);
      });
      if (addButton) addButton.disabled = slots.length >= maxSlots;
      slots.forEach((slot) => slot.pane.classList.toggle('active', slot.index === activeIndex));
    }

    function select(index) {
      if (!slots[index]) return;
      activeIndex = index;
      const slot = slots[index];
      notify(slot);
      slot.term.refresh(0, slot.term.rows - 1);
      slot.term.focus();
    }

    function setStatus(slot, status, message) {
      slot.status = status;
      if (message !== undefined) slot.message = message;
      notify(slot);
    }

    function releaseSession(slot) {
      if (slot.sessionId) bySession.delete(slot.sessionId);
      slot.sessionId = null;
      slot.connected = false;
    }

    async function connect(slot, profile) {
      if (slot.sessionId) return { ok: false, error: 'La terminal ya tiene una sesion.' };
      const sessionId = `t${slot.number}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
      slot.sessionId = sessionId;
      slot.connected = false;
      slot.host = profile.host;
      slot.protocol = profile.protocol;
      slot.name = profile.name || profile.host;
      bySession.set(sessionId, slot);

      slot.term.writeln('');
      slot.term.writeln(`--- Conectando a ${profile.host}:${profile.port} por ${profile.protocol.toUpperCase()} ---`);
      if (profile.protocol === 'telnet') {
        slot.term.writeln('\x1b[33mAviso: Telnet viaja en texto plano, incluidas las credenciales. Prefiera SSH.\x1b[0m');
      }
      setStatus(slot, 'connecting', `Conectando a ${profile.host}`);

      const result = await api.connect({ ...profile, sessionId, cols: lastSize.cols, rows: lastSize.rows });
      if (slot.sessionId !== sessionId) return result;
      if (!result.ok) {
        slot.term.writeln(`Error: ${result.error || 'no se pudo conectar'}`);
        releaseSession(slot);
        setStatus(slot, 'error', result.error || 'No se pudo conectar');
        return result;
      }
      if (!slot.connected) {
        slot.connected = true;
        setStatus(slot, 'connected', `Conectado a ${profile.host}`);
      }
      return result;
    }

    function disconnect(slot) {
      if (slot && slot.sessionId) return api.disconnect(slot.sessionId);
      return Promise.resolve({ ok: true });
    }

    function write(slot, data) {
      if (slot && slot.sessionId && slot.connected) return api.write(slot.sessionId, data);
      return Promise.resolve({ ok: false });
    }

    function resizeAll(size) {
      lastSize = { cols: size.cols, rows: size.rows };
      slots.forEach((slot) => {
        slot.term.resize(size.cols, size.rows);
        if (slot.sessionId) api.resize(slot.sessionId, size.cols, size.rows);
      });
    }

    function findFree() {
      const active = slots[activeIndex];
      if (active && !active.sessionId) return active;
      return slots.find((slot) => !slot.sessionId) || null;
    }

    api.onData(({ sessionId, data }) => {
      const slot = bySession.get(sessionId);
      if (!slot) return;
      slot.term.write(data);
      slot.listeners.forEach((listener) => listener(data));
    });

    api.onStatus(({ sessionId, status, message }) => {
      const slot = bySession.get(sessionId);
      if (!slot) return;
      if (status === 'connected') slot.connected = true;
      if (status === 'closed' || status === 'error') {
        slot.runner.abort('La sesion se cerro durante el envio.');
        releaseSession(slot);
        slot.term.writeln(`\r\n\x1b[90m--- ${message || 'Sesion cerrada'} ---\x1b[0m`);
      }
      setStatus(slot, status, message);
    });

    for (let index = 0; index < initialSlots; index += 1) addSlot();

    return {
      slots,
      maxSlots,
      active: () => slots[activeIndex],
      addSlot,
      select,
      render,
      setStatus,
      connect,
      disconnect,
      write,
      resizeAll,
      findFree
    };
  }

  root.TerminalSessions = { create };
})(window);
