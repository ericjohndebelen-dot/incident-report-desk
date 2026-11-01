const REPORT_SHEET_NAME = 'Reports';
const REPORT_HEADERS = [
  'Record ID', 'Ticket ID', 'Date', 'ID Number', 'Department', 'What Are You Reporting?', 'Urgency', 'Incident Type',
  'Start Time', 'End Time', 'Lost Time', 'Location / Table No.', 'Settlement / Action Taken', 'Game ID', 'IT ID',
  'Status', 'Assigned Team', 'Handled By', 'Ticket Notes', 'Photos', 'Created At', 'Updated At', 'Record JSON'
];
const REPORT_CATEGORIES = ['Studio Incident', 'Card Room Incident', 'Training Room Incident', 'Office Incident', 'Maintenance Records', 'CCTV Records'];
const REPORT_DEPARTMENTS = ['CCTV', 'HR', 'ADMIN', 'STUDIO', 'CARD', 'MAINTENANCE'];
const ASSIGNED_TEAMS = ['IT', 'Maintenance'];
const REPORT_URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const REPORT_STATUSES = ['New', 'Ongoing', 'In Progress', 'Resolved', 'Closed'];

/** Run once from the Apps Script editor to create a private sheet and photo folder. */
function setupIncidentDesk() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty('INCIDENT_SPREADSHEET_ID');
  let folderId = properties.getProperty('INCIDENT_PHOTO_FOLDER_ID');
  let adminKey = properties.getProperty('INCIDENT_ADMIN_KEY');

  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create('Incident Desk Reports');
    spreadsheetId = spreadsheet.getId();
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName(REPORT_SHEET_NAME);
    sheet.getRange(1, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, REPORT_HEADERS.length).setFontWeight('bold').setBackground('#e8f2ee');
    sheet.autoResizeColumns(1, REPORT_HEADERS.length);
    sheet.setColumnWidth(REPORT_HEADERS.length, 180);
    sheet.hideColumns(REPORT_HEADERS.length);
    properties.setProperty('INCIDENT_SPREADSHEET_ID', spreadsheetId);
  }
  if (!folderId) {
    folderId = DriveApp.createFolder('Incident Desk Photos (private)').getId();
    properties.setProperty('INCIDENT_PHOTO_FOLDER_ID', folderId);
  }
  if (!adminKey) {
    adminKey = `${Utilities.getUuid()}-${Utilities.getUuid()}`;
    properties.setProperty('INCIDENT_ADMIN_KEY', adminKey);
  }

  const output = {
    spreadsheet: SpreadsheetApp.openById(spreadsheetId).getUrl(),
    photoFolder: DriveApp.getFolderById(folderId).getUrl(),
    dashboardKey: adminKey
  };
  Logger.log(JSON.stringify(output, null, 2));
  return output;
}

function doGet(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  const callback = String(parameters.callback || '');
  if (!/^incidentDeskCallback_[A-Za-z0-9_]{1,100}$/.test(callback)) {
    return ContentService.createTextOutput('Invalid callback').setMimeType(ContentService.MimeType.TEXT);
  }
  if (!['list', 'photo'].includes(parameters.action)) return jsonp(callback, { ok: false, error: 'Unknown action.' });
  if (!validAdminKey(parameters.key)) return jsonp(callback, { ok: false, error: 'The dashboard connection key was not accepted.' });

  try {
    if (parameters.action === 'photo') return jsonp(callback, { ok: true, dataUrl: readPrivatePhoto(parameters.fileId) });
    return jsonp(callback, { ok: true, reports: readReports() });
  } catch (error) {
    return jsonp(callback, { ok: false, error: 'Could not read the incident report sheet.' });
  }
}

function readPrivatePhoto(fileId) {
  const safeId = String(fileId || '');
  if (!/^[A-Za-z0-9_-]{15,}$/.test(safeId)) throw new Error('Invalid photo ID.');
  const folderId = requiredProperty('INCIDENT_PHOTO_FOLDER_ID');
  const file = DriveApp.getFileById(safeId);
  const parents = file.getParents();
  let belongsToIncidentFolder = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) belongsToIncidentFolder = true;
  if (!belongsToIncidentFolder) throw new Error('This photo is not in the private incident folder.');
  const blob = file.getBlob();
  const contentType = blob.getContentType();
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) throw new Error('This file is not a supported incident photo.');
  return `data:${contentType};base64,${Utilities.base64Encode(blob.getBytes())}`;
}

