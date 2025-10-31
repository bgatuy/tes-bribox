// Simple account-scoped, offline-first sync for PDF history
// Assumes backend at the same base used by auth.js (localhost:3000)

(function(){
  const API_BASE = (typeof localStorage !== 'undefined' && localStorage.getItem('API_BASE')) || 'http://localhost:3000';

  function getToken(){
    try { return localStorage.getItem('token'); } catch { return null; }
  }

  function parseJwt(token){
    try {
      const base = token.split('.')[1] || '';
      // Support base64url variants
      const b64 = base.replace(/-/g, '+').replace(/_/g, '/');
      const padLen = (4 - (b64.length % 4)) % 4;
      const padded = b64 + '='.repeat(padLen);
      return JSON.parse(atob(padded));
    } catch { return null; }
  }

  function getUserKey(){
    const t = getToken();
    if(!t) return null;
    const p = parseJwt(t) || {};
    return p.sub || p.userId || p.id || p.username || null;
  }

  async function apiFetch(path, opts={}){
    const token = getToken();
    const headers = new Headers(opts.headers || {});
    if(token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...opts, headers });
  }

  function readHistori(key){
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }

  function writeHistori(key, arr){
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
  }

  function mergeByContentHash(a, b){
    const map = new Map();
    const put = (x)=>{
      if(!x || !x.contentHash) return;
      const prev = map.get(x.contentHash);
      if(!prev) { map.set(x.contentHash, x); return; }
      const pa = Date.parse(prev.uploadedAt||0) || 0;
      const pb = Date.parse(x.uploadedAt||0) || 0;
      map.set(x.contentHash, pb >= pa ? x : prev);
    };
    a.forEach(put); b.forEach(put);
    return Array.from(map.values());
  }

  function nowIso(){ return new Date().toISOString(); }

  // IDB helpers (use the same DB name/version/store as trackmate.js)
  const DB_NAME = 'PdfStorage';
  const DB_VERSION = 2;
  const STORE_BLOBS = 'pdfBlobs';

  function openDbLocal(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if(!_db.objectStoreNames.contains(STORE_BLOBS)){
          _db.createObjectStore(STORE_BLOBS, { keyPath: 'contentHash' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getBlobByHash(contentHash){
    const db = await openDbLocal();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BLOBS], 'readonly');
      const store = tx.objectStore(STORE_BLOBS);
      const r = store.get(contentHash);
      r.onsuccess = () => resolve(r.result ? r.result.data : null);
      r.onerror = () => reject(r.error);
    });
  }

  async function listServerFiles(){
    const res = await apiFetch('/api/files');
    if(!res.ok) throw new Error(`list files failed: ${res.status}`);
    return res.json();
  }

  async function downloadToLocal(item){
    const { contentHash } = item;
    const res = await apiFetch(`/api/files/${encodeURIComponent(contentHash)}/download`);
    if(!res.ok) throw new Error(`download failed: ${res.status}`);
    const blob = await res.blob();
    // Prefer using saveBlobByHash from trackmate.js if available
    if(typeof window.saveBlobByHash === 'function'){
      await window.saveBlobByHash(blob, contentHash);
    } else {
      // best-effort: store into IDB directly
      const db = await openDbLocal();
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_BLOBS], 'readwrite');
        tx.objectStore(STORE_BLOBS).put({
          contentHash,
          name: item.name || 'document.pdf',
          size: blob.size,
          dateAdded: nowIso(),
          data: blob,
          meta: null
        });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }
    // Update local histories keys
    const entry = {
      namaUker: '-',
      tanggalPekerjaan: '',
      fileName: item.name || 'document.pdf',
      contentHash,
      size: item.size || blob.size,
      uploadedAt: item.uploadedAt || nowIso()
    };
    mirrorHistoriWithEntry(entry);
  }

  async function uploadFromLocal(entry, file){
    const contentHash = entry?.contentHash;
    if(!contentHash) return;
    let toUpload = file;
    if(!toUpload){
      const blob = await getBlobByHash(contentHash);
      if(!blob) return; // nothing to upload
      try { toUpload = new File([blob], entry.fileName || 'document.pdf', { type: 'application/pdf' }); }
      catch { toUpload = blob; }
    }
    const fd = new FormData();
    fd.append('file', toUpload);
    fd.append('contentHash', contentHash);
    if(entry?.fileName) fd.append('name', entry.fileName);
    if(entry?.size) fd.append('size', String(entry.size));
    try {
      const res = await apiFetch('/api/files', { method: 'POST', body: fd });
      if(!res.ok) throw new Error(`upload failed: ${res.status}`);
    } catch (e){
      // swallow; will retry on next init
      console.warn('uploadFromLocal error', e);
    }
  }

  function mirrorHistori(){
    const userKey = getUserKey();
    if(!userKey) return;
    const a = readHistori('pdfHistori');
    const b = readHistori(`pdfHistori:${userKey}`);
    const merged = mergeByContentHash(a, b);
    writeHistori('pdfHistori', merged);
    writeHistori(`pdfHistori:${userKey}`, merged);
    return merged;
  }

  function mirrorHistoriWithEntry(entry){
    const userKey = getUserKey();
    if(!userKey) return;
    const keyA = 'pdfHistori';
    const keyB = `pdfHistori:${userKey}`;
    const a = readHistori(keyA);
    const exists = a.some(x => x.contentHash === entry.contentHash);
    const merged = exists ? a : a.concat(entry);
    writeHistori(keyA, merged);
    writeHistori(keyB, merged);
  }

  async function doInitialSync(){
    const userKey = getUserKey();
    if(!userKey) return;
    const local = mirrorHistori();
    // Fetch remote index
    let remote = [];
    try { remote = await listServerFiles(); } catch (e) { console.warn('listServerFiles failed', e); return; }
    const localSet = new Set((local||[]).map(x => x.contentHash));
    const remoteSet = new Set((remote||[]).map(x => x.contentHash));

    // Download missing locally
    for(const item of remote){
      if(!localSet.has(item.contentHash)){
        try { await downloadToLocal(item); } catch(e){ console.warn('download error', e); }
      }
    }

    // Upload missing on server
    for(const entry of (local||[])){
      if(!remoteSet.has(entry.contentHash)){
        await uploadFromLocal(entry);
      }
    }
  }

  function initAccountSync(){
    const token = getToken();
    if(!token) return; // not logged in
    mirrorHistori();
    // storage mirror across tabs
    const userKey = getUserKey();
    window.addEventListener('storage', (e) => {
      if(!userKey) return;
      if(e.key === 'pdfHistori' || e.key === `pdfHistori:${userKey}`){
        mirrorHistori();
      }
    });
    // kick off initial sync (non-blocking)
    doInitialSync();
  }

  // Expose minimal API
  window.sync = {
    initAccountSync,
    onLocalSave: async ({ contentHash, file, entry }) => {
      try { if(entry) mirrorHistoriWithEntry(entry); else mirrorHistori(); } catch {}
      // Upload in background
      try { await uploadFromLocal(entry || { contentHash }, file); } catch {}
    }
  };

  // Auto-init on non-auth pages
  document.addEventListener('DOMContentLoaded', ()=>{
    const path = (window.location.pathname || '').toLowerCase();
    if(!path.endsWith('login.html') && !path.endsWith('register.html')){
      try { initAccountSync(); } catch(e){ console.warn('initAccountSync error', e); }
    }
  });
})();
