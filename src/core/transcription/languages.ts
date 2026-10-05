import type { HinglishDomain, LanguageCode } from '../types/project';

/**
 * How a UI language maps onto what a Whisper-family model actually needs.
 *
 * Whisper has no "Hinglish" language. Hinglish is predominantly Hindi speech
 * with English code-switches, so the recogniser must hear it as Hindi rather
 * than forcing Hindi sounds into English guesses. The result may use Devanagari;
 * we romanise those spans locally while leaving English text untouched.
 */
export interface LanguageConfig {
  code: LanguageCode;
  label: string;
  hint: string;
  /** ISO code handed to the model, or null to let it auto-detect */
  whisperLanguage: string | null;
  /**
   * Style-priming text for providers that accept one.
   *
   * This must be a *sample of the desired output*, never an instruction.
   * Whisper treats this field as preceding context and transcribes anything
   * instruction-shaped straight into the result — an earlier version reading
   * "Do not translate the Hindi into English" produced the literal caption
   * "Do not translated into English." A representative sentence primes the
   * vocabulary and script without leaking.
   */
  prompt: string | null;
  /** convert Devanagari output to Roman script after transcription */
  romanise: boolean;
  /** models below this quality tier translate instead of transcribing */
  requiresLargeModel: boolean;
}

import { DEVANAGARI_ENGLISH } from './englishLexicon';
import { normalizeHindiText } from './hindiLexicon';
import { DEVANAGARI_HINDI_TO_ROMAN, HINGLISH_CANONICAL_SPELLINGS } from './hinglishLexicon';

export const HINGLISH_DOMAIN_PROMPTS: Record<HinglishDomain, string> = {
  general:
    'Namaste doston! Welcome back to my YouTube channel. Aaj ke is video mein hum discuss karenge digital marketing strategy, client acquisition, ad revenue, aur Instagram reels ke viral algorithms. Maine Danube properties ke saath project budget negotiate ki thi. Basically agar aapko video editing, Photoshop, Premiere Pro ya AI tools mein koi doubt hai toh comment section mein zaroor poochiye. Channel ko subscribe karein, bell icon dabayein, aur apne friends ke saath share karein.',
  tech:
    'Hello developers! Aaj ke is video mein hum fullstack web development, React components, Node.js API endpoints, database schema, aur Docker containers deploy karne ke baare mein baat karenge. Basically agar code execution mein runtime error ya syntax bug aaye toh console logs check karein, GitHub repo pull karein, aur localhost server restart karein.',
  business:
    'Welcome everyone. Aaj hum discuss karenge startup growth strategy, customer retention, revenue generation, client onboarding, aur profit margins. Maine quarterly marketing budget, ROI metrics, aur sales funnel analyze kiya tha. Basically business scale karne ke liye cash flow, equity valuation, aur product market fit samajhna bahut zaroori hai.',
  vlog:
    'Hey guys, welcome back to my vlog! Aaj hum ja rahe hain apne friends ke saath ek amazing road trip aur cafe explore karne. Weather bahut achha hai aur humne weekend travel plan banaya tha. Basically street food tasting, shopping, aur fun activities enjoy karenge. Video ko like karein, comment karein, aur vlog end tak zaroor dekhiye.',
  education:
    'Namaste students. Aaj ke is lecture mein hum cover karenge important concepts, exam preparation strategy, numerical problem solving, aur theoretical formulas. Agar aapko syllabus ke kisi topic mein doubt ho toh revision notes download karein, previous year questions practice karein, aur doubt session mein poochiye.',
};

export const HINGLISH_DOMAINS: Array<{ id: HinglishDomain; label: string; description: string }> = [
  { id: 'general', label: 'General / Creator', description: 'Social media, content creation, video editing & YouTube' },
  { id: 'tech', label: 'Tech & Coding', description: 'Programming, software dev, APIs & developer tools' },
  { id: 'business', label: 'Business & Finance', description: 'Startups, sales, marketing, real estate & investments' },
  { id: 'vlog', label: 'Casual & Daily Vlog', description: 'Travel, food, lifestyle, friends & conversations' },
  { id: 'education', label: 'Education & Tutorial', description: 'Lectures, exams, concepts & student study guides' },
];

