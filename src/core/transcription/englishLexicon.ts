/**
 * Keeps English words spelled in English.
 *
 * Speech models routinely return an English word the way an Indian speaker
 * pronounces it — "Netflics", "Yutub", "Instagraam" — or in Devanagari, which
 * a transliterator then turns into "netaphliks". An LLM pass can repair this,
 * but only when the call succeeds and the token count survives; that is not
 * good enough for a brand name that must be right every single time.
 *
 * So this runs first and deterministically: a phonetic key plus a tight edit
 * distance, against a list of words that are always spelled the English way.
 */

/** Canonical spellings. Order does not matter; matching is by phonetic key. */
export const ENGLISH_LEXICON: string[] = [
  // streaming, social and creators
  'Netflix', 'YouTube', 'Instagram', 'WhatsApp', 'Facebook', 'Twitter', 'Threads',
  'Snapchat', 'LinkedIn', 'Telegram', 'Pinterest', 'Reddit', 'Discord', 'Twitch',
  'TikTok', 'Spotify', 'Hotstar', 'JioCinema', 'Prime', 'Shorts', 'Reels',
  'creator', 'content', 'audience', 'channel', 'subscriber', 'subscribers', 'follower',
  'followers', 'influencer', 'influencers', 'vlog', 'vlogger', 'vlogging', 'podcast',
  'podcaster', 'podcasting', 'streamer', 'streaming', 'livestream', 'broadcast',
  'webinar', 'community', 'superchat', 'membership', 'sponsor', 'sponsors', 'sponsorship',
  'collaboration', 'collab', 'collabs', 'monetize', 'monetization', 'adsense',
  'thumbnail', 'thumbnails', 'headline', 'caption', 'captions', 'subtitle', 'subtitles',
  'description', 'keywords', 'tags', 'script', 'storyboard', 'voiceover', 'footage',
  'b-roll', 'a-roll', 'jump cut', 'transition', 'transitions', 'animation', 'keyframes',
  'lower third', 'color grade', 'sound design', 'headphones', 'tripod', 'gimbal',
  'lighting', 'softbox', 'ring light', 'teleprompter', 'microphone', 'sound effect',
  'reach', 'impressions', 'engagement', 'retention', 'watch time', 'clickthrough',

  // tech companies, platforms, devices and products
  'Google', 'Apple', 'iPhone', 'iPad', 'Android', 'Samsung', 'OnePlus', 'Xiaomi',
  'Redmi', 'Microsoft', 'Windows', 'Amazon', 'Flipkart', 'Myntra', 'Swiggy', 'Zomato',
  'Paytm', 'PhonePe', 'Zerodha', 'Groww', 'AngelOne', 'Upstox', 'CRED', 'Uber', 'Ola',
  'Rapido', 'Nykaa', 'Meesho', 'Blinkit', 'Zepto', 'InDrive', 'ChatGPT', 'OpenAI',
  'Claude', 'Anthropic', 'Gemini', 'Copilot', 'Cursor', 'DeepSeek', 'Perplexity',
  'Midjourney', 'Stable Diffusion', 'ElevenLabs', 'Runway', 'Photoshop', 'Premiere',
  'CapCut', 'Canva', 'Figma', 'MacBook', 'AirPods', 'PlayStation', 'Bluetooth', 'WiFi',
  'Gmail', 'Chrome', 'Danube', 'Dubai', 'UAE', 'GCC',

  // technology, software, web development & coding
  'laptop', 'desktop', 'monitor', 'keyboard', 'mouse', 'processor', 'storage',
  'memory', 'battery', 'charger', 'cable', 'adapter', 'port', 'router', 'modem',
  'hotspot', 'network', 'bandwidth', 'connection', 'server', 'cloud', 'database',
  'developer', 'programmer', 'coding', 'software', 'hardware', 'application',
  'website', 'browser', 'domain', 'hosting', 'login', 'logout', 'signup',
  'register', 'password', 'passcode', 'username', 'profile', 'account',
  'verification', 'security', 'firewall', 'antivirus', 'debug', 'debugging', 'version',
  'feature', 'features', 'settings', 'preferences', 'notification', 'notifications',
  'backup', 'download', 'upload', 'install', 'terminal', 'console', 'repository',
  'Python', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Next.js', 'Node.js',
  'Express', 'Tailwind', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Firebase',
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'GraphQL', 'REST', 'API', 'APIs', 'JSON',
  'webhook', 'SDK', 'CLI', 'GitHub', 'GitLab', 'commit', 'branch', 'merge', 'pull request',
  'rebase', 'refactor', 'syntax', 'variable', 'function', 'component', 'props', 'state',
  'frontend', 'backend', 'fullstack', 'devops', 'serverless', 'microservices', 'pipeline',
  'deployment', 'staging', 'production', 'testing', 'benchmark', 'optimization',
  'latency', 'throughput', 'caching', 'scalability', 'authentication', 'endpoint',
  'responsive', 'viewport', 'typography', 'svg', 'canvas', 'algorithm',

  // AI & Machine Learning terminology
  'AI', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
  'LLM', 'transformer', 'fine-tuning', 'prompt', 'prompts', 'prompting', 'token', 'tokens',
  'context window', 'embedding', 'vector', 'vector database', 'inference', 'hallucination',
  'agent', 'agents', 'agentic', 'autonomous',

  // money, business, commerce, startups and real estate
  'business', 'marketing', 'strategy', 'brand', 'client', 'clients', 'project',
  'budget', 'profit', 'revenue', 'investment', 'investor', 'investors', 'startup',
  'startups', 'company', 'product', 'service', 'services', 'customer', 'customers',
  'market', 'price', 'cost', 'discount', 'offer', 'payment', 'salary', 'interest',
  'insurance', 'property', 'furnished', 'apartment', 'apartments', 'construction',
  'building', 'material', 'furniture', 'integrated', 'villa', 'rental', 'advantage',
  'intention', 'bulk', 'person', 'people', 'entrepreneur', 'founder', 'founders',
  'co-founder', 'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'director', 'executive', 'leader',
  'employee', 'consumer', 'valuation', 'equity', 'shares', 'stocks', 'trading',
  'trader', 'dividend', 'portfolio', 'crypto', 'cryptocurrency', 'Bitcoin', 'Ethereum',
  'blockchain', 'wallet', 'turnover', 'margin', 'margins', 'invoice', 'quotation',
  'receipt', 'billing', 'transaction', 'credit', 'debit', 'mortgage', 'banking',
  'commercial', 'residential', 'interior', 'interiors', 'renovation', 'architecture',
  'infrastructure', 'tenant', 'landlord', 'lease', 'agreement', 'contract', 'deal',
  'negotiation', 'partnership', 'franchise', 'agency', 'consulting', 'logistics',
  'shipping', 'warehouse', 'inventory', 'wholesale', 'retail', 'distributor', 'supplier',
  'vendor', 'manufacturing', 'factory', 'export', 'import', 'bootstrapping', 'venture capital',
  'angel investor', 'pitch deck', 'dilution', 'runway', 'burn rate', 'cash flow', 'ARR',
  'MRR', 'gross profit', 'net profit', 'EBITDA', 'CAC', 'LTV', 'ROI', 'KPI', 'B2B', 'B2C',
  'D2C', 'SaaS', 'marketplace', 'freemium', 'churn', 'conversion', 'funnel', 'growth hack',
  'scale', 'pivot', 'product market fit', 'roadmap', 'milestone', 'stakeholder',

  // Indian business, currencies, cities & context
  'crore', 'crores', 'lakh', 'lakhs', 'thousand', 'million', 'billion', 'rupee', 'rupees',
  'dollar', 'dollars', 'dirham', 'dirhams', 'GST', 'TDS', 'PAN', 'Aadhaar', 'UPI',
  'mutual fund', 'SIP', 'FD', 'demat', 'Sensex', 'Nifty', 'flat', 'flats', 'duplex',
  'penthouse', 'carpet area', 'square feet', 'sq ft', 'possession', 'stamp duty',
  'amenities', 'broker', 'brokerage', 'Bengaluru', 'Bangalore', 'Mumbai', 'New Delhi',
  'Gurgaon', 'Gurugram', 'Noida', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad',
  'Jaipur',

  // media words creators use constantly
  'video', 'audio', 'camera', 'editing', 'comment', 'comments', 'viral', 'trending',
  'documentary', 'interview', 'episode', 'episodes', 'season', 'series', 'movie',
  'trailer', 'scene', 'story', 'reel', 'reels', 'shoot', 'render', 'rendering', 'review',
  'resolution', 'framerate', 'fps', 'codec', 'aspect ratio',

  // work, career and everyday conversational English
  'actually', 'basically', 'obviously', 'literally', 'definitely', 'exactly', 'properly',
  'honestly', 'seriously', 'perfect', 'perfectly', 'completely', 'totally', 'probably',
  'particularly', 'specifically', 'especially', 'immediately', 'frequently', 'normally',
  'regularly', 'automatically', 'manually', 'finally', 'eventually', 'meanwhile',
  'otherwise', 'however', 'therefore', 'furthermore', 'anyway', 'professional',
  'important', 'different', 'difficult', 'possible', 'impossible', 'problem', 'solution',
  'question', 'answer', 'example', 'experience', 'information', 'education', 'technology',
  'internet', 'mobile', 'computer', 'online', 'offline', 'digital', 'system', 'quality',
  'quantity', 'percent', 'percentage', 'government', 'college', 'university', 'student',
  'teacher', 'doctor', 'hospital', 'medicine', 'exercise', 'restaurant', 'hotel', 'ticket',
  'flight', 'traffic', 'accident', 'message', 'call', 'sir', 'madam', 'simple', 'clean',
  'awesome', 'amazing', 'crazy', 'serious', 'casual', 'urgent', 'priority', 'feedback',
  'opinion', 'advice', 'suggestion', 'concept', 'logic', 'mindset', 'focus', 'target',
  'routine', 'discipline', 'motivation', 'confidence', 'stress', 'pressure', 'tension',
  'health', 'fitness', 'workout', 'training', 'travel', 'journey', 'booking', 'cancel',
  'party', 'event', 'celebration', 'festival', 'concert', 'vibe', 'vibes', 'clarity',
  'impact', 'standard', 'status', 'progress', 'guys', 'everyone', 'somebody', 'anybody',
];

