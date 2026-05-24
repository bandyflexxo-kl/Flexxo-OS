// TODO: Phase 1C — Google Drive API integration
// This file is scaffolded but not yet implemented.
// Will handle: uploading supplier price files to Google Drive,
// storing Drive file IDs on SupplierPriceFile records.

export async function uploadFileToDrive(params: {
  fileName: string
  fileBuffer: Buffer
  mimeType: string
}): Promise<{ fileId: string; webViewLink: string }> {
  throw new Error('Google Drive integration not yet implemented (Phase 1C)')
}

export async function getFileFromDrive(fileId: string): Promise<Buffer> {
  throw new Error('Google Drive integration not yet implemented (Phase 1C)')
}
