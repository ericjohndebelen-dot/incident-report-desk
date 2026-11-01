# Incident Desk

A polished, free incident-report and ticket dashboard. The public form is a separate page at `report.html`; each submission creates a ticket that appears in `index.html` when shared storage is configured.

## Included features

- Separate shareable incident form and internal dashboard.
- Date, ID number, department (CCTV, HR, ADMIN, STUDIO, CARD), urgency (Low, Medium, High, Critical), and incident description.
- Optional incident times, location/table number, lost time, settlement/action, Game ID, IT ID, and up to three pasted or uploaded photos.
- Search and filters for incident type, status, and urgency.
- Ticket details, IT handler, notes, and statuses: New, Ongoing, In Progress, Resolved, and Closed.
- CSV export and JSON backup/import.
- No delete controls in the dashboard.
- Responsive English interface.

The incident type list adapts the sections in `Book1.xlsx`: Studio Incident, Card Room Incident, Training Room Incident, Office Incident, Maintenance Records, and CCTV Records.

## Free hosting

1. Create a public GitHub repository, such as `incident-desk`.
2. Upload the contents of this project folder to the repository root. Keep `Code.gs` in the repository; it contains the backend source but no account credentials.
3. In GitHub, open **Settings → Pages**.
4. Choose **Deploy from a branch**, select the `main` branch and `/(root)`, then save.
5. Once Pages publishes the site, the dashboard is at `https://YOUR-USERNAME.github.io/incident-desk/` and the separate public report form is at `https://YOUR-USERNAME.github.io/incident-desk/report.html`.

See GitHub's [Pages quickstart](https://docs.github.com/en/pages/quickstart).

## Connect the public form to the shared dashboard

The public form and dashboard can share reports from different devices through a free Google Sheet. Complete this setup once:

1. Sign in to the Google account that should own the incident data. Create a project at [Google Apps Script](https://script.google.com/).
2. Open `Code.gs` in this project, copy all of it into the Apps Script editor, and save.
3. Select `setupIncidentDesk` and click **Run**. Approve its Google Sheets and Drive access. This creates a private `Incident Desk Reports` spreadsheet and private photo folder. In the execution log, copy the `dashboardKey` and keep it private.
4. Click **Deploy → New deployment**. Choose **Web app**, set **Execute as** to your account, and set **Who has access** to **Anyone** so reporters do not need to sign in. Deploy and copy the web app URL ending in `/exec`.
5. Open `config.js` and paste that URL between the quotes for `apiUrl`, for example:

   ```js
   window.INCIDENT_DESK_CONFIG = {
     apiUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
   };
   ```

6. Commit the updated `config.js` to GitHub. Pages republishes the site.
7. Open the dashboard and click **Connect**. Paste the private `dashboardKey` from step 3. The dashboard loads shared reports and sends reports already stored in that browser to the sheet. It refreshes shared reports automatically about once a minute; use **Refresh reports** to update sooner.
8. Copy the public link with **Reporter link** and share it. Reports submitted there are saved centrally and show in the dashboard as new tickets.

Google's official guides explain [web app deployment](https://developers.google.com/apps-script/guides/web) and [Content Service](https://developers.google.com/apps-script/guides/content). The web app runs under its owner's Google account, so the owner must approve the setup and keep available Drive storage for incident photos.

### Keep the connection key private

The GitHub Pages site is public, but `config.js` contains only the web app URL. The dashboard key is entered into the dashboard and kept in that browser session; it is not written into the project. The key protects report and photo access. The Google Sheet and Drive folder are private by default. A team member who needs to view photos must have access to the private Drive folder.

## Local-only mode and data retention

If `config.js` has no web app URL, the site still works, but reports are stored only in that browser and do not sync to another device. The public page clearly labels this mode. Shared collection starts after the Apps Script setup above. The dashboard has no delete controls; keep a regular JSON backup. Clearing browser storage can remove local-only reports.

## Workbook fields

The report form uses the date, ID number, department, incident description, urgency, and optional incident details. Department choices follow the requested CCTV, HR, ADMIN, STUDIO, and CARD list. The separate incident-type field preserves the workbook categories, while urgency and ticket status are tracked independently.
