// EmailJS Configuration & Utility
// EmailJS: https://www.emailjs.com/
// バックエンド不要でクライアントサイドからメール送信が可能
import emailjs from '@emailjs/browser';

// EmailJS設定
// ※ アカウント作成後、以下の値を設定してください
// 1. https://www.emailjs.com/ でアカウント作成
// 2. Email Service を追加（Gmail等）
// 3. Email Template を作成
// 4. 以下の値を設定

const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';  // Account → API Keys → Public Key
const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';  // Email Services → Service ID
const EMAILJS_TEMPLATE_CLIENT = 'YOUR_TEMPLATE_CLIENT';  // クライアント向けテンプレート
const EMAILJS_TEMPLATE_ADMIN = 'YOUR_TEMPLATE_ADMIN';    // 管理者（LiquidBlock）向けテンプレート

// EmailJS初期化
let initialized = false;
function initEmailJS() {
  if (initialized || EMAILJS_PUBLIC_KEY === 'YOUR_PUBLIC_KEY') return;
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  initialized = true;
}

export interface EstimateEmailData {
  projectId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  projectName: string;
  totalAmount: number;
  totalAmountWithTax: number;
  itemSummary: string;    // 見積項目のサマリーテキスト
  driveFolderUrl?: string;
  estimateUrl?: string;   // 見積もり確認ページURL
}

/**
 * 見積依頼メールを送信する（クライアント + LiquidBlock宛）
 * @returns true if at least one email was sent successfully
 */
export async function sendEstimateNotification(data: EstimateEmailData): Promise<{
  success: boolean;
  clientSent: boolean;
  adminSent: boolean;
  error?: string;
}> {
  initEmailJS();

  // EmailJSが設定されていない場合
  if (EMAILJS_PUBLIC_KEY === 'YOUR_PUBLIC_KEY') {
    console.warn('📧 EmailJS is not configured. Skipping email notifications.');
    return { success: false, clientSent: false, adminSent: false, error: 'EmailJS未設定' };
  }

  const templateParams = {
    to_email: data.email,
    to_name: data.contactName,
    company_name: data.companyName,
    project_name: data.projectName || '新規案件',
    project_id: data.projectId,
    total_amount: `¥${data.totalAmount.toLocaleString()}`,
    total_amount_with_tax: `¥${data.totalAmountWithTax.toLocaleString()}`,
    item_summary: data.itemSummary,
    drive_folder_url: data.driveFolderUrl || '未設定',
    estimate_url: data.estimateUrl || '',
    phone: data.phone || '未記入',
    date: new Date().toLocaleDateString('ja-JP'),
  };

  let clientSent = false;
  let adminSent = false;

  // 1. クライアント宛メール
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_CLIENT, templateParams);
    clientSent = true;
    console.log('✅ Client email sent to:', data.email);
  } catch (error) {
    console.error('❌ Client email failed:', error);
  }

  // 2. LiquidBlock管理者宛メール（info@liquid-block.com）
  try {
    const adminParams = {
      ...templateParams,
      to_email: 'info@liquid-block.com',
      to_name: 'LiquidBlock',
    };
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ADMIN, adminParams);
    adminSent = true;
    console.log('✅ Admin email sent to: info@liquid-block.com');
  } catch (error) {
    console.error('❌ Admin email failed:', error);
  }

  return {
    success: clientSent || adminSent,
    clientSent,
    adminSent,
    error: (!clientSent && !adminSent) ? 'メール送信に失敗しました' : undefined,
  };
}

/**
 * EmailJSが設定済みかどうかを返す
 */
export function isEmailConfigured(): boolean {
  return EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY';
}
