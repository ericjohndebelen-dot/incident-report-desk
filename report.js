(() => {
  'use strict';

  const STORAGE_KEY = 'incident-desk.reports.v1';
  const MAX_PHOTOS = 3;
  const MAX_PHOTO_DATA_URL_LENGTH = 850_000;
  const $ = selector => document.querySelector(selector);
  const form = $('#publicReportForm');
  const errorBox = $('#publicFormError');
  const toast = $('#publicToast');
  let reports = loadReports();
  let photos = [];
  let pendingUploads = 0;
  let uploadSession = 0;
  let toastTimer;
  let pendingReport = null;

  for (const report of reports) {
    if (!report.ticketId) report.ticketId = nextTicketId();
  }

  function localDateInputValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function createId() {
    return globalThis.crypto?.randomUUID?.() || `ir-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nextTicketId() {
    const date = localDateInputValue().replaceAll('-', '');
    return `TKT-${date}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  function loadReports() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved : (Array.isArray(saved.reports) ? saved.reports : []);
    } catch {
      return [];
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
  }

  function incidentCategoryForDepartment(department) {
    return {
      CCTV: 'CCTV Records',
      HR: 'Office Incident',
      ADMIN: 'Office Incident',
      STUDIO: 'Studio Incident',
      CARD: 'Card Room Incident'
    }[department] || 'Office Incident';
  }

  function updateDepartmentFields() {
    const department = $('#publicDepartment').value;
    const isTableDepartment = ['STUDIO', 'CARD'].includes(department);
    $('#publicLocationLabel').textContent = isTableDepartment ? 'Table No.' : 'Location';
    $('#publicGameIdField').classList.toggle('hidden', department !== 'STUDIO');
  }

  function updateStorageNote() {
    const connected = window.IncidentSync?.isConfigured();
    $('#storageNoteTitle').textContent = connected ? 'Shared reporting is ready:' : 'Browser-only storage:';
    $('#storageNoteText').textContent = connected
      ? 'After you submit, your ticket enters the Incident Desk dashboard for the team to review. Photos are stored in the team’s private Drive folder.'
      : 'This form saves to the browser and device used to submit. Configure the shared connection so reports from any device enter the Incident Desk dashboard.';
    $('#successDetail').textContent = connected
      ? 'Your report was saved to the shared Incident Desk dashboard. Save this ticket number for reference.'
      : 'This report is saved only in the browser used to submit. Save this ticket number for reference.';
  }

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read image.'));
      reader.readAsDataURL(blob);
    });
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG, or WebP image.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Each image must be smaller than 20 MB.');
    const source = await readAsDataUrl(file);
    const image = await new Promise((resolve, reject) => {
      const item = new Image();
      item.onload = () => resolve(item);
      item.onerror = () => reject(new Error('This image format could not be opened.'));
      item.src = source;
    });
    let finalBlob = null;
    for (const [maxDimension, quality] of [[1280, 0.78], [1100, 0.7], [900, 0.62], [720, 0.54]]) {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not process this image.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      finalBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (finalBlob && finalBlob.size <= 500 * 1024) {
        return { name: String(file.name || 'Incident photo').slice(0, 100), dataUrl: await readAsDataUrl(finalBlob) };
      }
    }
    if (!finalBlob || finalBlob.size > 600 * 1024) throw new Error('This image is too large after compression. Try a smaller image.');
    return { name: String(file.name || 'Incident photo').slice(0, 100), dataUrl: await readAsDataUrl(finalBlob) };
  }

  function renderPhotoPreviews() {
    const container = $('#publicPhotoPreviews');
    container.replaceChildren();
    photos.forEach((photo, index) => {
      const preview = document.createElement('div');
      preview.className = 'photo-preview';
      const image = document.createElement('img');
      image.src = photo.dataUrl;
      image.alt = photo.name || `Incident photo ${index + 1}`;
      const remove = document.createElement('button');
      remove.className = 'photo-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      remove.addEventListener('click', () => {
        photos.splice(index, 1);
        renderPhotoPreviews();
      });
      preview.append(image, remove);
      container.append(preview);
    });
    $('#publicChoosePhotos').disabled = photos.length + pendingUploads >= MAX_PHOTOS;
  }

  async function addPhotos(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    const files = selected.filter(file => file.type.startsWith('image/'));
    if (!files.length) {
      showToast('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    const slots = Math.max(0, MAX_PHOTOS - photos.length - pendingUploads);
    if (!slots) {
      showToast(`A report can include up to ${MAX_PHOTOS} photos.`);
      return;
    }
    if (files.length > slots) showToast(`Only ${slots} more photo(s) can be added.`);
    const selectedFiles = files.slice(0, slots);
    const session = uploadSession;
    pendingUploads += selectedFiles.length;
    renderPhotoPreviews();
    for (const file of selectedFiles) {
      try {
        const photo = await compressImage(file);
        if (session === uploadSession) photos.push(photo);
      } catch (error) {
        if (session === uploadSession) showToast(error.message || 'Could not add this photo.');
      } finally {
        if (session === uploadSession) {
          pendingUploads -= 1;
          renderPhotoPreviews();
        }
      }
    }
  }

  function clearPhotos() {
    uploadSession += 1;
    pendingUploads = 0;
    photos = [];
    renderPhotoPreviews();
  }

  $('#publicDepartment').addEventListener('change', updateDepartmentFields);
  $('#publicDate').value = localDateInputValue();
  updateDepartmentFields();
  updateStorageNote();
  form.addEventListener('input', () => { if (!form.querySelector('[type="submit"]').disabled) pendingReport = null; });
  $('#publicChoosePhotos').addEventListener('click', () => $('#publicPhotoInput').click());
  $('#publicPhotoInput').addEventListener('change', event => {
    addPhotos(event.target.files);
    event.target.value = '';
  });
  $('#publicPhotoDropzone').addEventListener('dragover', event => {
    event.preventDefault();
    $('#publicPhotoDropzone').classList.add('drag-active');
  });
  $('#publicPhotoDropzone').addEventListener('dragleave', event => {
    if (!$('#publicPhotoDropzone').contains(event.relatedTarget)) $('#publicPhotoDropzone').classList.remove('drag-active');
  });
  $('#publicPhotoDropzone').addEventListener('drop', event => {
    event.preventDefault();
    $('#publicPhotoDropzone').classList.remove('drag-active');
    addPhotos(event.dataTransfer.files);
  });
  document.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addPhotos(files);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [$('#publicDate'), $('#publicPersonId'), $('#publicDepartment'), $('#publicSeverity'), $('#publicDescription')];
    const invalid = required.find(field => !field.value.trim());
    if (invalid) {
      errorBox.textContent = 'Complete the date, ID number, department, urgency, and incident description.';
      errorBox.hidden = false;
      invalid.focus();
      return;
    }
    if (pendingUploads > 0) {
      errorBox.textContent = 'Wait for photo uploads to finish before submitting.';
      errorBox.hidden = false;
      return;
    }
    if (!pendingReport) {
      const now = new Date().toISOString();
      pendingReport = {
        id: createId(),
        ticketId: nextTicketId(),
        category: incidentCategoryForDepartment($('#publicDepartment').value),
        department: $('#publicDepartment').value,
        incidentDate: $('#publicDate').value,
        startTime: $('#publicStart').value,
        endTime: $('#publicEnd').value,
        lostTime: $('#publicLost').value.trim(),
        location: $('#publicLocation').value.trim(),
        personId: $('#publicPersonId').value.trim(),
        gameId: $('#publicGameId').value.trim(),
        description: $('#publicDescription').value.trim(),
        settlement: $('#publicSettlement').value.trim(),
        itId: $('#publicItId').value.trim(),
        status: 'New',
        severity: $('#publicSeverity').value,
        assignedTo: '',
        ticketNotes: '',
        photos: photos.slice(0, MAX_PHOTOS),
        createdAt: now,
        updatedAt: now
      };
    }
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.querySelector('svg')?.classList.add('sync-spin');
    const submitLabel = submitButton.lastChild;
    const originalLabel = submitLabel?.textContent;
    if (submitLabel) submitLabel.textContent = ' Sending…';
    let report = pendingReport;
    if (window.IncidentSync?.isConfigured()) {
      try {
        const result = await window.IncidentSync.submit('create', pendingReport);
        report = result.report || pendingReport;
      } catch (error) {
        errorBox.textContent = `${error.message} Your details are still here; submit again to retry.`;
        errorBox.hidden = false;
        submitButton.disabled = false;
        submitButton.querySelector('svg')?.classList.remove('sync-spin');
        if (submitLabel) submitLabel.textContent = originalLabel || 'Submit incident';
        return;
      }
    }
    const updatedReports = [...reports.filter(item => item.id !== report.id), report];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedReports));
      reports = updatedReports;
    } catch {
      if (!window.IncidentSync?.isConfigured()) {
        errorBox.textContent = 'This report could not be saved in this browser. Its storage may be full. Try fewer or smaller photos.';
        errorBox.hidden = false;
        submitButton.disabled = false;
        submitButton.querySelector('svg')?.classList.remove('sync-spin');
        if (submitLabel) submitLabel.textContent = originalLabel || 'Submit incident';
        return;
      }
      reports = updatedReports;
    }
    errorBox.hidden = true;
    $('#publicSuccess').hidden = false;
    $('#publicReportForm').hidden = true;
    $('#successTicketNumber').textContent = report.ticketId;
    submitButton.disabled = false;
    submitButton.querySelector('svg')?.classList.remove('sync-spin');
    if (submitLabel) submitLabel.textContent = originalLabel || 'Submit incident';
    pendingReport = null;
  });

  $('#reportAnother').addEventListener('click', () => {
    form.reset();
    pendingReport = null;
    $('#publicDate').value = localDateInputValue();
    errorBox.hidden = true;
    $('#publicSuccess').hidden = true;
    form.hidden = false;
    form.querySelector('[type="submit"]').disabled = false;
    clearPhotos();
    updateDepartmentFields();
    $('#publicDepartment').focus();
  });
})();