export const getHinglishPrompt = (domain?: HinglishDomain): string => {
  return HINGLISH_DOMAIN_PROMPTS[domain ?? 'general'] ?? HINGLISH_DOMAIN_PROMPTS.general;
};

export const LANGUAGES: Record<LanguageCode, LanguageConfig> = {
  auto: {
    code: 'auto',
    label: 'Auto Detect',
    hint: 'Detects English and Hindi code-switching. Keeps English words in English and converts Hindi into natural Roman Hinglish.',
    whisperLanguage: null,
    prompt:
      'Hello everyone, welcome back. Aaj ke is video mein hum discuss karenge digital content creation, business strategy, latest technology, aur creative ideas. Like, share, and subscribe for more tutorials.',
    romanise: false,
    requiresLargeModel: false,
  },
  en: {
    code: 'en',
    label: 'English',
    hint: 'Transcribes speech in English with rich vocabulary, brand names, and terminology.',
    whisperLanguage: 'en',
    prompt:
      'Welcome back to the channel. Today we are discussing business strategy, artificial intelligence tools, software engineering, digital content creation, video editing workflows, revenue generation, marketing campaigns, and analytics. We analyze market trends, client communication, and creative solutions. Like, share, and subscribe for more in-depth tutorials.',
    romanise: false,
    requiresLargeModel: false,
  },
  'en-IN': {
    code: 'en-IN',
    label: 'English India',
    hint: 'English with Indian pronunciation, names, places, and business/tech vocabulary.',
    whisperLanguage: 'en',
    prompt:
      'Welcome back. In today’s video, we are discussing the startup ecosystem in Bengaluru, Mumbai, and Delhi NCR, analyzing GST compliance, venture capital investments, product architecture, client acquisition, revenue metrics in lakhs and crores, digital marketing campaigns, and AI tools for content creators. Like, share, and subscribe.',
    romanise: false,
    requiresLargeModel: false,
  },
  hinglish: {
    code: 'hinglish',
    label: 'Hinglish',
    hint: 'Hindi with English words. Keeps English words in proper English and transliterates Hindi to Roman letters.',
    whisperLanguage: 'hi',
    prompt: getHinglishPrompt('general'),
    romanise: true,
    requiresLargeModel: true,
  },
  hi: {
    code: 'hi',
    label: 'Hindi',
    hint: 'Transcribes Hindi speech in Devanagari script (हिंदी) with accurate vocabulary.',
    whisperLanguage: 'hi',
    prompt:
      'नमस्ते दोस्तों! हमारे चैनल में आपका स्वागत है। आज के इस वीडियो में हम डिजिटल मार्केटिंग, स्टार्टअप, बिजनेस स्ट्रैटेजी, टेक्नोलॉजी, सॉफ्टवेयर, कंटेंट क्रिएशन और नए ऑनलाइन टूल्स के बारे में बात करेंगे। यदि आपके पास कोई सवाल है तो कमेंट में बताएं। वीडियो को लाइक करें, शेयर करें और चैनल को सब्सक्राइब करें।',
    romanise: false,
    requiresLargeModel: true,
  },
  ur: {
    code: 'ur',
    label: 'Urdu',
    hint: 'Transcribes Urdu speech in Nastaliq / Perso-Arabic script (اردو).',
    whisperLanguage: 'ur',
    prompt: 'خوش آمدید! آج کی ویڈیو میں ہم ڈیجیٹل مارکیٹنگ اور سوشل میڈیا اسٹریٹجی پر بات کریں گے۔',
    romanise: false,
    requiresLargeModel: true,
  },
  pa: {
    code: 'pa',
    label: 'Punjabi',
    hint: 'Transcribes Punjabi speech in Gurmukhi script (ਪੰਜਾਬੀ).',
    whisperLanguage: 'pa',
    prompt: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਦੋਸਤੋ! ਸਾਡੇ ਚੈਨਲ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ। ਵੀਡੀਓ ਨੂੰ ਲਾਈਕ ਅਤੇ ਸ਼ੇਅਰ ਜ਼ਰੂਰ ਕਰੋ।',
    romanise: false,
    requiresLargeModel: true,
  },
  bn: {
    code: 'bn',
    label: 'Bengali',
    hint: 'Transcribes Bengali speech in Bengali script (বাংলা).',
    whisperLanguage: 'bn',
    prompt: 'নমস্কার বন্ধুরা! আমাদের চ্যানেলে আপনাদের স্বাগত। আজকের ভিডিওতে আমরা নতুন প্রযুক্তি নিয়ে আলোচনা করব।',
    romanise: false,
    requiresLargeModel: true,
  },
  mr: {
    code: 'mr',
    label: 'Marathi',
    hint: 'Transcribes Marathi speech in Devanagari script (मराठी).',
    whisperLanguage: 'mr',
    prompt: 'नमस्कार मित्रांनो! आपल्या चॅनलवर स्वागत आहे. आज आपण नवीन बिझनेस स्ट्रॅटेजी आणि तंत्रज्ञानावर चर्चा करणार आहोत.',
    romanise: false,
    requiresLargeModel: true,
  },
  gu: {
    code: 'gu',
    label: 'Gujarati',
    hint: 'Transcribes Gujarati speech in Gujarati script (ગુજરાતી).',
    whisperLanguage: 'gu',
    prompt: 'નમસ્તે મિત્રો! અમારી ચેનલમાં આપનું સ્વાગત છે. આજના વીડિયોમાં આપણે નવા બિઝનેસ આઈડિયા પર વાત કરીશું.',
    romanise: false,
    requiresLargeModel: true,
  },
  ta: {
    code: 'ta',
    label: 'Tamil',
    hint: 'Transcribes Tamil speech in Tamil script (தமிழ்).',
    whisperLanguage: 'ta',
    prompt: 'வணக்கம் நண்பர்களே! நமது சேனலுக்கு உங்களை வரவேற்கிறோம். இன்றைய வீடியோவில் புதிய தொழில்நுட்பம் பற்றி விவாதிப்போம்.',
    romanise: false,
    requiresLargeModel: true,
  },
  te: {
    code: 'te',
    label: 'Telugu',
    hint: 'Transcribes Telugu speech in Telugu script (తెలుగు).',
    whisperLanguage: 'te',
    prompt: 'నమస్కారం మిత్రులారా! మన ఛానల్‌కి స్వాగతం. ఈ వీడియోలో వ్యాపార వ్యూహాలు మరియు కొత్త విషయాల గురించి మాట్లాడుకుందాం.',
    romanise: false,
    requiresLargeModel: true,
  },
  kn: {
    code: 'kn',
    label: 'Kannada',
    hint: 'Transcribes Kannada speech in Kannada script (ಕನ್ನಡ).',
    whisperLanguage: 'kn',
    prompt: 'ನಮಸ್ಕಾರ ಸ್ನೇಹಿತರೇ! ನಮ್ಮ ಚಾನೆಲ್‌ಗೆ ಸ್ವಾಗತ. ಇಂದಿನ ವಿಡಿಯೋದಲ್ಲಿ ಹೊಸ ತಂತ್ರಜ್ಞಾನದ ಬಗ್ಗೆ ಚರ್ಚಿಸೋಣ.',
    romanise: false,
    requiresLargeModel: true,
  },
  ml: {
    code: 'ml',
    label: 'Malayalam',
    hint: 'Transcribes Malayalam speech in Malayalam script (മലയാളം).',
    whisperLanguage: 'ml',
    prompt: 'നമസ്കാരം സുഹൃത്തുക്കളെ! ഞങ്ങളുടെ ചാനലിലേക്ക് സ്വാഗതം. ഇന്നത്തെ വീഡിയോയിൽ പുതിയ കാര്യങ്ങൾ ചർച്ച ചെയ്യാം.',
    romanise: false,
    requiresLargeModel: true,
  },
};