function doPost(event) {
  let payload = {};
  try {
    payload = JSON.parse(String(event && event.parameter && event.parameter.payload || '{}'));
    let result;
    if (payload.action === 'create') {
      result = createPublicReport(payload.report);
    } else if (payload.action === 'upsert') {
      if (!validAdminKey(payload.key)) throw new Error('The dashboard connection key was not accepted.');
      result = upsertAdminReport(payload.report);
    } else {
      throw new Error('Unknown report action.');
    }
    return postMessagePage({ channel: 'incident-desk-sync', nonce: String(payload.nonce || ''), ok: true, report: result });
  } catch (error) {
    return postMessagePage({
      channel: 'incident-desk-sync', nonce: String(payload.nonce || ''), ok: false,
      error: String(error && error.message || 'Could not save the report.')
    });
  }
}

function createPublicReport(input) {
  const report = normalizeIncident(input, true);
  if (!report.id || !report.ticketId) throw new Error('The report is missing its ticket details.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = reportSheet();
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, REPORT_HEADERS.length).getValues() : [];
    const existingRow = rows.find(row => String(row[0]) === report.id);
    if (existingRow) return parseStoredReport(existingRow);
    if (rows.some(row => String(row[1]) === report.ticketId)) report.ticketId = newTicketId();
    report.photos = saveIncidentPhotos(report.photos, [], true);
    report.createdAt = report.createdAt || new Date().toISOString();
    report.updatedAt = new Date().toISOString();
    sheet.appendRow(reportToRow(report));
    return report;
  } finally {
    lock.releaseLock();
  }
}

function upsertAdminReport(input) {
  const candidate = normalizeIncident(input, false);
  if (!candidate.id || !candidate.ticketId) throw new Error('The report is missing its ticket details.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = reportSheet();
    const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, REPORT_HEADERS.length).getValues() : [];
    const index = values.findIndex(row => String(row[0]) === candidate.id);
    const previous = index >= 0 ? parseStoredReport(values[index]) : null;
    if (index < 0 && values.some(row => String(row[1]) === candidate.ticketId)) candidate.ticketId = newTicketId();
    candidate.createdAt = previous ? previous.createdAt : (candidate.createdAt || new Date().toISOString());
    candidate.updatedAt = new Date().toISOString();
    candidate.photos = saveIncidentPhotos(candidate.photos, previous ? previous.photos : [], false);
    const output = reportToRow(candidate);
    if (index >= 0) sheet.getRange(index + 2, 1, 1, REPORT_HEADERS.length).setValues([output]);
    else sheet.appendRow(output);
    return candidate;
  } finally {
    lock.releaseLock();
  }
}

function normalizeIncident(value, isPublic) {
  if (!value || typeof value !== 'object') throw new Error('The report details are invalid.');
  const department = REPORT_DEPARTMENTS.includes(value.department) ? value.department : '';
  const categoryByDepartment = { CCTV: 'CCTV Records', HR: 'Office Incident', ADMIN: 'Office Incident', STUDIO: 'Studio Incident', CARD: 'Card Room Incident', MAINTENANCE: 'Maintenance Records' };
  const category = REPORT_CATEGORIES.includes(value.category) ? value.category : categoryByDepartment[department];
  const date = String(value.incidentDate || '').slice(0, 10);
  const description = cleanText(value.description, 3000);
  const assignedTeam = ASSIGNED_TEAMS.includes(value.assignedTeam) ? value.assignedTeam : '';
  if (!category || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !description) throw new Error('Complete the date, department, and incident description.');
  if (isPublic && !assignedTeam) throw new Error('Choose IT or Maintenance to handle this report.');
  const photos = Array.isArray(value.photos) ? value.photos.slice(0, 3).map(photo => ({
    name: cleanText(photo && photo.name || 'Incident photo', 100) || 'Incident photo',
    dataUrl: String(photo && photo.dataUrl || ''),
    driveFileId: isPublic ? '' : String(photo && photo.driveFileId || '')
  })) : [];
  return {
    id: cleanText(value.id, 120),
    ticketId: cleanText(value.ticketId, 40),
    category,
    department,
    incidentDate: date,
    startTime: cleanText(value.startTime, 5),
    endTime: cleanText(value.endTime, 5),
    lostTime: cleanText(value.lostTime, 60),
    location: cleanText(value.location, 120),
    personId: cleanText(value.personId, 80),
    gameId: cleanText(value.gameId, 80),
    description,
    settlement: cleanText(value.settlement, 1500),
    itId: cleanText(value.itId, 80),
    status: REPORT_STATUSES.includes(value.status) ? value.status : 'New',
    severity: REPORT_URGENCIES.includes(value.severity) ? value.severity : 'Medium',
    assignedTeam,
    assignedTo: isPublic ? '' : cleanText(value.assignedTo, 100),
    ticketNotes: isPublic ? '' : cleanText(value.ticketNotes, 2000),
    photos,
    createdAt: cleanText(value.createdAt, 40),
    updatedAt: cleanText(value.updatedAt, 40)
  };
}

