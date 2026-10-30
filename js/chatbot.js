/* ===========================================================================
   chatbot.js — the floating ScrapHub help assistant.

   A button fixed bottom-right on every signed-in screen, opening a compact
   panel. Replies come from Groq through our own /api/chat, so no key is in the
   browser. Voice uses the browser's own Web Speech API; when it is missing or
   the microphone is refused, the panel says so and typing still works.
   ========================================================================= */
'use strict';

const Chat = {
  open: false,
  busy: false,
  ready: null,            // null = not checked yet, true/false afterwards
  readyReason: null,
  messages: [],
  listening: false,
  speakReplies: false,
  recog: null,
  voiceError: null,

  supportsSpeech() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  supportsTts() { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'; },

  starters() {
    const role = Auth.role();
    if (role === 'vendor') return ['What does my plan include?', 'How do I publish a factory lot?', 'Why can I not accept this job?'];
    if (role === 'factory') return ['How is GST calculated here?', 'What is in a hub lot?', 'Where are my orders?'];
    if (role === 'admin') return ['How do I approve a vendor?', 'Where do rates come from?', 'What do the ledger stages mean?'];
    return ['How much is my scrap worth?', 'How does pickup work?', 'What can I sell here?'];
  },

  mount() {
    let host = $('#chatRoot');
    if (!host) {
      host = document.createElement('div');
      host.id = 'chatRoot';
      document.body.appendChild(host);
    }
    if (!Auth.isSignedIn()) { host.innerHTML = ''; this.open = false; return; }
    this.render();
    if (this.ready === null) this.checkReady();
  },

  async checkReady() {
    const health = await Api.health();
    this.ready = !!(health.ok && health.providers.chat.configured);
    this.readyReason = this.ready ? null : (health.providers.chat.reason || health.error || 'The assistant is not configured.');
    if (this.open) this.render();
  },

  render() {
    const host = $('#chatRoot');
    if (!host) return;
    if (!this.open) {
      host.innerHTML = `<button class="chat-fab" data-act="chatOpen" aria-label="Open the ScrapHub assistant">
        <span class="ic">${ico('message')}</span><span class="lbl">Help</span></button>`;
      return;
    }
    host.innerHTML = `<section class="chat-panel" role="dialog" aria-label="ScrapHub assistant" aria-modal="false">
      <header class="chat-h">
        <div class="row" style="gap:8px">
          <span class="chat-av">${ico('recycle')}</span>
          <div><div class="strong" style="font-size:14px">ScrapHub assistant</div>
            <div class="t-xs muted">${this.ready === false ? 'Unavailable' : this.ready === null ? 'Connecting…' : 'Ask about anything in the app'}</div></div>
        </div>
        <div class="row" style="gap:2px">
          ${this.supportsTts() ? `<button class="btn btn-ghost btn-icon" data-act="chatSpeakToggle"
            aria-pressed="${this.speakReplies}" aria-label="${this.speakReplies ? 'Turn off spoken replies' : 'Read replies aloud'}"
            title="${this.speakReplies ? 'Spoken replies on' : 'Spoken replies off'}">${this.speakReplies ? `${ico('volume')}` : `${ico('volumeOff')}`}</button>` : ''}
          <button class="btn btn-ghost btn-icon" data-act="chatClose" aria-label="Close the assistant">${ico('close')}</button>
        </div>
      </header>
      <div class="chat-body" id="chatBody">${this.bodyHtml()}</div>
      ${this.footerHtml()}
    </section>`;
    this.scrollDown();
    const input = $('#chatInput');
    if (input && this.ready !== false) setTimeout(() => input.focus(), 40);
  },

  bodyHtml() {
    if (this.ready === null) {
      return `<div class="chat-note"><span class="spinner sm"></span> Checking whether the assistant is available…</div>`;
    }
    if (this.ready === false) {
      return `<div class="chat-note chat-note-warn">
        <strong>The assistant is not switched on.</strong>
        <p class="t-sm" style="margin-top:6px">${esc(this.readyReason || '')}</p>
        <p class="t-sm" style="margin-top:8px">It needs a ScrapHub backend with a Groq API key.
        ${Auth.role() === 'admin' ? 'You can point the app at one in <a href="#/account">Settings → Integrations</a>.' : 'An administrator can set this up.'}</p>
      </div>`;
    }
    let html = '';
    if (!this.messages.length) {
      html += `<div class="chat-note">Hello ${esc((Auth.user().name || '').split(' ')[0])} — ask me about rates, pickups, your plan or anything else in ScrapHub.</div>
        <div class="chat-starters">${this.starters().map(s =>
          `<button class="chip" data-act="chatStarter" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    html += this.messages.map(m => `<div class="chat-msg ${m.role}">
      ${m.role === 'assistant' ? `<span class="chat-av sm">${ico('recycle')}</span>` : ''}
      <div class="bub">${this.format(m.content)}${m.error ? '<div class="t-xs" style="margin-top:6px;opacity:.85">Not sent</div>' : ''}</div></div>`).join('');
    if (this.busy) {
      html += `<div class="chat-msg assistant"><span class="chat-av sm">${ico('recycle')}</span>
        <div class="bub"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
    }
    return html;
  },

  footerHtml() {
    if (this.ready === false) return '';
    const mic = this.supportsSpeech()
      ? `<button class="btn btn-ghost btn-icon mic${this.listening ? ' on' : ''}" data-act="chatMic"
           aria-pressed="${this.listening}" aria-label="${this.listening ? 'Stop recording' : 'Speak your question'}"
           title="${this.listening ? 'Listening — click to stop' : 'Speak your question'}">${this.listening ? ico('stop') : ico('mic')}</button>`
      : '';
    return `<form class="chat-f" data-form="chat">
        ${this.voiceError ? `<div class="chat-voice-err t-xs">${esc(this.voiceError)}</div>` : ''}
        ${this.listening ? '<div class="chat-listening t-xs"><span class="pulse"></span> Listening… speak now</div>' : ''}
        <div class="chat-input-row">
          <input class="input" id="chatInput" placeholder="Ask a question…" autocomplete="off"
            aria-label="Message the assistant" ${this.busy ? 'disabled' : ''}>
          ${mic}
          <button class="btn btn-icon" type="submit" aria-label="Send" ${this.busy ? 'disabled' : ''}>${ico('send')}</button>
        </div>
        <div class="chat-dis t-xs">The assistant can be wrong. It cannot book pickups or take payments.</div>
      </form>`;
  },

  /** Minimal, safe formatting: escape first, then allow **bold** and line breaks. */
  format(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  },
  scrollDown() { const b = $('#chatBody'); if (b) b.scrollTop = b.scrollHeight; },

  async send(text) {
    const content = String(text || '').trim();
    if (!content || this.busy) return;
    this.stopListening();
    this.messages.push({ role: 'user', content });
    this.busy = true;
    this.render();

    const payload = this.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
    const res = await Assistant.ask(payload, Assistant.context());
    this.busy = false;

    if (!res.ok) {
      const msg = userFacingError(res.error || 'Something went wrong. Please try again.', res.code, 'The assistant');
      this.messages.push({ role: 'assistant', content: msg, error: true });
      this.render();
      return;
    }
    this.messages.push({ role: 'assistant', content: res.reply });
    this.render();
    if (this.speakReplies) this.speak(res.reply);
  },

  /* ---------- voice in ---------- */
  startListening() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      this.voiceError = 'This browser does not support voice input. Chrome or Edge do.';
      return this.render();
    }
    if (!window.isSecureContext) {
      this.voiceError = 'Voice input needs a secure (https) connection.';
      return this.render();
    }
    try {
      const r = new Ctor();
      r.lang = 'en-IN';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        const input = $('#chatInput');
        if (input) input.value = (finalText + interim).trim();
      };
      r.onerror = e => {
        const map = {
          'not-allowed': 'Microphone access was refused. Allow it in your browser’s site settings to use voice.',
          'service-not-allowed': 'Microphone access was refused by the browser.',
          'no-speech': 'I did not catch anything. Try again.',
          'audio-capture': 'No microphone was found.',
          'network': 'Voice recognition could not reach the network.',
          'aborted': null,
        };
        this.voiceError = Object.prototype.hasOwnProperty.call(map, e.error) ? map[e.error] : 'Voice input failed. Please type instead.';
        this.listening = false;
        this.render();
      };
      r.onend = () => {
        this.listening = false;
        this.render();
        const input = $('#chatInput');
        if (input && input.value.trim()) input.focus();
      };
      this.recog = r;
      this.voiceError = null;
      this.listening = true;
      this.render();
      r.start();
    } catch (e) {
      this.listening = false;
      this.voiceError = 'Voice input could not start.';
      this.render();
    }
  },
  stopListening() {
    if (this.recog && this.listening) { try { this.recog.stop(); } catch {} }
    this.listening = false;
  },

  /* ---------- voice out ---------- */
  speak(text) {
    if (!this.supportsTts()) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/\*\*/g, '').slice(0, 600));
      u.lang = 'en-IN';
      u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch {}
  },
  shutUp() { if (this.supportsTts()) { try { speechSynthesis.cancel(); } catch {} } },
};

/* ---------- actions ---------- */
A.chatOpen = () => { Chat.open = true; Chat.render(); if (Chat.ready === null) Chat.checkReady(); };
A.chatClose = () => { Chat.open = false; Chat.stopListening(); Chat.shutUp(); Chat.render(); };
A.chatStarter = d => Chat.send(d.q);
A.chatMic = () => { Chat.listening ? Chat.stopListening() : Chat.startListening(); if (!Chat.listening) Chat.render(); };
A.chatSpeakToggle = () => {
  Chat.speakReplies = !Chat.speakReplies;
  if (!Chat.speakReplies) Chat.shutUp();
  Chat.render();
  toast(Chat.speakReplies ? 'Replies will be read aloud' : 'Spoken replies turned off');
};
