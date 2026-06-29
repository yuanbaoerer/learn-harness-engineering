import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { DocumentService } from '../services/document-service';
import { QaService } from '../services/qa-service';
import { IndexingService } from '../services/indexing-service';
import { PersistenceService } from '../services/persistence-service';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports the shared IPC channel constants (single source of
      // truth in src/shared/types.ts). Loading a relative module from the
      // preload requires the Node module resolver, so the Chromium preload
      // sandbox must be disabled. contextIsolation + nodeIntegration:false +
      // a curated contextBridge API still keep the renderer isolated from Node.
      sandbox: false,
    },
    title: 'Knowledge Base',
  });

  // In development, load from Vite dev server or built renderer
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeServices() {
  const dataDir = path.join(app.getPath('userData'), 'knowledge-base-data');
  const persistence = new PersistenceService(dataDir);
  const documentService = new DocumentService(persistence);
  const indexingService = new IndexingService(persistence);
  const qaService = new QaService(persistence);

  registerIpcHandlers(ipcMain, {
    documentService,
    indexingService,
    qaService,
  });

  // Seed the bundled sample documents on first run so the app can show
  // documents and answer questions out of the box.
  await seedSampleDocuments(documentService, indexingService);
}

/** Import and index the bundled sample documents if the library is empty. */
async function seedSampleDocuments(
  documentService: DocumentService,
  indexingService: IndexingService
) {
  if (documentService.listDocuments().length > 0) return;

  const sampleDir = path.join(app.getAppPath(), 'data', 'sample-documents');
  if (!fs.existsSync(sampleDir)) return;

  const files = fs.readdirSync(sampleDir).sort();
  for (const filename of files) {
    const filePath = path.join(sampleDir, filename);
    if (fs.statSync(filePath).isFile()) {
      try {
        documentService.importDocument(filePath);
      } catch (err) {
        console.error(`Failed to seed ${filename}:`, err);
      }
    }
  }

  await indexingService.startIndexing();
  for (const doc of documentService.listDocuments()) {
    const chunks = indexingService.getChunksForDocument(doc.id);
    documentService.updateDocument(doc.id, { status: 'indexed', chunks: chunks.length });
  }
}

app.whenReady().then(async () => {
  await initializeServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