function saveIncidentPhotos(photos, previousPhotos, isPublic) {
  const folder = DriveApp.getFolderById(requiredProperty('INCIDENT_PHOTO_FOLDER_ID'));
  const previousIds = new Set((previousPhotos || []).map(photo => String(photo.driveFileId || '')).filter(Boolean));
  return (photos || []).slice(0, 3).map(photo => {
    const dataUrl = String(photo.dataUrl || '');
    if (dataUrl) {
      const match = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!match || dataUrl.length > 900000) throw new Error('A photo is too large or is not a supported JPEG.');
      const safeName = String(photo.name || 'Incident photo').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 80);
      const bytes = Utilities.base64Decode(match[1]);
      const file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', `${Date.now()}-${safeName || 'incident-photo'}.jpg`));
      return { name: String(photo.name || 'Incident photo').slice(0, 100), driveFileId: file.getId() };
    }
    const fileId = String(photo.driveFileId || '');
    if (!isPublic && fileId && previousIds.has(fileId)) {
      return { name: String(photo.name || 'Incident photo').slice(0, 100), driveFileId: fileId };
    }
    return null;
  }).filter(Boolean);
}

function reportToRow(report) {
  const values = [
    report.id, report.ticketId, report.incidentDate, report.personId, report.department, report.description, report.severity,
    report.category, report.startTime, report.endTime, report.lostTime, report.location, report.settlement, report.gameId,
    report.itId, report.status, report.assignedTeam, report.assignedTo, report.ticketNotes,
    (report.photos || []).map(photo => photo.driveFileId).filter(Boolean).join(', '), report.createdAt, report.updatedAt,
    JSON.stringify(report)
  ];
  return values.map(safeSheetValue);
}

function safeSheetValue(value) {
  const text = String(value == null ? '' : value);
  return /^[=+@\-]/.test(text) && !/^\d{4}-\d{2}-\d{2}$/.test(text) ? `'${text}` : text;
}

function readReports() {
  const sheet = reportSheet();
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, REPORT_HEADERS.length).getValues()
    .map(parseStoredReport).filter(Boolean);
}

function parseStoredReport(row) {
  try {
    const jsonIndex = REPORT_HEADERS.indexOf('Record JSON');
    const report = JSON.parse(String(row[jsonIndex] || '{}'));
    if (!report || !report.id) return null;
    return report;
  } catch (error) {
    return null;
  }
}

function reportSheet() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty('INCIDENT_SPREADSHEET_ID'));
  const sheet = spreadsheet.getSheetByName(REPORT_SHEET_NAME);
  if (!sheet) throw new Error('The Reports tab is missing. Run setupIncidentDesk again.');
  ensureAssignedTeamColumn(sheet);
  return sheet;
}

function ensureAssignedTeamColumn(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  if (!headers.includes('Assigned Team')) {
    const jsonIndex = headers.indexOf('Record JSON');
    const newColumn = jsonIndex >= 0 ? jsonIndex + 1 : lastColumn + 1;
    if (jsonIndex >= 0) sheet.insertColumnBefore(newColumn);
    else sheet.insertColumnAfter(lastColumn);
    const headerCell = sheet.getRange(1, newColumn);
    headerCell.setValue('Assigned Team').setFontWeight('bold').setBackground('#e8f2ee');
    sheet.setColumnWidth(newColumn, 140);
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value || '').trim());
  }
  const handlerIndex = headers.indexOf('Handled By (IT)');
  if (handlerIndex >= 0) sheet.getRange(1, handlerIndex + 1).setValue('Handled By');
  const teamIndex = headers.indexOf('Assigned Team');
  if (teamIndex >= 0) sheet.showColumns(teamIndex + 1);
  const jsonIndex = headers.indexOf('Record JSON');
  if (jsonIndex >= 0) sheet.hideColumns(jsonIndex + 1);
}

function requiredProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Run setupIncidentDesk in Apps Script before publishing the web app.');
  return value;
}

function validAdminKey(value) {
  const expected = PropertiesService.getScriptProperties().getProperty('INCIDENT_ADMIN_KEY');
  return Boolean(expected && String(value || '') === expected);
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function newTicketId() {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  return `TKT-${date}-${Utilities.getUuid().slice(0, 5).toUpperCase()}`;
}

function jsonp(callback, value) {
  const encoded = JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return ContentService.createTextOutput(`${callback}(${encoded});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function postMessagePage(value) {
  const encoded = JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>parent.postMessage(${encoded}, "*");</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