export const LANGUAGE_ORDER: LanguageCode[] = [
  'auto',
  'hinglish',
  'en',
  'en-IN',
  'hi',
  'ur',
  'pa',
  'bn',
  'mr',
  'gu',
  'ta',
  'te',
  'kn',
  'ml',
];

// ---------------------------------------------------------------------------
// Devanagari to Roman
// ---------------------------------------------------------------------------

const VOWELS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri',
  ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऍ: 'e', ऑ: 'o',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
};

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v', ळ: 'l',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  क़: 'q', ख़: 'kh', ग़: 'gh', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f',
};

const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const NUKTA = '़';

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

export const hasDevanagari = (text: string) => /[ऀ-ॿ]/.test(text);

const ROMAN_HINGLISH_NORMALISATIONS: Record<string, string> = {
  // English words commonly mangled by transliteration
  aaphara: 'offer',
  aaphis: 'office',
  aiphoon: 'iPhone',
  akaurnt: 'account',
  apaartament: 'apartment',
  asapataal: 'hospital',
  baaik: 'bike',
  bijnas: 'business',
  bilading: 'building',
  bussiness: 'business',
  chainal: 'channel',
  daaktar: 'doctor',
  debita: 'debit',
  diskaunt: 'discount',
  dokyoomentari: 'documentary',
  dokyoomentree: 'documentary',
  edaiting: 'editing',
  egjaam: 'exam',
  endroid: 'Android',
  folovars: 'followers',
  googal: 'Google',
  gugal: 'Google',
  hospitaal: 'hospital',
  imel: 'email',
  instaagraam: 'Instagram',
  instagraam: 'Instagram',
  intaranet: 'internet',
  intaravyoo: 'interview',
  integreted: 'integrated',
  iphona: 'iPhone',
  kaara: 'car',
  kaimaraa: 'camera',
  kampyootar: 'computer',
  kastamar: 'customer',
  kemra: 'camera',
  klaient: 'client',
  kolej: 'college',
  kredita: 'credit',
  lapataap: 'laptop',
  maarketing: 'marketing',
  mateeriyal: 'material',
  matiriyal: 'material',
  mesij: 'message',
  mobail: 'mobile',
  netaphliks: 'Netflix',
  paadakaast: 'podcast',
  paasavard: 'password',
  peament: 'payment',
  pharneechar: 'furniture',
  pheel: 'feel',
  phesabuk: 'Facebook',
  phlait: 'flight',
  prablam: 'problem',
  projeckt: 'project',
  propheshanal: 'professional',
  restaurent: 'restaurant',
  revenyoo: 'revenue',
  sabsakraib: 'subscribe',
  saemasang: 'Samsung',
  sar: 'sir',
  selari: 'salary',
  sistam: 'system',
  skool: 'school',
  skreen: 'screen',
  solyooshan: 'solution',
  steshan: 'station',
  styoodent: 'student',
  taimlain: 'timeline',
  teachar: 'teacher',
  thambanel: 'thumbnail',
  tikat: 'ticket',
  traiphik: 'traffic',
  tren: 'train',
  twitar: 'Twitter',
  vatsaep: 'WhatsApp',
  veediyo: 'video',
  whatsap: 'WhatsApp',
  yootyoob: 'YouTube',

  // Common Hindi romanisations & schwa-heavy outputs
  aaega: 'aayega',
  aaegaa: 'aayega',
  aaegi: 'aayegi',
  aaenge: 'aayenge',
  aapaka: 'aapka',
  aapakaa: 'aapka',
  aapake: 'aapke',
  aapaki: 'aapki',
  aapakee: 'aapki',
  aapane: 'aapne',
  aasapaas: 'aas paas',
  achchha: 'achha',
  achchhaa: 'achha',
  achchhee: 'achhi',
  apanaa: 'apna',
  apane: 'apne',
  apanee: 'apni',
  baavajood: 'bawajood',
  baavajooda: 'bawajood',
  bachchaa: 'bachcha',
  badaaa: 'bada',
  badhaaa: 'badha',
  bcz: 'kyunki',
  bcoz: 'kyunki',
  bhaee: 'bhai',
  bhee: 'bhi',
  bohot: 'bahut',
  bolaa: 'bola',
  bolanaa: 'bolna',
  bolane: 'bolne',
  bolee: 'boli',
  chaaloo: 'chalu',
  chalanaa: 'chalna',
  chalataa: 'chalta',
  chaltaa: 'chalta',
  chhotaa: 'chhota',
  dekhanaa: 'dekhna',
  dekhane: 'dekhne',
  dekhaa: 'dekha',
  dekhee: 'dekhi',
  denaa: 'dena',
  dene: 'dene',
  detaa: 'deta',
  detee: 'deti',
  dhyaan: 'dhyan',
  diladaar: 'dildaar',
  diyaa: 'diya',
  dostee: 'dosti',
  dubaee: 'Dubai',
  hajaar: 'hazaar',
  hamaara: 'hamara',
  hamaaraa: 'hamara',
  hamaaree: 'hamari',
  hameshaa: 'hamesha',
  hmesha: 'hamesha',
  hee: 'hi',
  hogaa: 'hoga',
  hogee: 'hogi',
  hotaa: 'hota',
  hotee: 'hoti',
  isaka: 'iska',
  isalie: 'isliye',
  isaliye: 'isliye',
  itanaa: 'itna',
  itanee: 'itni',
  itane: 'itne',
  jaaega: 'jaayega',
  jaaegaa: 'jaayega',
  jaaegi: 'jaayegi',
  jaaenge: 'jaayenge',
  jaaoongaa: 'jaunga',
  jaroor: 'zaroor',
  jayaadaa: 'zyada',
  jisako: 'jisko',
  jyaada: 'zyada',
  jyaadaa: 'zyada',
  kaa: 'ka',
  kabhee: 'kabhi',
  karanaa: 'karna',
  karane: 'karne',
  karataa: 'karta',
  karate: 'karte',
  karatee: 'karti',
  karegaa: 'karega',
  karegee: 'karegi',
  karod: 'crore',
  karoda: 'crore',
  karoon: 'karu',
  karun: 'karu',
  karoo: 'karu',
  karon: 'karu',
  kese: 'kaise',
  khatama: 'khatam',
  kiyaa: 'kiya',
  koo: 'ko',
  kyaa: 'kya',
  kyon: 'kyun',
  kyonki: 'kyunki',
  kyoonki: 'kyunki',
  lenaa: 'lena',
  lene: 'lene',
  mai: 'main',
  mainne: 'maine',
  matalab: 'matlab',
  milegaa: 'milega',
  naheen: 'nahi',
  padegaa: 'padega',
  pahala: 'pehla',
  pahalaa: 'pehla',
  pahale: 'pehle',
  pahle: 'pehle',
  pahli: 'pehli',
  pehela: 'pehla',
  pehele: 'pehle',
  plz: 'please',
  poochha: 'poocha',
  poochhaa: 'poocha',
  rahaa: 'raha',
  rahee: 'rahi',
  rupae: 'rupaye',
  sabase: 'sabse',
  sakataa: 'sakta',
  sakatee: 'sakti',
  sakate: 'sakte',
  samajhanaa: 'samajhna',
  samajhane: 'samajhne',
  shuroo: 'shuru',
  sirpha: 'sirf',
  smjh: 'samajh',
  thik: 'theek',
  thodaa: 'thoda',
  unaka: 'unka',
  unakaa: 'unka',
  unake: 'unke',
  unaki: 'unki',
  unakee: 'unki',
  unhone: 'unhone',
  unhonne: 'unhone',
  usaka: 'uska',
  usakaa: 'uska',
  usake: 'uske',
  usaki: 'uski',
  usakee: 'uski',
  usako: 'usko',
  usane: 'usne',
  vaalaa: 'wala',
  wahaan: 'wahan',
  wese: 'waise',
  yahaan: 'yahan',
  zyaada: 'zyada',
};

