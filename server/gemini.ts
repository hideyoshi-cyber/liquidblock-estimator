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
