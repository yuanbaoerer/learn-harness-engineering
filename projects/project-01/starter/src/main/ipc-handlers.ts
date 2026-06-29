import { dialog, IpcMain } from 'electron';
import { DocumentService } from '../services/document-service';
import { IndexingService } from '../services/indexing-service';
import { QaService } from '../services/qa-service';
import { AppStatus, Document, IPC_CHANNELS } from '../shared/types';

export interface Services {
  documentService: DocumentService;
  indexingService: IndexingService;
  qaService: QaService;
}

export function registerIpcHandlers(ipcMain: IpcMain, services: Services) {
  const { documentService, indexingService, qaService } = services;

  /** Build the cross-boundary AppStatus from indexing + document state. */
  const buildAppStatus = (): AppStatus => {
    const status = indexingService.getStatus();
    return {
      documentsLoaded: documentService.listDocuments().length,
      indexStatus: status.status,
      lastActivity: status.lastIndexed ?? '',
    };
  };

  // Document operations
  ipcMain.handle(IPC_CHANNELS.LIST_DOCUMENTS, async () => {
    return documentService.listDocuments();
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_DOCUMENT, async (_event, filePath: string) => {
    return documentService.importDocument(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GET_DOCUMENT, async (_event, id: string) => {
    return documentService.getDocument(id);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_DOCUMENT, async (_event, id: string) => {
    return documentService.deleteDocument(id);
  });

  ipcMain.handle(IPC_CHANNELS.PICK_IMPORT_DOCUMENT, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text & Markdown', extensions: ['txt', 'md'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const imported: Document[] = [];
    for (const filePath of result.filePaths) {
      try {
        imported.push(documentService.importDocument(filePath));
      } catch (err) {
        console.error(`Failed to import ${filePath}:`, err);
      }
    }

    if (imported.length > 0) {
      await indexingService.startIndexing();
      for (const doc of imported) {
        const chunks = indexingService.getChunksForDocument(doc.id);
        documentService.updateDocument(doc.id, { status: 'indexed', chunks: chunks.length });
      }
    }
    return imported;
  });

  // Indexing
  ipcMain.handle(IPC_CHANNELS.START_INDEXING, async (_event, documentId?: string) => {
    await indexingService.startIndexing(documentId);
    // Mark the affected document(s) as indexed so the UI reflects reality.
    const targets = documentId
      ? [documentId]
      : documentService.listDocuments().map(doc => doc.id);
    for (const id of targets) {
      const chunks = indexingService.getChunksForDocument(id);
      if (chunks.length > 0) {
        documentService.updateDocument(id, { status: 'indexed', chunks: chunks.length });
      }
    }
    return buildAppStatus();
  });

  ipcMain.handle(IPC_CHANNELS.GET_INDEXING_STATUS, async () => {
    return buildAppStatus();
  });

  ipcMain.handle(IPC_CHANNELS.GET_CHUNKS, async (_event, documentId: string) => {
    return indexingService.getChunksForDocument(documentId);
  });

  // Q&A
  ipcMain.handle(IPC_CHANNELS.ASK_QUESTION, async (_event, question: string) => {
    return qaService.ask(question);
  });

  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    return qaService.getHistory();
  });
}
