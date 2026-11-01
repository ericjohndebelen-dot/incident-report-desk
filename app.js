(() => {
  'use strict';

  const STORAGE_KEY = 'incident-desk.reports.v1';
  const CATEGORIES = [
    'Studio Incident',
    'Card Room Incident',
    'Training Room Incident',
    'Office Incident',
    'Maintenance Records',
    'CCTV Records'
  ];
  const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
  const DEPARTMENTS = ['CCTV', 'HR', 'ADMIN', 'STUDIO', 'CARD'];
  const MAX_PHOTOS = 3;
  const MAX_PHOTO_DATA_URL_LENGTH = 850_000;
  const STATUS_LABELS = { New: 'New', Ongoing: 'Ongoing', 'In Progress': 'In Progress', Resolved: 'Resolved', Closed: 'Closed' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const reportList = $('#reportList');
  const dialog = $('#reportDialog');
  const form = $('#reportForm');
  const toast = $('#toast');
  let reports = loadReports();
  let activeTicketId = null;
  let currentPhotos = [];
  let pendingPhotoUploads = 0;
  let photoUploadSession = 0;
  let toastTimer;
  let remoteRefreshActive = false;
  let photoRequestSequence = 0;

  let migratedTicketIds = false;
  for (const report of reports) {
    if (!report.ticketId) {
      report.ticketId = nextTicketId();
      migratedTicketIds = true;
    }
  }
  if (migratedTicketIds) saveReports();

  function localDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function createId() {
    return globalThis.crypto?.randomUUID?.() || `ir-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nextTicketId() {
    const date = localDateInputValue().replaceAll('-', '');
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `TKT-${date}-${suffix}`;
  }

  function photoSource(photo) {
    if (photo?.dataUrl) return photo.dataUrl;
    if (photo?.driveFileId) return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(photo.driveFileId)}`;
    return '';
  }

  function statusClass(status) {
    if (status === 'Closed' || status === 'Resolved') return 'status-resolved';
    if (status === 'In Progress') return 'status-progress';
    if (status === 'Ongoing') return 'status-ongoing';
    return 'status-new';
  }

  function normalizeReport(value) {
    if (!value || typeof value !== 'object' || !CATEGORIES.includes(value.category)) return null;
    const description = String(value.description || '').trim().slice(0, 3000);
    const incidentDate = String(value.incidentDate || '').slice(0, 10);
    if (!description || !/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) return null;
    const status = Object.hasOwn(STATUS_LABELS, value.status) ? value.status : 'New';
    const severity = SEVERITIES.includes(value.severity) ? value.severity : 'Medium';
    return {
      id: String(value.id || createId()).slice(0, 120),
      ticketId: String(value.ticketId || '').slice(0, 40),
      category: value.category,
      department: DEPARTMENTS.includes(value.department) ? value.department : '',
      incidentDate,
      startTime: String(value.startTime || '').slice(0, 5),
      endTime: String(value.endTime || '').slice(0, 5),
      lostTime: String(value.lostTime || '').slice(0, 60),
      location: String(value.location || '').trim().slice(0, 120),
      personId: String(value.personId || '').trim().slice(0, 80),
      gameId: String(value.gameId || '').trim().slice(0, 80),
      description,
      settlement: String(value.settlement || '').trim().slice(0, 1500),
      itId: String(value.itId || '').trim().slice(0, 80),
      status,
      severity,
      assignedTo: String(value.assignedTo || '').trim().slice(0, 100),
      ticketNotes: String(value.ticketNotes || '').trim().slice(0, 2000),
      photos: Array.isArray(value.photos) ? value.photos
        .map(photo => {
          if (!photo || typeof photo !== 'object') return null;
          const dataUrl = String(photo.dataUrl || '');
          const driveFileId = String(photo.driveFileId || '').slice(0, 120);
          if (dataUrl && /^data:image\/jpeg;base64,/.test(dataUrl) && dataUrl.length <= MAX_PHOTO_DATA_URL_LENGTH) {
            return { name: String(photo.name || 'Incident photo').slice(0, 100), dataUrl };
          }
          if (driveFileId) return { name: String(photo.name || 'Incident photo').slice(0, 100), driveFileId };
          return null;
        })
        .filter(Boolean).slice(0, MAX_PHOTOS) : [],
      createdAt: String(value.createdAt || new Date().toISOString()),
      updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString())
    };
  }

  function loadReports() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const list = Array.isArray(saved) ? saved : (Array.isArray(saved.reports) ? saved.reports : []);
      return list.map(normalizeReport).filter(Boolean);
    } catch {
      return [];
    }
  }

  function saveReports() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
      return true;
    } catch {
      showToast('The report could not be saved. Browser storage may be full, especially with photos. Download a backup and free up space.');
      return false;
    }
  }

  function setConnectionStatus(connected) {
    const label = connected ? 'Shared reports connected' : (window.IncidentSync?.isConfigured() ? 'Shared reports not connected' : 'Saved in this browser');
    const status = $('#connectionStatus');
    status.replaceChildren();
    const dot = document.createElement('span');
    dot.className = connected ? 'online-dot' : 'online-dot offline-dot';
    status.append(dot, document.createTextNode(label));
    $('#connectSyncButton').querySelector('span').textContent = connected ? 'Connected' : 'Connect';
    $('#connectSyncButton').title = connected ? 'Reconnect or resync local reports' : 'Connect this dashboard to shared reports';
    $('#storageCard strong').textContent = connected ? 'Shared storage' : (window.IncidentSync?.isConfigured() ? 'Connection needed' : 'Local storage');
    $('#storageCard p').textContent = connected
      ? 'The dashboard refreshes reports saved from the public link.'
      : (window.IncidentSync?.isConfigured() ? 'Connect this dashboard to load reports submitted from other devices.' : 'Reports are saved in this browser on this device.');
    $('#storageDescription').textContent = connected
      ? 'Reports and ticket updates are saved in the shared Incident Desk sheet. Photos stay in its private Drive folder.'
      : 'Reports are stored in this browser only. Connect the shared service to collect reports from the public link on any device.';
    const footer = $('#storageFooter');
    footer.replaceChildren(footer.querySelector('svg'), document.createTextNode(connected ? ' Shared reports and tickets' : ' Stored in this browser only'));
  }

  async function saveRemoteReport(report) {
    const key = window.IncidentSync?.getAdminKey();
    if (!key || !window.IncidentSync?.isConfigured()) return null;
    try {
      const result = await window.IncidentSync.submit('upsert', report, key);
      const saved = normalizeReport(result.report);
      if (saved) {
        const index = reports.findIndex(item => item.id === saved.id);
        if (index >= 0) reports[index] = saved;
        saveReports();
      }
      return true;
    } catch (error) {
      showToast(`Saved on this device. Shared update failed: ${error.message}`);
      return false;
    }
  }

  async function refreshRemoteReports(promptForKey = true, syncLocalReports = false) {
    if (!window.IncidentSync?.isConfigured()) {
      setConnectionStatus(false);
      showToast('Add the shared web app URL in config.js first.');
      return;
    }
    if (remoteRefreshActive) return;
    let key = window.IncidentSync.getAdminKey();
    if (!key && promptForKey) {
      key = window.prompt('Enter the Incident Desk dashboard key from your Google Apps Script setup:')?.trim() || '';
      if (!key) return;
      window.IncidentSync.setAdminKey(key);
    }
    if (!key) {
      setConnectionStatus(false);
      return;
    }
    remoteRefreshActive = true;
    const refreshButton = $('#refreshRemoteButton');
    refreshButton.disabled = true;
    try {
      let shared = await window.IncidentSync.list(key);
      let sharedById = new Map(shared.map(value => normalizeReport(value)).filter(Boolean).map(report => [report.id, report]));
      if (syncLocalReports) {
        for (const local of reports.slice()) {
          if (sharedById.has(local.id)) continue;
          try {
            const result = await window.IncidentSync.submit('upsert', local, key);
            const saved = normalizeReport(result.report);
            if (saved) sharedById.set(saved.id, saved);
          } catch {
            // Keep a local-only report in the dashboard if the upload is temporarily unavailable.
          }
        }
        shared = await window.IncidentSync.list(key);
        sharedById = new Map(shared.map(value => normalizeReport(value)).filter(Boolean).map(report => [report.id, report]));
      }
      const localOnly = reports.filter(report => !sharedById.has(report.id));
      reports = [...sharedById.values(), ...localOnly];
      saveReports();
      renderDashboard();
      setConnectionStatus(true);
      showToast(`${sharedById.size} shared report(s) loaded${localOnly.length ? `; ${localOnly.length} remain on this device` : ''}.`);
    } catch (error) {
      if (/key was not accepted/i.test(error.message)) window.IncidentSync.setAdminKey('');
      setConnectionStatus(false);
      showToast(error.message);
    } finally {
      remoteRefreshActive = false;
      refreshButton.disabled = false;
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
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
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
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
      context.fillStyle = '#ffffff';
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
    const previews = $('#photoPreviews');
    if (!previews) return;
    previews.replaceChildren();
    currentPhotos.forEach((photo, index) => {
      const preview = document.createElement('div');
      preview.className = 'photo-preview';
      const image = document.createElement('img');
      image.src = photoSource(photo);
      image.alt = photo.name || `Incident photo ${index + 1}`;
      const remove = document.createElement('button');
      remove.className = 'photo-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove photo ${index + 1} from this report`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      remove.addEventListener('click', () => {
        currentPhotos.splice(index, 1);
        renderPhotoPreviews();
      });
      preview.append(image, remove);
      previews.append(preview);
    });
    $('#choosePhotos').disabled = currentPhotos.length + pendingPhotoUploads >= MAX_PHOTOS;
  }

  async function addPhotoFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    const files = selected.filter(file => file.type.startsWith('image/'));
    if (!files.length) {
      showToast('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    const slots = Math.max(0, MAX_PHOTOS - currentPhotos.length - pendingPhotoUploads);
    if (!slots) {
      showToast(`A report can include up to ${MAX_PHOTOS} photos.`);
      return;
    }
    if (files.length > slots) showToast(`Only ${slots} more photo(s) can be added to this report.`);
    const chosen = files.slice(0, slots);
    const session = photoUploadSession;
    pendingPhotoUploads += chosen.length;
    renderPhotoPreviews();
    for (const file of chosen) {
      try {
        const photo = await compressImage(file);
        if (session === photoUploadSession) currentPhotos.push(photo);
      } catch (error) {
        if (session === photoUploadSession) showToast(error.message || 'Could not add this photo.');
      } finally {
        if (session === photoUploadSession) {
          pendingPhotoUploads -= 1;
          renderPhotoPreviews();
        }
      }
    }
  }

  function showPhoto(photo, index) {
    if (!photo) return;
    const requestSequence = ++photoRequestSequence;
    $('#photoViewerImage').src = photoSource(photo);
    $('#photoViewerImage').alt = photo.name || `Incident photo ${index + 1}`;
    $('#photoViewer').showModal();
    const key = window.IncidentSync?.getAdminKey();
    if (photo.driveFileId && key) {
      window.IncidentSync.photo(photo.driveFileId, key).then(dataUrl => {
        if ($('#photoViewer').open && requestSequence === photoRequestSequence) {
          $('#photoViewerImage').src = dataUrl;
        }
      }).catch(() => {});
    }
  }

  function discardPendingPhotos() {
    photoUploadSession += 1;
    currentPhotos = [];
    pendingPhotoUploads = 0;
    renderPhotoPreviews();
  }

  function formatDate(value) {
    if (!value) return 'No date';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function fillCategoryOptions() {
    const select = $('#category');
    const filter = $('#categoryFilter');
    for (const category of CATEGORIES) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.append(option);
      filter.append(option.cloneNode(true));
    }
  }

  function updateCategoryFields() {
    const category = $('#category').value;
    const tableCategory = ['Studio Incident', 'Card Room Incident'].includes(category);
    $('#locationLabel').textContent = tableCategory ? 'Table No.' : 'Location';
    $('#personIdLabel').textContent = category === 'Studio Incident'
      ? 'SS ID (E-ID#)'
      : category === 'Office Incident' ? 'HR-ID (E-ID#)' : 'ID (E-ID#)';
    $('#descriptionLabel').innerHTML = `${['Studio Incident', 'Card Room Incident', 'Office Incident'].includes(category) ? 'Error description' : 'Incident description'} <i>*</i>`;
    $('#gameIdField').classList.toggle('hidden', category !== 'Studio Incident');
  }

  function createMeta(icon, text) {
    const span = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icon);
    svg.append(path);
    span.append(svg, document.createTextNode(text));
    return span;
  }

  function reportTitle(report) {
    const value = report.description.trim();
    return value.length > 112 ? `${value.slice(0, 109)}…` : value;
  }

  function makeReportCard(report) {
    const article = document.createElement('article');
    article.className = 'report-card';

    const main = document.createElement('div');
    main.className = 'report-main';
    const topline = document.createElement('div');
    topline.className = 'report-topline';
    const category = document.createElement('span');
    category.className = 'category-badge';
    category.textContent = report.category;
    const status = document.createElement('span');
    status.className = `status-badge ${statusClass(report.status)}`;
    status.textContent = STATUS_LABELS[report.status];
    const severity = document.createElement('span');
    severity.className = `severity-badge severity-${report.severity.toLowerCase()}`;
    severity.textContent = report.severity;
    const department = report.department ? document.createElement('span') : null;
    if (department) {
      department.className = 'department-badge';
      department.textContent = report.department;
      topline.append(category, department, status, severity);
    } else {
      topline.append(category, status, severity);
    }

    const title = document.createElement('h3');
    title.textContent = reportTitle(report);
    const meta = document.createElement('div');
    meta.className = 'report-meta';
    meta.append(createMeta('M12 3v18M5 8h14M7 5h.01M17 5h.01M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01', formatDate(report.incidentDate)));
    if (report.startTime) {
      const time = report.endTime ? `${report.startTime}–${report.endTime}` : report.startTime;
      meta.append(createMeta('M12 7v5l3 2m5-2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', time));
    }
    if (report.location) meta.append(createMeta('M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z M12 10h.01', report.location));
    if (report.personId) meta.append(createMeta('M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', report.personId));
    if (report.lostTime) meta.append(createMeta('M12 7v5l3 2m5-2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', `Lost time: ${report.lostTime}`));
    main.append(topline, title, meta);
    if (report.photos.length) {
      const thumbnails = document.createElement('div');
      thumbnails.className = 'report-thumbnails';
      report.photos.forEach((photo, index) => {
        const button = document.createElement('button');
        button.className = 'report-photo-thumb';
        button.type = 'button';
        button.dataset.action = 'view-photo';
        button.dataset.id = report.id;
        button.dataset.photoIndex = index;
        button.setAttribute('aria-label', `View incident photo ${index + 1}`);
        const image = document.createElement('img');
        image.src = photoSource(photo);
        image.alt = '';
        button.append(image);
        thumbnails.append(button);
      });
      main.append(thumbnails);
    }

    const side = document.createElement('div');
    side.className = 'report-side';
    const date = document.createElement('span');
    date.className = 'report-date';
    date.textContent = report.gameId ? `Game ID: ${report.gameId}` : (report.itId ? `IT ID: ${report.itId}` : '');
    const actions = document.createElement('div');
    actions.className = 'report-actions';
    const edit = document.createElement('button');
    edit.className = 'small-action';
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.dataset.id = report.id;
    edit.setAttribute('aria-label', 'Edit report');
    edit.title = 'Edit';
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.4-.9L19 8.5a2.1 2.1 0 0 0-3-3L5.4 16.1 4 20Z"/></svg>';
    actions.append(edit);
    side.append(date, actions);
    article.append(main, side);
    return article;
  }

  function addTicketDetail(container, label, value, full = false) {
    const field = document.createElement('div');
    field.className = `ticket-detail${full ? ' full' : ''}`;
    const caption = document.createElement('span');
    caption.className = 'ticket-detail-label';
    caption.textContent = label;
    const text = document.createElement('p');
    text.className = 'ticket-detail-value';
    text.textContent = value || '—';
    field.append(caption, text);
    container.append(field);
  }

  function populateTicketDialog(report) {
    activeTicketId = report.id;
    $('#ticketDialogTitle').textContent = report.ticketId || 'Incident ticket';
    $('#ticketDialogSubtitle').textContent = `${report.category} · ${formatDate(report.incidentDate)}`;
    const details = $('#ticketDetails');
    details.replaceChildren();
    const isTableIncident = ['Studio Incident', 'Card Room Incident'].includes(report.category);
    const incidentTime = report.startTime
      ? (report.endTime ? `${report.startTime}–${report.endTime}` : report.startTime)
      : '';
    addTicketDetail(details, 'Department', report.department);
    addTicketDetail(details, 'Incident type', report.category);
    addTicketDetail(details, 'Urgency', report.severity);
    addTicketDetail(details, 'Incident date', formatDate(report.incidentDate));
    addTicketDetail(details, 'Incident time', incidentTime);
    addTicketDetail(details, 'Lost time', report.lostTime);
    addTicketDetail(details, isTableIncident ? 'Table No.' : 'Location', report.location);
    addTicketDetail(details, 'ID number', report.personId);
    addTicketDetail(details, 'Game ID', report.gameId);
    addTicketDetail(details, 'IT ID', report.itId);
    addTicketDetail(details, 'Incident description', report.description, true);
    addTicketDetail(details, 'Settlement / action taken', report.settlement, true);

    const gallery = $('#ticketPhotoGallery');
    gallery.replaceChildren();
    report.photos.forEach((photo, index) => {
      const button = document.createElement('button');
      button.className = 'report-photo-thumb';
      button.type = 'button';
      button.dataset.action = 'view-photo';
      button.dataset.id = report.id;
      button.dataset.photoIndex = index;
      button.setAttribute('aria-label', `View incident photo ${index + 1}`);
      const image = document.createElement('img');
      image.src = photoSource(photo);
      image.alt = '';
      button.append(image);
      gallery.append(button);
    });
    $('#ticketDetailStatus').value = report.status;
    $('#ticketAssignee').value = report.assignedTo || '';
    $('#ticketNotes').value = report.ticketNotes || '';
  }

  function openTicket(report) {
    populateTicketDialog(report);
    $('#ticketDialog').showModal();
  }

  function renderTickets() {
    const query = $('#ticketSearch').value.trim().toLocaleLowerCase();
    const status = $('#ticketStatusFilter').value;
    const filtered = reports
      .filter(report => (!status || report.status === status))
      .filter(report => !query || [report.ticketId, report.personId, report.department, report.category, report.severity, report.description, report.location, report.assignedTo, report.status]
        .some(value => String(value || '').toLocaleLowerCase().includes(query)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const list = $('#ticketList');
    list.replaceChildren();
    $('#ticketCount').textContent = filtered.length;
    $('#ticketNavCount').textContent = reports.length;
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'ticket-empty';
      empty.textContent = reports.length
        ? 'No tickets match your search or status filter.'
        : 'No tickets yet. Submitting an incident report will create a ticket automatically.';
      list.append(empty);
      return;
    }
    for (const report of filtered) {
      const row = document.createElement('button');
      row.className = `ticket-row${report.severity === 'Critical' ? ' ticket-critical' : ''}`;
      row.type = 'button';
      row.dataset.ticketId = report.id;
      const ticketId = document.createElement('span');
      ticketId.className = 'ticket-number';
      ticketId.textContent = report.ticketId;
      const incident = document.createElement('span');
      incident.className = 'ticket-incident';
      incident.textContent = reportTitle(report);
      const category = document.createElement('span');
      category.className = 'ticket-category';
      category.textContent = `${report.department || 'No department'} · ${report.category} · ${report.severity}`;
      const ticketStatus = document.createElement('span');
      ticketStatus.className = `status-badge ${statusClass(report.status)}`;
      ticketStatus.textContent = STATUS_LABELS[report.status];
      const date = document.createElement('span');
      date.className = 'ticket-created';
      date.textContent = formatDate(report.incidentDate);
      row.append(ticketId, incident, category, ticketStatus, date);
      list.append(row);
    }
  }

  function matchesFilters(report) {
    const query = $('#searchInput').value.trim().toLocaleLowerCase();
    const category = $('#categoryFilter').value;
    const status = $('#statusFilter').value;
    const severity = $('#severityFilter').value;
    if (category && report.category !== category) return false;
    if (status && report.status !== status) return false;
    if (severity && report.severity !== severity) return false;
    if (!query) return true;
    return [report.department, report.category, report.incidentDate, report.location, report.personId, report.gameId, report.description, report.settlement, report.itId, report.status, report.severity]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
  }

  function renderReports() {
    const filtered = reports.filter(matchesFilters).sort((a, b) => b.incidentDate.localeCompare(a.incidentDate) || b.createdAt.localeCompare(a.createdAt));
    reportList.replaceChildren();
    $('#visibleCount').textContent = filtered.length;
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const icon = document.createElement('div');
      icon.className = 'empty-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z"/><path d="M14 4v4.5h4.25M8.5 12h7M8.5 15.5h4"/></svg>';
      const heading = document.createElement('h3');
      heading.textContent = reports.length ? 'No matching reports' : 'No incident reports yet';
      const message = document.createElement('p');
      message.textContent = reports.length ? 'Try changing the search or filters to find a report.' : 'Create your first report to start a record here.';
      empty.append(icon, heading, message);
      if (!reports.length) {
        const create = document.createElement('button');
        create.className = 'button button-primary';
        create.type = 'button';
        create.dataset.openForm = '';
        create.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New report</span>';
        empty.append(create);
      }
      reportList.append(empty);
      return;
    }
    for (const report of filtered) reportList.append(makeReportCard(report));
  }

  function renderDashboard() {
    const resolved = reports.filter(report => ['Resolved', 'Closed'].includes(report.status)).length;
    const open = reports.length - resolved;
    const critical = reports.filter(report => report.severity === 'Critical').length;
    const usedCategories = new Set(reports.map(report => report.category)).size;
    $('#totalCount').textContent = reports.length;
    $('#openCount').textContent = open;
    $('#resolvedCount').textContent = resolved;
    $('#categoryCount').textContent = usedCategories;
    $('#criticalCount').textContent = critical;
    $('#navCount').textContent = reports.length;

    const categoryBars = $('#categoryBars');
    const counts = CATEGORIES.map(category => [category, reports.filter(report => report.category === category).length]);
    const max = Math.max(1, ...counts.map(([, count]) => count));
    categoryBars.replaceChildren();
    for (const [category, count] of counts) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Filter ${category}, ${count} reports`);
      const name = document.createElement('span');
      name.className = 'bar-name';
      name.textContent = category;
      const track = document.createElement('span');
      track.className = 'bar-track';
      const fill = document.createElement('span');
      fill.className = 'bar-fill';
      fill.style.width = `${count ? Math.max(5, count / max * 100) : 0}%`;
      track.append(fill);
      const value = document.createElement('span');
      value.className = 'bar-count';
      value.textContent = count;
      row.dataset.category = category;
      row.append(name, track, value);
      categoryBars.append(row);
    }
    renderReports();
    renderTickets();
  }

  function resetForm() {
    form.reset();
    $('#editingId').value = '';
    discardPendingPhotos();
    $('#formTitle').textContent = 'New report';
    $('#incidentDate').value = localDateInputValue();
    $('#formError').hidden = true;
    $('#formError').textContent = '';
    updateCategoryFields();
  }

  function openNewForm() {
    resetForm();
    dialog.showModal();
    $('#category').focus();
  }

  function openEditForm(report) {
    resetForm();
    $('#formTitle').textContent = 'Edit report';
    $('#editingId').value = report.id;
    for (const key of ['category', 'department', 'incidentDate', 'startTime', 'endTime', 'lostTime', 'location', 'personId', 'gameId', 'description', 'settlement', 'itId', 'status', 'severity']) {
      $(`#${key}`).value = report[key] || (key === 'status' ? 'New' : '');
    }
    currentPhotos = report.photos.map(photo => ({ ...photo }));
    renderPhotoPreviews();
    updateCategoryFields();
    dialog.showModal();
    $('#category').focus();
  }

  function formValues() {
    const existing = reports.find(report => report.id === $('#editingId').value);
    return normalizeReport({
      id: $('#editingId').value || createId(),
      ticketId: existing?.ticketId || nextTicketId(),
      category: $('#category').value,
      department: $('#department').value,
      incidentDate: $('#incidentDate').value,
      startTime: $('#startTime').value,
      endTime: $('#endTime').value,
      lostTime: $('#lostTime').value,
      location: $('#location').value,
      personId: $('#personId').value,
      gameId: $('#gameId').value,
      description: $('#description').value,
      settlement: $('#settlement').value,
      itId: $('#itId').value,
      status: $('#status').value,
      severity: $('#severity').value,
      assignedTo: existing?.assignedTo || '',
      ticketNotes: existing?.ticketNotes || '',
      photos: currentPhotos,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const backup = { app: 'Incident Desk', version: 1, exportedAt: new Date().toISOString(), reports };
    downloadFile(`incident-desk-backup-${localDateInputValue()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    showToast(`JSON backup downloaded with ${reports.length} report(s).`);
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const columns = [
      ['Ticket ID', 'ticketId'], ['Incident Date', 'incidentDate'], ['ID Number', 'personId'], ['Department', 'department'], ['Incident Type', 'category'], ['Urgency', 'severity'], ['Start Time', 'startTime'], ['End Time', 'endTime'],
      ['Lost Time', 'lostTime'], ['Location / Table No.', 'location'], ['What are you reporting?', 'description'],
      ['Settlement', 'settlement'], ['Game ID', 'gameId'], ['IT ID', 'itId'], ['Status', 'status'], ['Assigned To', 'assignedTo'], ['Ticket Notes', 'ticketNotes']
    ];
    const rows = [columns.map(([label]) => csvCell(label)).join(',')];
    for (const report of reports) rows.push(columns.map(([, key]) => csvCell(report[key])).join(','));
    downloadFile(`incident-desk-reports-${localDateInputValue()}.csv`, `\uFEFF${rows.join('\r\n')}`, 'text/csv;charset=utf-8');
    showToast(`${reports.length} report(s) downloaded as CSV.`);
  }

  function importJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const incoming = Array.isArray(parsed) ? parsed : parsed.reports;
        if (!Array.isArray(incoming)) throw new Error('invalid');
        const existingIds = new Set(reports.map(report => report.id));
        const existingTicketIds = new Set(reports.map(report => report.ticketId));
        let added = 0;
        for (const item of incoming) {
          const report = normalizeReport(item);
          if (!report) continue;
          if (existingIds.has(report.id)) report.id = createId();
          if (!report.ticketId || existingTicketIds.has(report.ticketId)) report.ticketId = nextTicketId();
          existingIds.add(report.id);
          existingTicketIds.add(report.ticketId);
          reports.push(report);
          added += 1;
        }
        if (!saveReports()) return;
        renderDashboard();
        showToast(`${added} report(s) imported.`);
      } catch {
        showToast('Could not read the file. Choose a valid Incident Desk JSON backup.');
      } finally {
        $('#importFile').value = '';
      }
    };
    reader.onerror = () => showToast('Could not read the selected file.');
    reader.readAsText(file);
  }

  fillCategoryOptions();
  $('#todayLabel').textContent = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  $('#incidentDate').value = localDateInputValue();
  updateCategoryFields();
  renderDashboard();
  setConnectionStatus(Boolean(window.IncidentSync?.getAdminKey()) && window.IncidentSync?.isConfigured());
  if (window.IncidentSync?.getAdminKey() && window.IncidentSync?.isConfigured()) {
    refreshRemoteReports(false, false);
    window.setInterval(() => {
      if (window.IncidentSync.getAdminKey()) refreshRemoteReports(false, false);
    }, 60000);
  }

  document.addEventListener('click', event => {
    const openButton = event.target.closest('[data-open-form]');
    if (openButton) { openNewForm(); return; }
    const ticketButton = event.target.closest('[data-ticket-id]');
    if (ticketButton) {
      const report = reports.find(item => item.id === ticketButton.dataset.ticketId);
      if (report) openTicket(report);
      return;
    }
    const bar = event.target.closest('.bar-row');
    if (bar) {
      $('#categoryFilter').value = $('#categoryFilter').value === bar.dataset.category ? '' : bar.dataset.category;
      renderReports();
      $('#reports').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const report = reports.find(item => item.id === action.dataset.id);
    if (!report) return;
    if (action.dataset.action === 'edit') {
      openEditForm(report);
      return;
    }
    if (action.dataset.action === 'view-photo') {
      const photoIndex = Number(action.dataset.photoIndex);
      showPhoto(report.photos[photoIndex], photoIndex);
    }
  });

  $('#categoryBars').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.bar-row');
    if (!row) return;
    event.preventDefault();
    $('#categoryFilter').value = $('#categoryFilter').value === row.dataset.category ? '' : row.dataset.category;
    renderReports();
    $('#reports').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#category').addEventListener('change', updateCategoryFields);
  $('#searchInput').addEventListener('input', renderReports);
  $('#categoryFilter').addEventListener('change', renderReports);
  $('#statusFilter').addEventListener('change', renderReports);
  $('#severityFilter').addEventListener('change', renderReports);
  $('#ticketSearch').addEventListener('input', renderTickets);
  $('#ticketStatusFilter').addEventListener('change', renderTickets);
  $('#closeDialog').addEventListener('click', () => dialog.close());
  $('#cancelForm').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  $('#choosePhotos').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', event => {
    addPhotoFiles(event.target.files);
    event.target.value = '';
  });
  $('#photoDropzone').addEventListener('dragover', event => {
    event.preventDefault();
    $('#photoDropzone').classList.add('drag-active');
  });
  $('#photoDropzone').addEventListener('dragleave', event => {
    if (!$('#photoDropzone').contains(event.relatedTarget)) $('#photoDropzone').classList.remove('drag-active');
  });
  $('#photoDropzone').addEventListener('drop', event => {
    event.preventDefault();
    $('#photoDropzone').classList.remove('drag-active');
    addPhotoFiles(event.dataTransfer.files);
  });
  dialog.addEventListener('paste', event => {
    if (!dialog.open) return;
    const files = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addPhotoFiles(files);
  });
  $('#closePhotoViewer').addEventListener('click', () => { photoRequestSequence += 1; $('#photoViewer').close(); });
  $('#photoViewer').addEventListener('click', event => { if (event.target === $('#photoViewer')) { photoRequestSequence += 1; $('#photoViewer').close(); } });
  $('#closeTicketDialog').addEventListener('click', () => $('#ticketDialog').close());
  $('#editSourceIncident').addEventListener('click', () => {
    const report = reports.find(item => item.id === activeTicketId);
    if (!report) return;
    $('#ticketDialog').close();
    openEditForm(report);
  });
  $('#saveTicket').addEventListener('click', async () => {
    const report = reports.find(item => item.id === activeTicketId);
    if (!report) return;
    report.status = $('#ticketDetailStatus').value;
    report.assignedTo = $('#ticketAssignee').value.trim().slice(0, 100);
    report.ticketNotes = $('#ticketNotes').value.trim().slice(0, 2000);
    report.updatedAt = new Date().toISOString();
    if (!saveReports()) return;
    const sharedSaved = await saveRemoteReport(report);
    renderDashboard();
    populateTicketDialog(report);
    showToast(sharedSaved === false
      ? `Ticket ${report.ticketId} is saved here. Reconnect and refresh to sync it.`
      : (sharedSaved ? `Ticket ${report.ticketId} updated in the shared dashboard.` : `Ticket ${report.ticketId} updated on this device. Connect the dashboard to share it.`));
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [$('#category'), $('#incidentDate'), $('#description')];
    const invalid = required.find(field => !field.value.trim());
    const error = $('#formError');
    if (invalid) {
      error.textContent = 'Complete the incident type, incident date, and incident description.';
      error.hidden = false;
      invalid.focus();
      return;
    }
    if (pendingPhotoUploads > 0) {
      error.textContent = 'Wait for the photo upload to finish before saving this report.';
      error.hidden = false;
      return;
    }
    const report = formValues();
    if (!report) {
      error.textContent = 'This report is not valid. Check the fields and try again.';
      error.hidden = false;
      return;
    }
    const existingIndex = reports.findIndex(item => item.id === report.id);
    if (existingIndex >= 0) reports[existingIndex] = report;
    else reports.push(report);
    if (!saveReports()) return;
    const sharedSaved = await saveRemoteReport(report);
    renderDashboard();
    dialog.close();
    resetForm();
    showToast(sharedSaved === false
      ? 'Saved on this device. Reconnect and refresh to sync this report.'
      : (sharedSaved ? `Report ${report.ticketId} saved to the shared dashboard.` : `Report ${report.ticketId} saved on this device. Connect the dashboard to share it.`));
  });

  $('#exportButton').addEventListener('click', exportJson);
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', event => importJson(event.target.files[0]));
  $('#csvButton').addEventListener('click', exportCsv);
  $('#csvButtonSmall').addEventListener('click', exportCsv);
  $('#copyReportLink').addEventListener('click', async () => {
    const link = new URL('report.html', window.location.href).toString();
    try {
      await navigator.clipboard.writeText(link);
      showToast('Public reporting link copied to clipboard.');
    } catch {
      window.prompt('Copy this public reporting link:', link);
    }
  });
  $('#connectSyncButton').addEventListener('click', () => refreshRemoteReports(true, true));
  $('#refreshRemoteButton').addEventListener('click', () => refreshRemoteReports(true, false));
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    reports = loadReports();
    renderDashboard();
    showToast('Incident reports refreshed from the reporting page.');
  });
})();
