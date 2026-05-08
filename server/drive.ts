import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';

let driveClient: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set');

  const absolutePath = path.resolve(keyPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Service account key file not found at: ${absolutePath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: absolutePath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * プロジェクトごとのサブフォルダを作成し、フォルダIDを返す
 */
export async function createProjectFolder(
  projectId: string,
  companyName: string,
  projectName: string
): Promise<string> {
  const drive = getDriveClient();
  const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!parentFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');

  const folderName = `${projectId}_${companyName}_${projectName}`.replace(/[/\\?*:|"<>]/g, '_');

  // Check if folder already exists
  const existing = await drive.files.list({
    q: `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id!;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  console.log(`✅ Created Drive folder: ${folderName} (${folder.data.id})`);
  return folder.data.id!;
}

/**
 * Google Driveのフォルダにファイルをアップロードする
 */
export async function uploadFileToDrive(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();

  const readable = new Readable();
  readable.push(fileBuffer);
  readable.push(null);

  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: 'id, webViewLink',
  });

  // Make file viewable by anyone with the link
  await drive.permissions.create({
    fileId: file.data.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  console.log(`✅ Uploaded file: ${fileName} → ${file.data.webViewLink}`);
  return {
    fileId: file.data.id!,
    webViewLink: file.data.webViewLink || '',
  };
}
