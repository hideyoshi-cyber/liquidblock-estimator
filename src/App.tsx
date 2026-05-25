import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Video, Wand2, Camera, Timer, Layers, Sparkles, Crown, 
  ArrowLeft, ArrowRight, CheckCircle, CheckCircle2, Download, FileText,
  Monitor, Smartphone, Maximize, Mic, Users, Building, TreePine, CalendarDays, Clock,
  Music, Briefcase, Film, UserCircle, ShieldAlert, FileQuestion, FileCheck, Zap, Box, Palette,
  Globe, Headphones, UserPlus, Star, Mail, Phone, User, FileSignature, Box as BoxIcon, FileBadge2,
  Plus, LayoutDashboard, ChevronRight, Save, Trash2, Send, FolderKanban, FileSpreadsheet,
  Link, Paperclip, Image, X, GripVertical, MapPin
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { searchCompany, addCustomCompany, removeCustomCompany, getCustomCompanies, companyDatabase, classifyCompanyViaAPI } from './companyDatabase';
import type { CompanyEntry, AIClassificationResult } from './companyDatabase';
import { sendEstimateNotification, isEmailConfigured } from './emailService';

// Backend API base URL
const API_BASE = 'http://localhost:3001';

// --- Japanese Business Day Calculator ---
const getJapaneseHolidays = (year: number): Set<string> => {
  const holidays = new Set<string>();
  const fmt = (m: number, d: number) => `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  // Fixed holidays
  holidays.add(fmt(1,1));   // 元日
  holidays.add(fmt(2,11));  // 建国記念の日
  holidays.add(fmt(2,23));  // 天皇誕生日
  holidays.add(fmt(4,29));  // 昭和の日
  holidays.add(fmt(5,3));   // 憲法記念日
  holidays.add(fmt(5,4));   // みどりの日
  holidays.add(fmt(5,5));   // こどもの日
  holidays.add(fmt(8,11));  // 山の日
  holidays.add(fmt(11,3));  // 文化の日
  holidays.add(fmt(11,23)); // 勤労感謝の日
  // Happy Monday holidays
  const nthMonday = (m: number, n: number) => {
    const first = new Date(year, m - 1, 1);
    const dayOfWeek = first.getDay();
    const firstMon = dayOfWeek <= 1 ? 1 + (1 - dayOfWeek) : 1 + (8 - dayOfWeek);
    return firstMon + (n - 1) * 7;
  };
  holidays.add(fmt(1, nthMonday(1, 2)));  // 成人の日
  holidays.add(fmt(7, nthMonday(7, 3)));  // 海の日
  holidays.add(fmt(9, nthMonday(9, 3)));  // 敬老の日
  holidays.add(fmt(10, nthMonday(10, 2))); // スポーツの日
  // Equinox (approximate formula)
  const vernalEquinox = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnalEquinox = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays.add(fmt(3, vernalEquinox));   // 春分の日
  holidays.add(fmt(9, autumnalEquinox)); // 秋分の日
  // Substitute holidays (振替休日): if a holiday falls on Sunday, next Monday is a holiday
  const allDates = Array.from(holidays);
  for (const dateStr of allDates) {
    const d = new Date(dateStr + 'T00:00:00');
    if (d.getDay() === 0) { // Sunday
      const sub = new Date(d); sub.setDate(sub.getDate() + 1);
      holidays.add(sub.toISOString().slice(0, 10));
    }
  }
  // Kokumin no Kyujitsu (国民の休日): day between two holidays
  for (const dateStr of Array.from(holidays)) {
    const d = new Date(dateStr + 'T00:00:00');
    const prev = new Date(d); prev.setDate(prev.getDate() - 2);
    const prevStr = prev.toISOString().slice(0, 10);
    if (holidays.has(prevStr)) {
      const between = new Date(d); between.setDate(between.getDate() - 1);
      if (between.getDay() !== 0 && between.getDay() !== 6) {
        holidays.add(between.toISOString().slice(0, 10));
      }
    }
  }
  return holidays;
};

const countBusinessDays = (startStr: string, endStr: string): number => {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (end <= start) return 0;
  // Collect holidays for all years in range
  const holidays = new Set<string>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    getJapaneseHolidays(y).forEach(h => holidays.add(h));
  }
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    const day = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidays.has(dateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
};

// --- Types ---
type Option = { id: string; label: string; icon: React.ElementType; desc: string; };
type Question = { id: string; title: string; options: Option[]; condition?: (answers: Record<string, string>) => boolean; };
type CustomerInfo = { projectName: string; companyName: string; contactName: string; email: string; phone: string; address: string; };
type DocumentType = 'estimate' | 'order' | 'delivery' | 'invoice';
type ProjectStatus = 'draft' | 'estimate' | 'ordered' | 'production' | 'delivered' | 'invoiced' | 'paid';
type PhaseType = 'Planning' | 'Pre-Production' | 'Shooting' | 'Cast' | 'CG' | 'Post-Production' | 'Audio' | 'Express' | 'Overhead' | 'Discount';

export type LineItem = {
  id?: string; // For custom items
  phase: PhaseType;
  name: string;
  persons?: number;
  days?: number;
  unit: string;
  unitPrice: number;
  amount: number;
  isEstimateOnly?: boolean;
  isCustom?: boolean;
};

type OrientationFile = {
  name: string;
  type: string;
  dataUrl: string; // base64 encoded
  driveLink?: string; // Google Drive link after upload
};

type DirectionAnalysis = {
  tone: string[];
  style: string[];
  colorPalette: string[];
  summary: string;
  suggestedApproach: string;
};

type Project = {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerInfo: CustomerInfo;
  answers: Record<string, string>;
  customItems: LineItem[];
  referenceUrls: string[];
  orientationFiles: OrientationFile[];
  driveFolderId?: string;
  driveFolderUrl?: string;
  aiAnalysis?: DirectionAnalysis;
  removedAutoItems?: string[];
  itemOverrides?: Record<string, { unitPrice?: number; persons?: number; days?: number; unit?: string }>;
  dates?: {
    issueDate?: string;
    estimateExpiry?: string;
    deliveryDate?: string;
    invoiceDate?: string;
    paymentDue?: string;
  };
  itemOrder?: string[];
  projectNotes?: string;
  suppliedData?: string[];
  approval?: {
    approved: boolean;
    approvedAt: string;
    approvedBy: string;
    approverTitle?: string;
  };
  totalAmount: number;
  status: ProjectStatus;
  currentDocType: DocumentType;
};

// --- Portfolio Preview Images (from project DETAIL PAGES on liquid-block.com/courses) ---
// Each image URL was extracted by navigating INTO the project page, NOT from thumbnails
const portfolioPreviewImages: Record<string, { src: string; title: string }[]> = {
  motion: [
    { src: 'https://static.wixstatic.com/media/6b5e14_0f274c5a1695492fbb3227bcbf7a2e37~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'Technics Space Tune 説明動画' },
    { src: 'https://static.wixstatic.com/media/6b5e14_ceeb0cc1eb0d4a74973b89d244aa4a32~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'AOSBOX クラウドバックアップ' },
    { src: 'https://static.wixstatic.com/media/6b5e14_286ce8c5384e4c19be1858fa0989febe~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'アイオイシステム サービス説明' },
  ],
  vfx: [
    { src: 'https://static.wixstatic.com/media/f22f3c_40a3ff535d3240a1902cdaae50ad5271~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'アメトーーク!! トップガン芸人' },
    { src: 'https://static.wixstatic.com/media/f22f3c_1cc434d59fe14a9ca81cc366f0ff38ac~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'ロンドンハーツ トップガン' },
    { src: 'https://static.wixstatic.com/media/f7515e_9d5122ef04ab4030bd7c364b2a57874c~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'ナショジオ WILD NATURE' },
  ],
  full_cg: [
    { src: 'https://static.wixstatic.com/media/f22f3c_7af85b951d504e31bddc56ffcdecd2b1~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'ISHIDA CCW マルチヘッド計量機' },
    { src: 'https://static.wixstatic.com/media/f22f3c_fe4d38f0b2534618ab981b8765d833ab~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'ISHIDA CCW 3DCGアニメーション' },
    { src: 'https://static.wixstatic.com/media/f22f3c_69a772c6c0af43e9951d3ca2b392a65e~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'NEC陸自ユニファイドネットワーク' },
  ],
  opening: [
    { src: 'https://static.wixstatic.com/media/6b5e14_6a4eb2ad9d434307953a782e99923e53~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'AngelJapan SNS動画' },
    { src: 'https://static.wixstatic.com/media/f22f3c_85e5ce4e6c71445a8f21e7ca64aa2d0c~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'ISHIDA 製品カット' },
    { src: 'https://static.wixstatic.com/media/6b5e14_80f0986b8fd74942b49f97946164c74f~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'ベネッセICTサポート' },
  ],
  ending: [
    { src: 'https://static.wixstatic.com/media/6b5e14_dd018c12c5144989afe379b5da41ed86~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: '太陽工業 ONE TAIYO EXPO' },
    { src: 'https://static.wixstatic.com/media/6b5e14_f23cb98f650d4c05b20bf541707547e1~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'パチンコモナコ シネアド' },
    { src: 'https://static.wixstatic.com/media/f22f3c_80a2192c0a674a77a949844736a6f165~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'IG工業 OP・ED' },
  ],
  promo: [
    { src: 'https://static.wixstatic.com/media/6b5e14_c07ba6a1b2324beb9aae96ca26229814~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'Panasonic CX350 プロモ' },
    { src: 'https://static.wixstatic.com/media/6b5e14_a8703fe7088e4af984c8ad16014d098c~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: '外車王 WEBCM' },
    { src: 'https://static.wixstatic.com/media/6b5e14_63745ab06ddd415eaec7369785243f6e~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: '大和工業 CM「LIFE」篇' },
  ],
  branding: [
    { src: 'https://static.wixstatic.com/media/dfcf31_7eea0517cf364669a3fe18ce8d8e48b2~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'SENKOグループ 企業紹介' },
    { src: 'https://static.wixstatic.com/media/f22f3c_21d75397a9c7432fa9795de6ea419105~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'ISHIDA マルチヘッド計量機' },
    { src: 'https://static.wixstatic.com/media/f7515e_2641416c3abd4113bcf7533ee6147ae5~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: '両備グループ ブランディング' },
  ],
  explainer: [
    { src: 'https://static.wixstatic.com/media/699022_b717b937a07440658c9c083e509d9998~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'AGC ライフサイエンス事業紹介' },
    { src: 'https://static.wixstatic.com/media/9afd04_354ed727b70f487c84762cff6d4196dd~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'Emocri Web広告' },
    { src: 'https://static.wixstatic.com/media/6b5e14_787c8b3a435048759e8ba46cad9368ed~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'WaterStand 製品3D解説' },
  ],
  music_video: [
    { src: 'https://static.wixstatic.com/media/6b5e14_09123459b31e41ab86fb3871de6e2ccf~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'T-BOLAN「Re:I」' },
    { src: 'https://static.wixstatic.com/media/6b5e14_b02ee00035834efb9764fa833d63da3b~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'T-BOLAN MV スチル' },
    { src: 'https://static.wixstatic.com/media/6b5e14_59b9f63982844a9199b5cca3e63e691f~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'T-BOLAN「Re:I」シーン' },
  ],
  other_video: [
    { src: 'https://static.wixstatic.com/media/dfcf31_f8e95ec062424199956ab677c4477a25~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: 'DUNLOP 透過LED展示映像' },
    { src: 'https://static.wixstatic.com/media/f7515e_4f060077139549bca3a590fad67ddee4~mv2.png/v1/fill/w_480,h_270,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png', title: '高台寺 夜間特別拝観' },
    { src: 'https://static.wixstatic.com/media/6b5e14_1b25fa35e5ca4e9a9397217115259276~mv2.jpg/v1/fill/w_480,h_270,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg', title: 'LEDイルミネーション演出' },
  ],
};

// --- Industry Background Images (for STEP 01 card overlays) ---
const industryBackgroundImages: Record<string, string> = {
  end_client: '/images/industry_general.png',
  agency: '/images/industry_agency.png',
  production: '/images/industry_production.png',
  cg_production: '/images/industry_cg.png',
};

// --- CG Type Background Images (for STEP 03 card overlays) ---
// Uses portfolio images from detail pages to represent each CG level
const cgTypeBackgroundImages: Record<string, string> = {
  '2d_motion': 'https://static.wixstatic.com/media/6b5e14_5fac531652534bc2be1fa9382be4d970~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  '3d_product': 'https://static.wixstatic.com/media/6b5e14_c07ba6a1b2324beb9aae96ca26229814~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'full_3d_vfx': 'https://static.wixstatic.com/media/6b5e14_f23cb98f650d4c05b20bf541707547e1~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'partial': 'https://static.wixstatic.com/media/6b5e14_b1681eedc6d84dc997f9b595c5077df7~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
};

// --- CG Needed Background Images (for cg_needed question overlays) ---
const cgNeededBackgroundImages: Record<string, string> = {
  'yes_cg': '/images/cg_yes.png',
  'no_cg': '/images/cg_no.png',
};

// --- Media Type Background Images (for media question overlays) ---
const mediaBackgroundImages: Record<string, string> = {
  'web_tv': 'https://static.wixstatic.com/media/f22f3c_b3a79ea39eda40208ff989b88df7741d~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'signage': 'https://static.wixstatic.com/media/6b5e14_ab99e15b4be640ea9609a5e37c833ce9~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'led': 'https://static.wixstatic.com/media/f22f3c_941f941675d3487489b576f3fe9dbfca~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'mapping': 'https://static.wixstatic.com/media/f7515e_4f060077139549bca3a590fad67ddee4~mv2.png/v1/fill/w_600,h_400,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png',
  'event': 'https://static.wixstatic.com/media/f22f3c_88580554c5f04e7391ce245c8a22d69f~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.jpg',
  'other_media': 'https://static.wixstatic.com/media/f7515e_305d69e7f00c4501a4691612b91291da~mv2.png/v1/fill/w_600,h_400,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Image-place-holder.png',
};

// --- CG Deadline Explanations (for STEP 04 popup) ---
const deadlineExplanations: Record<string, { title: string; details: string[] }> = {
  'express_cg': {
    title: '特急納期について',
    details: [
      '通常よりも短い期間での納品となります。',
      '複数のCGアーティストを同時にアサインし、並行作業で対応します。',
      '特急料金として通常価格の1.3〜1.5倍が適用されます。',
      '10日〜1ヶ月半が目安ですが、内容の複雑さにより変動します。',
      '※ 修正回数が限られる場合がございます。',
    ],
  },
  'normal_cg': {
    title: '通常納期について',
    details: [
      '最も推奨される制作スケジュールです。',
      'モデリング → テクスチャ → アニメーション → ライティング → レンダリング → コンポジットの工程を順番に進めます。',
      '各工程でのチェック・修正を2回ずつ含みます。',
      '1ヶ月半〜2ヶ月が標準的な制作期間です。',
      '品質とコストのバランスが最適です。',
    ],
  },
  'relaxed_cg': {
    title: '余裕ある納期について',
    details: [
      '少人数のチームでじっくりと制作するプランです。',
      'アーティスト1〜2名体制のため、人件費を抑えられます。',
      '通常価格の0.8〜0.9倍のコスト抑制が期待できます。',
      '制作期間は2ヶ月以上を想定しています。',
      'テスト・修正にも十分な時間を確保できるため、クオリティを高められます。',
    ],
  },
};

// --- 24-step Production Process (for agreement modal) ---
const productionProcessSteps = [
  { phase: 'プリプロダクション', steps: [
    { num: 1, name: 'ヒアリング・要件定義', desc: 'ご要望・目的・ターゲットなどを詳しくお伺いします' },
    { num: 2, name: '企画・コンセプト策定', desc: '映像の方向性・コンセプトを策定します' },
    { num: 3, name: '構成・台本作成', desc: '映像全体の構成と台本を作成します' },
    { num: 4, name: '絵コンテ・Vコンテ制作', desc: 'カット割りや動きを視覚的に確認します' },
    { num: 5, name: 'スケジュール策定', desc: '制作全体のスケジュールを確定します' },
    { num: 6, name: 'ロケハン・撮影準備', desc: '撮影場所の選定と機材・スタッフ手配を行います' },
    { num: 7, name: 'キャスティング', desc: '出演者の選定・ブッキングを行います' },
    { num: 8, name: '美術・スタイリング準備', desc: 'セットデザイン・衣装・小道具を準備します' },
  ]},
  { phase: 'プロダクション', steps: [
    { num: 9, name: '本撮影', desc: '台本・コンテに基づいた撮影を実施します' },
    { num: 10, name: '素材整理・データ管理', desc: '撮影素材の管理・選定を行います' },
  ]},
  { phase: 'ポストプロダクション', steps: [
    { num: 11, name: 'オフライン編集（仮編集）', desc: '素材を並べ、全体の流れを構成します' },
    { num: 12, name: 'CG・モーショングラフィックス制作', desc: '2D/3DCG、モーションの制作を行います' },
    { num: 13, name: '3Dモデリング・テクスチャ', desc: '3Dモデルの造形と質感設定を行います' },
    { num: 14, name: 'アニメーション', desc: 'CG・キャラクターの動きをつけます' },
    { num: 15, name: 'ライティング・レンダリング', desc: '照明設計と最終画像の出力を行います' },
    { num: 16, name: 'コンポジット・VFX合成', desc: '実写とCGの合成、エフェクト処理を行います' },
    { num: 17, name: 'カラーグレーディング', desc: '色調を統一し映像の雰囲気を仕上げます' },
    { num: 18, name: 'テロップ・字幕挿入', desc: 'テキストや図表を映像に反映します' },
    { num: 19, name: 'BGM・SE選曲・制作', desc: '楽曲・効果音の選定または制作を行います' },
    { num: 20, name: 'ナレーション収録', desc: 'ナレーターの手配と音声収録を行います' },
    { num: 21, name: 'MA（マルチオーディオ）整音', desc: '音声・BGM・SEのバランスを最終調整します' },
    { num: 22, name: 'プレビュー・修正対応', desc: 'お客様へプレビューし、修正を反映します' },
  ]},
  { phase: '納品・アフターサポート', steps: [
    { num: 23, name: '最終納品（各種フォーマット）', desc: '指定フォーマットでの最終データ納品を行います' },
    { num: 24, name: 'アフターサポート', desc: '納品後の微調整や追加対応をサポートします' },
  ]},
];

// --- Contract Terms (for agreement before submission) ---
const contractTerms = [
  { title: 'お支払い条件', content: '制作費用は、着手金（50%）と納品時残金（50%）の2回払いを原則といたします。お支払いは請求書発行後30日以内にお願いいたします。' },
  { title: '著作権について', content: '納品物の著作権は、制作費全額のお支払い完了後にお客様へ譲渡いたします。ただし、弊社ポートフォリオへの掲載権は保持させていただきます。' },
  { title: '修正回数', content: 'お見積りに含まれる修正回数は各チェック工程につき2回までとなります。それ以上の修正が発生した場合は、追加費用をご相談させていただきます。' },
  { title: 'キャンセルポリシー', content: '制作着手後のキャンセルにつきましては、進行度に応じた制作費をご請求させていただきます。着手前のキャンセルは無料です。' },
  { title: '納品物の利用範囲', content: 'お見積り時にご指定いただいた媒体・期間での利用を想定しております。利用範囲の変更・追加がある場合は別途ご相談ください。' },
  { title: '秘密保持', content: '制作過程でお預かりする情報は、厳重に管理し第三者に開示いたしません。NDAの締結にも対応いたします。' },
  { title: 'データバックアップ', content: '納品後のプロジェクトデータは、通常1年間バックアップを保持いたします。5年間の長期バックアップをご希望の場合は、専用HDDへの個別バックアップ（¥20,000）にて対応いたします。' },
];

// --- Mock Data ---
const questions: Question[] = [
  { id: 'client_type', title: '貴社の業種（発注元）をお聞かせください', condition: (ans) => !ans['client_type'], options: [
      { id: 'end_client', label: '一般企業 (直取引)', icon: UserCircle, desc: '自社のサービス・製品のための映像制作' },
      { id: 'agency', label: '広告代理店', icon: Briefcase, desc: 'クライアントワークの企画・プロデュース' },
      { id: 'production', label: '映像制作会社', icon: Film, desc: '同業者様からのCG・VFX等の外注依頼' },
      { id: 'cg_production', label: 'CG制作会社', icon: Box, desc: 'CG・VFX専門会社様からの協業・外注依頼' },
  ]},
  { id: 'category', title: 'どのような映像を制作しますか？', options: [
      { id: 'motion', label: 'モーショングラフィックス', icon: Video, desc: 'テキストやイラストを動かす表現' },
      { id: 'vfx', label: 'VFX / CG合成', icon: Wand2, desc: '実写への合成、フル3D CGI' },
      { id: 'full_cg', label: 'フルCG映像', icon: Box, desc: '実写なし。全編3DCG/2Dアニメーションで構成' },
      { id: 'opening', label: 'オープニング制作', icon: Sparkles, desc: '番組・イベント・作品のオープニング映像' },
      { id: 'ending', label: 'エンディング制作', icon: Star, desc: '番組・イベント・作品のエンディング映像' },
      { id: 'promo', label: 'ビデオプロモーション', icon: Camera, desc: '実写撮影メインの映像' },
      { id: 'branding', label: 'ブランディング動画', icon: Crown, desc: '企業・商品のブランドイメージを訴求する映像' },
      { id: 'explainer', label: '説明系動画', icon: FileText, desc: 'サービス紹介・チュートリアル・マニュアル等' },
      { id: 'music_video', label: 'ミュージックビデオ (MV)', icon: Music, desc: '楽曲の世界観を表現する映像作品' },
      { id: 'other_video', label: 'その他映像', icon: Film, desc: 'イベント映像・ドキュメンタリー・ウェビナー等' },
  ]},
  { id: 'cg_needed', title: 'CG・アニメーション制作は必要ですか？', condition: (ans) => ['promo', 'music_video', 'branding', 'explainer', 'other_video'].includes(ans['category']), options: [
      { id: 'yes_cg', label: 'はい（CG・アニメーションあり）', icon: Sparkles, desc: '実写にCG合成やモーショングラフィックスを追加' },
      { id: 'no_cg', label: 'いいえ（実写・編集のみ）', icon: Film, desc: '撮影素材の編集のみで完結' },
  ]},
  { id: 'cg_type', title: 'CG・アニメーションの表現レベルは？', condition: (ans) => {
    if (ans['category'] === 'motion' || ans['category'] === 'vfx' || ans['category'] === 'full_cg' || ans['category'] === 'opening' || ans['category'] === 'ending') return true;
    if (ans['cg_needed'] === 'yes_cg') return true;
    if (ans['media'] === 'mapping') return true;
    return false;
  }, options: [
      { id: '2d_motion', label: '2D モーショングラフィックス', icon: Palette, desc: 'インフォグラフィック・UIアニメーション等' },
      { id: '3d_product', label: '3D モデリング＆アニメーション', icon: Box, desc: '製品の3D化、建築パース等の立体表現' },
      { id: 'full_3d_vfx', label: 'ハイエンド 3D / VFX合成', icon: Sparkles, desc: 'キャラクターアニメ・実写への高度なCG合成' },
      { id: 'ai_animation', label: 'AIアニメーション制作', icon: Wand2, desc: 'AI生成でキャラクター・背景・アニメーションを制作' },
      { id: 'partial', label: '部分発注（必要な工程のみ）', icon: Layers, desc: '特定の工程のみを個別に発注したい' },
  ]},
  { id: 'cg_deadline', title: 'CG制作の希望納期は？', condition: (ans) => {
    if (ans['category'] === 'motion' || ans['category'] === 'vfx' || ans['category'] === 'full_cg' || ans['category'] === 'opening' || ans['category'] === 'ending') return true;
    if (ans['cg_needed'] === 'yes_cg') return true;
    if (ans['media'] === 'mapping') return true;
    return false;
  }, options: [
      { id: 'express_cg', label: '特急（10日〜1ヶ月半以内）', icon: Zap, desc: '複数人体制で短納期。特急料金が適用されます' },
      { id: 'normal_cg', label: '通常（1ヶ月半〜）', icon: CalendarDays, desc: '標準的なポスプロ期間（推奨）' },
      { id: 'relaxed_cg', label: '余裕あり（2ヶ月以上）', icon: Clock, desc: '少人数でじっくり制作（コスト抑制）' },
  ]},
  { id: 'media', title: '広告媒体・配信先はどれですか？', options: [
      { id: 'web_tv', label: 'Web・TV', icon: Monitor, desc: '標準的な16:9の横型映像' },
      { id: 'signage', label: 'デジタルサイネージ', icon: Smartphone, desc: '縦型や駅ナカ広告' },
      { id: 'led', label: '特殊比率LED', icon: Maximize, desc: '超横長などの特殊サイズ' },
      { id: 'mapping', label: 'プロジェクションマッピング', icon: Layers, desc: '立体物への投影' },
      { id: 'event', label: 'イベント', icon: Users, desc: '展示会・カンファレンス・ライブ演出等' },
      { id: 'other_media', label: 'その他', icon: Globe, desc: 'その他の媒体・用途' },
  ]},
  { id: 'length', title: '映像の長さはどのくらいですか？', options: [
      { id: '15s', label: '15秒〜30秒', icon: Timer, desc: 'SNS広告・CM向け' },
      { id: '60s_plus', label: '1分〜3分', icon: Timer, desc: 'サービス紹介・MVショート' },
      { id: 'long', label: '3分以上', icon: Timer, desc: 'フルコーラスMV・長編ブランディング' },
      { id: 'loop', label: '空間演出ループ映像', icon: Layers, desc: 'サイネージやイベント向け' },
  ]},
  { id: 'shooting', title: '実写の撮影は必要ですか？', condition: (ans) => ans['category'] !== 'motion' && ans['category'] !== 'vfx', options: [
      { id: 'none', label: '不要', icon: Video, desc: '既存素材のみ使用' },
      { id: '1day', label: '半日〜1日撮影', icon: Camera, desc: '一般的な規模の撮影' },
      { id: 'multi', label: '2日以上の撮影', icon: CalendarDays, desc: '本格的なロケ・大掛かりな撮影' },
  ]},
  { id: 'location', title: 'ロケーション場所はどこですか？', condition: (ans) => ans['shooting'] === '1day' || ans['shooting'] === 'multi', options: [
      { id: 'office', label: '自社オフィス', icon: Building, desc: 'お客様のオフィス等での撮影' },
      { id: 'studio', label: 'ハウススタジオ', icon: Camera, desc: '専用スタジオの手配' },
      { id: 'outdoor', label: '屋外ロケ・特殊ロケ', icon: TreePine, desc: '屋外、またはドローン等の特殊撮影' },
  ]},
  { id: 'cast', title: '出演者（キャスト）の手配は必要ですか？', condition: (ans) => ans['shooting'] === '1day' || ans['shooting'] === 'multi', options: [
      { id: 'none', label: '不要（自社社員等）', icon: Users, desc: 'キャストの手配・費用なし' },
      { id: 'extra', label: 'モデル手配（1年契約）', icon: UserPlus, desc: 'プロモデル・エキストラ（1年間の使用権含む）' },
      { id: 'talent', label: '有名タレント・インフルエンサー', icon: Star, desc: '次の画面で規模感を選択→概算費用を自動反映します' },
  ]},
  { id: 'talent_rank', title: 'タレント・インフルエンサーの規模感は？', condition: (ans) => ans['cast'] === 'talent', options: [
      { id: 'micro', label: 'マイクロインフルエンサー', icon: Users, desc: 'フォロワー1万人未満。参考価格帯：10万～30万円' },
      { id: 'mid', label: '中小規模インフルエンサー', icon: UserPlus, desc: 'フォロワー1万～10万人。参考価格帯：30万～80万円' },
      { id: 'major', label: '人気タレント・大手インフルエンサー', icon: Star, desc: 'TV出演等の知名度。参考価格帯：100万～500万円' },
      { id: 'top', label: 'トップタレント（Aクラス）', icon: Crown, desc: '国民的知名度。参考価格帯：500万円～' },
  ]},
  { id: 'lighting', title: '照明スタッフの手配は必要ですか？', condition: (ans) => (ans['shooting'] === '1day' || ans['shooting'] === 'multi') && ans['location'] !== 'studio', options: [
      { id: 'lighting_yes', label: '照明スタッフあり', icon: Sparkles, desc: 'プロの照明技師を手配し、映像品質を向上' },
      { id: 'lighting_no', label: '照明スタッフなし', icon: Camera, desc: '自然光や持ち込み機材で対応' },
  ]},
  { id: 'narration', title: 'ナレーション（音声）の有無は？', condition: (ans) => ans['category'] !== 'music_video', options: [
      { id: 'none', label: 'BGM・SEのみ', icon: Mic, desc: 'ナレーションなし' },
      { id: 'pro', label: 'プロナレーター手配（1年契約）', icon: Crown, desc: 'プロによる高品質な収録（1年間の使用権含む）' },
      { id: 'ai_narration', label: 'AIナレーション', icon: Wand2, desc: 'AI音声合成によるナレーション（修正1回込）' },
      { id: 'self', label: '音声外注予定', icon: Users, desc: 'お客様側で音声発注予定' },
  ]},
  { id: 'bgm', title: '音楽・BGMのこだわりは？', options: [
      { id: 'none_bgm', label: '音楽の発注なし', icon: FileText, desc: 'BGMはクライアント側でご用意、または不要' },
      { id: 'royalty_free', label: 'ロイヤリティフリー音源', icon: Music, desc: '基本プランに含む（追加費用なし）' },
      { id: 'original', label: 'オリジナル楽曲制作', icon: Headphones, desc: '専属の作曲家によるオリジナルBGM制作' },
  ]},
  { id: 'language', title: '多言語展開（ローカライズ）の予定は？', options: [
      { id: 'ja_only', label: '日本語のみ', icon: FileText, desc: '国内向け展開' },
      { id: 'multi_lang', label: '英語字幕等・他言語対応', icon: Globe, desc: '海外向けテロップや字幕の追加制作' },
  ]},
  { id: 'ai_assets', title: 'AI素材制作は必要ですか？', condition: (ans) => ans['cg_type'] !== 'ai_animation', options: [
      { id: 'ai_none', label: 'AI素材不要', icon: FileText, desc: '実写撮影・CG制作のみで対応' },
      { id: 'ai_light', label: 'AI素材あり（少量）', icon: Wand2, desc: '背景・静止画を数点AIで生成' },
      { id: 'ai_heavy', label: 'AI素材あり（大量）', icon: Sparkles, desc: 'AIモデル・動画・静止画を積極的に活用' },
  ]},
  { id: 'sequence_data', title: 'シーケンスデータ（プロジェクトファイル）の引き渡しは必要ですか？', options: [
      { id: 'seq_no', label: '引き渡しなし', icon: FileText, desc: '完成映像データのみ納品' },
      { id: 'seq_yes', label: '引き渡しあり', icon: FileCheck, desc: 'After Effects / Cinema4D等のプロジェクトファイルを納品' },
  ]},
  { id: 'certainty', title: '企画や仕様はどの程度固まっていますか？', options: [
      { id: 'no_prepro', label: 'プリプロ不要（制作のみ依頼）', icon: Zap, desc: '企画・コンテ等は全て済んでいる。制作・ポスプロのみを依頼したい' },
      { id: 'fixed', label: '要件・コンテ決定済み', icon: FileCheck, desc: 'そのまま制作に入れる状態' },
      { id: 'draft', label: 'ざっくりとした構成案あり', icon: FileQuestion, desc: '弊社での企画構成のブラッシュアップが必要' },
      { id: 'uncertain', label: '未確定（要件変更の可能性大）', icon: ShieldAlert, desc: '企画から相談したい・予備費を含めて多めに見積もりたい' },
  ]}
];

// --- Engine ---
const calculateEstimate = (answers: Record<string, string>, customItems: LineItem[] = [], cgPartialItems: string[] = []) => {
  const items: LineItem[] = [];
  const addLine = (phase: LineItem['phase'], name: string, unitPrice: number, persons: number | undefined, days: number | undefined, unit: string, isEstimateOnly = false) => {
    const amount = isEstimateOnly ? 0 : unitPrice * (persons ?? 1) * (days ?? 1);
    items.push({ phase, name, persons, days, unit, unitPrice, amount, isEstimateOnly });
  };
  const isCgOnly = answers['category'] === 'motion' || answers['category'] === 'vfx' || answers['category'] === 'full_cg' || answers['category'] === 'opening' || answers['category'] === 'ending';

  // --- Base Automated Calculation ---
  const skipPrepro = answers['certainty'] === 'no_prepro';

  // CGのみの場合はプリプロを最小化
  if (!skipPrepro) {
    if (isCgOnly) {
      // CGのみの場合はディレクションのみ
      let dirDays = 2;
      if (answers['certainty'] === 'draft') dirDays += 2;
      if (answers['certainty'] === 'uncertain') dirDays += 3;
      addLine('Planning', 'ディレクション・進行管理費', 60000, 1, dirDays, '人日');
    } else {
      let dirDays = 2;
      if (answers['certainty'] === 'draft') dirDays += 3;
      if (answers['certainty'] === 'uncertain') dirDays += 5;
      if ((answers['client_type'] === 'production' || answers['client_type'] === 'cg_production') && answers['certainty'] !== 'uncertain') dirDays = Math.max(1, dirDays - 3);
      addLine('Planning', 'ディレクション・進行管理費', 60000, 1, dirDays, '人日');
      if (answers['client_type'] !== 'production' && answers['client_type'] !== 'cg_production') {
        addLine('Planning', '絵コンテ・Vコンテ作成費', 40000, 1, answers['certainty'] === 'uncertain' ? 5 : 2, '人日');
      }
      if (answers['shooting'] === '1day' || answers['shooting'] === 'multi') addLine('Pre-Production', 'ロケハン・撮影準備費', 50000, 2, 1, '人日');
    }
  }

  if (!isCgOnly && answers['shooting'] !== 'none' && answers['shooting']) {
    const sDays = answers['shooting'] === 'multi' ? 3 : 1;
    addLine('Shooting', 'ディレクター（現場指揮）', 60000, 1, sDays, '人日');
    addLine('Shooting', 'カメラマン', 80000, 1, sDays, '人日');
    if (answers['shooting'] === 'multi') { addLine('Shooting', 'カメラアシスタント', 35000, 2, sDays, '人日'); }
    addLine('Shooting', 'カメラ機材レンタル費（カメラ・レンズ）', 80000, undefined, sDays, '日');
    addLine('Shooting', '音声収録機材費', 20000, undefined, sDays, '日');
    addLine('Shooting', '録音技師', 50000, 1, sDays, '人日');
    // 照明機材: 照明スタッフがいる場合のみ
    const hasLighting = answers['location'] === 'studio' || answers['shooting'] === 'multi' || answers['lighting'] === 'lighting_yes';
    if (hasLighting) addLine('Shooting', '照明機材レンタル費', 40000, undefined, sDays, '日');
    // 照明スタッフ: スタジオは必須、ロケは選択制、multiは必須
    if (answers['location'] === 'studio') {
      addLine('Shooting', '照明技師', 70000, 1, sDays, '人日');
      addLine('Shooting', '照明アシスタント', 35000, 1, sDays, '人日');
    } else if (answers['shooting'] === 'multi') {
      addLine('Shooting', '照明技師', 70000, 1, sDays, '人日');
    } else if (answers['lighting'] === 'lighting_yes') {
      addLine('Shooting', '照明技師', 70000, 1, sDays, '人日');
    }
    if (answers['location'] === 'studio') addLine('Shooting', 'ハウススタジオ代', 150000, undefined, sDays, '日');
    else if (answers['location'] === 'outdoor') addLine('Shooting', '特殊ロケ費（車両・ドローン等）', 100000, undefined, sDays, '日');
    if (answers['cast'] === 'extra') {
      addLine('Cast', 'モデル出演費', 50000, 2, sDays, '人日');
      addLine('Cast', 'モデル使用権（1年契約）', 150000, 2, undefined, '名');
      addLine('Cast', 'キャスティング手配・オーディション費', 50000, undefined, 1, '式');
      addLine('Cast', 'ヘアメイク・スタイリスト手配費', 50000, 1, sDays, '人日');
    }
    else if (answers['cast'] === 'talent') {
      // タレントランクに応じた概算金額を反映
      const talentPricing: Record<string, { price: number; label: string }> = {
        'micro': { price: 200000, label: 'マイクロインフルエンサー出演費（概算）' },
        'mid': { price: 500000, label: '中小規模インフルエンサー出演費（概算）' },
        'major': { price: 3000000, label: '人気タレント・インフルエンサー出演費（概算）' },
        'top': { price: 10000000, label: 'トップタレント（Aクラス）出演費（概算）' },
      };
      const rank = answers['talent_rank'] || 'mid';
      const talent = talentPricing[rank] || talentPricing['mid'];
      addLine('Cast', talent.label, talent.price, undefined, 1, '式');
      addLine('Cast', 'キャスティング手配・プロダクション費', 100000, undefined, 1, '式');
      addLine('Cast', 'ヘアメイク・スタイリスト手配費', 70000, 2, sDays, '人日');
    }
  }

  if (isCgOnly) {
    // CG単価: 2D=¥50,000/日、3D=¥60,000/日
    const CG_RATE_2D = 50000;
    const CG_RATE_3D = 60000;
    // 納期: 通常=1.5ヶ月（約30営業日）、特急=10日〜1.5ヶ月（人数増で対応）、余裕=2ヶ月以上
    let deadlineDaysMul = 1; let deadlinePersonsMul = 1;
    let isExpress = false;
    if (answers['cg_deadline'] === 'express_cg') { deadlineDaysMul = 0.5; deadlinePersonsMul = 2.5; isExpress = true; }
    else if (answers['cg_deadline'] === 'relaxed_cg') { deadlineDaysMul = 1.5; deadlinePersonsMul = 0.7; }

    if (answers['cg_type'] === '2d_motion') {
      // 2D系 — 通常30営業日ベース
      const persons2d = Math.max(1, Math.round(1 * deadlinePersonsMul));
      addLine('CG', '2Dアニメーション (After Effects)', CG_RATE_2D, persons2d, Math.max(2, Math.round(10 * deadlineDaysMul)), '人日');
      addLine('CG', '2Dアセットデザイン (After Effects)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '2Dグラフィック素材 (Illustrator・Photoshop)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', 'コンポジット (After Effects)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '2Dエフェクト (After Effects)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
    } else if (answers['cg_type'] === '3d_product') {
      // 3D プロダクト系
      const persons3d = Math.max(1, Math.round(2 * deadlinePersonsMul));
      addLine('CG', '3Dモデリング (Cinema4D・Blender)', CG_RATE_3D, persons3d, Math.max(3, Math.round(10 * deadlineDaysMul)), '人日');
      addLine('CG', '3D背景モデリング (Cinema4D・Blender)', CG_RATE_3D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '3Dアニメーション (Cinema4D・Blender)', CG_RATE_3D, persons3d, Math.max(2, Math.round(8 * deadlineDaysMul)), '人日');
      addLine('CG', 'コンポジット (After Effects)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '3Dエフェクト (Cinema4D・Blender)', CG_RATE_3D, 1, Math.max(1, Math.round(3 * deadlineDaysMul)), '人日');
    } else if (answers['cg_type'] === 'full_3d_vfx') {
      // ハイエンド 3D / VFX
      const personsVfx = Math.max(1, Math.round(3 * deadlinePersonsMul));
      addLine('CG', '3Dキャラクターモデリング (Cinema4D・Blender)', CG_RATE_3D, Math.max(1, Math.round(2 * deadlinePersonsMul)), Math.max(3, Math.round(12 * deadlineDaysMul)), '人日');
      addLine('CG', '3D背景モデリング (Cinema4D・Blender)', CG_RATE_3D, Math.max(1, Math.round(1 * deadlinePersonsMul)), Math.max(2, Math.round(8 * deadlineDaysMul)), '人日');
      addLine('CG', '3Dリギング (Cinema4D・Blender)', CG_RATE_3D, 1, Math.max(2, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '3Dアニメーション (Cinema4D・Blender)', CG_RATE_3D, personsVfx, Math.max(5, Math.round(15 * deadlineDaysMul)), '人日');
      addLine('CG', '3Dエフェクト (Cinema4D・Blender)', CG_RATE_3D, Math.max(1, Math.round(1 * deadlinePersonsMul)), Math.max(2, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', '2Dエフェクト (After Effects)', CG_RATE_2D, 1, Math.max(1, Math.round(5 * deadlineDaysMul)), '人日');
      addLine('CG', 'コンポジット (After Effects)', CG_RATE_2D, Math.max(1, Math.round(2 * deadlinePersonsMul)), Math.max(3, Math.round(8 * deadlineDaysMul)), '人日');
    } else if (answers['cg_type'] === 'partial') {
      // 部分発注: cgPartialItemsに含まれる工程のみ
      const partialMap: Record<string, { name: string; baseDays: number; rate?: number; unit?: string; phase?: string }> = {
        '2d_anim': { name: '2Dアニメーション (After Effects)', baseDays: 10 },
        '2d_asset': { name: '2Dアセットデザイン (After Effects)', baseDays: 5 },
        '2d_graphic': { name: '2Dグラフィック素材 (Illustrator・Photoshop)', baseDays: 5 },
        '3d_anim': { name: '3Dアニメーション (Cinema4D・Blender)', baseDays: 8 },
        '3d_chara': { name: '3Dキャラクターモデリング (Cinema4D・Blender)', baseDays: 12 },
        '3d_bg': { name: '3D背景モデリング (Cinema4D・Blender)', baseDays: 8 },
        '3d_rig': { name: '3Dリギング (Cinema4D・Blender)', baseDays: 5 },
        'comp': { name: 'コンポジット (After Effects)', baseDays: 5 },
        '2d_fx': { name: '2Dエフェクト (After Effects)', baseDays: 5 },
        '3d_fx': { name: '3Dエフェクト (Cinema4D・Blender)', baseDays: 5 },
        '3d_model': { name: '3Dモデリング (Cinema4D・Blender)', baseDays: 10 },
        'ai_chara': { name: 'AIキャラクター制作', baseDays: 2, rate: 50000, unit: '点' },
        'ai_bg': { name: 'AI背景制作', baseDays: 3, rate: 6000, unit: '点' },
        'ai_world': { name: 'AI世界観イメージ制作', baseDays: 1, rate: 15000, unit: '点' },
        'ai_anim': { name: 'AIアニメーション制作', baseDays: 5, rate: 50000, unit: 'カット' },
        'ae_comp': { name: 'AEコンポジット', baseDays: 3, rate: 50000 },
        'ai_narration': { name: 'AIナレーション制作', baseDays: 1, rate: 20000, unit: '式', phase: 'Audio' },
        'ai_credit': { name: 'AIクレジット費用（API・クラウド利用費）', baseDays: 1, rate: 50000, unit: 'プロジェクト' },
      };
      cgPartialItems.forEach(key => {
        const item = partialMap[key];
        if (item) {
          const rate = item.rate || (key.startsWith('3d') ? CG_RATE_3D : CG_RATE_2D);
          const unit = item.unit || '人日';
          const phase = (item.phase || 'CG') as PhaseType;
          addLine(phase, item.name, rate, unit === '人日' ? 1 : undefined, Math.max(1, Math.round(item.baseDays * deadlineDaysMul)), unit);
        }
      });
    } else if (answers['cg_type'] === 'ai_animation') {
      // AIアニメーション制作
      // カット数・キャラ数は尺に応じて調整
      const isLong = answers['length'] === '60s_plus' || answers['length'] === 'long';
      const cutCount = isLong ? 10 : 5;
      const charaCount = 2;
      const bgCount = isLong ? 5 : 3;
      addLine('CG', 'AIキャラクター制作', 50000, undefined, charaCount, '点');
      addLine('CG', 'AI背景制作', 6000, undefined, bgCount, '点');
      addLine('CG', 'AI世界観イメージ制作', 15000, undefined, 1, '点');
      addLine('CG', 'AIアニメーション制作', 50000, undefined, cutCount, 'カット');
      addLine('CG', 'AEコンポジット', 50000, 1, Math.max(2, Math.round(3 * deadlineDaysMul)), '人日');
      addLine('Post-Production', '映像編集・カラーグレーディング', 50000, 1, Math.max(2, Math.round(3 * deadlineDaysMul)), '人日');
      addLine('Audio', 'AIナレーション制作', 20000, undefined, 1, '式');
      addLine('CG', 'AIクレジット費用（API・クラウド利用費）', 50000, undefined, 1, 'プロジェクト');
    }
    // レンダリングサーバー（部分発注で工程がない場合・AIアニメーションはスキップ）
    if (answers['cg_type'] !== 'ai_animation' && (answers['cg_type'] !== 'partial' || cgPartialItems.length > 0)) {
      addLine('CG', 'レンダリングサーバー使用費', 30000, undefined, Math.max(3, Math.round(10 * deadlineDaysMul)), '日');
    }

    // 特急料金（10日〜1.5ヶ月以内の場合 +30%）
    if (isExpress) {
      const expressSubtotal = items.reduce((acc, item) => acc + item.amount, 0);
      const expressFee = Math.round(expressSubtotal * 0.30);
      addLine('Express', '特急対応料金（納期短縮 +30%）', expressFee, undefined, 1, '式');
    }
  } else {
    // --- 非CG専用案件のポスプロ ---
    let basePostDays = 5;
    if (answers['category'] === 'music_video') basePostDays += 8;
    if (answers['length'] === '60s_plus') basePostDays *= 1.5;
    if (answers['length'] === 'long') basePostDays *= 2.5;
    // CG制作会社の場合はオフライン/オンライン編集不要（CG工程のみ）
    if (answers['client_type'] !== 'cg_production') {
      addLine('Post-Production', 'オフライン編集費', 50000, 1, 3, '人日');
      addLine('Post-Production', 'カラーグレーディング・オンライン編集費', 60000, 1, 3, '人日');
    }

    // CG制作が必要な場合（実写+CG混合案件）、またはプロジェクションマッピング
    const needsCg = answers['cg_needed'] === 'yes_cg' || answers['media'] === 'mapping';
    if (needsCg && answers['cg_type']) {
      const CG_RATE = 50000;
      // 実写混合の場合、CG日数はCG専用より少なめに（全体の約60%）
      const isDetailed = answers['certainty'] === 'fixed'; // 要件・コンテ決定済みの場合
      const cgScale = isDetailed ? 0.8 : 0.6; // 詳細あり→もう少し多めに見積もる
      let deadlineDaysMul = 1; let deadlinePersonsMul = 1;
      let isExpress = false;
      if (answers['cg_deadline'] === 'express_cg') { deadlineDaysMul = 0.5; deadlinePersonsMul = 2.5; isExpress = true; }
      else if (answers['cg_deadline'] === 'relaxed_cg') { deadlineDaysMul = 1.5; deadlinePersonsMul = 0.7; }

      if (answers['cg_type'] === '2d_motion') {
        const p = Math.max(1, Math.round(1 * deadlinePersonsMul));
        addLine('Post-Production', '2Dアニメーション (After Effects)', CG_RATE, p, Math.max(2, Math.round(8 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', '2Dアセットデザイン (After Effects)', CG_RATE, 1, Math.max(1, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '2Dグラフィック素材 (Illustrator・Photoshop)', CG_RATE, 1, Math.max(1, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', 'コンポジット (After Effects)', CG_RATE, 1, Math.max(1, Math.round(3 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '2Dエフェクト (After Effects)', CG_RATE, 1, Math.max(1, Math.round(3 * cgScale * deadlineDaysMul)), '人日');
      } else if (answers['cg_type'] === '3d_product') {
        const p = Math.max(1, Math.round(2 * deadlinePersonsMul));
        addLine('Post-Production', '3Dモデリング (Cinema4D・Blender)', CG_RATE, p, Math.max(2, Math.round(8 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '3D背景モデリング (Cinema4D・Blender)', CG_RATE, 1, Math.max(1, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', '3Dアニメーション (Cinema4D・Blender)', CG_RATE, p, Math.max(2, Math.round(6 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', 'コンポジット (After Effects)', CG_RATE, 1, Math.max(1, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '3Dエフェクト (Cinema4D・Blender)', CG_RATE, 1, Math.max(1, Math.round(2 * cgScale * deadlineDaysMul)), '人日');
      } else if (answers['cg_type'] === 'full_3d_vfx') {
        const p = Math.max(1, Math.round(3 * deadlinePersonsMul));
        addLine('Post-Production', '3Dキャラクターモデリング (Cinema4D・Blender)', CG_RATE, Math.max(1, Math.round(2 * deadlinePersonsMul)), Math.max(3, Math.round(10 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '3D背景モデリング (Cinema4D・Blender)', CG_RATE, 1, Math.max(2, Math.round(6 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '3Dリギング (Cinema4D・Blender)', CG_RATE, 1, Math.max(2, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', '3Dアニメーション (Cinema4D・Blender)', CG_RATE, p, Math.max(3, Math.round(12 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', '3Dエフェクト (Cinema4D・Blender)', CG_RATE, 1, Math.max(1, Math.round(4 * cgScale * deadlineDaysMul)), '人日');
        if (isDetailed) addLine('Post-Production', '2Dエフェクト (After Effects)', CG_RATE, 1, Math.max(1, Math.round(3 * cgScale * deadlineDaysMul)), '人日');
        addLine('Post-Production', 'コンポジット (After Effects)', CG_RATE, Math.max(1, Math.round(2 * deadlinePersonsMul)), Math.max(2, Math.round(6 * cgScale * deadlineDaysMul)), '人日');
      }
      addLine('Post-Production', 'レンダリングサーバー使用費', 30000, undefined, Math.max(3, Math.round(8 * cgScale * deadlineDaysMul)), '日');

      if (isExpress) {
        const expressSubtotal = items.reduce((acc, item) => acc + item.amount, 0);
        const expressFee = Math.round(expressSubtotal * 0.30);
        addLine('Express', '特急対応料金（納期短縮 +30%）', expressFee, undefined, 1, '式');
      }
    }
  }

  if (answers['media'] === 'led' || answers['media'] === 'mapping') addLine('CG', '特殊フォーマット変換・マッピング調整費', 100000, undefined, 1, '式');
  if (answers['media'] === 'mapping') {
    addLine('Pre-Production', '現地ロケハン・投影テスト（最低3回）', 50000, 2, 3, '人日');
    addLine('Pre-Production', '現地調査 交通費・宿泊費', 30000, 2, 3, '人回');
  }
  if (answers['narration'] === 'pro' && answers['category'] !== 'music_video') {
    addLine('Audio', 'プロナレーター収録費（1年契約・使用権含む）', 200000, undefined, 1, '式');
    addLine('Audio', '収録スタジオ費', 50000, undefined, 1, '式');
    addLine('Audio', 'MA・整音作業費', 40000, 1, 1, '式');
  }
  else if (answers['narration'] === 'ai_narration' && answers['category'] !== 'music_video') { addLine('Audio', 'AIナレーション制作費（修正1回込）', 30000, undefined, 1, '式'); addLine('Audio', 'AIナレーション追加修正（以降1回ごと）', 10000, undefined, 1, '回'); }
  else if (answers['narration'] !== 'none' && answers['category'] !== 'music_video') addLine('Audio', 'BGM・SE選曲・整音作業費', 30000, undefined, 1, '式');
  if (answers['bgm'] === 'original') addLine('Audio', 'オリジナルBGM制作（作曲・編曲）', 150000, undefined, 1, '式');
  if (answers['language'] === 'multi_lang') addLine('Post-Production', '英語字幕翻訳・テロップ作成費', 50000, undefined, 1, '式');

  // --- AI素材制作 ---
  if (answers['ai_assets'] === 'ai_light') {
    addLine('CG', 'AI静止画生成', 10000, undefined, 3, '枚');
    addLine('CG', 'AI背景生成', 10000, undefined, 2, '枚');
    addLine('CG', 'AI使用課金（API・クラウド利用費）', 10000, undefined, 1, '式');
  } else if (answers['ai_assets'] === 'ai_heavy') {
    addLine('CG', 'AIモデル生成（人物）', 50000, undefined, 2, '名');
    addLine('CG', 'AI動画生成', 30000, undefined, 5, 'カット');
    addLine('CG', 'AI静止画生成', 10000, undefined, 10, '枚');
    addLine('CG', 'AI背景生成', 10000, undefined, 5, '枚');
    addLine('CG', 'AI使用課金（API・クラウド利用費）', 10000, undefined, 3, '式');
  }

  // --- シーケンスデータ引き渡し ---
  if (answers['sequence_data'] === 'seq_yes') {
    if (answers['client_type'] === 'production' || answers['client_type'] === 'cg_production') {
      // 制作会社・CG制作会社: 固定30万円
      addLine('Post-Production', 'シーケンスデータ引き渡し費（プロジェクトファイル一式）', 300000, undefined, 1, '式');
    } else {
      // 一般企業・代理店: ポストプロダクション費同額
      const postTotal = items.filter(i => i.phase === 'Post-Production').reduce((acc, i) => acc + i.amount, 0);
      addLine('Post-Production', 'シーケンスデータ引き渡し費（プロジェクトファイル一式）', postTotal, undefined, 1, '式');
    }
  }

  // --- 5年間バックアップオプション ---
  if (answers['backup_5year'] === 'yes') {
    addLine('Overhead', '5年間長期バックアップ（専用HDD保管）', 20000, undefined, 1, '式');
  }

  // --- Integrate Custom Items before Overhead Calculation ---
  const allItems = [...items, ...customItems];

  const subTotal = allItems.reduce((acc, item) => acc + item.amount, 0);
  
  // Overhead Calculation (10% of subtotal including custom items)
  const overheadAmount = Math.round(subTotal * 0.10);
  allItems.push({ phase: 'Overhead', name: '制作間接費（機材管理・データ管理・諸経費）', unit: '式', unitPrice: overheadAmount, amount: overheadAmount });

  let grossTotal = subTotal + overheadAmount;
  if (answers['certainty'] === 'uncertain') {
    const contingency = Math.round(grossTotal * 0.15);
    allItems.push({ phase: 'Overhead', name: '企画変更予備費・コンティンジェンシー費', unit: '式', unitPrice: contingency, amount: contingency });
    grossTotal += contingency;
  }

  // 割引は各カテゴリに按分吸収（見積書に割引行を表示しない）
  let partnerDiscountRate = 0;
  if (answers['client_type'] === 'agency') partnerDiscountRate = 0.15;
  else if (answers['client_type'] === 'production' || answers['client_type'] === 'cg_production') partnerDiscountRate = 0.20;
  
  if (partnerDiscountRate > 0) {
    allItems.forEach(item => {
      if (item.amount > 0) {
        const discount = Math.round(item.amount * partnerDiscountRate);
        item.unitPrice = Math.round(item.unitPrice * (1 - partnerDiscountRate));
        item.amount = item.amount - discount;
      }
    });
  }

  const total = allItems.reduce((acc, item) => acc + item.amount, 0);
  const hasUnestimatedItem = allItems.some(i => i.isEstimateOnly);
  return { total, items: allItems, hasContingency: answers['certainty'] === 'uncertain', hasUnestimatedItem };
};

// Apply admin overrides and removals to estimate
const applyAdminEdits = (
  est: ReturnType<typeof calculateEstimate>,
  removedAutoItems: Set<string>,
  itemOverrides: Record<string, { unitPrice?: number; persons?: number; days?: number; unit?: string }>,
  itemOrder?: string[]
) => {
  let filtered = est.items.filter(i => !removedAutoItems.has(i.name));
  filtered = filtered.map(item => {
    const override = itemOverrides[item.name];
    if (override) {
      const up = override.unitPrice ?? item.unitPrice;
      const p = override.persons ?? item.persons;
      const d = override.days ?? item.days;
      const u = override.unit ?? item.unit;
      const amount = up * (p || 1) * (d || 1);
      return { ...item, unitPrice: up, persons: p, days: d, unit: u, amount };
    }
    return item;
  });
  // Apply custom ordering if provided
  if (itemOrder && itemOrder.length > 0) {
    filtered.sort((a, b) => {
      const ai = itemOrder.indexOf(a.name);
      const bi = itemOrder.indexOf(b.name);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  const total = filtered.reduce((acc, i) => acc + i.amount, 0);
  return { ...est, items: filtered, total };
};

// Scale phase days to fit within available business days
// If days <= available: no change (fits in schedule)
// If days > available: compress days to fit, increase persons to maintain work volume
const scaleToBusinessDays = (
  est: ReturnType<typeof calculateEstimate>,
  startDate: string,
  deliveryDate: string
): ReturnType<typeof calculateEstimate> => {
  if (!startDate || !deliveryDate) return est;
  const availableDays = countBusinessDays(startDate, deliveryDate);
  if (availableDays <= 0) return est;

  const scalablePhases = ['Pre-Production', 'Production', 'Post-Production'];
  const scalableItems = est.items.filter(i => scalablePhases.includes(i.phase) && i.days && i.days > 0 && !i.isEstimateOnly);
  const nonScalableItems = est.items.filter(i => !scalablePhases.includes(i.phase) || !i.days || i.days <= 0 || i.isEstimateOnly);

  const currentTotalDays = scalableItems.reduce((acc, i) => acc + (i.days || 0), 0);
  if (currentTotalDays <= 0) return est;

  // If fits within schedule, no adjustment needed
  if (currentTotalDays <= availableDays) return est;

  // Over schedule: compress days proportionally, increase persons to keep work volume
  const ratio = availableDays / currentTotalDays;

  let scaledTotal = 0;
  const scaledItems = scalableItems.map(item => {
    const origDays = item.days || 1;
    const origPersons = item.persons || 1;
    const newDays = Math.max(1, Math.round(origDays * ratio));
    // Increase persons to maintain total work (person-days)
    const origWorkVolume = origDays * origPersons;
    const newPersons = Math.max(origPersons, Math.ceil(origWorkVolume / newDays));
    const newAmount = item.unitPrice * newPersons * newDays;
    scaledTotal += newDays;
    return { ...item, days: newDays, persons: newPersons, amount: newAmount };
  });

  // Adjust rounding error on the largest item
  const diff = availableDays - scaledTotal;
  if (diff !== 0 && scaledItems.length > 0) {
    const largestIdx = scaledItems.reduce((maxIdx, item, idx, arr) => (item.days || 0) > (arr[maxIdx].days || 0) ? idx : maxIdx, 0);
    const item = scaledItems[largestIdx];
    const adjustedDays = Math.max(1, (item.days || 1) + diff);
    const origWork = (scalableItems[largestIdx].days || 1) * (scalableItems[largestIdx].persons || 1);
    const adjustedPersons = Math.max(item.persons || 1, Math.ceil(origWork / adjustedDays));
    scaledItems[largestIdx] = { ...item, days: adjustedDays, persons: adjustedPersons, amount: item.unitPrice * adjustedPersons * adjustedDays };
  }

  const allItems = [...scaledItems, ...nonScalableItems];
  const orderMap = new Map(est.items.map((item, idx) => [item.name + item.phase, idx]));
  allItems.sort((a, b) => (orderMap.get(a.name + a.phase) ?? 999) - (orderMap.get(b.name + b.phase) ?? 999));

  const newTotal = allItems.reduce((acc, i) => acc + i.amount, 0);
  return { ...est, items: allItems, total: newTotal };
};

// --- Utils ---
const generateId = () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `LB-${year}${month}-${random}`;
};

const statusLabels: Record<ProjectStatus, string> = {
  draft: '下書き', estimate: '見積依頼・検討中', ordered: '受注・制作中', production: '制作中', delivered: '納品済', invoiced: '請求済', paid: '入金済'
};

// --- Main App ---
function App() {
  // 権限管理
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<'dashboard' | 'wizard' | 'detail'>('wizard');
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  // ウィザード用ステート
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customItems, setCustomItems] = useState<LineItem[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showConfirmScreen, setShowConfirmScreen] = useState(false);
  const [showCustomerInput, setShowCustomerInput] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({ projectName: '', companyName: '', contactName: '', email: '', phone: '', address: '' });
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);
  const [deadlinePopupId, setDeadlinePopupId] = useState<string | null>(null);
  const [contractAgreed, setContractAgreed] = useState(false);
  const [showCompanyVerification, setShowCompanyVerification] = useState(true);
  const [selectedClientType, setSelectedClientType] = useState<string>('');
  const [companySuggestions, setCompanySuggestions] = useState<CompanyEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [companyMatchInfo, setCompanyMatchInfo] = useState<CompanyEntry | null>(null);
  const [aiClassification, setAiClassification] = useState<AIClassificationResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  // Customer Library
  const [customerLibrary, setCustomerLibrary] = useState<CustomerInfo[]>(() => {
    try { return JSON.parse(localStorage.getItem('lb_customer_library') || '[]'); } catch { return []; }
  });
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);

  const saveToCustomerLibrary = (info: CustomerInfo) => {
    if (!info.companyName) return;
    const existing = customerLibrary.findIndex(c => c.companyName === info.companyName && c.contactName === info.contactName);
    let updated: CustomerInfo[];
    if (existing >= 0) {
      updated = [...customerLibrary]; updated[existing] = { ...info, projectName: '' };
    } else {
      updated = [...customerLibrary, { ...info, projectName: '' }];
    }
    setCustomerLibrary(updated);
    localStorage.setItem('lb_customer_library', JSON.stringify(updated));
  };

  const deleteFromCustomerLibrary = (idx: number) => {
    const updated = customerLibrary.filter((_, i) => i !== idx);
    setCustomerLibrary(updated);
    localStorage.setItem('lb_customer_library', JSON.stringify(updated));
  };

  const exportCustomerLibraryCSV = () => {
    const header = '会社名,担当者名,メールアドレス,電話番号,住所';
    const rows = customerLibrary.map(c => 
      [c.companyName, c.contactName, c.email, c.phone, c.address].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `顧客ライブラリ_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  const [referenceUrls, setReferenceUrls] = useState<string[]>(['']);
  const [orientationFiles, setOrientationFiles] = useState<OrientationFile[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<DirectionAnalysis | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removedAutoItems, setRemovedAutoItems] = useState<Set<string>>(new Set());
  const [itemOverrides, setItemOverrides] = useState<Record<string, { unitPrice?: number; persons?: number; days?: number; unit?: string }>>({});
  const [projectDates, setProjectDates] = useState<{
    issueDate?: string; estimateExpiry?: string; startDate?: string; deliveryDate?: string; invoiceDate?: string; paymentDue?: string;
  }>({});
  const [itemOrder, setItemOrder] = useState<string[]>([]);
  const [cgPartialItems, setCgPartialItems] = useState<string[]>([]);
  const [projectNotes, setProjectNotes] = useState('');
  const [suppliedData, setSuppliedData] = useState<string[]>([]);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [workflowAgreed, setWorkflowAgreed] = useState(false);
  const dragItemRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const [tutorialStep, setTutorialStep] = useState(-1);
  const [tutorialDismissed, setTutorialDismissed] = useState(() => localStorage.getItem('lb_tutorial_done') === '1');

  const tutorialSteps = [
    { target: '人数・日数', message: '人数と日数はクリックして直接変更できます。変更するとリアルタイムで金額が再計算されます。', position: 'bottom' as const },
    { target: '不要チェック', message: '不要な項目には「不要」ボタンを押して除外できます。除外した項目は金額に含まれなくなります。', position: 'bottom' as const },
    { target: '税込金額', message: '各項目に消費税10%の税込金額が表示されています。合計欄にも税込合計が表示されます。', position: 'bottom' as const },
    { target: '送信', message: '内容をご確認の上、「この内容で見積もり依頼を送信」ボタンからご送信ください。', position: 'top' as const },
  ];

  const startTutorial = () => { setTutorialStep(0); };
  const nextTutorial = () => {
    if (tutorialStep < tutorialSteps.length - 1) setTutorialStep(tutorialStep + 1);
    else { setTutorialStep(-1); setTutorialDismissed(true); localStorage.setItem('lb_tutorial_done', '1'); }
  };

  // CG/VFX プリセット項目
  const cgPresets = [
    { name: '2Dアニメーション (After Effects)', unitPrice: 50000 },
    { name: '2Dアセットデザイン (After Effects)', unitPrice: 50000 },
    { name: '2Dグラフィック素材 (Illustrator・Photoshop)', unitPrice: 50000 },
    { name: '3Dアニメーション (Cinema4D・Blender)', unitPrice: 50000 },
    { name: '3Dキャラクターモデリング (Cinema4D・Blender)', unitPrice: 50000 },
    { name: '3D背景モデリング (Cinema4D・Blender)', unitPrice: 50000 },
    { name: '3Dリギング (Cinema4D・Blender)', unitPrice: 50000 },
    { name: 'コンポジット (After Effects)', unitPrice: 50000 },
    { name: '2Dエフェクト (After Effects)', unitPrice: 50000 },
    { name: '3Dエフェクト (Cinema4D・Blender)', unitPrice: 50000 },
  ];

  // カスタム追加用フォームステート
  const [newItem, setNewItem] = useState<{ phase: PhaseType; name: string; unitPrice: number; persons: number; days: number; unit: string; }>({
    phase: 'Post-Production', name: '', unitPrice: 0, persons: 1, days: 1, unit: '人日'
  });

  const handlePresetSelect = (presetName: string) => {
    if (presetName === '') return;
    const preset = cgPresets.find(p => p.name === presetName);
    if (preset) {
      setNewItem({ ...newItem, name: preset.name, unitPrice: preset.unitPrice, phase: 'Post-Production' });
    }
  };

  // Initialization
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const adminMode = params.get('mode') === 'admin';
    setIsAdmin(adminMode);
    setViewMode(adminMode ? 'dashboard' : 'wizard');

    const saved = localStorage.getItem('liquidblock_projects');
    if (saved) {
      try { 
        // 過去データの互換性担保（customItemsやprojectNameがないデータ対策）
        const parsed: Project[] = JSON.parse(saved).map((p: any) => ({
          ...p,
          customItems: p.customItems || [],
          referenceUrls: p.referenceUrls || [],
          orientationFiles: p.orientationFiles || [],
          customerInfo: { ...p.customerInfo, projectName: p.customerInfo.projectName || '' }
        }));
        setProjects(parsed); 
      } catch (e) { console.error('Failed to parse projects', e); }
    }
  }, []);

  const saveProjects = (newProjects: Project[]) => {
    setProjects(newProjects);
    localStorage.setItem('liquidblock_projects', JSON.stringify(newProjects));
  };

  // --- Actions ---
  const startNewProject = () => {
    setAnswers({});
    setCustomItems([]);
    setReferenceUrls(['']);
    setOrientationFiles([]);
    setAiAnalysis(null);
    setRemovedAutoItems(new Set());
    setItemOverrides({});
    setProjectDates({});
    setItemOrder([]);
    setCgPartialItems([]);
    setProjectNotes('');
    setSuppliedData([]);
    setCustomerInfo({ projectName: '', companyName: '', contactName: '', email: '', phone: '', address: '' });
    setCurrentStep(0);
    setIsFinished(false);
    setShowConfirmScreen(false);
    setShowCustomerInput(false);
    setIsSubmitted(false);
    setActiveProject(null);
    setSelectedClientType('');
    setShowCompanyVerification(true);
    setViewMode('wizard');
  };

  const handleSelectAnswer = (questionId: string, optionId: string) => {
    // 広告代理店・直クライアントの場合、24工程モーダルを表示
    if (questionId === 'client_type' && (optionId === 'end_client' || optionId === 'agency' || optionId === 'cg_production') && !workflowAgreed) {
      setAnswers({ ...answers, [questionId]: optionId });
      setShowWorkflowModal(true);
      return;
    }
    const newAnswers = { ...answers, [questionId]: optionId };
    setAnswers(newAnswers);
    // 部分発注選択時は自動遷移しない（チェックボックス操作が必要）
    if (questionId === 'cg_type' && optionId === 'partial') return;
    setTimeout(() => {
      const newVisible = questions.filter(q => !q.condition || q.condition(newAnswers));
      const currentIdx = newVisible.findIndex(q => q.id === questionId);
      if (currentIdx < newVisible.length - 1) setCurrentStep(questions.findIndex(q => q.id === newVisible[currentIdx + 1].id));
      else setShowConfirmScreen(true);
    }, 400);
  };

  const handleBackQuestion = () => {
    const newVisible = questions.filter(q => !q.condition || q.condition(answers));
    const currentIdx = newVisible.findIndex(q => q.id === questions[currentStep].id);
    if (currentIdx > 0) setCurrentStep(questions.findIndex(q => q.id === newVisible[currentIdx - 1].id));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerInfo({ ...customerInfo, [e.target.name]: e.target.value });
  };

  const [formError, setFormError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approverName, setApproverName] = useState('');
  const [approverTitle, setApproverTitle] = useState('');
  const projectApproval = isAdmin && activeProject ? activeProject.approval : undefined;

  const handleApproveEstimate = () => {
    if (!approverName.trim()) return;
    const approval = {
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedBy: approverName.trim(),
      approverTitle: approverTitle.trim() || undefined,
    };
    // Save to localStorage
    const stored = JSON.parse(localStorage.getItem('lb_projects') || '[]');
    // Find latest project or create
    if (stored.length > 0) {
      stored[stored.length - 1].approval = approval;
      localStorage.setItem('lb_projects', JSON.stringify(stored));
    }
    setShowApprovalModal(false);
    setApproverName('');
    setApproverTitle('');
    alert('✅ お見積もりを承諾しました。ありがとうございます。');
  };

  const validateCustomerInfo = () => {
    if (!customerInfo.projectName || !customerInfo.companyName || !customerInfo.contactName || !customerInfo.email) {
      setFormError('「プロジェクト名」「貴社名」「ご担当者名」「メールアドレス」は必須項目です。');
      return false;
    }
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerInfo.email)) {
      setFormError('メールアドレスの形式が正しくありません。');
      return false;
    }
    setFormError('');
    return true;
  };

  const submitProjectByClient = async () => {
    if (!validateCustomerInfo()) return;
    setIsUploading(true);
    const est = calculateEstimate(answers, customItems, cgPartialItems);
    const now = new Date().toISOString();
    const filteredUrls = referenceUrls.filter(u => u.trim() !== '');
    const projectId = generateId();

    let driveFolderId: string | undefined;
    let driveFolderUrl: string | undefined;
    let analysis: DirectionAnalysis | undefined;

    try {
      // Phase B: Google Drive folder creation & file upload
      const folderRes = await fetch(`${API_BASE}/api/drive/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, companyName: customerInfo.companyName, projectName: customerInfo.projectName })
      });
      if (folderRes.ok) {
        const folderData = await folderRes.json();
        driveFolderId = folderData.folderId;
        driveFolderUrl = `https://drive.google.com/drive/folders/${driveFolderId}`;

        // Upload orientation files to Drive
        for (const file of orientationFiles) {
          try {
            const uploadRes = await fetch(`${API_BASE}/api/drive/upload-base64`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderId: driveFolderId, fileName: file.name, mimeType: file.type, dataUrl: file.dataUrl })
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              file.driveLink = uploadData.webViewLink;
            }
          } catch (e) { console.warn('File upload skipped:', file.name, e); }
        }
      }
    } catch (e) { console.warn('Drive integration skipped (server may not be running):', e); }

    try {
      // Phase C: Gemini AI analysis
      const imageFile = orientationFiles.find(f => f.type.startsWith('image/'));
      const analyzeRes = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageFile?.dataUrl || '',
          mimeType: imageFile?.type || 'image/jpeg',
          referenceUrls: filteredUrls
        })
      });
      if (analyzeRes.ok) {
        analysis = await analyzeRes.json();
        setAiAnalysis(analysis!);
      }
    } catch (e) { console.warn('AI analysis skipped (server may not be running):', e); }

    const newProject: Project = {
      id: projectId, createdAt: now, updatedAt: now,
      customerInfo, answers, customItems,
      referenceUrls: filteredUrls, orientationFiles,
      driveFolderId, driveFolderUrl, aiAnalysis: analysis,
      totalAmount: est.total,
      status: 'estimate', currentDocType: 'estimate'
    };
    saveProjects([newProject, ...projects]);
    setIsUploading(false);

    // Check if backend operations actually succeeded
    if (!driveFolderId) {
      setSubmitError('バックエンドサーバーに接続できませんでした。見積もりはローカルに保存されましたが、Google Driveへのアップロードは行われていません。');
    } else {
      setSubmitError('');
    }
    // Send email notifications via EmailJS (no backend required)
    try {
      const itemSummary = est.items
        .map(i => `・${i.name}（${i.phase}）: ¥${i.amount.toLocaleString()}`)
        .join('\n');
      const emailResult = await sendEstimateNotification({
        projectId,
        companyName: customerInfo.companyName,
        contactName: customerInfo.contactName,
        email: customerInfo.email,
        phone: customerInfo.phone,
        projectName: customerInfo.projectName || '新規案件',
        totalAmount: est.total,
        totalAmountWithTax: Math.round(est.total * 1.1),
        itemSummary,
        driveFolderUrl,
      });
      if (emailResult.success) {
        console.log('✅ Email notifications sent successfully');
      } else if (emailResult.error) {
        console.warn('⚠️ Email:', emailResult.error);
      }
    } catch (e) { console.warn('Email notification skipped:', e); }

    setIsSubmitted(true);
    window.scrollTo(0, 0);
  };

  const saveProjectByAdmin = () => {
    if (!validateCustomerInfo()) return;
    const est = calculateEstimate(answers, customItems, cgPartialItems);
    const now = new Date().toISOString();
    
    if (activeProject) {
      const filteredUrls = referenceUrls.filter(u => u.trim() !== '');
      const adminEst = applyAdminEdits(est, removedAutoItems, itemOverrides, itemOrder);
      const updated = projects.map(p => p.id === activeProject.id ? {
        ...p, customerInfo, answers, customItems,
        referenceUrls: filteredUrls, orientationFiles,
        removedAutoItems: Array.from(removedAutoItems), itemOverrides,
        dates: projectDates, itemOrder, projectNotes, suppliedData,
        totalAmount: adminEst.total, updatedAt: now
      } : p);
      saveProjects(updated);
      setActiveProject(updated.find(p => p.id === activeProject.id) || null);
    } else {
      const filteredUrls = referenceUrls.filter(u => u.trim() !== '');
      const adminEst = applyAdminEdits(est, removedAutoItems, itemOverrides, itemOrder);
      const newProject: Project = {
        id: generateId(), createdAt: now, updatedAt: now,
        customerInfo, answers, customItems,
        referenceUrls: filteredUrls, orientationFiles,
        removedAutoItems: Array.from(removedAutoItems), itemOverrides,
        dates: projectDates, itemOrder, projectNotes, suppliedData,
        totalAmount: adminEst.total,
        status: 'estimate', currentDocType: 'estimate'
      };
      saveProjects([newProject, ...projects]);
      setActiveProject(newProject);
    }
    setViewMode('dashboard');
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if(confirm('本当にこのプロジェクトを削除しますか？')) {
      saveProjects(projects.filter(p => p.id !== id));
    }
  }

  const changeProjectStatus = (id: string, newStatus: ProjectStatus, e?: React.ChangeEvent) => {
    if(e) e.stopPropagation();
    saveProjects(projects.map(p => p.id === id ? { ...p, status: newStatus, updatedAt: new Date().toISOString() } : p));
  };

  const changeDocType = (type: DocumentType) => {
    if (activeProject) {
      const updated = { ...activeProject, currentDocType: type };
      setActiveProject(updated);
      saveProjects(projects.map(p => p.id === updated.id ? updated : p));
    }
  };

  // --- カスタム項目関連のアクション (管理者のみ) ---
  const handleAddCustomItem = () => {
    if (!newItem.name || newItem.unitPrice === 0) {
      setFormError('項目名と単価を入力してください。');
      return;
    }
    setFormError('');
    const item: LineItem = {
      id: Date.now().toString(),
      phase: newItem.phase,
      name: newItem.name,
      unitPrice: newItem.unitPrice,
      persons: newItem.persons,
      days: newItem.days,
      unit: newItem.unit,
      amount: newItem.unitPrice * newItem.persons * newItem.days,
      isCustom: true
    };
    setCustomItems([...customItems, item]);
    // リセット
    setNewItem({ phase: newItem.phase, name: '', unitPrice: 0, persons: 1, days: 1, unit: '人日' });
  };

  const handleRemoveCustomItem = (id: string) => {
    setCustomItems(customItems.filter(item => item.id !== id));
  };

  const exportToExcel = () => {
    const est = calculateEstimate(answers, customItems, cgPartialItems);
    const adminEst = isAdmin ? applyAdminEdits(est, removedAutoItems, itemOverrides, itemOrder) : est;
    const items = adminEst.items;
    const tax = Math.floor(adminEst.total * 0.1);
    const issueDate = projectDates.issueDate || (activeProject ? activeProject.updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const expiryDate = projectDates.estimateExpiry || (() => { const d = new Date(issueDate); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

    const data: (string | number | undefined)[][] = [];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    let r = 0;

    // === Header ===
    data.push(['御 見 積 書']); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;
    data.push([]); r++;

    // === 宛先 & 発行情報 (左右分割) ===
    data.push([`${customerInfo.companyName || '（貴社名）'} 御中`, '', '', '', '発行日', issueDate]); r++;
    data.push([`ご担当：${customerInfo.contactName || ''} 様`, '', '', '', '見積有効期限', expiryDate]); r++;
    if (customerInfo.address) { data.push([`〒 ${customerInfo.address}`, '', '', '', '見積番号', activeProject?.id || '']); r++; }
    else { data.push(['', '', '', '', '見積番号', activeProject?.id || '']); r++; }
    data.push([`TEL: ${customerInfo.phone || ''}　/　Email: ${customerInfo.email || ''}`, '', '', '', '', '']); r++;
    data.push([]); r++;

    // === 案件情報 ===
    data.push(['案件名', customerInfo.projectName || '']); merges.push({ s: { r, c: 1 }, e: { r, c: 6 } }); r++;
    if (projectDates.startDate && projectDates.deliveryDate) {
      const biz = countBusinessDays(projectDates.startDate, projectDates.deliveryDate);
      data.push(['制作期間', `${projectDates.startDate} 〜 ${projectDates.deliveryDate}（${biz}営業日）`]);
      merges.push({ s: { r, c: 1 }, e: { r, c: 6 } }); r++;
    }
    data.push([]); r++;

    // === 金額サマリ ===
    data.push(['御見積金額（税込）', '', '', '', '', '', `¥${(adminEst.total + tax).toLocaleString()}`]); merges.push({ s: { r, c: 0 }, e: { r, c: 5 } }); r++;
    data.push(['', '', '', '', '', '税抜合計', `¥${adminEst.total.toLocaleString()}`]); r++;
    data.push(['', '', '', '', '', '消費税(10%)', `¥${tax.toLocaleString()}`]); r++;
    data.push([]); r++;

    // === 発行者情報 ===
    data.push(['', '', '', '', '株式会社リキッドブロック']); r++;
    data.push(['', '', '', '', '〒651-0082 兵庫県神戸市中央区小野浜町 1-4']); r++;
    data.push(['', '', '', '', '登録番号: T-4140001096045']); r++;
    data.push([]); r++;

    // === フェーズ別明細 ===
    const phases = ['Planning', 'Pre-Production', 'Shooting', 'Cast', 'CG', 'Post-Production', 'Audio', 'Overhead', 'Express'] as const;
    const phaseLabels: Record<string, string> = { 'Planning': '企画構成費', 'Pre-Production': '制作準備費', 'Shooting': '撮影費', 'Cast': '出演者関係費', 'CG': 'CG/アニメーション費', 'Post-Production': 'ポストプロダクション', 'Audio': '音楽・音響費', 'Overhead': '制作管理費', 'Express': '特急料金' };

    // 表示モード: 一般企業・代理店はsummary（カテゴリ合計のみ）
    // ただし特急料金（Express）オプション等は詳細表示を強制する

    for (const phase of phases) {
      const phaseItems = items.filter(i => i.phase === phase);
      if (phaseItems.length === 0) continue;

      const phaseTotal = phaseItems.reduce((sum, i) => sum + (i.isEstimateOnly ? 0 : i.amount), 0);
      const isExcelSummary = !isAdmin && (answers['client_type'] === 'end_client' || answers['client_type'] === 'agency') && phase !== 'Express';

      if (isExcelSummary) {
        // 集約モード: カテゴリ名と合計のみ
        data.push([`■ ${phaseLabels[phase] || phase}`, '', '', '', '', '', phaseTotal]); merges.push({ s: { r, c: 0 }, e: { r, c: 5 } }); r++;
      } else {
        // 詳細モード: 従来どおり
        data.push([`■ ${phaseLabels[phase] || phase}`]); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;
        data.push(['', '内訳', '単価', '人数', '日数', '単位', '金額']); r++;

        let phaseDays = 0;
        for (const item of phaseItems) {
          data.push([
            '',
            item.name + (item.isCustom ? ' ★' : ''),
            item.isEstimateOnly ? '別途見積' : item.unitPrice,
            item.persons || '',
            item.days || '',
            item.unit,
            item.isEstimateOnly ? '別途見積' : item.amount
          ]); r++;
          if (!item.isEstimateOnly) { phaseDays += (item.days || 0); }
        }
        data.push(['', '', '', '', phaseDays || '', '小計', phaseTotal]); r++;
      }
      data.push([]); r++;
    }

    // === 制作条件 ===
    const conditionItems = visibleQuestions.map(q => {
      const opt = q.options.find(o => o.id === answers[q.id]);
      return opt ? `${q.title}: ${opt.label}` : null;
    }).filter(Boolean);
    if (conditionItems.length > 0) {
      data.push(['■ 制作条件']); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;
      for (const c of conditionItems) { data.push(['', c || '']); merges.push({ s: { r, c: 1 }, e: { r, c: 6 } }); r++; }
      data.push([]); r++;
    }

    // === 支給データ ===
    const suppliedLabels: Record<string, string> = { photo_hd: '静止画(FHD以上)', photo_sd: '静止画(FHD以下)', logo: 'ロゴデータ', psd: 'PSDデータ', pamphlet: 'パンフレットデータ', video: '映像素材', font: '指定フォント', guideline: 'ブランドガイドライン', other_data: 'その他データ' };
    if (suppliedData.length > 0) {
      data.push(['■ 支給データ']); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;
      data.push(['', suppliedData.map(k => suppliedLabels[k] || k).join('、')]); merges.push({ s: { r, c: 1 }, e: { r, c: 6 } }); r++;
      data.push([]); r++;
    }

    // === 案件概要・備考 ===
    if (projectNotes) {
      data.push(['■ 案件概要・備考']); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;
      data.push(['', projectNotes]); merges.push({ s: { r, c: 1 }, e: { r, c: 6 } }); r++;
    }

    // === 算定基準注釈 ===
    data.push([]); r++;
    data.push(['※ 本見積の算定基準: JAC（日本アド・コンテンツ制作協会）TVCM制作費見積書式 / JAGDA（日本グラフィックデザイナー協会）制作料金算定基準に準拠']); merges.push({ s: { r, c: 0 }, e: { r, c: 6 } }); r++;

    // Build worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 4 },   // A: spacer
      { wch: 32 },  // B: 内訳
      { wch: 10 },  // C: 単価
      { wch: 6 },   // D: 人数
      { wch: 6 },   // E: 日数
      { wch: 10 },  // F: 単位/ラベル
      { wch: 14 }   // G: 金額
    ];
    // A4 portrait print settings
    ws['!print'] = { paper: 9, orientation: 'portrait' };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '見積書');
    const fileName = `見積書_${customerInfo.companyName || 'LB'}_${customerInfo.projectName || new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };


  // --- Renders ---
  
  // 1. BACKYARD DASHBOARD (Admin Only)
  if (viewMode === 'dashboard' && isAdmin) {
    const totalSales = projects.filter(p => p.status === 'invoiced' || p.status === 'paid').reduce((acc, p) => acc + p.totalAmount, 0);
    const uncollected = projects.filter(p => p.status === 'invoiced').reduce((acc, p) => acc + p.totalAmount, 0);

    return (
      <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '40px', height: '40px', background: 'var(--brand-red)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Video size={20} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: '24px', margin: 0, fontWeight: 700 }}>LIQUIDBLOCK CRM <span style={{ fontSize: '12px', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '2px 8px', borderRadius: '0', marginLeft: '8px', verticalAlign: 'middle' }}>BACKYARD</span></h1>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>プロジェクト・売上統合管理ダッシュボード</div>
            </div>
          </div>
          <button className="btn-primary" onClick={startNewProject} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> 新規案件を代理入力
          </button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '20px', marginBottom: '40px' }}>
          <div className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>総プロジェクト数</div>
            <div style={{ fontSize: '32px', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-primary)' }}>{projects.length}</div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--brand-red)' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>確定売上 (請求済・入金済)</div>
            <div style={{ fontSize: '32px', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--brand-red)' }}>¥{totalSales.toLocaleString()}</div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--color-danger)' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>未入金残高 (請求済)</div>
            <div style={{ fontSize: '32px', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--color-danger)' }}>¥{uncollected.toLocaleString()}</div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--color-success)' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>入金済</div>
            <div style={{ fontSize: '32px', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--color-success)' }}>¥{projects.filter(p => p.status === 'paid').reduce((a, p) => a + p.totalAmount, 0).toLocaleString()}</div>
          </div>
        </div>

        {/* 月次売上棒グラフ（決算期: 11月〜10月） */}
        {(() => {
          // Fiscal year: Nov(11) - Oct(10). Determine current fiscal year.
          const now = new Date();
          const fiscalYearStart = now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1; // 10=Nov(0-indexed)
          const fiscalMonths = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Nov to Oct
          const monthLabels = ['11月', '12月', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月'];

          // Group by month using invoice date or creation date
          const monthData = fiscalMonths.map((m, idx) => {
            const year = m >= 11 ? fiscalYearStart : fiscalYearStart + 1;
            const monthProjects = projects.filter(p => {
              const dateStr = p.dates?.invoiceDate || p.dates?.deliveryDate || p.createdAt;
              const d = new Date(dateStr);
              return d.getMonth() + 1 === m && d.getFullYear() === year;
            });
            const paid = monthProjects.filter(p => p.status === 'paid').reduce((a, p) => a + p.totalAmount, 0);
            const invoiced = monthProjects.filter(p => p.status === 'invoiced').reduce((a, p) => a + p.totalAmount, 0);
            const inProd = monthProjects.filter(p => ['ordered', 'production', 'delivered'].includes(p.status)).reduce((a, p) => a + p.totalAmount, 0);
            const estimating = monthProjects.filter(p => ['draft', 'estimate'].includes(p.status)).reduce((a, p) => a + p.totalAmount, 0);
            return { month: monthLabels[idx], paid, invoiced, inProd, estimating, total: paid + invoiced + inProd + estimating };
          });
          const maxTotal = Math.max(...monthData.map(d => d.total), 1);

          return (
            <div className="glass-panel" style={{ padding: '24px', marginBottom: '40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--text-primary)' }}>月次売上推移 <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>（第{fiscalYearStart + 1}期: {fiscalYearStart}年11月〜{fiscalYearStart + 1}年10月）</span></h2>
                <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
                  <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--color-success)', marginRight: '4px' }}></span>入金済</span>
                  <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#EF4444', marginRight: '4px' }}></span>請求済</span>
                  <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand-red)', marginRight: '4px' }}></span>制作中</span>
                  <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--border-color)', marginRight: '4px' }}></span>見積中</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '180px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                {monthData.map((d, i) => {
                  const barH = d.total > 0 ? (d.total / maxTotal) * 160 : 0;
                  const paidH = d.total > 0 ? (d.paid / d.total) * barH : 0;
                  const invH = d.total > 0 ? (d.invoiced / d.total) * barH : 0;
                  const prodH = d.total > 0 ? (d.inProd / d.total) * barH : 0;
                  const estH = barH - paidH - invH - prodH;
                  const isCurrentMonth = (() => { const n = new Date(); const cm = n.getMonth() + 1; return fiscalMonths[i] === cm; })();
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      {d.total > 0 && <div style={{ fontSize: '10px', fontFamily: 'Outfit', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>¥{(d.total / 10000).toFixed(0)}万</div>}
                      <div style={{ width: '100%', maxWidth: '48px', display: 'flex', flexDirection: 'column', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                        {estH > 0 && <div style={{ height: `${estH}px`, background: 'var(--border-light)' }}></div>}
                        {prodH > 0 && <div style={{ height: `${prodH}px`, background: 'var(--brand-red)', opacity: 0.6 }}></div>}
                        {invH > 0 && <div style={{ height: `${invH}px`, background: '#EF4444' }}></div>}
                        {paidH > 0 && <div style={{ height: `${paidH}px`, background: 'var(--color-success)' }}></div>}
                      </div>
                      <div style={{ fontSize: '11px', color: isCurrentMonth ? 'var(--neon-cyan)' : 'var(--text-muted)', fontWeight: isCurrentMonth ? 700 : 400, paddingTop: '4px' }}>{d.month}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span>年間合計: <span style={{ color: 'var(--text-primary)', fontFamily: 'Outfit', fontWeight: 600 }}>¥{monthData.reduce((a, d) => a + d.total, 0).toLocaleString()}</span></span>
                <span>確定売上: <span style={{ color: 'var(--brand-red)', fontFamily: 'Outfit', fontWeight: 600 }}>¥{monthData.reduce((a, d) => a + d.paid + d.invoiced, 0).toLocaleString()}</span></span>
              </div>
            </div>
          );
        })()}

        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-section)', color: 'var(--text-muted)', fontSize: '13px' }}>
                <th style={{ padding: '16px 24px', fontWeight: 500 }}>Project ID / 受信日</th>
                <th style={{ padding: '16px 24px', fontWeight: 500 }}>プロジェクト名・発注元</th>
                <th style={{ padding: '16px 24px', fontWeight: 500 }}>見積金額</th>
                <th style={{ padding: '16px 24px', fontWeight: 500 }}>ステータス</th>
                <th style={{ padding: '16px 24px', fontWeight: 500, textAlign: 'right' }}>アクション</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>現在、見積もりの依頼（プロジェクト）はありません。</td></tr>
              ) : projects.map(p => (
                <tr 
                  key={p.id} 
                  style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-section)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={() => { setActiveProject(p); setAnswers(p.answers); setCustomItems(p.customItems || []); setReferenceUrls(p.referenceUrls?.length ? p.referenceUrls : ['']); setOrientationFiles(p.orientationFiles || []); setAiAnalysis(p.aiAnalysis || null); setRemovedAutoItems(new Set(p.removedAutoItems || [])); setItemOverrides(p.itemOverrides || {}); setProjectDates(p.dates || {}); setItemOrder(p.itemOrder || []); setProjectNotes(p.projectNotes || ''); setSuppliedData(p.suppliedData || []); setCustomerInfo(p.customerInfo); setIsFinished(true); setViewMode('detail'); }}
                >
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontFamily: 'Outfit', fontWeight: 600, color: 'var(--text-primary)' }}>{p.id}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{new Date(p.createdAt).toLocaleDateString('ja-JP')}</div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ color: 'var(--brand-red)', fontWeight: 600, marginBottom: '4px' }}>{p.customerInfo.projectName || '（プロジェクト名未定）'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.customerInfo.companyName} / 担当: {p.customerInfo.contactName} 様</div>
                  </td>
                  <td style={{ padding: '16px 24px', fontFamily: 'Outfit', color: 'var(--text-primary)', fontWeight: 600 }}>
                    ¥{p.totalAmount.toLocaleString()}
                  </td>
                  <td style={{ padding: '16px 24px' }} onClick={e => e.stopPropagation()}>
                    <select 
                      value={p.status} 
                      onChange={(e) => changeProjectStatus(p.id, e.target.value as ProjectStatus, e)}
                      style={{ 
                        background: p.status === 'paid' ? 'rgba(16, 185, 129, 0.15)' : p.status === 'invoiced' ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255,255,255,0.05)',
                        color: p.status === 'paid' ? 'var(--neon-green)' : p.status === 'invoiced' ? 'var(--neon-pink)' : '#fff',
                        border: '1px solid var(--border-subtle)', padding: '6px 12px', borderRadius: '0', fontSize: '13px', outline: 'none', cursor: 'pointer'
                      }}
                    >
                      {Object.entries(statusLabels).map(([key, label]) => (
                        <option key={key} value={key} style={{ background: '#fff', color: 'var(--text-primary)' }}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                    <button onClick={(e) => deleteProject(p.id, e)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Trash2 size={18} /></button>
                    <ChevronRight size={20} color="var(--text-muted)" style={{ verticalAlign: 'middle', marginLeft: '12px' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* === 会社データベース管理 === */}
        <div className="glass-panel" style={{ padding: '24px', marginTop: '24px' }}>
          <h2 style={{ fontSize: '16px', margin: '0 0 16px 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building size={18} /> 会社データベース管理
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '8px' }}>
              組込み: {companyDatabase.length}社 ／ カスタム追加: {getCustomCompanies().length}社
            </span>
          </h2>

          {/* 新規登録フォーム */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>会社名</label>
              <input id="admin-company-name" type="text" placeholder="株式会社○○" style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-section)', border: '1px solid var(--border-color)', borderRadius: '2px', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 1, minWidth: '140px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>業種</label>
              <select id="admin-company-type" defaultValue="end_client" style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-section)', border: '1px solid var(--border-color)', borderRadius: '2px', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
                <option value="end_client">一般企業</option>
                <option value="agency">広告代理店/デザイン</option>
                <option value="production">映像制作会社</option>
                <option value="cg_production">CG制作会社</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '120px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>サブカテゴリ</label>
              <input id="admin-company-sub" type="text" placeholder="例: メーカー" style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-section)', border: '1px solid var(--border-color)', borderRadius: '2px', color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <button
              className="btn-primary"
              style={{ padding: '8px 20px', whiteSpace: 'nowrap', height: '38px' }}
              onClick={() => {
                const nameEl = document.getElementById('admin-company-name') as HTMLInputElement;
                const typeEl = document.getElementById('admin-company-type') as HTMLSelectElement;
                const subEl = document.getElementById('admin-company-sub') as HTMLInputElement;
                if (!nameEl?.value.trim()) return;
                addCustomCompany({
                  name: nameEl.value.trim(),
                  type: typeEl.value as 'agency' | 'production' | 'cg_production' | 'end_client',
                  sub: subEl.value.trim() || undefined,
                });
                nameEl.value = '';
                subEl.value = '';
                // Force re-render
                setProjects([...projects]);
              }}
            ><Plus size={14} /> 登録</button>
          </div>

          {/* カスタム追加済みリスト */}
          {getCustomCompanies().length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>カスタム追加済み企業一覧</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {getCustomCompanies().map((c, i) => {
                  const typeLabel = c.type === 'agency' ? '代理店' : c.type === 'production' ? '制作' : c.type === 'cg_production' ? 'CG' : '一般';
                  const typeColor = c.type === 'agency' ? '#3B82F6' : c.type === 'production' ? '#10B981' : c.type === 'cg_production' ? '#8B5CF6' : '#F59E0B';
                  return (
                    <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', borderRadius: '2px', fontSize: '12px' }}>
                      <span style={{ color: typeColor, fontWeight: 600 }}>[{typeLabel}]</span>
                      <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                      {c.sub && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({c.sub})</span>}
                      <button onClick={() => { removeCustomCompany(c.name); setProjects([...projects]); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '14px', lineHeight: 1 }}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. SHARED WIZARD & DETAIL COMPUTATIONS
  const rawEst = calculateEstimate(answers, customItems, cgPartialItems);
  const scaledEst = (projectDates.startDate && projectDates.deliveryDate) 
    ? scaleToBusinessDays(rawEst, projectDates.startDate, projectDates.deliveryDate) 
    : rawEst;
  const est = applyAdminEdits(scaledEst, removedAutoItems, itemOverrides, itemOrder);
  const visibleQuestions = questions.filter(q => !q.condition || q.condition(answers));
  const currentQuestion = questions[currentStep];

  const docType = isAdmin && activeProject ? activeProject.currentDocType : 'estimate';
  const getDocTitles = () => {
    switch (docType) {
      case 'estimate': return { en: 'Estimate', ja: '御見積書', text: '下記の通り、映像制作のお見積りを申し上げます。' };
      case 'order': return { en: 'Purchase Order', ja: '発注請書', text: '下記の通り、映像制作の発注を承りました。誠にありがとうございます。' };
      case 'delivery': return { en: 'Delivery Note', ja: '納品書', text: '下記の通り、映像制作物を納品いたします。ご確認のほどよろしくお願い申し上げます。' };
      case 'invoice': return { en: 'Invoice', ja: 'ご請求書', text: '下記の通り、ご請求申し上げます。期日までのお振込をよろしくお願い申し上げます。' };
    }
  };
  const docInfo = getDocTitles();

  const renderPhaseTable = (phase: LineItem['phase'], title: string, colorVar: string, description?: string) => {
    const phaseItems = est.items.filter(i => i.phase === phase);
    if (phaseItems.length === 0) return null;
    const phaseTotal = phaseItems.reduce((acc, i) => acc + i.amount, 0);

    // 表示モード判定: 一般企業・代理店はsummary、制作会社はdetailed、Adminは常にdetailed
    // ただし、特急料金（Express）は「特別対応オプション」の内訳として別に詳細表示させる
    const isSummaryMode = !isAdmin && (answers['client_type'] === 'end_client' || answers['client_type'] === 'agency') && phase !== 'Express';

    if (isSummaryMode) {
      // 集約モード: カテゴリ名と合計金額のみ
      return (
        <div className="print-section" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', borderRadius: '2px' }}>
            <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
            <span style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>¥{phaseTotal.toLocaleString()} <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>(税込 ¥{Math.round(phaseTotal * 1.1).toLocaleString()})</span></span>
          </div>
        </div>
      );
    }

    return (
      <div className="print-section" style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: description ? '4px' : '16px', display: 'flex', justifyContent: 'space-between' }}>
          <span>{title}</span>
          <span style={{ fontFamily: 'Outfit' }}><span style={{ color: 'var(--brand-red)', fontWeight: 600 }}>¥{phaseTotal.toLocaleString()}</span> <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(税込 ¥{Math.round(phaseTotal * 1.1).toLocaleString()})</span></span>
        </h3>
        {description && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0', lineHeight: 1.5 }}>{description}</p>}
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'var(--bg-section)', borderRadius: '2px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', color: '#333', fontSize: '13px', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '12px 20px', fontWeight: 500 }}>内訳 (Description)</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, width: '12%' }}>単価</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, width: '10%', textAlign: 'center' }}>人数</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, width: '10%', textAlign: 'center' }}>日数</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, width: '10%', textAlign: 'center' }}>単位</th>
              <th style={{ padding: '12px 20px', fontWeight: 500, textAlign: 'right', width: '13%' }}>金額</th>
              <th style={{ padding: '12px 10px', fontWeight: 500, textAlign: 'right', width: '10%', fontSize: '11px' }}>税込(10%)</th>
              {!isAdmin && <th style={{ width: '5%', padding: '12px 8px', textAlign: 'center', fontSize: '11px' }}>不要</th>}
              {isAdmin && <th style={{ width: '4%', padding: '12px 8px', textAlign: 'center', fontSize: '11px' }}>↕</th>}
              {isAdmin && <th style={{ width: '4%', padding: '12px 20px' }}></th>}
            </tr>
          </thead>
          <tbody>
            {phaseItems.map((item, idx) => {
              const isEditable = isAdmin && !item.name.includes('間接費') && !item.name.includes('予備費') && !item.name.includes('割引');
              const canEditQty = !item.name.includes('間接費') && !item.name.includes('予備費') && !item.name.includes('割引') && !item.isEstimateOnly;
              return (
              <tr key={item.id || idx} style={{ borderTop: idx > 0 ? '1px solid #e5e5e5' : 'none', fontSize: '14px', background: item.isCustom ? 'rgba(208, 2, 27, 0.03)' : 'transparent' }}>
                <td style={{ padding: '12px 20px', color: item.isCustom ? 'var(--brand-red)' : (item.name.includes('予備費') ? '#888' : 'var(--text-primary)') }}>
                  {item.name}
                  {item.isCustom && <span style={{ fontSize: '10px', background: 'var(--brand-red)', color: '#fff', padding: '2px 6px', borderRadius: '0', marginLeft: '8px' }}>追加項目</span>}
                  {item.name.includes('予備費') && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>仕様変更等に対する準備金</div>}
                  {item.isEstimateOnly && <div style={{ fontSize: '12px', color: 'var(--brand-red)', marginTop: '4px' }}>※別途お見積りとなります。</div>}
                </td>
                <td style={{ padding: '12px 20px', fontFamily: 'Outfit', color: 'var(--text-muted)' }}>
                  {isEditable ? (
                    <input type="number" value={item.unitPrice} onChange={e => {
                      const v = parseInt(e.target.value) || 0;
                      setItemOverrides(prev => ({ ...prev, [item.name]: { ...prev[item.name], unitPrice: v } }));
                    }} style={{ width: '80px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '4px 6px', fontFamily: 'Outfit', fontSize: '13px', textAlign: 'right' }} />
                  ) : (item.isEstimateOnly ? '-' : Math.abs(item.unitPrice).toLocaleString())}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                  {canEditQty && item.persons ? (
                    <input type="number" value={item.persons} min={1} onChange={e => {
                      const v = parseInt(e.target.value) || 1;
                      setItemOverrides(prev => ({ ...prev, [item.name]: { ...prev[item.name], persons: v } }));
                    }} style={{ width: '50px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '4px 6px', fontFamily: 'Outfit', fontSize: '13px', textAlign: 'center' }} />
                  ) : (item.persons ? `${item.persons}名` : '-')}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                  {canEditQty && item.days ? (
                    <input type="number" value={item.days} min={1} onChange={e => {
                      const v = parseInt(e.target.value) || 1;
                      setItemOverrides(prev => ({ ...prev, [item.name]: { ...prev[item.name], days: v } }));
                    }} style={{ width: '50px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '4px 6px', fontFamily: 'Outfit', fontSize: '13px', textAlign: 'center' }} />
                  ) : (item.days ? `${item.days}日` : '-')}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {isEditable ? (
                    <select value={itemOverrides[item.name]?.unit || item.unit} onChange={e => {
                      setItemOverrides(prev => ({ ...prev, [item.name]: { ...prev[item.name], unit: e.target.value } }));
                    }} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '4px 6px', fontSize: '12px', outline: 'none' }}>
                      <option value="人日">人日</option>
                      <option value="日">日</option>
                      <option value="式">式</option>
                      <option value="人回">人回</option>
                      <option value="月">月</option>
                      <option value="個">個</option>
                      <option value="時間">時間</option>
                      <option value="別途見積もり">別途見積もり</option>
                    </select>
                  ) : item.unit}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right', fontFamily: 'Outfit', fontWeight: 600, color: item.amount < 0 ? '#16a34a' : (item.name.includes('予備費') ? '#888' : 'var(--text-primary)') }}>
                  {item.isEstimateOnly ? '別途見積り' : (item.amount < 0 ? '-' : '') + '¥' + Math.abs(item.amount).toLocaleString()}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: 'Outfit', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {item.isEstimateOnly ? '-' : '¥' + Math.round(Math.abs(item.amount) * 1.1).toLocaleString()}
                </td>
                {!isAdmin && (
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    {!item.name.includes('間接費') && !item.name.includes('予備費') && !item.name.includes('割引') ? (
                      <button onClick={() => setRemovedAutoItems(prev => { const n = new Set(prev); if (n.has(item.name)) { n.delete(item.name); } else { n.add(item.name); } return n; })} 
                        style={{ background: removedAutoItems.has(item.name) ? 'rgba(236, 72, 153, 0.15)' : 'none', border: '1px solid var(--border-subtle)', color: removedAutoItems.has(item.name) ? 'var(--neon-pink)' : 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', borderRadius: '0', fontSize: '11px' }} title="この項目は不要">
                        {removedAutoItems.has(item.name) ? '不要' : '-'}
                      </button>
                    ) : null}
                  </td>
                )}
                {isAdmin && (
                  <td style={{ padding: '4px 2px', textAlign: 'center', cursor: 'grab' }}
                    draggable
                    onDragStart={() => { dragItemRef.current = est.items.indexOf(item); }}
                    onDragEnter={() => { dragOverRef.current = est.items.indexOf(item); }}
                    onDragEnd={() => {
                      if (dragItemRef.current !== null && dragOverRef.current !== null && dragItemRef.current !== dragOverRef.current) {
                        const allNames = est.items.map(i => i.name);
                        const newOrder = [...allNames];
                        const [moved] = newOrder.splice(dragItemRef.current, 1);
                        newOrder.splice(dragOverRef.current, 0, moved);
                        setItemOrder(newOrder);
                      }
                      dragItemRef.current = null; dragOverRef.current = null;
                    }}
                    onDragOver={e => e.preventDefault()}
                  >
                    <GripVertical size={14} style={{ color: 'var(--text-muted)' }} />
                  </td>
                )}
                {isAdmin && (
                  <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                    {item.isCustom ? (
                      <button onClick={() => handleRemoveCustomItem(item.id!)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '4px' }} title="この項目を削除">
                        <Trash2 size={16} />
                      </button>
                    ) : !item.name.includes('間接費') && !item.name.includes('予備費') && !item.name.includes('割引') ? (
                      <button onClick={() => setRemovedAutoItems(prev => { const n = new Set(prev); n.add(item.name); return n; })} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', opacity: 0.5 }} title="この項目を除外">
                        <X size={16} />
                      </button>
                    ) : null}
                  </td>
                )}
              </tr>
            );})}
            {/* Phase Total Row */}
            {(() => {
              const totalDays = phaseItems.reduce((sum, i) => sum + (i.days || 0), 0);
              const totalAmount = phaseItems.reduce((sum, i) => sum + Math.abs(i.amount), 0);
              const totalTax = Math.round(totalAmount * 1.1);
              return (
                <tr style={{ borderTop: '2px solid var(--border-subtle)', background: 'var(--bg-section)' }}>
                  <td style={{ padding: '10px 20px', fontWeight: 600, fontSize: '13px', color: 'var(--brand-red)' }}>小計</td>
                  <td style={{ padding: '10px 20px' }}></td>
                  <td style={{ padding: '10px 20px' }}></td>
                  <td style={{ padding: '10px 20px', textAlign: 'center', fontFamily: 'Outfit', fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>{totalDays > 0 ? `${totalDays}日` : '-'}</td>
                  <td style={{ padding: '10px 20px' }}></td>
                  <td style={{ padding: '10px 20px', textAlign: 'right', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>¥{totalAmount.toLocaleString()}</td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'Outfit', fontSize: '12px', color: 'var(--text-muted)' }}>¥{totalTax.toLocaleString()}</td>
                  {!isAdmin && <td></td>}
                  {isAdmin && <td></td>}
                  {isAdmin && <td></td>}
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ width: '100vw', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '0 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, background: 'var(--brand-red)', height: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: isAdmin ? 'pointer' : 'default' }} onClick={() => { if (isAdmin) setViewMode('dashboard'); }}>
          <h2 style={{ fontSize: '15px', margin: 0, fontWeight: 700, letterSpacing: '2px', color: '#fff', textTransform: 'uppercase' }}>LIQUIDBLOCK <span style={{ fontWeight: 400, fontSize: '13px', letterSpacing: '1px', opacity: 0.85 }}>Estimator</span></h2>
          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.5px', marginLeft: '0px', display: 'block', marginTop: '1px' }}>JAC TVCM制作費見積書式 / JAGDA制作料金算定基準 準拠</span>
          {isAdmin && <span style={{ fontSize: '11px', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', padding: '2px 8px', borderRadius: '0', marginLeft: '8px' }}>ADMIN</span>}
        </div>
        
        {viewMode === 'wizard' && !isFinished && !showConfirmScreen && !showCustomerInput && !showCompanyVerification && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {visibleQuestions.map((q, idx) => {
              const isActiveOrPast = visibleQuestions.findIndex(vq => vq.id === currentQuestion.id) >= idx;
              return <div key={q.id} style={{ width: '32px', height: '4px', borderRadius: '2px', background: isActiveOrPast ? '#fff' : 'rgba(255,255,255,0.3)', transition: 'background 0.3s ease' }} />
            })}
          </div>
        )}
        
        {viewMode === 'detail' && isAdmin && (
          <button onClick={() => setViewMode('dashboard')} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}><LayoutDashboard size={16} /> ダッシュボードへ戻る</button>
        )}
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', overflowY: 'auto' }}>
        <AnimatePresence mode="wait">
          {/* === 会社情報入力 & 業種選択（ウィザード前） === */}
          {viewMode === 'wizard' && showCompanyVerification ? (
            <motion.div key="company-verify" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }} style={{ width: '100%', maxWidth: '640px', paddingBottom: '100px' }}>
              <div style={{ marginBottom: '40px', textAlign: 'center' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(208, 2, 27, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}><Building size={28} color="var(--brand-red)" /></div>
                <h1 style={{ fontSize: '32px', margin: '0 0 8px 0', lineHeight: 1.3 }}>貴社情報のご入力</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0, lineHeight: 1.6 }}>見積書に記載する貴社情報と業種をご入力ください。<br/>法人番号システムによる照合は準備中です。</p>
              </div>

              <div style={{ background: 'var(--bg-section)', borderRadius: '2px', padding: '32px', border: '1px solid var(--border-subtle)', marginBottom: '24px' }}>
                <div style={{ marginBottom: '20px', position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 }}>貴社名 <span style={{ color: 'var(--brand-red)' }}>*</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
                    <Building size={18} color="var(--text-muted)" />
                    <input type="text" value={customerInfo.companyName}
                      onChange={e => {
                        const v = e.target.value;
                        setCustomerInfo({...customerInfo, companyName: v});
                        setAiClassification(null);
                        const hits = searchCompany(v);
                        setCompanySuggestions(hits);
                        setShowSuggestions(hits.length > 0 && v.length >= 2);
                        if (hits.length === 0) {
                          setCompanyMatchInfo(null);
                        }
                      }}
                      onFocus={() => { if (companySuggestions.length > 0) setShowSuggestions(true); }}
                      onBlur={async () => {
                        setTimeout(() => setShowSuggestions(false), 200);
                        // DBにヒットせず、3文字以上の会社名が入力された場合、AI分類を実行
                        const name = customerInfo.companyName.trim();
                        if (!companyMatchInfo && name.length >= 3) {
                          const dbHits = searchCompany(name);
                          const exactMatch = dbHits.find(h => h.name === name);
                          if (!exactMatch) {
                            setIsClassifying(true);
                            try {
                              const result = await classifyCompanyViaAPI(name, API_BASE);
                              if (result) {
                                setAiClassification(result);
                                setSelectedClientType(result.type);
                              } else {
                                // API不可の場合はend_clientにフォールバック
                                setSelectedClientType('end_client');
                              }
                            } catch {
                              setSelectedClientType('end_client');
                            } finally {
                              setIsClassifying(false);
                            }
                          }
                        }
                      }}
                      placeholder="会社名を入力すると候補が表示されます"
                      style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '16px', fontFamily: 'inherit' }} />
                  </div>
                  {/* オートコンプリートドロップダウン */}
                  {showSuggestions && companySuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg-section)', border: '1px solid var(--border-color)', borderRadius: '0 0 2px 2px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', maxHeight: '240px', overflowY: 'auto' }}>
                      {companySuggestions.map((c, idx) => {
                        const typeLabel = c.sub || (c.type === 'agency' ? '広告代理店' : c.type === 'production' ? '映像制作会社' : c.type === 'cg_production' ? 'CG制作会社' : '一般企業');
                        const typeColor = c.type === 'agency' ? '#3B82F6' : c.type === 'production' ? '#10B981' : c.type === 'cg_production' ? '#8B5CF6' : '#F59E0B';
                        return (
                          <div key={idx}
                            onMouseDown={() => {
                              setCustomerInfo({...customerInfo, companyName: c.name});
                              setSelectedClientType(c.type);
                              setCompanyMatchInfo(c);
                              setAiClassification(null);
                              setShowSuggestions(false);
                              setCompanySuggestions([]);
                            }}
                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(208,2,27,0.04)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{c.name}</span>
                            <span style={{ fontSize: '11px', color: typeColor, background: `${typeColor}11`, padding: '2px 8px', borderRadius: '2px', fontWeight: 500 }}>{typeLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* マッチ結果表示 - DBヒット */}
                  {companyMatchInfo && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle size={14} color="#10B981" />
                      <span style={{ fontSize: '12px', color: '#10B981' }}>データベースで照合済み: {companyMatchInfo.sub || (companyMatchInfo.type === 'agency' ? '広告代理店' : companyMatchInfo.type === 'production' ? '映像制作会社' : companyMatchInfo.type === 'cg_production' ? 'CG制作会社' : '一般企業')}として自動判定されました</span>
                    </div>
                  )}
                  {/* AI分類中ローディング */}
                  {isClassifying && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(139, 92, 246, 0.06)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Wand2 size={14} color="#8B5CF6" style={{ animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: '12px', color: '#8B5CF6' }}>🤖 AI が業種を判定中...</span>
                    </div>
                  )}
                  {/* AI分類結果表示 */}
                  {!companyMatchInfo && !isClassifying && aiClassification && (
                    <div style={{ marginTop: '8px', padding: '10px 12px', background: aiClassification.confidence >= 0.7 ? 'rgba(139, 92, 246, 0.06)' : 'rgba(245, 158, 11, 0.06)', border: `1px solid ${aiClassification.confidence >= 0.7 ? 'rgba(139, 92, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`, borderRadius: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <Wand2 size={14} color={aiClassification.confidence >= 0.7 ? '#8B5CF6' : '#F59E0B'} />
                        <span style={{ fontSize: '12px', color: aiClassification.confidence >= 0.7 ? '#8B5CF6' : '#F59E0B', fontWeight: 600 }}>
                          🤖 AI判定: {aiClassification.type === 'agency' ? '広告代理店' : aiClassification.type === 'production' ? '映像制作会社' : aiClassification.type === 'cg_production' ? 'CG制作会社' : '一般企業'}
                          {aiClassification.sub ? ` (${aiClassification.sub})` : ''}
                          （確信度: {Math.round(aiClassification.confidence * 100)}%）
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '22px' }}>
                        {aiClassification.reason}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 }}>ご担当者名 <span style={{ color: 'var(--brand-red)' }}>*</span></label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
                      <User size={18} color="var(--text-muted)" />
                      <input type="text" value={customerInfo.contactName} onChange={e => setCustomerInfo({...customerInfo, contactName: e.target.value})} placeholder="山田 太郎" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '15px', fontFamily: 'inherit' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 }}>電話番号</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
                      <Phone size={18} color="var(--text-muted)" />
                      <input type="text" value={customerInfo.phone} onChange={e => setCustomerInfo({...customerInfo, phone: e.target.value})} placeholder="03-0000-0000" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '15px', fontFamily: 'inherit' }} />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 }}>住所 <span style={{ color: 'var(--brand-red)' }}>*</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
                    <TreePine size={18} color="var(--text-muted)" />
                    <input type="text" value={customerInfo.address} onChange={e => setCustomerInfo({...customerInfo, address: e.target.value})} placeholder="東京都渋谷区○○ 1-2-3 ○○ビル5F" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '15px', fontFamily: 'inherit' }} />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 }}>メールアドレス <span style={{ color: 'var(--brand-red)' }}>*</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
                    <Mail size={18} color="var(--text-muted)" />
                    <input type="text" value={customerInfo.email} onChange={e => setCustomerInfo({...customerInfo, email: e.target.value})} placeholder="info@example.com" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '15px', fontFamily: 'inherit' }} />
                  </div>
                </div>
              </div>

              {/* 業種選択 または 問い合わせ誘導 */}
              {(!companyMatchInfo && customerInfo.companyName.trim().length >= 2) ? (
                <div style={{ textAlign: 'center', marginTop: '32px', marginBottom: '24px' }}>
                  <div style={{ background: 'rgba(208, 2, 27, 0.04)', border: '1px solid rgba(208, 2, 27, 0.15)', borderRadius: '2px', padding: '24px', marginBottom: '24px' }}>
                    <p style={{ margin: '0 0 12px 0', color: 'var(--brand-red)', fontWeight: 600, fontSize: '15px' }}>システム未登録</p>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>現在、こちらの会社は自動見積もりシステムに登録されていません。<br/>恐れ入りますが、以下のボタンより直接お問い合わせをお願いいたします。</p>
                  </div>
                  <a
                    href={`mailto:info@liquid-block.com?subject=${encodeURIComponent('[LiquidBlock] 映像制作のお見積り・お問い合わせ')}&body=${encodeURIComponent(`以下のお客様よりお見積りのご依頼がありました。\n\n貴社名: ${customerInfo.companyName}\nご担当者名: ${customerInfo.contactName}\n電話番号: ${customerInfo.phone}\n住所: ${customerInfo.address}\nメールアドレス: ${customerInfo.email}\n\n---\nお見積りのご要望、ご相談内容をこちらにご記載ください:\n\n`)}`}
                    className="btn-primary"
                    style={{
                      padding: '14px 48px', fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none'
                    }}
                  >
                    メールで問い合わせる <Mail size={18} />
                  </a>
                </div>
              ) : (
                <>
                  <div style={{ background: 'var(--bg-section)', borderRadius: '2px', padding: '24px 32px', border: '1px solid var(--border-subtle)', marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', color: 'var(--text-primary)', marginBottom: '16px', fontWeight: 600 }}>貴社の業種をお選びください <span style={{ color: 'var(--brand-red)' }}>*</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {[
                    { id: 'end_client', label: '一般企業 (直取引)', icon: UserCircle, desc: '自社サービス・製品の映像制作' },
                    { id: 'agency', label: '広告代理店', icon: Briefcase, desc: '企画・プロデュース' },
                    { id: 'production', label: '映像制作会社', icon: Film, desc: 'CG・VFX等の外注依頼' },
                    { id: 'cg_production', label: 'CG制作会社', icon: Box, desc: '協業・外注依頼' },
                  ].map(opt => {
                    const Icon = opt.icon;
                    const isSelected = selectedClientType === opt.id;
                    return (
                      <div key={opt.id} onClick={() => { if (!companyMatchInfo) setSelectedClientType(opt.id); }} style={{
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
                        background: isSelected ? 'rgba(208, 2, 27, 0.06)' : 'transparent',
                        border: isSelected ? '2px solid var(--brand-red)' : '1px solid var(--border-color)',
                        borderRadius: '2px', cursor: companyMatchInfo ? (isSelected ? 'default' : 'not-allowed') : 'pointer', transition: 'all 0.2s ease',
                        opacity: companyMatchInfo && !isSelected ? 0.3 : 1
                      }}>
                        <Icon size={20} color={isSelected ? 'var(--brand-red)' : 'var(--text-muted)'} />
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--brand-red)' : 'var(--text-primary)' }}>{opt.label}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 照合ステータス通知 */}
              {companyMatchInfo ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '2px', padding: '12px 16px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <CheckCircle size={16} color="#10B981" />
                  <span style={{ fontSize: '12px', color: '#10B981', lineHeight: 1.5 }}>業界データベースで「{companyMatchInfo.name}」が見つかりました。業種が自動判定されています。</span>
                </div>
              ) : (
                <div style={{ background: 'rgba(59, 130, 246, 0.04)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '2px', padding: '12px 16px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ShieldAlert size={16} color="rgba(59, 130, 246, 0.7)" />
                  <span style={{ fontSize: '12px', color: 'rgba(59, 130, 246, 0.8)', lineHeight: 1.5 }}>広告代理店・映像制作会社・CG制作会社のデータベースと照合します。未登録の場合は自動見積をご利用いただけません。</span>
                </div>
              )}

              {/* 進行ボタン */}
              <div style={{ textAlign: 'center' }}>
                {(!customerInfo.companyName.trim() || !customerInfo.contactName.trim() || !customerInfo.address.trim() || !customerInfo.email.trim() || !selectedClientType) && (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>貴社名・ご担当者名・住所・メールアドレス・業種は必須項目です</p>
                )}
                <button
                  className="btn-primary"
                  disabled={!customerInfo.companyName.trim() || !customerInfo.contactName.trim() || !customerInfo.address.trim() || !customerInfo.email.trim() || !selectedClientType}
                  onClick={() => {
                    const initialAnswers = { client_type: selectedClientType };
                    setAnswers(initialAnswers);
                    setShowCompanyVerification(false);
                    // 業種選択済みの状態から最初のSTEP（categoryなど）を特定してスキップする
                    const firstVisible = questions.filter(q => !q.condition || q.condition(initialAnswers))[0];
                    setCurrentStep(questions.findIndex(q => q.id === firstVisible.id));
                    setWorkflowAgreed(false);
                  }}
                  style={{
                    padding: '14px 48px', fontSize: '16px',
                    opacity: (!customerInfo.companyName.trim() || !customerInfo.contactName.trim() || !customerInfo.address.trim() || !customerInfo.email.trim() || !selectedClientType) ? 0.4 : 1,
                    cursor: (!customerInfo.companyName.trim() || !customerInfo.contactName.trim() || !customerInfo.address.trim() || !customerInfo.email.trim() || !selectedClientType) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                  }}
                >見積を開始する <ArrowRight size={18} /></button>
                  </div>
                </>
              )}
            </motion.div>
          ) : viewMode === 'wizard' && !isFinished && !showConfirmScreen && !showCustomerInput ? (
            // --- Wizard ---
            <motion.div key={currentStep} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }} style={{ width: '100%', maxWidth: '800px', paddingBottom: '100px' }}>
              <div style={{ marginBottom: '40px', textAlign: 'center' }}>
                <p style={{ color: 'var(--brand-red)', fontWeight: 600, letterSpacing: '2px', marginBottom: '16px', fontSize: '14px' }}>STEP {String(visibleQuestions.findIndex(q => q.id === currentQuestion.id) + 1).padStart(2, '0')}</p>
                <h1 style={{ fontSize: '38px', margin: 0, lineHeight: 1.3 }}>{currentQuestion.title}</h1>
              </div>
              <div className="grid-2" style={{ position: 'relative' }}>
                {(() => {
                  const isIndustry = currentQuestion.id === 'client_type';
                  const isCategory = currentQuestion.id === 'category';
                  const isCgType = currentQuestion.id === 'cg_type';
                  const isCgNeeded = currentQuestion.id === 'cg_needed';
                  const isDeadline = currentQuestion.id === 'cg_deadline';
                  
                  // Cross-column preview logic (category only)
                  const hoveredIdx = isCategory ? currentQuestion.options.findIndex(o => o.id === hoveredCategoryId) : -1;
                  const hoveredIsLeft = hoveredIdx >= 0 && hoveredIdx % 2 === 0;
                  const hoveredIsRight = hoveredIdx >= 0 && hoveredIdx % 2 === 1;
                  const hoveredPreviewImgs = (isCategory && hoveredCategoryId) ? portfolioPreviewImages[hoveredCategoryId] : null;
                  const hoveredLabel = hoveredIdx >= 0 ? currentQuestion.options[hoveredIdx]?.label : '';

                  return (
                    <>
                      {currentQuestion.options.map((option, optIdx) => {
                        const Icon = option.icon;
                        const isSelected = answers[currentQuestion.id] === option.id;
                        const isLeft = optIdx % 2 === 0;
                        const isCovered = isCategory && ((isLeft && hoveredIsRight) || (!isLeft && hoveredIsLeft));
                        const industryBg = isIndustry ? industryBackgroundImages[option.id] : null;
                        const cgTypeBg = isCgType ? cgTypeBackgroundImages[option.id] : null;
                        const cgNeededBg = isCgNeeded ? cgNeededBackgroundImages[option.id] : null;
                        const mediaBg = currentQuestion.id === 'media' ? mediaBackgroundImages[option.id] : null;
                        const cardBg = industryBg || cgTypeBg || cgNeededBg || mediaBg;
                        const deadlineInfo = isDeadline ? deadlineExplanations[option.id] : null;

                        return (
                          <div 
                            key={option.id} 
                            className={`selection-card ${isSelected ? 'selected' : ''}`} 
                            onClick={() => handleSelectAnswer(currentQuestion.id, option.id)}
                            onMouseEnter={() => isCategory && setHoveredCategoryId(option.id)}
                            onMouseLeave={() => isCategory && setHoveredCategoryId(null)}
                            style={{ 
                              position: 'relative', overflow: 'hidden',
                              opacity: isCovered ? 0 : 1,
                              pointerEvents: isCovered ? 'none' : 'auto',
                              transition: 'opacity 0.3s ease',
                              minHeight: cardBg ? '120px' : undefined,
                            }}
                          >
                            {/* Background image (STEP 01 industry + STEP 03 cg_type) */}
                            {cardBg && (
                              <>
                                <div style={{
                                  position: 'absolute', inset: 0, zIndex: 0,
                                  backgroundImage: `url(${cardBg})`,
                                  backgroundSize: 'cover', backgroundPosition: 'center',
                                  opacity: 0.15,
                                  transition: 'opacity 0.4s ease',
                                }} className="card-bg-img" />
                              </>
                            )}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', position: 'relative', zIndex: 2 }}>
                              <div className="card-icon" style={{ padding: '12px', borderRadius: '2px', background: isSelected ? 'rgba(208, 2, 27, 0.08)' : 'var(--bg-section)', color: isSelected ? 'var(--brand-red)' : 'var(--text-muted)', transition: 'all 0.3s ease' }}><Icon size={24} /></div>
                              <div style={{ flex: 1 }}>
                                <h3 className="card-title" style={{ fontSize: '18px', margin: '0 0 4px 0', color: isSelected ? 'var(--brand-red)' : 'var(--text-primary)', transition: 'color 0.3s ease' }}>{option.label}</h3>
                                <p className="card-desc" style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5, transition: 'color 0.3s ease' }}>{option.desc}</p>
                              </div>
                              {/* Info button for deadline cards */}
                              {deadlineInfo && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeadlinePopupId(deadlinePopupId === option.id ? null : option.id); }}
                                  style={{
                                    background: 'none', border: '1px solid var(--border-color)', borderRadius: '50%',
                                    width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700,
                                    flexShrink: 0, transition: 'all 0.2s ease',
                                  }}
                                  onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--brand-red)'; (e.target as HTMLElement).style.color = 'var(--brand-red)'; }}
                                  onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border-color)'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
                                  title="詳しく見る"
                                >?</button>
                              )}
                            </div>
                            {/* Deadline popup tooltip */}
                            {deadlineInfo && deadlinePopupId === option.id && (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
                                background: '#fff', border: '1px solid var(--border-color)',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: '20px 24px',
                                animation: 'fadeIn 0.25s ease',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                  <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--brand-red)', fontWeight: 700 }}>{deadlineInfo.title}</h4>
                                  <button onClick={(e) => { e.stopPropagation(); setDeadlinePopupId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
                                </div>
                                <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                  {deadlineInfo.details.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                              </div>
                            )}
                            {isSelected && <div style={{ position: 'absolute', top: '24px', right: '24px', color: 'var(--brand-red)', zIndex: 2 }}><CheckCircle2 size={20} /></div>}
                          </div>
                        );
                      })}

                      {/* Full-column preview overlay (STEP 02 category only) */}
                      {isCategory && hoveredCategoryId && hoveredPreviewImgs && hoveredIdx >= 0 && (
                        <div 
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            [hoveredIsLeft ? 'right' : 'left']: 0,
                            width: 'calc(50% - 8px)',
                            background: 'rgba(15,15,15,0.50)',
                            borderRadius: '2px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            padding: '28px 24px',
                            gap: '16px',
                            zIndex: 20,
                            animation: 'fadeIn 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                            pointerEvents: 'none',
                          }}
                        >
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '3px', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase' }}>
                            Portfolio — {hoveredLabel}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {hoveredPreviewImgs.slice(0, 3).map((img, i) => (
                              <div key={i} style={{ animation: `fadeInUp 0.4s ${0.1 + i * 0.1}s cubic-bezier(0.25, 0.46, 0.45, 0.94) both` }}>
                                <img 
                                  src={img.src.replace('w_280,h_166', 'w_480,h_270')} 
                                  alt={img.title} 
                                  style={{ 
                                    width: '100%', height: 'auto', maxHeight: '140px', objectFit: 'cover', 
                                    borderRadius: '2px', display: 'block',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                  }} 
                                />
                                <div style={{ 
                                  fontSize: '11px', color: 'rgba(255,255,255,0.75)', 
                                  marginTop: '6px', 
                                  fontWeight: 500,
                                  letterSpacing: '0.5px',
                                  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                                }}>{img.title}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              {/* 部分発注時のCG工程チェックボックス */}
              {currentQuestion.id === 'cg_type' && answers['cg_type'] === 'partial' && (
                <div style={{ marginTop: '32px', padding: '24px', background: 'var(--bg-section)', borderRadius: '2px', border: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ fontSize: '16px', color: 'var(--text-primary)', margin: '0 0 4px 0' }}>発注する工程を選択してください</h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>必要な工程にチェックを入れてください（複数選択可）。¥50,000/日 × 基本日数で計算されます。</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { key: '2d_anim', label: '2Dアニメーション (AE)', days: 10 },
                      { key: '2d_asset', label: '2Dアセットデザイン (AE)', days: 5 },
                      { key: '2d_graphic', label: '2Dグラフィック素材 (Ai/Ps)', days: 5 },
                      { key: '2d_fx', label: '2Dエフェクト (AE)', days: 5 },
                      { key: '3d_model', label: '3Dモデリング (C4D/Blender)', days: 10 },
                      { key: '3d_chara', label: '3Dキャラクターモデリング', days: 12 },
                      { key: '3d_bg', label: '3D背景モデリング', days: 8 },
                      { key: '3d_rig', label: '3Dリギング', days: 5 },
                      { key: '3d_anim', label: '3Dアニメーション (C4D/Blender)', days: 8 },
                      { key: '3d_fx', label: '3Dエフェクト (C4D/Blender)', days: 5 },
                      { key: 'comp', label: 'コンポジット (AE)', days: 5 },
                      { key: 'ai_chara', label: 'AIキャラクター制作', days: 2, unit: '点', price: 50000 },
                      { key: 'ai_bg', label: 'AI背景制作', days: 3, unit: '点', price: 6000 },
                      { key: 'ai_world', label: 'AI世界観イメージ', days: 1, unit: '点', price: 15000 },
                      { key: 'ai_anim', label: 'AIアニメーション', days: 5, unit: 'カット', price: 50000 },
                      { key: 'ae_comp', label: 'AEコンポジット', days: 3, price: 50000 },
                      { key: 'ai_narration', label: 'AIナレーション', days: 1, unit: '式', price: 20000 },
                      { key: 'ai_credit', label: 'AIクレジット費用', days: 1, unit: 'プロジェクト', price: 50000 },
                    ].map(item => {
                      const isChecked = cgPartialItems.includes(item.key);
                      return (
                        <label key={item.key} style={{ 
                          display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', 
                          background: isChecked ? 'rgba(208, 2, 27, 0.06)' : '#fff',
                          border: isChecked ? '2px solid var(--brand-red)' : '1px solid #e0e0e0',
                          borderRadius: '4px', cursor: 'pointer', fontSize: '14px', 
                          color: isChecked ? '#333' : '#555',
                          fontWeight: isChecked ? 600 : 400,
                          transition: 'all 0.2s ease',
                          boxShadow: isChecked ? '0 1px 4px rgba(208,2,27,0.12)' : 'none',
                        }}>
                          <input type="checkbox" checked={isChecked} onChange={() => {
                            setCgPartialItems(prev => isChecked ? prev.filter(k => k !== item.key) : [...prev, item.key]);
                          }} style={{ accentColor: 'var(--brand-red)', width: '16px', height: '16px' }} />
                          <span>{item.label}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '12px', color: isChecked ? 'var(--brand-red)' : '#999', fontFamily: 'Outfit', fontWeight: 600 }}>{item.days}日〜</span>
                        </label>
                      );
                    })}
                  </div>
                  {cgPartialItems.length > 0 && (
                    <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--brand-red)', fontWeight: 600 }}>{cgPartialItems.length}工程を選択中</span>
                      <button className="btn-primary" onClick={() => {
                        const newVisible = questions.filter(q => !q.condition || q.condition(answers));
                        const currentIdx = newVisible.findIndex(q => q.id === 'cg_type');
                        if (currentIdx < newVisible.length - 1) setCurrentStep(questions.findIndex(q => q.id === newVisible[currentIdx + 1].id));
                        else setShowConfirmScreen(true);
                      }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}>次の質問へ進む <ArrowRight size={16} /></button>
                    </div>
                  )}
                </div>
              )}
              {currentStep > 0 && (
                <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'center' }}>
                  <button className="btn-secondary" onClick={handleBackQuestion} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ArrowLeft size={16} /> 前の質問に戻る</button>
                </div>
              )}
            </motion.div>
          ) : showConfirmScreen && !isFinished ? (
            // --- Confirmation Screen ---
            <motion.div key="confirm" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ width: '100%', maxWidth: '700px', paddingBottom: '80px' }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <div style={{ width: '60px', height: '60px', background: 'rgba(208, 2, 27, 0.08)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                  <CheckCircle2 size={28} style={{ color: 'var(--brand-red)' }} />
                </div>
                <h1 style={{ fontSize: '28px', margin: '0 0 8px 0' }}>選択内容の確認</h1>
                <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>以下の内容で見積書を作成します。修正がある場合は戻って変更できます。</p>
              </div>
              {/* 暫定見積の注意書き */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02))',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderLeft: '4px solid rgba(245, 158, 11, 0.7)',
                borderRadius: '2px',
                padding: '16px 20px',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}>
                <div style={{ fontSize: '18px', lineHeight: 1, marginTop: '2px' }}>⚠️</div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', marginBottom: '6px', letterSpacing: '0.5px' }}>暫定見積について</div>
                  <p style={{ fontSize: '12.5px', color: '#78350F', lineHeight: 1.7, margin: 0 }}>
                    本ツールで算出される金額は、ご選択いただいた条件に基づく<strong>概算（暫定見積）</strong>です。<br/>
                    実際のお見積りは、本内容をもとに担当者がヒアリング・精査のうえ、正式にご提示させていただきます。
                  </p>
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '24px 28px' }}>
                {visibleQuestions.map(q => {
                  const selectedOption = q.options.find(o => o.id === answers[q.id]);
                  if (!selectedOption) return null;
                  return (
                    <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', minWidth: '200px' }}>{q.title.replace('？', '')}</span>
                      <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500, textAlign: 'right' }}>{selectedOption.label}</span>
                    </div>
                  );
                })}
                {cgPartialItems.length > 0 && (
                  <div style={{ padding: '12px 0' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>部分発注工程</span>
                    <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {cgPartialItems.map(key => (
                        <span key={key} style={{ fontSize: '12px', padding: '3px 10px', background: 'rgba(208, 2, 27, 0.06)', color: 'var(--brand-red)', borderRadius: '0', border: '1px solid rgba(208, 2, 27, 0.15)' }}>{key}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 5年バックアップオプション */}
              <div style={{ marginTop: '24px' }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '16px 20px',
                  background: answers['backup_5year'] === 'yes' ? 'rgba(208, 2, 27, 0.04)' : 'var(--bg-section)',
                  border: `1px solid ${answers['backup_5year'] === 'yes' ? 'rgba(208, 2, 27, 0.2)' : 'var(--border-subtle)'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}>
                  <input
                    type="checkbox"
                    checked={answers['backup_5year'] === 'yes'}
                    onChange={e => setAnswers(prev => ({ ...prev, backup_5year: e.target.checked ? 'yes' : '' }))}
                    style={{ accentColor: 'var(--brand-red)', width: '18px', height: '18px', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                      5年間長期バックアップ（専用HDD保管）
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      通常1年間のバックアップを5年間に延長します。専用HDDに個別保管いたします。
                    </div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'Outfit', color: answers['backup_5year'] === 'yes' ? 'var(--brand-red)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    ¥20,000
                  </div>
                </label>
              </div>

              {/* 契約条件・利用規約 */}
              <div style={{ marginTop: '24px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} style={{ color: 'var(--brand-red)' }} />
                  ご利用条件
                </div>
                <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
                  {contractTerms.map((term, idx) => (
                    <div key={idx} style={{ padding: '14px 20px', borderBottom: idx < contractTerms.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{term.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>{term.content}</div>
                    </div>
                  ))}
                </div>
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '16px',
                  padding: '14px 16px',
                  background: contractAgreed ? 'rgba(208, 2, 27, 0.04)' : 'rgba(245, 158, 11, 0.04)',
                  border: `1px solid ${contractAgreed ? 'rgba(208, 2, 27, 0.2)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}>
                  <input
                    type="checkbox"
                    checked={contractAgreed}
                    onChange={e => setContractAgreed(e.target.checked)}
                    style={{ accentColor: 'var(--brand-red)', width: '18px', height: '18px', marginTop: '1px', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '13px', color: contractAgreed ? 'var(--text-primary)' : '#78350F', lineHeight: 1.5 }}>
                    上記のご利用条件を確認し、<strong>暫定見積であること</strong>、および各条件の内容に同意します。
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '32px' }}>
                <button className="btn-secondary" onClick={() => { setShowConfirmScreen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ArrowLeft size={16} /> 修正する
                </button>
                <button
                  className="btn-primary"
                  onClick={() => { setShowConfirmScreen(false); setShowCustomerInput(true); }}
                  disabled={!contractAgreed}
                  style={{
                    padding: '14px 40px', fontSize: '16px',
                    opacity: contractAgreed ? 1 : 0.4,
                    cursor: contractAgreed ? 'pointer' : 'not-allowed',
                  }}
                >
                  次へ：プロジェクト情報の入力 →
                </button>
              </div>
            </motion.div>
          ) : showCustomerInput && !isFinished ? (
            // --- Customer Info Input ---
            <motion.div key="customer-input" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ width: '100%', maxWidth: '750px', paddingBottom: '80px' }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <div style={{ width: '60px', height: '60px', background: 'rgba(124, 58, 237, 0.08)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                  <FolderKanban size={28} style={{ color: '#7C3AED' }} />
                </div>
                <h1 style={{ fontSize: '28px', margin: '0 0 8px 0' }}>プロジェクト情報・制作期間</h1>
                <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>見積書に記載するプロジェクト案件名と予定制作スケジュールをご入力ください。</p>
              </div>

              <div className="glass-panel" style={{ padding: '28px' }}>

                {/* 制作期間 */}
                <div style={{ padding: '16px', background: 'rgba(208, 2, 27, 0.04)', border: '1px solid rgba(208, 2, 27, 0.1)', borderRadius: '2px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--brand-red)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CalendarDays size={16} /> 制作期間
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px' }}>制作開始日</label>
                      <input type="date" value={projectDates.startDate || ''} onChange={e => setProjectDates(prev => ({...prev, startDate: e.target.value}))} className="input-field" />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '12px' }}>納品予定日</label>
                      <input type="date" value={projectDates.deliveryDate || ''} onChange={e => setProjectDates(prev => ({...prev, deliveryDate: e.target.value}))} className="input-field" />
                    </div>
                  </div>
                  {projectDates.startDate && projectDates.deliveryDate && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--brand-red)', fontFamily: 'Outfit', fontWeight: 600, textAlign: 'center' }}>
                      制作期間: {countBusinessDays(projectDates.startDate, projectDates.deliveryDate)}営業日
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '32px' }}>
                <button className="btn-secondary" onClick={() => { setShowCustomerInput(false); setShowConfirmScreen(true); }} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ArrowLeft size={16} /> 選択内容に戻る
                </button>
                <button className="btn-primary" onClick={() => { setIsFinished(true); setShowCustomerInput(false); if (customerInfo.companyName) saveToCustomerLibrary(customerInfo); }} style={{ padding: '14px 40px', fontSize: '16px' }}
                  disabled={!customerInfo.projectName}
                >
                  見積書を作成 →
                </button>
              </div>
              {(!customerInfo.projectName) && (
                <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px', color: 'var(--color-danger)' }}>※ プロジェクト名は必須です</div>
              )}
            </motion.div>
          ) : isSubmitted ? (
            // --- Success Screen ---
            <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ width: '80px', height: '80px', background: submitError ? 'rgba(251, 146, 60, 0.15)' : 'var(--neon-cyan-glow)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px auto', color: submitError ? '#fb923c' : 'var(--neon-cyan)' }}>{submitError ? <ShieldAlert size={40} /> : <CheckCircle2 size={40} />}</div>
              <h1 style={{ fontSize: '32px', marginBottom: '16px' }}>{submitError ? 'お見積もりを保存しました' : 'お見積もりのご依頼、誠にありがとうございます。'}</h1>
              {submitError && (
                <div style={{ maxWidth: '600px', margin: '0 auto 24px auto', padding: '16px 20px', background: 'rgba(251, 146, 60, 0.08)', border: '1px solid rgba(251, 146, 60, 0.3)', borderRadius: '2px', textAlign: 'left' }}>
                  <div style={{ color: '#fb923c', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>⚠ 送信に一部失敗しました</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.6 }}>{submitError}</div>
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '16px', lineHeight: 1.8, maxWidth: '600px', margin: '0 auto 16px auto' }}>{submitError ? 'お見積もりはローカルに保存されました。担当者に直接ご連絡ください。' : <>ご入力いただいた内容を送信いたしました。<br />内容を確認のうえ、<strong>担当者よりメールにてご連絡</strong>させていただきます。</>}</p>
              <div style={{ maxWidth: '500px', margin: '0 auto 40px auto', padding: '20px 24px', background: 'rgba(0, 191, 255, 0.04)', border: '1px solid rgba(0, 191, 255, 0.15)', borderRadius: '2px', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <Mail size={16} style={{ color: 'var(--neon-cyan)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>メール通知について</span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                  お見積り内容は、ご入力いただいたメールアドレスおよび弊社担当者宛に送信されました。<br/>
                  担当者が内容を確認のうえ、改めてご連絡いたしますので、<strong>しばらくお待ちください</strong>。
                </p>
              </div>
              <button className="btn-secondary" onClick={() => window.location.reload()}>トップへ戻る</button>
            </motion.div>
          ) : (
            // --- Document Detail / Preview ---
            <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }} style={{ width: '100%', maxWidth: '1100px', padding: '40px 0 100px 0' }}>
              
              {/* Status Tabs - ADMIN ONLY */}
              {isAdmin && viewMode === 'detail' && (
                <div className="status-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '24px', background: 'var(--bg-section)', padding: '8px', borderRadius: '2px', border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
                  <button onClick={() => changeDocType('estimate')} style={{ background: docType === 'estimate' ? 'var(--neon-cyan-glow)' : 'transparent', color: docType === 'estimate' ? 'var(--neon-cyan)' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: docType === 'estimate' ? 600 : 400 }}><FileText size={16} /> 見積書</button>
                  <button onClick={() => changeDocType('order')} style={{ background: docType === 'order' ? 'rgba(139, 92, 246, 0.15)' : 'transparent', color: docType === 'order' ? 'var(--neon-purple)' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: docType === 'order' ? 600 : 400 }}><FileSignature size={16} /> 発注請書</button>
                  <button onClick={() => changeDocType('delivery')} style={{ background: docType === 'delivery' ? 'rgba(16, 185, 129, 0.15)' : 'transparent', color: docType === 'delivery' ? 'var(--neon-green)' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: docType === 'delivery' ? 600 : 400 }}><BoxIcon size={16} /> 納品書</button>
                  <button onClick={() => changeDocType('invoice')} style={{ background: docType === 'invoice' ? 'rgba(236, 72, 153, 0.15)' : 'transparent', color: docType === 'invoice' ? 'var(--neon-pink)' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: docType === 'invoice' ? 600 : 400 }}><FileBadge2 size={16} /> 請求書</button>
                </div>
              )}

              {/* Tutorial Banner */}
              {!isAdmin && !tutorialDismissed && tutorialStep === -1 && (
                <div style={{ marginBottom: '16px', padding: '14px 20px', background: 'rgba(208, 2, 27, 0.06)', border: '1px solid rgba(208, 2, 27, 0.15)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Wand2 size={18} style={{ color: 'var(--brand-red)' }} />
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>初めてご利用の方へ — 操作ガイドをご用意しています</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={startTutorial} className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }}>ガイドを見る</button>
                    <button onClick={() => { setTutorialDismissed(true); localStorage.setItem('lb_tutorial_done', '1'); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>閉じる</button>
                  </div>
                </div>
              )}

              {/* Tutorial Overlay */}
              {tutorialStep >= 0 && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'var(--bg-section)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={nextTutorial}>
                  <motion.div 
                    key={tutorialStep}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    onClick={e => e.stopPropagation()}
                    style={{ background: '#fff', border: '1px solid var(--neon-cyan)', borderRadius: '2px', padding: '24px 28px', maxWidth: '420px', position: 'relative' }}
                  >
                    <div style={{ position: 'absolute', top: '-8px', left: '50%', width: '16px', height: '16px', background: '#fff', border: '1px solid var(--neon-cyan)', borderRight: 'none', borderBottom: 'none', transform: 'translateX(-50%) rotate(45deg)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <div style={{ background: 'var(--brand-red)', color: '#fff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit', fontWeight: 700, fontSize: '13px' }}>{tutorialStep + 1}</div>
                      <span style={{ fontWeight: 600, color: 'var(--brand-red)', fontSize: '14px' }}>{tutorialSteps[tutorialStep].target}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>{tutorialStep + 1} / {tutorialSteps.length}</span>
                    </div>
                    <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.7, margin: '0 0 16px 0' }}>{tutorialSteps[tutorialStep].message}</p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <button onClick={() => { setTutorialStep(-1); setTutorialDismissed(true); localStorage.setItem('lb_tutorial_done', '1'); }} style={{ background: 'none', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '2px', cursor: 'pointer', fontSize: '12px' }}>スキップ</button>
                      <button onClick={nextTutorial} className="btn-primary" style={{ padding: '6px 18px', fontSize: '12px' }}>
                        {tutorialStep < tutorialSteps.length - 1 ? '次へ →' : '完了 ✓'}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}

              <div className="glass-panel" style={{ padding: '48px' }}>
                {/* PDF Header Layout */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
                  <div style={{ minWidth: '300px' }}>
                    <h1 style={{ fontSize: '36px', margin: '0 0 24px 0', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      {docInfo.en}
                      <span style={{ fontSize: '14px', padding: '4px 12px', background: 'var(--border-light)', borderRadius: '0', fontWeight: 500, letterSpacing: '2px' }}>{docInfo.ja}</span>
                    </h1>
                    <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: customerInfo.companyName ? 'var(--text-primary)' : 'var(--text-muted)' }}>{customerInfo.companyName || '（貴社名）'} 御中</div>
                      <div style={{ fontSize: '14px', color: customerInfo.contactName ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: '8px' }}>ご担当：{customerInfo.contactName || '（ご担当者名）'} 様</div>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>平素は格別のご高配を賜り、厚く御礼申し上げます。<br/>{docInfo.text}</p>
                    <div style={{
                      marginTop: '16px',
                      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(245, 158, 11, 0.02))',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      borderLeft: '4px solid rgba(245, 158, 11, 0.7)',
                      borderRadius: '2px',
                      padding: '12px 16px',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#92400E', marginBottom: '4px' }}>※ 暫定見積</div>
                      <p style={{ fontSize: '11px', color: '#78350F', lineHeight: 1.6, margin: 0 }}>
                        本書面はお客様のご選択に基づく概算金額です。正式なお見積りは、担当者による精査・ヒアリング後に改めてご提示いたします。
                      </p>
                      <p style={{ fontSize: '10px', color: '#92400E', lineHeight: 1.5, margin: '6px 0 0 0', opacity: 0.8 }}>
                        ※ 本見積の算定基準: JAC（日本アド・コンテンツ制作協会）TVCM制作費見積書式・カテゴリ分類 / JAGDA（日本グラフィックデザイナー協会）制作料金算定基準に準拠して算出しています。
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {isAdmin ? (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '13px', textAlign: 'left' }}>
                          <span style={{ color: 'var(--text-muted)' }}>発行日:</span>
                          <input type="date" value={projectDates.issueDate || (activeProject ? activeProject.updatedAt.slice(0,10) : new Date().toISOString().slice(0,10))} onChange={e => setProjectDates(prev => ({...prev, issueDate: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          <span style={{ color: 'var(--text-muted)' }}>見積有効期限:</span>
                          <input type="date" value={projectDates.estimateExpiry || ''} onChange={e => setProjectDates(prev => ({...prev, estimateExpiry: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          <span style={{ color: 'var(--brand-red)', fontWeight: 600 }}>制作開始日:</span>
                          <input type="date" value={projectDates.startDate || ''} onChange={e => setProjectDates(prev => ({...prev, startDate: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          <span style={{ color: 'var(--brand-red)', fontWeight: 600 }}>納品日:</span>
                          <input type="date" value={projectDates.deliveryDate || ''} onChange={e => setProjectDates(prev => ({...prev, deliveryDate: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          {docType !== 'estimate' && (<>
                          <span style={{ color: 'var(--text-muted)' }}>請求日:</span>
                          <input type="date" value={projectDates.invoiceDate || ''} onChange={e => setProjectDates(prev => ({...prev, invoiceDate: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          <span style={{ color: 'var(--text-muted)' }}>支払期限:</span>
                          <input type="date" value={projectDates.paymentDue || ''} onChange={e => setProjectDates(prev => ({...prev, paymentDue: e.target.value}))} style={{ background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '0', padding: '2px 6px', fontSize: '12px' }} />
                          </>)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>発行日: {projectDates.issueDate || (activeProject ? new Date(activeProject.updatedAt).toLocaleDateString('ja-JP') : new Date().toLocaleDateString('ja-JP'))} <br/><span style={{ fontSize: '11px' }}>{activeProject ? activeProject.id : ''}</span></div>
                    )}
                    {(() => {
                      const issueStr = projectDates.issueDate || (activeProject ? activeProject.updatedAt.slice(0,10) : new Date().toISOString().slice(0,10));
                      const expiryStr = projectDates.estimateExpiry || (() => { const d = new Date(issueStr); d.setDate(d.getDate() + 30); return d.toISOString().slice(0,10); })();
                      return docType === 'estimate' ? <div style={{ fontSize: '12px', color: 'var(--color-danger)' }}>見積有効期限: {expiryStr}（発行日より30日間）</div> : null;
                    })()}
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px', marginTop: '12px' }}>株式会社リキッドブロック</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>登録番号: T-4140001096045</div>
                    <div>〒651-0082</div>
                    <div>兵庫県神戸市中央区小野浜町 1-4</div>
                    <div>デザイン・クリエイティブセンター神戸403号</div>
                    <div>TEL: 078-381-5773</div>
                  </div>
                </div>

                {/* Total Summary & Project Name */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '48px', paddingBottom: '32px', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <h2 style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-muted)', margin: '0 0 8px 0' }}>プロジェクト概要</h2>
                    <p style={{ color: 'var(--text-primary)', margin: 0, fontSize: '18px', fontWeight: 600 }}>{customerInfo.projectName || '映像制作費一式'} {activeProject ? `(${activeProject.id})` : ''}</p>
                    {est.hasContingency && docType === 'estimate' && (
                      <div style={{ display: 'inline-block', marginTop: '12px', padding: '6px 16px', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--color-danger)', borderRadius: '0', fontSize: '13px', fontWeight: 600 }}><ShieldAlert size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px', marginBottom: '2px' }} /> 予備費・バッファ込み</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '4px' }}>{docType === 'invoice' ? 'ご請求金額' : '御見積金額'} (税別)</div>
                    <div style={{ fontSize: '48px', fontWeight: 700, fontFamily: 'Outfit', color: docType === 'invoice' ? 'var(--neon-pink)' : 'var(--neon-cyan)', lineHeight: 1 }}>¥{est.total.toLocaleString()}</div>
                    <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                      消費税(10%): <span style={{ fontFamily: 'Outfit', color: 'var(--text-primary)' }}>¥{Math.round(est.total * 0.1).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: '20px', fontFamily: 'Outfit', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                      税込合計: ¥{Math.round(est.total * 1.1).toLocaleString()}
                    </div>
                    {est.hasUnestimatedItem && <div style={{ fontSize: '12px', color: 'var(--brand-red)', marginTop: '4px' }}>※タレント費用等は別途追加となります</div>}
                    {est.total >= 2000000 && (
                      <div style={{ marginTop: '12px', padding: '12px 16px', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '2px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                        <div style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '4px', fontSize: '13px' }}>お支払いについて</div>
                        <div>· 200万円を超える案件は<strong style={{ color: 'var(--text-primary)' }}>前払い（半金）</strong>をお願いしております</div>
                        <div>· 半金: <strong style={{ color: 'var(--text-primary)' }}>発注月末日</strong>に50%、残り50%は<strong style={{ color: 'var(--text-primary)' }}>納品月末日</strong></div>
                        <div>· 支払いサイト: 月末締め翌月末払い</div>
                      </div>
                    )}
                    {(answers['ai_assets'] === 'ai_light' || answers['ai_assets'] === 'ai_heavy') && (
                      <div style={{ marginTop: '12px', padding: '12px 16px', background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '2px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                        <div style={{ color: '#7C3AED', fontWeight: 600, marginBottom: '4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}><Sparkles size={14} /> AI素材使用について</div>
                        <div>· 本見積もりにはAI生成素材が含まれます</div>
                        <div>· AI素材の使用には<strong style={{ color: 'var(--text-primary)' }}>クライアント様の事前承諾</strong>が必要です</div>
                        <div>· 生成物の著作権・肖像権に関する確認書を別途ご用意いたします</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 制作期間 */}
                <div style={{ marginBottom: '24px', padding: '20px 24px', background: 'rgba(208, 2, 27, 0.04)', borderRadius: '2px', border: '1px solid rgba(208, 2, 27, 0.1)' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--brand-red)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CalendarDays size={16} /> 制作期間
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'end' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>制作開始日</div>
                      <input type="date" value={projectDates.startDate || ''} onChange={e => setProjectDates(prev => ({...prev, startDate: e.target.value}))} 
                        style={{ width: '100%', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '2px', padding: '10px 14px', fontSize: '15px', fontFamily: 'Outfit', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '4px' }}>
                      <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>納品予定日</div>
                      <input type="date" value={projectDates.deliveryDate || ''} onChange={e => setProjectDates(prev => ({...prev, deliveryDate: e.target.value}))} 
                        style={{ width: '100%', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '2px', padding: '10px 14px', fontSize: '15px', fontFamily: 'Outfit', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date();
                        const twoMonthsLater = new Date(today);
                        twoMonthsLater.setMonth(twoMonthsLater.getMonth() + 2);
                        setProjectDates(prev => ({
                          ...prev,
                          startDate: today.toISOString().slice(0, 10),
                          deliveryDate: twoMonthsLater.toISOString().slice(0, 10),
                        }));
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '8px 20px',
                        background: 'rgba(245, 158, 11, 0.06)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '2px',
                        color: '#92400E',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Clock size={14} />
                      制作期間未定（2ヶ月を仮設定）
                    </button>
                  </div>
                  {projectDates.startDate && projectDates.deliveryDate && (() => {
                    const bizDays = countBusinessDays(projectDates.startDate, projectDates.deliveryDate);
                    const calDays = Math.ceil((new Date(projectDates.deliveryDate).getTime() - new Date(projectDates.startDate).getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', padding: '12px 28px', borderRadius: '2px', background: 'rgba(208, 2, 27, 0.06)', border: '1px solid rgba(208, 2, 27, 0.15)' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'Outfit', color: 'var(--brand-red)', lineHeight: 1 }}>{bizDays}</div>
                              <div style={{ fontSize: '11px', color: 'var(--brand-red)', fontWeight: 600, marginTop: '2px' }}>営業日</div>
                            </div>
                            <div style={{ width: '1px', height: '32px', background: 'var(--border-light)' }} />
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                              暦日 {calDays}日<br/>
                              <span style={{ fontSize: '10px' }}>（土日祝 {calDays - bizDays}日除外）</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ marginTop: '12px', height: '6px', background: 'var(--bg-section)', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(5, ((Date.now() - new Date(projectDates.startDate).getTime()) / (new Date(projectDates.deliveryDate).getTime() - new Date(projectDates.startDate).getTime())) * 100))}%`, background: 'var(--brand-red)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 制作条件の概要 */}
                <div className="print-page-break print-section" style={{ marginBottom: '32px', padding: '20px 24px', background: 'var(--bg-section)', borderRadius: '2px', border: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--brand-red)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={16} /> 制作条件
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                    {visibleQuestions.map(q => {
                      const opt = q.options.find(o => o.id === answers[q.id]);
                      if (!opt) return null;
                      return (
                        <div key={q.id} style={{ fontSize: '13px', padding: '4px 0', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                          <span style={{ color: 'var(--brand-red)', flexShrink: 0 }}>•</span>
                          <span style={{ color: 'var(--text-muted)' }}>{q.title.replace('？', '').replace('ですか', '').replace('は', '')}: </span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{opt.label}</span>
                        </div>
                      );
                    })}
                    {cgPartialItems.length > 0 && (
                      <div style={{ fontSize: '13px', padding: '4px 0', display: 'flex', gap: '8px', alignItems: 'baseline', gridColumn: 'span 2' }}>
                        <span style={{ color: 'var(--brand-red)', flexShrink: 0 }}>•</span>
                        <span style={{ color: 'var(--text-muted)' }}>部分発注工程: </span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{cgPartialItems.join('、')}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: '40px' }}>
                  {renderPhaseTable('Planning', '1. 企画構成費', '--neon-purple',
                    '企画の方向性を決めるディレクション、絵コンテ・Vコンテ作成などの企画構成にかかる費用です。')}
                  {renderPhaseTable('Pre-Production', '2. 制作準備費', '--neon-purple',
                    'ロケハン（撮影場所の下見）、現地調査など制作前の準備にかかる費用です。')}
                  {renderPhaseTable('Shooting', '3. 撮影費', '--neon-pink',
                    '実際の撮影・収録工程です。カメラマン、照明技師など現場スタッフや機材・スタジオ費が含まれます。')}
                  {renderPhaseTable('Cast', '4. 出演者関係費', '--neon-pink',
                    'モデル・タレント・インフルエンサーの出演費、使用権、ヘアメイク・スタイリスト費用です。')}
                  {renderPhaseTable('CG', '5. CG/アニメーション・素材制作費', '--neon-cyan',
                    'CGアニメーション、3Dモデリング、エフェクト、AI素材生成などの素材制作にかかる費用です。')}
                  {renderPhaseTable('Post-Production', '6. ポストプロダクション（編集）', '--neon-cyan',
                    'オフライン編集、カラーグレーディング、オンライン編集、テロップ・字幕制作などの仕上げ工程です。')}
                  {renderPhaseTable('Audio', '7. 音楽・音響費', '--neon-cyan',
                    'ナレーション収録、BGM制作、MA・整音作業、効果音などの音響にかかる費用です。')}
                  
                  {/* ADMIN CUSTOM ITEM ADDER */}
                  {isAdmin && (
                    <div className="add-custom-item action-buttons" style={{ background: 'var(--bg-section)', padding: '16px', borderRadius: '2px', border: '1px dashed var(--border-color)', marginBottom: '32px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand-red)', fontSize: '14px', fontWeight: 600 }}><FolderKanban size={16} /> 項目の手動追加・カスタマイズ</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>プリセット:</label>
                          <select className="input-field" style={{ width: '320px', fontSize: '13px' }} onChange={e => handlePresetSelect(e.target.value)} value="">
                            <option value="">--- CG/VFX項目を選択 ---</option>
                            {cgPresets.map(p => (<option key={p.name} value={p.name}>{p.name} (¥{p.unitPrice.toLocaleString()}/人日)</option>))}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>フェーズ</label>
                          <select className="input-field" value={newItem.phase} onChange={e => setNewItem({...newItem, phase: e.target.value as PhaseType})}>
                            <option value="Planning">企画構成費</option>
                            <option value="Pre-Production">制作準備費</option>
                            <option value="Shooting">撮影費</option>
                            <option value="Cast">出演者関係費</option>
                            <option value="CG">CG/アニメーション費</option>
                            <option value="Post-Production">ポストプロダクション（編集）</option>
                            <option value="Audio">音楽・音響費</option>
                          </select>
                        </div>
                        <div style={{ flex: 2 }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>項目名</label><input type="text" className="input-field" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} placeholder="例：特殊レンズレンタル費" /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>単価(¥)</label><input type="number" className="input-field" value={newItem.unitPrice} onChange={e => setNewItem({...newItem, unitPrice: parseInt(e.target.value) || 0})} /></div>
                        <div style={{ width: '80px' }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>人数</label><input type="number" className="input-field" value={newItem.persons} onChange={e => setNewItem({...newItem, persons: parseInt(e.target.value) || 1})} /></div>
                        <div style={{ width: '80px' }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>日数</label><input type="number" className="input-field" value={newItem.days} onChange={e => setNewItem({...newItem, days: parseInt(e.target.value) || 1})} /></div>
                        <div style={{ width: '80px' }}><label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>単位</label><input type="text" className="input-field" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} /></div>
                        <button className="btn-secondary" onClick={handleAddCustomItem} style={{ padding: '12px', color: 'var(--brand-red)', borderColor: 'var(--brand-red)' }}>追加</button>
                      </div>
                    </div>
                  )}

                  {renderPhaseTable('Overhead', '8. 制作管理費・予備費', '--text-main',
                    'データ管理、機材保守、通信費等の諸経費です。仕様変更の可能性がある場合は予備費（バッファ）も含まれます。')}
                  {renderPhaseTable('Express', '特急対応オプション', '--neon-pink',
                    '納期が1ヶ月半以内（10日以上）の場合、人員増強等のための特急料金が適用されます。')}
                </div>

                {/* AI Direction Analysis - ADMIN ONLY */}
                {isAdmin && aiAnalysis && (
                  <div className="action-buttons" style={{ background: 'rgba(124, 58, 237, 0.04)', padding: '32px', borderRadius: '2px', marginBottom: '40px', border: '1px solid rgba(139,92,246,0.3)' }}>
                    <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={20} color="#7C3AED" /> AI方向性分析 (Gemini)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>🎬 トーン</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {aiAnalysis.tone.map((t, i) => (
                            <span key={i} style={{ padding: '4px 12px', background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: '0', fontSize: '13px', color: '#7C3AED' }}>{t}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>🎨 スタイル</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {aiAnalysis.style.map((s, i) => (
                            <span key={i} style={{ padding: '4px 12px', background: 'rgba(208, 2, 27, 0.06)', border: '1px solid rgba(208, 2, 27, 0.15)', borderRadius: '0', fontSize: '13px', color: 'var(--brand-red)' }}>{s}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>🎨 カラーパレット</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {aiAnalysis.colorPalette.map((c, i) => (
                            <span key={i} style={{ padding: '4px 12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(236,72,153,0.4)', borderRadius: '0', fontSize: '13px', color: 'var(--color-danger)' }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-section)', padding: '16px', borderRadius: '2px', marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>📝 分析コメント</div>
                      <div style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.6 }}>{aiAnalysis.summary}</div>
                    </div>
                    {aiAnalysis.suggestedApproach && (
                      <div style={{ background: 'rgba(6,182,212,0.05)', padding: '16px', borderRadius: '2px', border: '1px solid rgba(6,182,212,0.2)' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>💡 LiquidBlock制作提案</div>
                        <div style={{ fontSize: '14px', color: 'var(--brand-red)', lineHeight: 1.6 }}>{aiAnalysis.suggestedApproach}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Google Drive Folder Link - ADMIN ONLY */}
                {isAdmin && activeProject?.driveFolderUrl && (
                  <div style={{ marginBottom: '40px', padding: '16px 24px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FolderKanban size={20} color="var(--color-success)" />
                      <div>
                        <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>Google Drive プロジェクトフォルダ</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>クライアントのリファレンス素材・オリエンシートが格納されています</div>
                      </div>
                    </div>
                    <a href={activeProject.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: '13px', padding: '8px 16px', color: 'var(--color-success)', borderColor: 'rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
                      <FolderKanban size={14} /> Driveで開く
                    </a>
                  </div>
                )}

                {/* Invoice Bank Info */}
                {isAdmin && docType === 'invoice' && (
                  <div style={{ marginBottom: '40px', padding: '24px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', borderRadius: '2px' }}>
                    <h3 style={{ fontSize: '16px', color: 'var(--text-primary)', marginBottom: '16px' }}>お振込先情報</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '14px', color: 'var(--text-muted)' }}>
                      <div><div style={{ marginBottom: '8px' }}>金融機関: <span style={{ color: 'var(--text-primary)' }}>三井住友銀行 (0009)</span></div><div style={{ marginBottom: '8px' }}>支店名: <span style={{ color: 'var(--text-primary)' }}>神戸営業部 (500)</span></div><div style={{ marginBottom: '8px' }}>口座種別: <span style={{ color: 'var(--text-primary)' }}>普通口座</span></div></div>
                      <div><div style={{ marginBottom: '8px' }}>口座番号: <span style={{ color: 'var(--text-primary)', fontFamily: 'Outfit', fontSize: '16px' }}>1234567</span></div><div style={{ marginBottom: '8px' }}>口座名義: <span style={{ color: 'var(--text-primary)' }}>カ）リキッドブロック</span></div><div style={{ marginBottom: '8px', color: 'var(--color-danger)' }}>お支払期限: 翌月末日</div></div>
                    </div>
                  </div>
                )}

                {/* 支給データ */}
                <div className="print-section" style={{ marginBottom: '24px', padding: '24px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', borderRadius: '2px' }}>
                  <h3 style={{ fontSize: '16px', color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Paperclip size={18} style={{ color: '#7C3AED' }} /> 支給データ
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>お客様からご支給いただける素材があればチェックを入れてください。</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { key: 'photo_hd', label: '静止画（FHD以上）', desc: '1920×1080px以上の高解像度写真' },
                      { key: 'photo_sd', label: '静止画（FHD以下）', desc: 'Web用等の低解像度写真' },
                      { key: 'logo', label: 'ロゴデータ', desc: 'AI/EPS/SVG/PNG等' },
                      { key: 'psd', label: 'PSDデータ', desc: 'Photoshopレイヤーデータ' },
                      { key: 'pamphlet', label: 'パンフレットデータ', desc: 'PDF/AI等の印刷用データ' },
                      { key: 'video', label: '映像素材', desc: '既存の映像・動画ファイル' },
                      { key: 'font', label: '指定フォント', desc: '企業指定のフォントデータ' },
                      { key: 'guideline', label: 'ブランドガイドライン', desc: 'CI/VIマニュアル等' },
                      { key: 'other_data', label: 'その他データ', desc: '3Dモデル・音声・テキスト等' },
                    ].map(item => {
                      const isChecked = suppliedData.includes(item.key);
                      return (
                        <label key={item.key} style={{
                          display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
                          background: isChecked ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isChecked ? 'rgba(139, 92, 246, 0.3)' : 'var(--border-subtle)'}`,
                          borderRadius: '2px', cursor: 'pointer', transition: 'all 0.2s'
                        }}>
                          <input type="checkbox" checked={isChecked} onChange={() => {
                            setSuppliedData(prev => isChecked ? prev.filter(k => k !== item.key) : [...prev, item.key]);
                          }} style={{ marginTop: '2px', accentColor: '#7C3AED' }} />
                          <div>
                            <div style={{ fontSize: '13px', color: isChecked ? '#fff' : 'var(--text-muted)', fontWeight: isChecked ? 500 : 400 }}>{item.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{item.desc}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {suppliedData.length > 0 && (
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#7C3AED' }}>
                      {suppliedData.length}種類の支給データあり
                    </div>
                  )}
                  {suppliedData.length === 0 && (
                    <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      支給データなし（すべて弊社にて制作）
                    </div>
                  )}
                </div>

                {/* 案件概要・備考 */}
                <div style={{ marginBottom: '40px', padding: '24px', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)', borderRadius: '2px' }}>
                  <h3 style={{ fontSize: '16px', color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={18} style={{ color: 'var(--brand-red)' }} /> 案件概要・備考
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>案件の背景・目的・特記事項などをご記入ください。見積書に記載されます。</p>
                  <textarea 
                    value={projectNotes}
                    onChange={e => setProjectNotes(e.target.value)}
                    placeholder="例）新製品ローンチに伴うブランディング動画の制作。ターゲットは20-30代の若年層。SNS配信を主目的とし、15秒・30秒・60秒の3パターンを制作予定。撮影は東京都内のスタジオを予定。"
                    rows={5}
                    style={{
                      width: '100%', background: 'var(--bg-section)', border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)', borderRadius: '2px', padding: '14px 16px', fontSize: '14px', lineHeight: 1.7,
                      resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                      transition: 'border-color 0.2s'
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--neon-cyan)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border-subtle)'}
                  />
                  {projectNotes && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {projectNotes.length} 文字
                    </div>
                  )}
                </div>

                {/* Lead Capture Form */}
                <div className="lead-capture-form" style={{ background: 'var(--bg-section)', padding: '32px', borderRadius: '2px', marginBottom: '40px', border: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserCircle size={20} color="var(--brand-red)" /> {isAdmin ? 'プロジェクト情報 / お客様情報' : 'プロジェクト名・お客様情報の入力'}
                  </h3>
                  {!isAdmin && <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>下記にご入力のうえ、「この内容で見積もり依頼を送信する」をクリックしてください。</p>}
                  
                  <div style={{ marginBottom: '20px', marginTop: isAdmin ? '24px' : '0' }}>
                    <div className="form-group">
                      <label className="form-label">プロジェクト名（案件名） <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                      <div style={{ position: 'relative' }}>
                        <FolderKanban size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
                        <input type="text" name="projectName" value={customerInfo.projectName} onChange={handleInputChange} className="input-field" placeholder="例：〇〇新商品プロモーション映像制作" style={{ paddingLeft: '40px' }} required disabled={isAdmin} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div className="form-group"><label className="form-label">貴社名 <span style={{ color: 'var(--color-danger)' }}>*</span></label><div style={{ position: 'relative' }}><Building size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} /><input type="text" name="companyName" value={customerInfo.companyName} onChange={handleInputChange} className="input-field" placeholder="株式会社〇〇" style={{ paddingLeft: '40px' }} required disabled={isAdmin} /></div></div>
                    <div className="form-group"><label className="form-label">ご担当者名 <span style={{ color: 'var(--color-danger)' }}>*</span></label><div style={{ position: 'relative' }}><User size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} /><input type="text" name="contactName" value={customerInfo.contactName} onChange={handleInputChange} className="input-field" placeholder="山田 太郎" style={{ paddingLeft: '40px' }} required disabled={isAdmin} /></div></div>
                    <div className="form-group"><label className="form-label">メールアドレス <span style={{ color: 'var(--color-danger)' }}>*</span></label><div style={{ position: 'relative' }}><Mail size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} /><input type="email" name="email" value={customerInfo.email} onChange={handleInputChange} className="input-field" placeholder="info@example.com" style={{ paddingLeft: '40px' }} required disabled={isAdmin} /></div></div>
                    <div className="form-group"><label className="form-label">電話番号</label><div style={{ position: 'relative' }}><Phone size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} /><input type="tel" name="phone" value={customerInfo.phone} onChange={handleInputChange} className="input-field" placeholder="03-0000-0000" style={{ paddingLeft: '40px' }} disabled={isAdmin} /></div></div>
                  </div>
                  {/* 住所 */}
                  <div style={{ marginTop: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">住所</label>
                      <div style={{ position: 'relative' }}>
                        <MapPin size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
                        <input type="text" name="address" value={customerInfo.address} onChange={handleInputChange} className="input-field" placeholder="東京都渋谷区〇〇 1-2-3 〇〇ビル5F" style={{ paddingLeft: '40px' }} disabled={isAdmin} />
                      </div>
                    </div>
                  </div>

                  {/* 顧客ライブラリ — Admin Only */}
                  {isAdmin && (
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>顧客ライブラリ ({customerLibrary.length}件)</span>
                        <button onClick={() => setShowCustomerPicker(!showCustomerPicker)} style={{ background: 'rgba(124, 58, 237, 0.06)', border: '1px solid rgba(124, 58, 237, 0.2)', color: '#7C3AED', padding: '4px 12px', borderRadius: '0', cursor: 'pointer', fontSize: '12px' }}>
                          {showCustomerPicker ? '閉じる' : '過去の顧客から選択'}
                        </button>
                        {customerInfo.companyName && (
                          <button onClick={() => { saveToCustomerLibrary(customerInfo); }} style={{ background: 'rgba(208, 2, 27, 0.06)', border: '1px solid rgba(208, 2, 27, 0.2)', color: 'var(--brand-red)', padding: '4px 12px', borderRadius: '0', cursor: 'pointer', fontSize: '12px' }}>
                            この顧客を保存
                          </button>
                        )}
                        {customerLibrary.length > 0 && (
                          <button onClick={exportCustomerLibraryCSV} style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', color: 'var(--color-success)', padding: '4px 12px', borderRadius: '0', cursor: 'pointer', fontSize: '12px', marginLeft: 'auto' }}>
                            CSV出力
                          </button>
                        )}
                      </div>
                      {showCustomerPicker && customerLibrary.length > 0 && (
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '2px', background: 'var(--bg-section)' }}>
                          {customerLibrary.map((c, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-section)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <div onClick={() => { setCustomerInfo({ ...c, projectName: customerInfo.projectName }); setShowCustomerPicker(false); }} style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>{c.companyName}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.contactName} / {c.email} {c.address ? `/ ${c.address}` : ''}</div>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); deleteFromCustomerLibrary(idx); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', opacity: 0.5 }}><X size={14} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      {showCustomerPicker && customerLibrary.length === 0 && (
                        <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: '2px' }}>
                          顧客データはまだ登録されていません。「この顧客を保存」で登録できます。
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Reference & Orientation Section */}
                <div className="lead-capture-form" style={{ background: 'var(--bg-section)', padding: '32px', borderRadius: '2px', marginBottom: '40px', border: '1px solid var(--border-subtle)' }}>
                  <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Image size={20} color="#7C3AED" /> リファレンス・オリエンシート
                  </h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>イメージに近い映像のURLや、オリエンシート（企画資料）があればご共有ください。</p>
                  
                  {/* Reference URLs */}
                  <div style={{ marginBottom: '24px' }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Link size={14} /> リファレンス映像URL（YouTube / Vimeo / Google Drive等）</label>
                    {referenceUrls.map((url, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <input
                          type="url" className="input-field" placeholder="https://www.youtube.com/watch?v=..."
                          value={url}
                          onChange={e => { const updated = [...referenceUrls]; updated[idx] = e.target.value; setReferenceUrls(updated); }}
                          disabled={isAdmin}
                          style={{ flex: 1 }}
                        />
                        {!isAdmin && referenceUrls.length > 1 && (
                          <button onClick={() => setReferenceUrls(referenceUrls.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '8px' }}><X size={16} /></button>
                        )}
                      </div>
                    ))}
                    {!isAdmin && (
                      <button onClick={() => setReferenceUrls([...referenceUrls, ''])} className="btn-secondary" style={{ fontSize: '13px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <Plus size={14} /> URLを追加
                      </button>
                    )}
                    {/* Admin: show clickable links */}
                    {isAdmin && referenceUrls.filter(u => u.trim()).length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        {referenceUrls.filter(u => u.trim()).map((url, idx) => (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', color: 'var(--brand-red)', fontSize: '13px', marginBottom: '4px', textDecoration: 'underline' }}>{url}</a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Orientation Sheet Upload */}
                  <div>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Paperclip size={14} /> オリエンシート（企画資料のアップロード）</label>
                    {!isAdmin && (
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{
                          display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
                          background: 'var(--bg-section)', border: '1px dashed var(--border-color)',
                          borderRadius: '2px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '13px',
                          transition: 'all 0.2s'
                        }}>
                          <Paperclip size={16} /> ファイルを選択（PDF, 画像等）
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.pptx" multiple style={{ display: 'none' }}
                            onChange={e => {
                              const files = e.target.files;
                              if (!files) return;
                              Array.from(files).forEach(file => {
                                if (file.size > 5 * 1024 * 1024) { setFormError(`${file.name} は5MB以上のため省略されました。`); return; }
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setOrientationFiles(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
                                };
                                reader.readAsDataURL(file);
                              });
                            }}
                          />
                        </label>
                      </div>
                    )}
                    {orientationFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                        {orientationFiles.map((file, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(124, 58, 237, 0.06)', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: '2px', fontSize: '13px' }}>
                            <Paperclip size={14} color="#7C3AED" />
                            <span style={{ color: 'var(--text-primary)' }}>{file.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({(file.dataUrl.length / 1024 / 1.37).toFixed(0)} KB)</span>
                            {!isAdmin && (
                              <button onClick={() => setOrientationFiles(orientationFiles.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}><X size={14} /></button>
                            )}
                            {isAdmin && file.type.startsWith('image/') && (
                              <a href={file.dataUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-red)', fontSize: '12px' }}>プレビュー</a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {orientationFiles.length === 0 && isAdmin && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>（アップロードされたファイルはありません）</div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="action-buttons" style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                  {isAdmin ? (
                    <>
                      {projectApproval?.approved && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '2px', color: '#10B981', fontSize: '13px', fontWeight: 600 }}>
                          <CheckCircle size={16} /> 承諾済み（{new Date(projectApproval.approvedAt).toLocaleDateString('ja-JP')} {projectApproval.approvedBy}様{projectApproval.approverTitle ? ` / ${projectApproval.approverTitle}` : ''}）
                        </div>
                      )}
                      <button className="btn-secondary" onClick={exportToExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', borderColor: 'var(--border-subtle)' }}><FileSpreadsheet size={18} /> Excelでダウンロード</button>
                      <button className="btn-secondary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand-red)', borderColor: 'var(--border-subtle)' }}><Download size={18} /> {docInfo.ja}を出力(PDF)</button>
                      <button className="btn-primary" onClick={saveProjectByAdmin} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Save size={18} /> 変更を保存して戻る</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-secondary" onClick={startNewProject}>やり直す</button>
                      <button className="btn-secondary" onClick={exportToExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', borderColor: 'var(--border-subtle)' }}><FileSpreadsheet size={18} /> Excelで保存</button>
                      <button className="btn-secondary" onClick={() => { if(validateCustomerInfo()) window.print(); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand-red)', borderColor: 'var(--border-subtle)' }}><Download size={18} /> 見積書を出力(PDF)</button>
                      <button className="btn-primary" onClick={submitProjectByClient} disabled={isUploading} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isUploading ? 0.6 : 1 }}>
                        {isUploading ? (
                          <><Sparkles size={18} className="spin" /> 送信・分析中...</>
                        ) : (
                          <><Send size={18} /> この内容で見積依頼を送信する</>
                        )}
                      </button>
                    </>
                  )}
                </div>
                {formError && (
                  <div style={{ marginTop: '12px', padding: '10px 16px', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '2px', color: 'var(--color-danger)', fontSize: '13px', textAlign: 'center' }}>
                    {formError}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 見積承諾モーダル */}
      <AnimatePresence>
        {showApprovalModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
            onClick={() => setShowApprovalModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: '2px', border: '1px solid var(--border-subtle)', padding: '32px', maxWidth: '480px', width: '100%' }}
            >
              <h3 style={{ fontSize: '20px', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle size={22} style={{ color: '#10B981' }} /> お見積もりの承諾
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.6 }}>
                以下の内容でお見積もりを承諾される場合は、ご担当者情報を入力して「承諾する」を押してください。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>承諾者氏名 <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                  <input
                    type="text" value={approverName} onChange={(e) => setApproverName(e.target.value)}
                    placeholder="例: 山田 太郎"
                    style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: '2px', color: 'var(--text-primary)', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>役職（任意）</label>
                  <input
                    type="text" value={approverTitle} onChange={(e) => setApproverTitle(e.target.value)}
                    placeholder="例: 代表取締役、部長、プロデューサー"
                    style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: '2px', color: 'var(--text-primary)', fontSize: '14px' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => setShowApprovalModal(false)}>キャンセル</button>
                <button
                  className="btn-primary"
                  onClick={handleApproveEstimate}
                  disabled={!approverName.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#10B981', opacity: approverName.trim() ? 1 : 0.5 }}
                >
                  <CheckCircle size={18} /> 承諾する
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 24工程ワークフローモーダル */}
      <AnimatePresence>
        {showWorkflowModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
            onClick={() => { setShowWorkflowModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '700px', maxHeight: '85vh', background: '#fff', border: '1px solid var(--border-subtle)', borderRadius: '2px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <div style={{ padding: '28px 32px 16px', borderBottom: '1px solid var(--border-color)' }}>
                <h2 style={{ fontSize: '22px', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>CGアニメーション映像の作り方 — 24工程</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                  リキッドブロックでは、以下の24工程に沿って映像制作を進めます。<br/>
                  ご発注前に、この制作フローをご理解いただくことで、スムーズな進行と高品質な納品を実現します。
                </p>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px' }}>
                {[
                  { n: 1, title: 'スケジュール作成（納期決め）', desc: '課題の提出日とスタートを決め、大まかな工程を把握します。', phase: 'pre' },
                  { n: 2, title: '案出し', desc: '全て肯定しながら数を出し、パターンをいっぱい作ります。もっともクリエイティブな工程です。', phase: 'pre' },
                  { n: 3, title: '企画', desc: '案出しで出てきたものをまとめ上げるプランニング作業。矛盾を解消し付加価値を与えます。', phase: 'pre' },
                  { n: 4, title: 'プロット', desc: '文字を元にしたストーリー形成。頭に絵が浮かぶ場合は挿絵も描きます。', phase: 'pre' },
                  { n: 5, title: '企画書「清書」', desc: 'Illustrator/PowerPoint等でビジュアル化。スポンサーやクライアントが投資判断する重要書類。', phase: 'pre' },
                  { n: 6, title: 'リファレンス集め', desc: '企画書に沿ったイメージをWeb・書籍からかき集め、世界観を固めます。', phase: 'pre' },
                  { n: 7, title: '企画コンテ', desc: '企画を元にざっくりシーンがわかる構成で作成。ボリュームと尺がわかります。', phase: 'pre' },
                  { n: 8, title: 'ルック制作（世界観）', desc: '3シーン程選んで静止画を作成。コラージュで世界観を可視化します。', phase: 'pre' },
                  { n: 9, title: 'スケジュール見直し', desc: '必要な時間コストが見えてきたところでスケジュールを再調整します。', phase: 'pre' },
                  { n: 10, title: '企画動コンテ', desc: '企画コンテを元に画像を繋いだ動コンテ。音楽やナレーションも挿入。', phase: 'pre' },
                  { n: 11, title: '演出コンテ', desc: 'カット割りを細かく設定し、カメラの動きや意図など指示を書き込みます。', phase: 'prod' },
                  { n: 12, title: '演出動コンテ', desc: '演出コンテを尺にしたもの。各カットのボリュームが理解できます。', phase: 'prod' },
                  { n: 13, title: 'アニマティクス', desc: 'CGらしい作業開始。カメラレンズ設定やカメラアニメーションを付けます。', phase: 'prod' },
                  { n: 14, title: '作業フロー構築', desc: 'CG素材の必要量を洗い出し。モデリング数、カット数、レンダリング時間等。', phase: 'prod' },
                  { n: 15, title: '背景・キャラクター・小物制作', desc: '3D制作の本格開始。複数人の場合は並行制作。一人の場合は背景→キャラ→小物の順。', phase: 'prod' },
                  { n: 16, title: '静止画でカットを埋める', desc: 'レイアウトを決めてレイヤー分けしたレンダリング。カットが埋まると安心感が生まれます。', phase: 'prod' },
                  { n: 17, title: 'アニメーション', desc: '時間コストの低いカットから進めてリズムを作り、難しいカットに集中します。', phase: 'post' },
                  { n: 18, title: 'レイヤー別レンダリング', desc: 'ライティング設定を決めてpng連番で書き出し。マルチパスレンダリングで素材化。', phase: 'post' },
                  { n: 19, title: 'AEコンポジット', desc: '最終画作りの品質を左右するパート。カラコレ、エフェクト実装、2Dアニメ制作。', phase: 'post' },
                  { n: 20, title: '映像編集', desc: '動コンテの各カットをAEで書き出した映像と入れ替え。視聴者目線で見やすさを確認。', phase: 'post' },
                  { n: 21, title: 'SE・MA編集', desc: '効果音や楽曲を雰囲気に合わせて挿入。著作権フリー音源のライブラリ活用。', phase: 'post' },
                  { n: 22, title: '初稿プレビュー', desc: '初稿をH264でレンダリング。確認用の映像を書き出します。', phase: 'post' },
                  { n: 23, title: '修正', desc: 'カットのつなぎや細かなミスを修正。レイヤー別書き出しにより効率的に差し替え可能。', phase: 'post' },
                  { n: 24, title: '完了', desc: '納品完了。お疲れ様でした。', phase: 'post' },
                ].map(step => {
                  const phaseColor = step.phase === 'pre' ? 'var(--neon-purple)' : step.phase === 'prod' ? 'var(--neon-pink)' : 'var(--neon-cyan)';
                  const phaseLabel = step.phase === 'pre' ? 'プリプロ' : step.phase === 'prod' ? 'プロダクション' : 'ポストプロ';
                  return (
                    <div key={step.n} style={{ display: 'flex', gap: '14px', marginBottom: '12px', padding: '10px 14px', background: 'var(--bg-section)', borderRadius: '2px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ minWidth: '36px', height: '36px', borderRadius: '50%', background: `${phaseColor}22`, color: phaseColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                        {step.n}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{step.title}</span>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '0', background: `${phaseColor}22`, color: phaseColor }}>{phaseLabel}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{step.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: '16px 32px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  上記の制作フローに沿って進行いたします。<br/>ご了承の上、お見積もりにお進みください。
                </p>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setWorkflowAgreed(true);
                    setShowWorkflowModal(false);
                    // 了承後に次の質問へ進む
                    const currentAnswer = answers['client_type'];
                    if (currentAnswer) {
                      const newAnswers = { ...answers };
                      const newVisible = questions.filter(q => !q.condition || q.condition(newAnswers));
                      const currentIdx = newVisible.findIndex(q => q.id === 'client_type');
                      if (currentIdx < newVisible.length - 1) {
                        setCurrentStep(questions.findIndex(q => q.id === newVisible[currentIdx + 1].id));
                      }
                    }
                  }}
                  style={{ padding: '12px 32px', fontSize: '14px', whiteSpace: 'nowrap' }}
                >
                  了承して進む
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