/** Standardises common Hindi romanisation and English loanwords without an SOP. */
export const normaliseRomanHinglish = (input: string): string =>
  input.replace(/\p{L}+/gu, (word) => {
    const lower = word.toLocaleLowerCase('en');
    const replacement =
      ROMAN_HINGLISH_NORMALISATIONS[lower] ||
      HINGLISH_CANONICAL_SPELLINGS[lower];
    if (!replacement) return word;
    if (/^\p{Lu}/u.test(word) && replacement !== 'Netflix') {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });

/**
 * Best-effort Devanagari to Roman transliteration for Hinglish captions.
 *
 * This is a readability aid, not a scholarly scheme: it drops the inherent
 * schwa at word end (so "काम" reads "kaam", not "kaama") because that is how
 * Hinglish is actually written.
 */
export const romaniseDevanagari = (input: string): string => {
  let out = '';
  const chars = Array.from(input);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (ch === NUKTA) continue;

    if (DEVANAGARI_DIGITS[ch]) {
      out += DEVANAGARI_DIGITS[ch];
      continue;
    }

    if (VOWELS[ch]) {
      out += VOWELS[ch];
      continue;
    }

    if (MATRAS[ch]) {
      out += MATRAS[ch];
      continue;
    }

    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      out += 'n';
      continue;
    }

    if (ch === VISARGA) {
      out += 'h';
      continue;
    }

    if (ch === VIRAMA) {
      // the consonant before it already had its schwa suppressed below
      continue;
    }

    const consonant = CONSONANTS[ch];
    if (consonant) {
      out += consonant;

      // A consonant carries an inherent "a" unless a virama, a matra or the end
      // of the word removes it.
      const followedByVirama = next === VIRAMA;
      const followedByMatra = next !== undefined && MATRAS[next] !== undefined;
      const atWordEnd = next === undefined || /[\s\p{P}]/u.test(next);

      // Schwa deletion: a non-initial consonant followed by another consonant which carries a matra
      // (e.g. आप + ने -> aapne, उस + के -> uske, कर + ते -> karte)
      const afterNext = chars[i + 2];
      const followedByConsonantWithMatra =
        i > 0 &&
        next !== undefined &&
        CONSONANTS[next] !== undefined &&
        afterNext !== undefined &&
        MATRAS[afterNext] !== undefined;

      if (!followedByVirama && !followedByMatra && !atWordEnd && !followedByConsonantWithMatra) {
        out += 'a';
      }
      continue;
    }

    out += ch;
  }

  return out;
};

