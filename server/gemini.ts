import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (genAI) return genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('GEMINI_API_KEY is not set in .env');
  }
  genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

export interface DirectionAnalysis {
  tone: string[];        // e.g. ["シネマティック", "クール"]
  style: string[];       // e.g. ["サイバーパンク", "3DCG"]
  colorPalette: string[];// e.g. ["ダーク", "ネオン"]
  summary: string;       // 自然言語による分析コメント
  suggestedApproach: string; // LiquidBlockとしての提案
}

export interface CompanyClassification {
  type: 'agency' | 'production' | 'cg_production' | 'end_client';
  confidence: number;    // 0.0 - 1.0
  reason: string;        // 判定理由（日本語）
  sub?: string;          // サブカテゴリ（例: "総合広告代理店", "VFXスタジオ"）
}

/**
 * アップロードされた画像をGemini APIで分析して方向性タグを返す
 */
export async function analyzeReference(
  imageBase64: string,
  mimeType: string,
  referenceUrls: string[] = []
): Promise<DirectionAnalysis> {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const urlContext = referenceUrls.length > 0
    ? `\n\nクライアントが参考として挙げたURLは以下です（分析のヒントにしてください）:\n${referenceUrls.join('\n')}`
    : '';

  const prompt = `あなたは映像制作会社「LiquidBlock」のクリエイティブディレクターです。
クライアントから送られてきたリファレンス画像を分析し、映像制作の方向性を判定してください。${urlContext}

以下のJSON形式で回答してください（日本語で）：

{
  "tone": ["トーンを1〜3個", "例: シネマティック, ポップ, エモーショナル, クール, ミニマル, ダイナミック, レトロ"],
  "style": ["スタイルを1〜3個", "例: サイバーパンク, フラットデザイン, 3DCG, 実写ベース, アニメ調, モーショングラフィックス, ハイファッション"],
  "colorPalette": ["カラーパレットを1〜3個", "例: ダーク, ビビッド, パステル, モノトーン, ネオン, アースカラー, メタリック"],
  "summary": "この画像から読み取れる映像の世界観やテイストを2〜3文で説明",
  "suggestedApproach": "LiquidBlockとしてこの方向性で制作する場合の技術的な提案を1〜2文で"
}

JSONのみで回答し、それ以外のテキストは含めないでください。`;

  const parts: any[] = [{ text: prompt }];

  // Add image if available
  if (imageBase64 && mimeType) {
    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
        data: base64Data,
      },
    });
  }

  try {
    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const analysis: DirectionAnalysis = JSON.parse(jsonMatch[0]);
    console.log('✅ Gemini analysis complete:', analysis.summary);
    return analysis;
  } catch (error) {
    console.error('Gemini analysis error:', error);
    return {
      tone: ['未分析'],
      style: ['未分析'],
      colorPalette: ['未分析'],
      summary: 'リファレンスの分析中にエラーが発生しました。',
      suggestedApproach: '',
    };
  }
}

/**
 * 会社名からGemini AIで業種を判定する
 */
export async function classifyCompany(companyName: string): Promise<CompanyClassification> {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `あなたは日本の企業データベースの専門家です。以下の会社名の業種を判定してください。

会社名: 「${companyName}」

以下の4つのカテゴリから最も適切なものを1つ選んでください：
- "agency" = 広告代理店、広告会社、デザイン会社、PR会社、マーケティング会社、メディアレップ、SP会社
- "production" = 映像制作会社、映像プロダクション、テレビ制作会社、CM制作会社、ポストプロダクション
- "cg_production" = CG制作会社、VFXスタジオ、ゲーム開発会社、アニメーション制作会社、3DCG専門会社
- "end_client" = 上記以外の一般企業（メーカー、商社、金融、IT、小売、サービス業、官公庁、教育機関など）

判定基準：
- 会社名に「広告」「アド」「エージェンシー」「プランニング」「コミュニケーション」等が含まれる → agency の可能性が高い
- 会社名に「映像」「プロダクション」「フィルム」「ムービー」「スタジオ」「ピクチャーズ」等が含まれる → production の可能性が高い
- 会社名に「CG」「VFX」「デジタルアーツ」「グラフィックス」「ゲーム」「アニメ」等が含まれる → cg_production の可能性が高い
- 有名企業の場合はその知識に基づいて判定してください
- 判断が難しい場合は "end_client" にしてください

以下のJSON形式のみで回答してください：
{
  "type": "agency|production|cg_production|end_client",
  "confidence": 0.0〜1.0の数値（確信度）,
  "reason": "判定理由を1文で",
  "sub": "サブカテゴリ（例: 総合広告代理店, VFXスタジオ, 自動車メーカー 等）"
}`;

  try {
    const result = await model.generateContent([{ text: prompt }]);
    const responseText = result.response.text();

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const classification: CompanyClassification = JSON.parse(jsonMatch[0]);

    // Validate type
    const validTypes = ['agency', 'production', 'cg_production', 'end_client'];
    if (!validTypes.includes(classification.type)) {
      classification.type = 'end_client';
    }

    // Clamp confidence
    classification.confidence = Math.max(0, Math.min(1, classification.confidence));

    console.log(`✅ Company classified: "${companyName}" → ${classification.type} (${Math.round(classification.confidence * 100)}%): ${classification.reason}`);
    return classification;
  } catch (error) {
    console.error('Company classification error:', error);
    return {
      type: 'end_client',
      confidence: 0,
      reason: '分類中にエラーが発生しました',
      sub: '不明',
    };
  }
}

