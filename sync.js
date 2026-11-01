(() => {
  'use strict';

  const KEY_STORAGE = 'incident-desk.admin-key.session';
  const CHANNEL = 'incident-desk-sync';

  function apiUrl() {
    const raw = String(window.INCIDENT_DESK_CONFIG?.apiUrl || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' ? parsed.toString() : '';
    } catch {
      return '';
    }
  }

  function getAdminKey() {
    try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  }

  function setAdminKey(value) {
    try {
      if (value) sessionStorage.setItem(KEY_STORAGE, value.trim());
      else sessionStorage.removeItem(KEY_STORAGE);
    } catch { /* The key can be entered again if session storage is unavailable. */ }
  }

  function makeNonce() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function submit(action, report, key = '', timeoutMs = 60000) {
    const endpoint = apiUrl();
    if (!endpoint) return Promise.reject(new Error('Shared reporting is not configured yet.'));

    const nonce = makeNonce();
    const frameName = `incident_desk_${nonce.replaceAll('-', '_')}`;
    const iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.title = 'Incident report connection';
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    const form = document.createElement('form');
    form.method = 'post';
    form.action = endpoint;
    form.target = frameName;
    form.hidden = true;
    const payload = { action, report, key, nonce };
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);
    form.append(input);

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        window.clearTimeout(timeout);
        form.remove();
        iframe.remove();
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onMessage = event => {
        if (event.source !== iframe.contentWindow || !event.data || event.data.channel !== CHANNEL || event.data.nonce !== nonce) return;
        if (!event.data.ok) {
          finish(reject, new Error(event.data.error || 'The shared report service could not save this report.'));
          return;
        }
        finish(resolve, event.data);
      };
      const timeout = window.setTimeout(() => finish(reject, new Error('The shared report service did not respond. Check the connection and try again.')), timeoutMs);
      window.addEventListener('message', onMessage);
      iframe.addEventListener('error', () => finish(reject, new Error('Could not reach the shared report service.')));
      document.body.append(iframe, form);
      try { form.submit(); }
      catch (error) { finish(reject, new Error(error.message || 'Could not send this report.')); }
    });
  }

  function list(key, timeoutMs = 30000) {
    const endpoint = apiUrl();
    if (!endpoint) return Promise.reject(new Error('Shared reporting is not configured yet.'));
    if (!key) return Promise.reject(new Error('Enter the dashboard connection key first.'));
    const callbackName = `incidentDeskCallback_${makeNonce().replaceAll('-', '_')}`;
    const url = new URL(endpoint);
    url.searchParams.set('action', 'list');
    url.searchParams.set('key', key);
    url.searchParams.set('callback', callbackName);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        delete window[callbackName];
        script.remove();
        window.clearTimeout(timeout);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const timeout = window.setTimeout(() => finish(reject, new Error('The shared dashboard did not respond. Check the URL and connection key.')), timeoutMs);
      window[callbackName] = result => {
        if (!result?.ok) {
          finish(reject, new Error(result?.error || 'The dashboard connection key was not accepted.'));
          return;
        }
        finish(resolve, Array.isArray(result.reports) ? result.reports : []);
      };
      script.onerror = () => finish(reject, new Error('Could not load shared reports. Check the web app URL and deployment access.'));
      script.src = url.toString();
      document.head.append(script);
    });
  }

  function photo(fileId, key, timeoutMs = 30000) {
    const endpoint = apiUrl();
    if (!endpoint || !key) return Promise.reject(new Error('Connect the dashboard before opening shared photos.'));
    const callbackName = `incidentDeskCallback_${makeNonce().replaceAll('-', '_')}`;
    const url = new URL(endpoint);
    url.searchParams.set('action', 'photo');
    url.searchParams.set('key', key);
    url.searchParams.set('fileId', fileId);
    url.searchParams.set('callback', callbackName);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        delete window[callbackName];
        script.remove();
        window.clearTimeout(timeout);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const timeout = window.setTimeout(() => finish(reject, new Error('The photo service did not respond.')), timeoutMs);
      window[callbackName] = result => {
        if (!result?.ok || !result.dataUrl) {
          finish(reject, new Error(result?.error || 'Could not load this private photo.'));
          return;
        }
        finish(resolve, result.dataUrl);
      };
      script.onerror = () => finish(reject, new Error('Could not load this photo.'));
      script.src = url.toString();
      document.head.append(script);
    });
  }

  window.IncidentSync = {
    isConfigured: () => Boolean(apiUrl()),
    getAdminKey,
    setAdminKey,
    submit,
    list,
    photo
  };
})();