/** Devanagari spellings that must resolve to an exact English word. */
export const DEVANAGARI_ENGLISH: Record<string, string> = {
  // brands and platforms
  'नेटफ्लिक्स': 'Netflix',
  'यूट्यूब': 'YouTube',
  'इंस्टाग्राम': 'Instagram',
  'व्हाट्सएप': 'WhatsApp',
  'व्हाट्सऐप': 'WhatsApp',
  'फेसबुक': 'Facebook',
  'गूगल': 'Google',
  'ऐपल': 'Apple',
  'एप्पल': 'Apple',
  'आईफोन': 'iPhone',
  'एंड्रॉयड': 'Android',
  'एंड्राइड': 'Android',
  'सैमसंग': 'Samsung',
  'अमेज़न': 'Amazon',
  'अमेजन': 'Amazon',
  'फ्लिपकार्ट': 'Flipkart',
  'स्विगी': 'Swiggy',
  'ज़ोमैटो': 'Zomato',
  'जोमैटो': 'Zomato',
  'पेटीएम': 'Paytm',
  'फोनपे': 'PhonePe',
  'ज़ीरोधा': 'Zerodha',
  'उबर': 'Uber',
  'ओला': 'Ola',
  'ट्विटर': 'Twitter',
  'टेलीग्राम': 'Telegram',
  'स्नैपचैट': 'Snapchat',
  'डैन्यूब': 'Danube',
  'डेन्यूब': 'Danube',
  'कैनवा': 'Canva',
  'फिग्मा': 'Figma',
  'फोटोशॉप': 'Photoshop',
  'प्रीमियर': 'Premiere',
  'कैपकॉट': 'CapCut',
  'चैटजीपीटी': 'ChatGPT',
  'ओपनएआई': 'OpenAI',

  // core business, property & user transcript words
  'फर्नीचर': 'furniture',
  'सर': 'sir',
  'मैडम': 'madam',
  'सिस्टम': 'system',
  'कॉस्ट': 'cost',
  'मार्केट': 'market',
  'रेट': 'rate',
  'रेट्स': 'rates',
  'सेल': 'sell',
  'पॉसिबल': 'possible',
  'कंपनी': 'company',
  'बिजनेस': 'business',
  'स्टार्ट': 'start',
  'बिल्डिंग': 'building',
  'मटीरियल': 'material',
  'मटेरियल': 'material',
  'प्रॉब्लम': 'problem',
  'सॉल्यूशन': 'solution',
  'दुबई': 'Dubai',
  'जीसीसी': 'GCC',
  'पर्सन': 'person',
  'परसेंट': 'percent',
  'करोड़': 'crore',
  'लाख': 'lakh',
  'फ्री': 'free',
  'बल्क': 'bulk',
  'कस्टमर': 'customer',
  'एडवांटेज': 'advantage',
  'इंटेंशन': 'intention',
  'मनी': 'money',
  'लाइव': 'live',
  'रेंट': 'rent',
  'रेंटल': 'rental',
  'अपार्टमेंट': 'apartment',
  'विला': 'villa',
  'फर्निश्ड': 'furnished',
  'इंटीग्रेटेड': 'integrated',

  // media & content creation
  'वीडियो': 'video',
  'ऑडियो': 'audio',
  'कैमरा': 'camera',
  'स्क्रीन': 'screen',
  'मोबाइल': 'mobile',
  'कंप्यूटर': 'computer',
  'लैपटॉप': 'laptop',
  'इंटरनेट': 'internet',
  'मार्केटिंग': 'marketing',
  'कंटेंट': 'content',
  'क्रिएटर': 'creator',
  'सब्सक्राइब': 'subscribe',
  'सब्सक्राइबर': 'subscriber',
  'सब्सक्राइबर्स': 'subscribers',
  'फॉलोअर': 'follower',
  'फॉलोअर्स': 'followers',
  'चैनल': 'channel',
  'थंबनेल': 'thumbnail',
  'टाइटल': 'title',
  'डिस्क्रिप्शन': 'description',
  'एडिटिंग': 'editing',
  'एडिट': 'edit',
  'कट': 'cut',
  'शॉट': 'shot',
  'सीन': 'scene',
  'स्क्रिप्ट': 'script',
  'पॉडकास्ट': 'podcast',
  'एपिसोड': 'episode',
  'सीरीज': 'series',
  'मूवी': 'movie',
  'फिल्म': 'film',
  'ट्रेलर': 'trailer',
  'रील': 'reel',
  'रील्स': 'reels',
  'शॉर्ट्स': 'shorts',
  'स्टोरी': 'story',
  'पोस्ट': 'post',
  'शेयर': 'share',
  'लाइक': 'like',
  'कमेंट': 'comment',
  'कमेंट्स': 'comments',
  'व्यू': 'view',
  'व्यूज': 'views',
  'वायरल': 'viral',
  'ट्रेंडिंग': 'trending',

  // tech, communication & web
  'मैसेज': 'message',
  'कॉल': 'call',
  'ईमेल': 'email',
  'पासवर्ड': 'password',
  'अकाउंट': 'account',
  'लॉगिन': 'login',
  'साइनअप': 'signup',
  'अपडेट': 'update',
  'डाउनलोड': 'download',
  'अपलोड': 'upload',
  'ऐप': 'app',
  'एप्लीकेशन': 'application',
  'सॉफ्टवेयर': 'software',
  'हार्डवेयर': 'hardware',
  'वेबसाइट': 'website',
  'नेटवर्क': 'network',
  'वाईफाई': 'WiFi',
  'ब्लूटूथ': 'Bluetooth',
  'लिंक': 'link',
  'क्लिक': 'click',
  'बटन': 'button',

  // daily conversational loanwords
  'एक्चुअली': 'actually',
  'बेसिकली': 'basically',
  'लिटरली': 'literally',
  'डेफिनेटली': 'definitely',
  'ऑब्वियसली': 'obviously',
  'सीरियसली': 'seriously',
  'पर्सनल': 'personal',
  'प्रोफेशनल': 'professional',
  'इंपॉर्टेंट': 'important',
  'डिफरेंट': 'different',
  'डिफिकल्ट': 'difficult',
  'सिंपल': 'simple',
  'इजी': 'easy',
  'हार्ड': 'hard',
  'क्लियर': 'clear',
  'कन्फर्म': 'confirm',
  'चेक': 'check',
  'रियल': 'real',
  'ओरिजिनल': 'original',
  'फेक': 'fake',
  'सुपर': 'super',
  'बेस्ट': 'best',
  'टॉप': 'top',
  'कूल': 'cool',
  'ग्रेट': 'great',
  'परफेक्ट': 'perfect',
  'नॉर्मल': 'normal',
  'स्पेशल': 'special',
  'एक्स्ट्रा': 'extra',

  // office, finance & society
  'प्रोजेक्ट': 'project',
  'क्लाइंट': 'client',
  'मीटिंग': 'meeting',
  'ऑफिस': 'office',
  'टीम': 'team',
  'बॉस': 'boss',
  'मैनेजर': 'manager',
  'लीडर': 'leader',
  'फाउंडर': 'founder',
  'सीईओ': 'CEO',
  'स्टार्टअप': 'startup',
  'इन्वेस्टमेंट': 'investment',
  'इन्वेस्टर': 'investor',
  'फंडिंग': 'funding',
  'प्रॉफिट': 'profit',
  'लॉस': 'loss',
  'रेवेन्यू': 'revenue',
  'बजट': 'budget',
  'प्राइस': 'price',
  'डिस्काउंट': 'discount',
  'ऑफर': 'offer',
  'सर्विस': 'service',
  'प्रोडक्ट': 'product',
  'क्वालिटी': 'quality',
  'ब्रांड': 'brand',
  'पेमेंट': 'payment',
  'कैश': 'cash',
  'कार्ड': 'card',
  'बैंक': 'bank',
  'लोन': 'loan',
  'ईएमआई': 'EMI',
  'टैक्स': 'tax',
  'सैलरी': 'salary',
  'पॉलिसी': 'policy',
  'हॉस्पिटल': 'hospital',
  'डॉक्टर': 'doctor',
  'मेडिसिन': 'medicine',
  'होटल': 'hotel',
  'रेस्टोरेंट': 'restaurant',
  'टिकट': 'ticket',
  'फ्लाइट': 'flight',
  'ट्रेन': 'train',
  'स्टेशन': 'station',
  'कार': 'car',
  'बाइक': 'bike',
  'ड्राइव': 'drive',
  'ट्रैफिक': 'traffic',
  'स्कूल': 'school',
  'कॉलेज': 'college',
  'यूनिवर्सिटी': 'university',
  'स्टूडेंट': 'student',
  'टीचर': 'teacher',
  'एग्जाम': 'exam',
  'टेस्ट': 'test',
  'रिजल्ट': 'result',

  // AI, developer & modern digital tools
  'एल्गोरिदम': 'algorithm',
  'एआई': 'AI',
  'प्रॉम्पट': 'prompt',
  'प्रॉम्प्ट': 'prompt',
  'टोकन': 'token',
  'कंपोनेंट': 'component',
  'डेवलपर': 'developer',
  'कोडिंग': 'coding',
  'प्रोग्रामिंग': 'programming',
  'कंसोल': 'console',
  'टर्मिनल': 'terminal',
  'डिप्लॉयमेंट': 'deployment',
  'प्रोडक्शन': 'production',
  'डेटाबेस': 'database',
  'सर्वर': 'server',
  'क्लाउड': 'cloud',
  'इन्फ्रास्ट्रक्चर': 'infrastructure',
  'एंगेजमेंट': 'engagement',
  'ऑडियंस': 'audience',
  'रीच': 'reach',
  'इम्प्रेशन': 'impression',
  'इम्प्रेशन्स': 'impressions',
  'इक्विटी': 'equity',
  'वैल्यूएशन': 'valuation',
  'प्लेटफॉर्म': 'platform',
  'मार्केटप्लेस': 'marketplace',
  'मार्जिन': 'margin',
  'कैशफ्लो': 'cash flow',
  'पार्टनरशिप': 'partnership',
  'कोलैबोरेशन': 'collaboration',
  'स्पॉन्सर': 'sponsor',
  'स्पॉन्सरशिप': 'sponsorship',
  'स्क्रीनशॉट': 'screenshot',
  'नोटिफिकेशन': 'notification',
  'इंटरफेस': 'interface',
  'डैशबोर्ड': 'dashboard',
  'टेम्पलेट': 'template',
  'टाइमलाइन': 'timeline',
  'एक्सपोर्ट': 'export',
  'रिजॉल्यूशन': 'resolution',
  'फ्रेम': 'frame',
  'फ्रेमरेट': 'framerate',
  'एनिमेशन': 'animation',
  'ट्रांजीशन': 'transition',
  'टाइपोग्राफी': 'typography',
  'फॉन्ट': 'font',
  'फॉन्ट्स': 'fonts',
  'स्टाइल': 'style',
  'प्रीमियम': 'premium',
  'कम्युनिटी': 'community',
  'डिस्कॉर्ड': 'Discord',
  'रेडिट': 'Reddit',
  'पिंटरेस्ट': 'Pinterest',
  'लिंक्डइन': 'LinkedIn',
  'थ्रेड्स': 'Threads',
  'स्पॉटिफाई': 'Spotify',
  'हॉटस्टार': 'Hotstar',
  'जियोसिनेमा': 'JioCinema',
  'माइक्रोसॉफ्ट': 'Microsoft',
  'हैडफोन': 'headphones',
  'हेडफोन': 'headphones',
  'ईयरबड्स': 'earbuds',
  'स्मार्टफोन': 'smartphone',
  'स्मार्टवॉच': 'smartwatch',
  'माइक': 'mic',
  'माइक्रोफोन': 'microphone',
  'ट्राइपॉड': 'tripod',
  'गिम्बल': 'gimbal',
  'लाइटिंग': 'lighting',
  'वर्जन': 'version',
  'फीचर': 'feature',
  'फीचर्स': 'features',
  'फीडबैक': 'feedback',
  'रिव्यू': 'review',
  'रेटिंग': 'rating',
  'जीएसटी': 'GST',
  'फ्लैट': 'flat',
  'फ्लैट्स': 'flats',
  'इंटीरियर': 'interior',
  'रेनोवेशन': 'renovation',
  'फॉलो': 'follow',
};

