import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { createProjectFolder, uploadFileToDrive } from './drive.js';
import { analyzeReference, DirectionAnalysis, classifyCompany, CompanyClassification } from './gemini.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// --- Health Check ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Phase B: Google Drive ---

/**
 * POST /api/drive/create-folder
 * プロジェクトごとのサブフォルダを作成する
 */
app.post('/api/drive/create-folder', async (req, res) => {
  try {
    const { projectId, companyName, projectName } = req.body;
    if (!projectId || !companyName) {
      return res.status(400).json({ error: 'projectId and companyName are required' });
    }
    const folderId = await createProjectFolder(projectId, companyName, projectName || '');
    res.json({ folderId });
  } catch (error: any) {
    console.error('Drive folder creation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/drive/upload
 * ファイルをGoogle Driveにアップロードする
 */
app.post('/api/drive/upload', upload.single('file'), async (req, res) => {
  try {
    const { folderId } = req.body;
    const file = req.file;
    if (!folderId || !file) {
      return res.status(400).json({ error: 'folderId and file are required' });
    }
    const result = await uploadFileToDrive(
      folderId,
      file.originalname,
      file.mimetype,
      file.buffer
    );
    res.json(result);
  } catch (error: any) {
    console.error('Drive upload error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/drive/upload-base64
 * Base64エンコードされたファイルをGoogle Driveにアップロードする（フロントから直接呼ぶ用）
 */
app.post('/api/drive/upload-base64', async (req, res) => {
  try {
    const { folderId, fileName, mimeType, dataUrl } = req.body;
    if (!folderId || !fileName || !dataUrl) {
      return res.status(400).json({ error: 'folderId, fileName, and dataUrl are required' });
    }
    const base64Data = dataUrl.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const result = await uploadFileToDrive(folderId, fileName, mimeType || 'application/octet-stream', buffer);
    res.json(result);
  } catch (error: any) {
    console.error('Drive upload-base64 error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Phase C: Gemini AI Analysis ---

/**
 * POST /api/analyze
 * リファレンス画像をGemini AIで分析する
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64, mimeType, referenceUrls } = req.body;
    if (!imageBase64 && (!referenceUrls || referenceUrls.length === 0)) {
      return res.status(400).json({ error: 'imageBase64 or referenceUrls are required' });
    }
    const analysis: DirectionAnalysis = await analyzeReference(
      imageBase64 || '',
      mimeType || 'image/jpeg',
      referenceUrls || []
    );
    res.json(analysis);
  } catch (error: any) {
    console.error('Gemini analysis error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Phase D: Company Classification ---

/**
 * POST /api/classify-company
 * 会社名からGemini AIで業種を自動判定する
 */
app.post('/api/classify-company', async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName || companyName.trim().length < 2) {
      return res.status(400).json({ error: 'companyName is required (min 2 chars)' });
    }
    const classification: CompanyClassification = await classifyCompany(companyName.trim());
    res.json(classification);
  } catch (error: any) {
    console.error('Company classification error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  🚀 LiquidBlock Backend Server             ║');
  console.log(`║  📡 Running on http://localhost:${PORT}       ║`);
  console.log('║  📁 Google Drive: Ready                     ║');
  console.log('║  🤖 Gemini AI: Ready                        ║');
  console.log('║  🏢 Company Classifier: Ready               ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
});