/** Applies the language's post-processing to a transcript fragment. */
export const postProcessText = (text: string, language: LanguageCode): string => {
  if (language === 'hi') {
    return normalizeHindiText(text);
  }
  const config = LANGUAGES[language];
  if (config?.romanise) {
    if (!hasDevanagari(text)) {
      return normaliseRomanHinglish(text);
    }

    // Convert Devanagari tokens while leaving Latin English tokens, spaces, and punctuation intact
    const processed = text.replace(/[\u0900-\u097F\uA8E0-\uA8FF]+/gu, (core) => {
      // 1. Check if it is a known English word written in Devanagari (e.g. वीडियो -> video, सिस्टम -> system)
      const directEnglish =
        DEVANAGARI_ENGLISH[core] ||
        DEVANAGARI_ENGLISH[core.normalize('NFC')] ||
        DEVANAGARI_ENGLISH[core.normalize('NFD')] ||
        DEVANAGARI_ENGLISH[core.replace(/[\u093C]/g, '')];
      if (directEnglish) return directEnglish;

      // 2. Check if it is a known Hindi word in Devanagari (e.g. मैं -> main, क्या -> kya, करूँ -> karu)
      const directHindiRoman =
        DEVANAGARI_HINDI_TO_ROMAN[core] ||
        DEVANAGARI_HINDI_TO_ROMAN[core.normalize('NFC')] ||
        DEVANAGARI_HINDI_TO_ROMAN[core.normalize('NFD')] ||
        DEVANAGARI_HINDI_TO_ROMAN[core.replace(/[\u093C]/g, '')];
      if (directHindiRoman) return directHindiRoman;

      // 3. Fallback to algorithmic romanisation
      return romaniseDevanagari(core);
    });

    return normaliseRomanHinglish(processed);
  }
  return text;
};