/**
 * A spelling-insensitive key for a word.
 *
 * Folds the ways Hindi romanisation drifts from English spelling — doubled
 * vowels, ph for f, v for w, silent endings — so "yootyoob" and "YouTube"
 * collapse onto the same key.
 */
export const phoneticKey = (input: string): string => {
  let key = input.toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return '';

  key = key
    .replace(/ph/g, 'f')
    .replace(/^wh/, 'w')
    .replace(/^v/, 'w')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/ou/g, 'u')
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/ea/g, 'i')
    .replace(/aa/g, 'a')
    .replace(/ie/g, 'i')
    .replace(/y/g, 'i')
    .replace(/e$/, '')
    .replace(/(.)\1+/g, '$1');

  return key;
};

/** Levenshtein distance, stopping early once it exceeds `limit`. */
export const editDistance = (a: string, b: string, limit = 3): number => {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }

    if (best > limit) return limit + 1;
    previous = current;
  }

  return previous[b.length];
};

interface Entry {
  canonical: string;
  key: string;
}

const buildIndex = (words: string[]): Entry[] =>
  words
    .map((canonical) => ({ canonical, key: phoneticKey(canonical) }))
    .filter((entry) => entry.key.length > 0);

let index: Entry[] = buildIndex(ENGLISH_LEXICON);

/** Adds project-specific terms — a client's brand names, say. */
export const extendLexicon = (extra: string[]): void => {
  index = buildIndex([...ENGLISH_LEXICON, ...extra]);
};

/** How far a key of this length may drift and still be the same word. */
const toleranceFor = (length: number): number => {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
};

/**
 * The canonical English spelling for a token, or null if it is not one.
 *
 * Deliberately conservative: a first-letter mismatch or a distance beyond the
 * tolerance means no match, because turning a genuine Hindi word into an
 * English one would be a worse failure than leaving a brand misspelled.
 */
export const canonicalEnglish = (token: string, extra: string[] = []): string | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Devanagari is unambiguous when we know it
  const direct = DEVANAGARI_ENGLISH[trimmed.replace(/[^ऀ-ॿ]/g, '')];
  if (direct) return direct;

  const key = phoneticKey(trimmed);
  if (key.length < 3) return null;

  const pool = extra.length > 0 ? [...buildIndex(extra), ...index] : index;

  let best: { canonical: string; distance: number } | null = null;

  for (const entry of pool) {
    if (entry.key === key) return entry.canonical;
    if (entry.key[0] !== key[0]) continue;
    if (Math.abs(entry.key.length - key.length) > 2) continue;

    const tolerance = toleranceFor(Math.min(entry.key.length, key.length));
    if (tolerance === 0) continue;

    const distance = editDistance(entry.key, key, tolerance);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { canonical: entry.canonical, distance };
    }
  }

  return best?.canonical ?? null;
};

/**
 * Repairs one token, keeping whatever punctuation was attached to it.
 *
 * A word the speaker capitalised mid-sentence is left capitalised; a brand's
 * own casing always wins, because "iPhone" is never "Iphone".
 */
export const normaliseEnglishToken = (token: string, extra: string[] = []): string => {
  const match = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(token);
  if (!match) return token;

  const [, lead, core, trail] = match;
  if (!core) return token;

  const canonical = canonicalEnglish(core, extra);
  if (!canonical) return token;

  // a brand with internal capitals keeps them exactly
  const hasInternalCaps = /[a-z][A-Z]/.test(canonical) || /^[a-z][A-Z]/.test(canonical);
  if (hasInternalCaps || canonical[0] === canonical[0].toUpperCase()) {
    return `${lead}${canonical}${trail}`;
  }

  // an ordinary word follows the casing the speaker's transcript already had
  const wasCapitalised = core[0] === core[0].toUpperCase() && core[0] !== core[0].toLowerCase();
  const cased = wasCapitalised ? canonical[0].toUpperCase() + canonical.slice(1) : canonical;
  return `${lead}${cased}${trail}`;
};
