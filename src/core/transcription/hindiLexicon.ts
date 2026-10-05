/**
 * Comprehensive Hindi vocabulary and Devanagari text normalization for Caption Maker.
 *
 * Covers core conversational, creator, media, business, and daily speech vocabulary
 * in Devanagari script, along with automated normalization for common ASR spelling
 * inconsistencies (e.g. nuqta variations, missing bindus, archaic/colloquial spellings).
 */

// ---------------------------------------------------------------------------
// 1. High-Frequency Hindi Vocabulary (1000+ words)
// ---------------------------------------------------------------------------

const PRONOUNS = [
  // First person
  'मैं', 'हम', 'मुझे', 'मुझको', 'हमें', 'हमको', 'मेरा', 'मेरी', 'मेरे', 'हमारा', 'हमारी', 'हमारे',
  'मुझसे', 'हमसे', 'मुझमें', 'हममें', 'मुझपर', 'हमपर',
  // Second person
  'आप', 'तुम', 'तू', 'आपको', 'तुम्हें', 'तुझको', 'आपका', 'आपकी', 'आपके', 'तुम्हारा', 'तुम्हारी', 'तुम्हारे',
  'तेरा', 'तेरी', 'तेरे', 'आपसे', 'तुमसे', 'तुझसे', 'आपमें', 'तुममें', 'आपपर', 'तुमपर',
  // Third person
  'वह', 'यह', 'वे', 'ये', 'उसे', 'उसको', 'इसे', 'इसको', 'उन्हें', 'उनको', 'इन्हें', 'इनको',
  'उसका', 'उसकी', 'उसके', 'इसका', 'इसकी', 'इसके', 'उनका', 'उनकी', 'उनके', 'इनका', 'इनकी', 'इनके',
  'उससे', 'इससे', 'उनसे', 'इनसे', 'उसमें', 'इसमें', 'उनमें', 'इनमें', 'उसपर', 'इसपर', 'उनपर', 'इनपर',
  // Reflexive, Indefinite & Relative
  'अपना', 'अपनी', 'अपने', 'खुद', 'स्वयं', 'आपस', 'परस्पर',
  'कोई', 'किसी', 'कुछ', 'सब', 'सबने', 'सबको', 'सबका', 'सबकी', 'सबके', 'सभी', 'हर', 'प्रत्येक',
  'जो', 'जिसने', 'जिसको', 'जिसे', 'जिसका', 'जिसकी', 'जिसके', 'जिससे', 'जिसमें', 'जिसपर',
  'जिन्होंने', 'जिनको', 'जिन्हें', 'जिनका', 'जिनकी', 'जिनके', 'जिनसे', 'जिनमें', 'जिनपर',
  'वही', 'यही', 'उन्हीं', 'इन्हीं', 'उसी', 'इसी',
];

const QUESTION_WORDS = [
  'क्या', 'क्यों', 'कैसे', 'कब', 'कहाँ', 'किधर', 'कौन', 'किसने', 'किसको', 'किसे',
  'किसका', 'किसकी', 'किसके', 'किससे', 'किसमें', 'किसपर',
  'किन्होंने', 'किनको', 'किन्हें', 'किनका', 'किनकी', 'किनके', 'किनसे', 'किनमें',
  'कितना', 'कितनी', 'कितने', 'कैसा', 'कैसी', 'कौनसा', 'कौनसी', 'कौनसे',
];

const VERBS_AND_CONJUGATIONS = [
  // Auxiliary & Copula
  'है', 'हैं', 'हूँ', 'हो', 'था', 'थी', 'थे', 'थीं', 'हूँगा', 'हूँगी', 'होगा', 'होगी', 'होंगे', 'होंगी',
  // होना
  'होना', 'होता', 'होती', 'होते', 'होतीं', 'हुआ', 'हुई', 'हुए', 'होकर', 'होके', 'होने',
  // करना
  'करना', 'करता', 'करती', 'करते', 'करतीं', 'किया', 'की', 'किए', 'करेगा', 'करेगी', 'करेंगे', 'करेंगी',
  'करो', 'करिए', 'कीजिए', 'कीजिये', 'करके', 'करने', 'करते-करते', 'करवाता', 'करवाया', 'करवाना', 'करवाओ',
  // जाना
  'जाना', 'जाता', 'जाती', 'जाते', 'जातीं', 'गया', 'गई', 'गए', 'गयी', 'गये', 'जाएगा', 'जाएगी', 'जाएंगे',
  'जाओ', 'जाइए', 'जाकर', 'जाके', 'जाने', 'जाते-जाते',
  // आना
  'आना', 'आता', 'आती', 'आते', 'आतीं', 'आया', 'आई', 'आए', 'आयी', 'आये', 'आएगा', 'आएगी', 'आएंगे',
  'आओ', 'आइए', 'आकर', 'आके', 'आने', 'आते-आते',
  // देखना
  'देखना', 'देखता', 'देखती', 'देखते', 'देखा', 'देखी', 'देखे', 'देखेगा', 'देखेगी', 'देखेंगे',
  'देखो', 'देखिए', 'देखकर', 'देखके', 'देखने', 'दिखाना', 'दिखाया', 'दिखाता', 'दिखाओ', 'दिखाइए',
  // सुनना
  'सुनना', 'सुनता', 'सुनती', 'सुनते', 'सुना', 'सुनी', 'सुने', 'सुनेगा', 'सुनेगी', 'सुनेंगे',
  'सुनो', 'सुनिए', 'सुनकर', 'सुनाने', 'सुनाता', 'सुनाया',
  // बोलना व कहना
  'बोलना', 'बोलता', 'बोलती', 'बोलते', 'बोला', 'बोली', 'बोले', 'बोलेगा', 'बोलेंगे', 'बोलो', 'बोलिए', 'बोलकर',
  'कहना', 'कहता', 'कहती', 'कहते', 'कहा', 'कही', 'कहे', 'कहेगा', 'कहेंगे', 'कहो', 'कहिए', 'कहकर', 'कहने',
  // समझना व सोचना
  'समझना', 'समझता', 'समझती', 'समझते', 'समझ', 'समझा', 'समझी', 'समझें', 'समझे', 'समझेगा', 'समझेंगे',
  'समझो', 'समझाइए', 'समझकर', 'समझाना', 'समझाता', 'समझाया', 'समझाइश',
  'सोचना', 'सोचता', 'सोचती', 'सोचते', 'सोच', 'सोचा', 'सोची', 'सोचे', 'सोचेगा', 'सोचेंगे', 'सोचो', 'सोचिए', 'सोचकर',
  // जानना व बताना
  'जानना', 'जानता', 'जानती', 'जानते', 'जाना', 'जानी', 'जाने', 'जानो', 'जानिए', 'जानकर', 'जानकारी',
  'बताना', 'बताता', 'बताती', 'बताते', 'बताया', 'बताई', 'बताए', 'बताएगा', 'बताएंगे', 'बताओ', 'बताइए', 'बताकर',
  // पूछना व मांगना
  'पूछना', 'पूछता', 'पूछती', 'पूछते', 'पूछा', 'पूछी', 'पूछे', 'पूछो', 'पूछिए', 'पूछकर',
  'मांगना', 'मांगता', 'मांगा', 'मांगी', 'मांगे', 'मांगो',
  // देना व लेना
  'देना', 'देता', 'देती', 'देते', 'देतीं', 'दिया', 'दी', 'दिए', 'दीं', 'देगा', 'देगी', 'देंगे', 'देंगी',
  'दो', 'दीजिए', 'दीजिये', 'देकर', 'देने', 'दिलाना', 'दिलाया',
  'लेना', 'लेता', 'लेती', 'लेते', 'लेतीं', 'लिया', 'ली', 'लिए', 'लीं', 'लेगा', 'लेगी', 'लेंगे', 'लेंगी',
  'लो', 'लीजिए', 'लीजिये', 'लेकर', 'लेने',
  // पाना व मिलना
  'पाना', 'पाता', 'पाती', 'पाते', 'पाया', 'पाई', 'पाए', 'पाएगा', 'पाएंगे', 'पाकर',
  'मिलना', 'मिलता', 'मिलती', 'मिलते', 'मिला', 'मिली', 'मिले', 'मिलेगा', 'मिलेगी', 'मिलेंगे',
  'मेलो', 'मिलिए', 'मिलकर', 'मिलाना', 'मिलाया',
  // लगना व रखना
  'लगना', 'लगता', 'लगती', 'लगते', 'लगा', 'लगी', 'लगे', 'लगेगा', 'लगेगी', 'लगेंगे', 'लगकर',
  'रखना', 'रखता', 'रखती', 'रखते', 'रखा', 'रखी', 'रखे', 'रखेगा', 'रखेंगे', 'रखो', 'रखिए', 'रखकर',
  // चलना व रुकना
  'चलना', 'चलता', 'चलती', 'चलते', 'चला', 'चली', 'चले', 'चलेगा', 'चलेगी', 'चलेंगे', 'चलो', 'चलिए', 'चलकर',
  'रुकना', 'रुकता', 'रुका', 'रुकी', 'रुके', 'रुको', 'रुकिए', 'रोकना', 'रोका', 'रोको',
  // बैठना, उठना व खड़ा होना
  'बैठना', 'बैठता', 'बैठा', 'बैठी', 'बैठे', 'बैठो', 'बैठिए',
  'उठना', 'उठता', 'उठा', 'उठी', 'उठे', 'उठो', 'उठाइए', 'उठाना',
  // चाहना व जरूरत
  'चाहना', 'चाहता', 'चाहती', 'चाहते', 'चाहा', 'चाहे', 'चाहिए', 'चाहिये',
  // सीखना व सिखाना
  'सीखना', 'सीखता', 'सीखती', 'सीखते', 'सीखा', 'सीखी', 'सीखे', 'सीखो', 'सीखिए',
  'सिखाना', 'सिखाता', 'सिखाया', 'सिखाओ', 'सिखाइए',
  // व्यापार व वित्तीय क्रियाएं
  'कमाना', 'कमाता', 'कमाती', 'कमाते', 'कमाया', 'कमाए', 'कमाओ',
  'बचाना', 'बचाता', 'बचाया', 'बचाइए', 'बचत',
  'खरीदना', 'खरीदता', 'खरीदा', 'खरीदी', 'खरीदे', 'खरीदो', 'खरीदिए',
  'बेचना', 'बेचता', 'बेचा', 'बेची', 'बेचे', 'बेचो', 'बेचिए',
  'बदलना', 'बदलता', 'बदला', 'बदली', 'बदले', 'बदलो', 'बदलें',
  'बढ़ना', 'बढ़ता', 'बढ़ी', 'बढ़े', 'बढ़ाना', 'बढ़ाता', 'बढ़ाया', 'बढ़ाओ',
  'घटना', 'घटता', 'घटा', 'घटी', 'घटाना', 'घटाया',
  'जीतना', 'जीता', 'जीते', 'जीत', 'हारना', 'हारा', 'हारे', 'हार',
  'छोड़ना', 'छोड़ा', 'छोड़ो', 'जोड़ना', 'जोड़ा', 'तोड़ना', 'तोड़ा',
  'भेजना', 'भेजा', 'भेजो', 'लाना', 'लाया', 'लाओ', 'पहुंचना', 'पहुंचा',
  'शुरू', 'शुरु', 'शुरुआत', 'समाप्त', 'खत्म', 'बंद', 'चालू',
];

const CONNECTORS_AND_POSTPOSITIONS = [
  // Postpositions
  'का', 'के', 'की', 'में', 'पर', 'से', 'को', 'तक', 'लिए', 'साथ', 'पास', 'बिना', 'द्वारा',
  'बारे', 'सामने', 'पीछे', 'ऊपर', 'नीचे', 'अंदर', 'बाहर', 'बीच', 'तरफ', 'ओर', 'आसपास',
  'भर', 'मात्र', 'समेत', 'बावजूद',
  // Conjunctions
  'और', 'तथा', 'एवं', 'व', 'लेकिन', 'किन्तु', 'परन्तु', 'मगर', 'बल्कि', 'या', 'अथवा',
  'क्योंकि', 'क्योकि', 'चूँकि', 'इसलिए', 'ताकि', 'अगर', 'यदि', 'तो', 'जब', 'तब',
  'जहाँ', 'वहाँ', 'जैसे', 'वैसे', 'जितना', 'उतना', 'चाहे', 'हालांकि', 'यद्यपि', 'तथापि',
  'वरना', 'बशर्ते',
  // Particles
  'भी', 'ही', 'तो', 'ना', 'नहीं', 'मत', 'सिर्फ', 'केवल',
];

const ADVERBS_AND_TIME = [
  // Time
  'आज', 'कल', 'परसों', 'अब', 'तब', 'कभी', 'हमेशा', 'सदा', 'रोज़', 'प्रतिदिन', 'अक्सर',
  'कभी-कभी', 'तुरंत', 'जल्दी', 'फौरन', 'धीरे', 'धीरे-धीरे', 'पहले', 'बाद', 'आगे', 'पीछे',
  'फिर', 'दोबारा', 'बार-बार', 'अचानक', 'एकदम', 'सुबह', 'शाम', 'दोपहर', 'रात',
  'हफ्ता', 'सप्ताह', 'महीना', 'साल', 'वर्ष', 'सदी', 'दौरान', 'वक्त', 'समय', 'पल', 'क्षण',
  // Place & Direction
  'यहाँ', 'वहाँ', 'जहाँ', 'कहाँ', 'इधर', 'उधर', 'जिधर', 'किधर', 'कहीं', 'सर्वत्र',
  // Manner, Degree & Extent
  'शायद', 'ज़रूर', 'जरूर', 'अवश्य', 'सचमुच', 'वास्तव', 'बिल्कुल', 'बिलकुल',
  'थोड़ा', 'थोड़ी', 'थोड़े', 'बहुत', 'ज्यादा', 'ज़्यादा', 'काफी', 'कम',
  'लगभग', 'करीब', 'खासकर', 'विशेषकर', 'सीधे', 'सच', 'झूठ', 'साफ़',
];

const ADJECTIVES_AND_QUALIFIERS = [
  'अच्छा', 'अच्छी', 'अच्छे', 'बुरा', 'बुरी', 'बुरे',
  'बड़ा', 'बड़ी', 'बड़े', 'छोटा', 'छोटी', 'छोटे',
  'नया', 'नई', 'नए', 'पुराना', 'पुरानी', 'पुराने',
  'सही', 'गलत', 'सच्चा', 'झूठा', 'आसान', 'सरल', 'मुश्किल', 'कठिन',
  'जरूरी', 'ज़रूरी', 'महत्वपूर्ण', 'खास', 'आम',
  'पहला', 'पहली', 'पहले', 'दूसरा', 'दूसरी', 'दूसरे', 'तीसरा', 'तीसरी', 'तीसरे', 'चौथा', 'पांचवां', 'आखिरी', 'अंतिम',
  'सुंदर', 'बढ़िया', 'शानदार', 'असली', 'नकली', 'पूरा', 'आधा', 'अधूरा',
  'भारी', 'हल्का', 'तेज', 'धीमा', 'गहरा', 'ऊंचा', 'नीचा', 'लंबा', 'चौड़ा',
  'अमीर', 'गरीब', 'खुश', 'दुखी', 'शांत', 'तैयार', 'सक्रिय', 'सफल',
];

const BUSINESS_CREATOR_MEDIA_NOUNS = [
  // Business & Finance
  'व्यापार', 'व्यवसाय', 'काम', 'नौकरी', 'धंधा', 'कंपनी', 'संस्थान', 'बाजार', 'बाज़ार', 'दुकान',
  'ग्राहक', 'खरीदार', 'उपभोक्ता', 'पैसा', 'रुपये', 'रुपया', 'धन', 'पूंजी', 'बचत', 'निवेश',
  'मुनाफा', 'लाभ', 'फायदा', 'फ़ायदा', 'नुकसान', 'नुक़सान', 'घाटा', 'हानि',
  'कीमत', 'मूल्य', 'भाव', 'दर', 'लागत', 'खर्च', 'खर्चा', 'हिसाब', 'खाता', 'बजट', 'बिक्री', 'खरीद',
  // Dialogue, Strategy & Planning
  'बात', 'बातें', 'बातचीत', 'चर्चा', 'राय', 'विचार', 'सुझाव', 'सवाल', 'प्रश्न', 'उत्तर', 'जवाब',
  'समस्या', 'हल', 'समाधान', 'निर्णय', 'फैसला', 'फ़ैसला', 'अनुभव', 'जानकारी', 'सूचना', 'समाचार', 'खबर',
  'नियम', 'शर्त', 'तरीका', 'उपाय', 'योजना', 'रणनीति', 'लक्ष्य', 'उद्देश्य', 'कोशिश', 'प्रयास', 'मेहनत',
  'सफलता', 'कामयाबी', 'प्रगति', 'विकास', 'बदलाव', 'परिवर्तन',
  // Media, Digital & Tech
  'वीडियो', 'चैनल', 'दर्शक', 'श्रोता', 'सामग्री', 'विषय', 'शीर्षक', 'टिप्पणी', 'पसंद', 'साझा',
  'माध्यम', 'संदेश', 'इंटरनेट', 'फोन', 'मोबाइल', 'कंप्यूटर', 'स्क्रीन', 'आवाज', 'आवाज़', 'चित्र', 'तस्वीर', 'दृश्य',
  // Life & Society
  'जिंदगी', 'ज़िन्दगी', 'जीवन', 'दुनिया', 'संसार', 'देश', 'राज्य', 'शहर', 'गाँव', 'घर', 'परिवार',
  'दोस्त', 'मित्र', 'साथी', 'लोग', 'जनता', 'समाज', 'सरकार', 'कानून', 'क़ानून', 'व्यवस्था', 'अधिकार', 'कर्तव्य',
];

const GREETINGS_AND_COURTESIES = [
  'नमस्ते', 'नमस्कार', 'प्रणाम', 'स्वागत', 'धन्यवाद', 'शुक्रिया', 'अलविदा', 'शुभकामनाएं',
];

/**
 * Everyday Hindi words whose consonants happen to line up with an English
 * word ("कमरा" room / camera, "कमाल" / camel, "शहर" / share). Listing them
 * here keeps the loanword recogniser from ever trying to read them as English.
 */
const EVERYDAY_WORDS = [
  'कमरा', 'कमरे', 'कमाल', 'बदल', 'मकान', 'किसान', 'सलाह', 'शहर', 'मौसम', 'इलाज', 'मालिक',
  'ज़मीन', 'जमीन', 'मज़ा', 'मजा', 'मज़े', 'मजे', 'सपना', 'सपने', 'रास्ता', 'रास्ते', 'हालत', 'हाल',
  'मौका', 'मौके', 'कारण', 'असर', 'हिस्सा', 'हिस्से', 'किस्मत', 'इज़्ज़त', 'इज्जत', 'ताकत', 'ताक़त',
  'दिमाग', 'दिमाग़', 'दिल', 'दिन', 'रोज़', 'रोज', 'हफ़्ते', 'हफ्ते', 'महीने', 'सालों', 'घंटे', 'घंटा',
  'मिनट', 'पल', 'देर', 'जल्द', 'बाकी', 'बाक़ी', 'काफ़ी', 'अलग', 'साफ़', 'साफ', 'पक्का', 'सीधा',
  'आसानी', 'मेहनत', 'कोशिश', 'उम्मीद', 'भरोसा', 'सोना', 'चांदी', 'ज़ेवर', 'गहने', 'कर्ज़', 'कर्ज',
  'क़र्ज़', 'ब्याज', 'कमाई', 'बचत', 'खर्च', 'ख़र्च', 'मुनाफ़ा', 'मुनाफा', 'घाटा', 'दाम', 'भाव', 'माल',
  'सामान', 'दुकान', 'दुकानदार', 'मालूम', 'पता', 'मतलब', 'वजह', 'तरफ़', 'तरफ', 'हमेशा', 'कभी',
  'शायद', 'बिलकुल', 'सबसे', 'सब', 'पूरा', 'पूरी', 'पूरे', 'आधा', 'ज़्यादातर', 'ज्यादातर', 'अक्सर',
  'ऐसा', 'ऐसी', 'ऐसे', 'वैसा', 'वैसी', 'वैसे', 'जैसा', 'जैसी', 'कैसा', 'कैसी', 'कैसे', 'जुड़ा',
  'जुड़ी', 'जुड़े', 'जुड़ना', 'बना', 'बनी', 'बने', 'बनाना', 'बनाया', 'बनाते', 'बनता', 'बनती',
  'बनते', 'बन', 'अगला', 'अगली', 'अगले', 'पिछला', 'पिछली', 'पिछले', 'नया', 'नई', 'नए', 'लोगों',
  'चीज़ों', 'चीजों', 'बातों', 'सालों', 'दोनों', 'सारे', 'सारी', 'सारा', 'ख़ुद', 'खुद', 'गलती',
  'ग़लती', 'सच', 'झूठ', 'हक़', 'हक', 'मन', 'मर्ज़ी', 'मर्जी', 'राय', 'बहस', 'कहानी', 'किताब', 'पढ़ाई',
  'नौकरी', 'मालिकों', 'सरकार', 'सरकारी', 'देश', 'दुनिया', 'शेर', 'बाघ', 'मोर', 'कमल', 'समझदार',
];

// ---------------------------------------------------------------------------
// Devanagari syllable structure
// ---------------------------------------------------------------------------

/**
 * One written syllable (akshara): a consonant cluster and the vowel it
 * carries. Both romanisers work on these rather than on raw characters,
 * because Hindi drops the inherent "a" by syllable context — "समझना" is
 * "samajhna", not "samajhana" — and that cannot be decided one letter at a time.
 */
export interface Akshara {
  /** onset consonants, nukta folded in ("ज़" is one entry); empty for a written vowel */
  consonants: string[];
  /** the vowel sign or independent vowel letter; '' means the inherent schwa */
  vowel: string;
  /** the vowel is written as an independent letter (अ, आ, ए...) */
  independent: boolean;
  /** word-final cluster written with a virama and no vowel at all */
  halant: boolean;
  /** an anusvara or chandrabindu follows the vowel */
  nasal: boolean;
  visarga: boolean;
  /** the inherent schwa is not pronounced (set by `parseAksharas`) */
  silent: boolean;
}

const VIRAMA_SIGN = '्';
const NUKTA_SIGN = '़';

const isDevanagariConsonant = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= 'क' && ch <= 'ह') || (ch >= 'क़' && ch <= 'य़') || (ch >= 'ॸ' && ch <= 'ॿ'));

const isIndependentVowel = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= 'ऄ' && ch <= 'औ') || ch === 'ॠ' || ch === 'ॡ' || ch === 'ॲ');

const isVowelSign = (ch: string | undefined): boolean =>
  ch !== undefined &&
  ((ch >= 'ा' && ch <= 'ौ') || ch === 'ऺ' || ch === 'ऻ' || ch === 'ॎ' || ch === 'ॏ' ||
    (ch >= 'ॕ' && ch <= 'ॗ') || ch === 'ॢ' || ch === 'ॣ');

/** Precomposed nukta letters, which NFC leaves alone in some inputs. */
const DECOMPOSED_NUKTA: Record<string, string> = {
  'क़': 'क़', 'ख़': 'ख़', 'ग़': 'ग़', 'ज़': 'ज़',
  'ड़': 'ड़', 'ढ़': 'ढ़', 'फ़': 'फ़', 'य़': 'य़',
};

/**
 * One canonical form for a Devanagari word: nukta letters decomposed and the
 * zero-width joiners some keyboards insert removed, so "ज़्यादा" typed either
 * way finds the same dictionary entry.
 */
export const canonicalDevanagari = (word: string): string =>
  word
    .normalize('NFC')
    .replace(/[‌‍]/g, '')
    .replace(/[क़-य़]/g, (ch) => DECOMPOSED_NUKTA[ch] ?? ch);

/**
 * Splits a Devanagari word into syllables and marks which inherent vowels
 * are silent, following Ohala's schwa-deletion rule for Hindi: a schwa goes
 * at the end of a word, and between a vowel+consonant and a consonant+vowel
 * (VC_CV), deciding from the right so one deletion protects its neighbour.
 */
export const parseAksharas = (word: string): Akshara[] => {
  const chars = Array.from(canonicalDevanagari(word));
  const out: Akshara[] = [];
  let i = 0;

  const takeConsonant = (): string => {
    let consonant = chars[i++];
    if (chars[i] === NUKTA_SIGN) {
      consonant += NUKTA_SIGN;
      i++;
    }
    return consonant;
  };

  const takeModifiers = (akshara: Akshara) => {
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === 'ं' || ch === 'ँ' || ch === 'ऀ') akshara.nasal = true;
      else if (ch === 'ः') akshara.visarga = true;
      else break;
      i++;
    }
  };

  while (i < chars.length) {
    const ch = chars[i];

    if (isIndependentVowel(ch)) {
      i++;
      const akshara: Akshara = {
        consonants: [], vowel: ch, independent: true, halant: false, nasal: false, visarga: false, silent: false,
      };
      takeModifiers(akshara);
      out.push(akshara);
      continue;
    }

    if (isDevanagariConsonant(ch)) {
      const consonants = [takeConsonant()];
      let halant = false;
      while (chars[i] === VIRAMA_SIGN) {
        i++;
        if (isDevanagariConsonant(chars[i])) consonants.push(takeConsonant());
        else {
          halant = true;
          break;
        }
      }
      let vowel = '';
      if (!halant && isVowelSign(chars[i])) vowel = chars[i++];
      const akshara: Akshara = {
        consonants, vowel, independent: false, halant, nasal: false, visarga: false, silent: false,
      };
      takeModifiers(akshara);
      out.push(akshara);
      continue;
    }

    // a stray nasal sign still nasalises the syllable before it
    if ((ch === 'ं' || ch === 'ँ') && out.length > 0) out[out.length - 1].nasal = true;
    i++;
  }

  markSilentSchwas(out);
  return out;
};

const carriesSchwa = (a: Akshara) => !a.independent && !a.halant && a.vowel === '';

const markSilentSchwas = (aksharas: Akshara[]): void => {
  const n = aksharas.length;
  if (n < 2) return;

  // Word-final schwa is silent ("काम" kaam), except after a cluster ending in
  // र, य or व, where Hindi keeps it ("मित्र" mitra, "अन्य" anya).
  const last = aksharas[n - 1];
  if (carriesSchwa(last) && !last.nasal && !last.visarga) {
    const final = last.consonants[last.consonants.length - 1];
    const keeps = last.consonants.length > 1 && (final === 'र' || final === 'य' || final === 'व');
    if (!keeps) last.silent = true;
  }

  for (let i = n - 2; i >= 1; i--) {
    const current = aksharas[i];
    if (!carriesSchwa(current) || current.nasal || current.visarga || current.consonants.length !== 1) continue;
    const previous = aksharas[i - 1];
    const next = aksharas[i + 1];
    // a nasal or visarga before means the consonant already sits in a cluster
    if (previous.halant || previous.nasal || previous.visarga) continue;
    if (next.independent || next.halant || next.consonants.length !== 1) continue;
    if (carriesSchwa(next) && next.silent) continue;
    current.silent = true;
  }
};

const NUMERALS_AND_QUANTITIES = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
  'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
  'पच्चीस', 'तीस', 'पैंतीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे', 'सौ',
  'हज़ार', 'हजार', 'लाख', 'करोड़', 'अरब', 'प्रतिशत', 'फीसदी',
  'आधा', 'पौन', 'सवा', 'डेढ़', 'ढाई', 'दोगुना', 'तिगुना', 'सैकड़ों', 'हज़ारों', 'लाखों', 'करोड़ों',
];

/**
 * All verified high-frequency Hindi vocabulary entries in Devanagari.
 */
export const HINDI_VOCABULARY = new Set<string>([
  ...GREETINGS_AND_COURTESIES,
  ...EVERYDAY_WORDS,
  ...PRONOUNS,
  ...QUESTION_WORDS,
  ...VERBS_AND_CONJUGATIONS,
  ...CONNECTORS_AND_POSTPOSITIONS,
  ...ADVERBS_AND_TIME,
  ...ADJECTIVES_AND_QUALIFIERS,
  ...BUSINESS_CREATOR_MEDIA_NOUNS,
  ...NUMERALS_AND_QUANTITIES,
]);

// ---------------------------------------------------------------------------
// 2. Hindi ASR & Orthographic Spelling Normalisations
// ---------------------------------------------------------------------------

/**
 * Common misrecognitions, colloquial forms, and nuqta inconsistencies in Hindi
 * speech-to-text mapped to their standard Devanagari spelling.
 */
export const HINDI_SPELLING_NORMALISATIONS: Record<string, string> = {
  // Missing anusvara / bindu
  नही: 'नहीं',
  हू: 'हूँ',
  हूँ: 'हूँ',
  हैं: 'हैं',
  मै: 'मैं',
  क्यो: 'क्यों',
  कहा: 'कहाँ',
  यहा: 'यहाँ',
  वाहा: 'वहाँ',
  जहा: 'जहाँ',
  किधर: 'किधर',
  हमे: 'हमें',
  उन्हे: 'उन्हें',
  इन्हे: 'इन्हें',
  किन्हे: 'किन्हें',

  // Verb endings & archaic spelling variants
  हुवा: 'हुआ',
  हुई: 'हुई',
  हुये: 'हुए',
  कीया: 'किया',
  गया: 'गया',
  गयी: 'गई',
  गये: 'गए',
  आया: 'आया',
  आयी: 'आई',
  आये: 'आए',
  लाया: 'लाया',
  लायी: 'लाई',
  लाये: 'लाए',
  पायी: 'पाई',
  पाये: 'पाए',

  // Polite imperative modern standardisation (-इये -> -इए)
  कीजिये: 'कीजिए',
  दीजिये: 'दीजिए',
  लीजिये: 'लीजिए',
  चाहिये: 'चाहिए',
  आइये: 'आइए',
  जाइये: 'जाइए',
  बताइये: 'बताइए',
  देखिये: 'देखिए',
  सुनिये: 'सुनिए',
  बोलिये: 'बोलिए',
  कहिये: 'कहिए',
  समझाइये: 'समझाइए',
  रखिये: 'रखिए',
  चलिये: 'चलिए',
  पूछिये: 'पूछिए',
  दिखाइये: 'दिखाइए',

  // Conjunctions & Connectors
  क्युकि: 'क्योंकि',
  क्युकी: 'क्योंकि',
  क्योकि: 'क्योंकि',
  इस्लिए: 'इसलिए',
  इसलिये: 'इसलिए',
  ताकी: 'ताकि',
  जेसा: 'जैसा',
  वेसा: 'वैसा',

  // Nuqta standardisations for loanwords (Arabic/Persian origin in Hindi)
  जरूर: 'ज़रूर',
  जरूरत: 'ज़रूरत',
  जरूरी: 'ज़रूरी',
  जिंदगी: 'ज़िंदगी',
  जिन्दगी: 'ज़िंदगी',
  ज्यादा: 'ज़्यादा',
  फैसला: 'फ़ैसला',
  फर्क: 'फ़र्क',
  साफ: 'साफ़',
  फायदा: 'फ़ायदा',
  नुकसान: 'नुक़सान',
  कानून: 'क़ानून',
  कदम: 'क़दम',
  कीमत: 'क़ीमत',
  खरीद: 'ख़रीद',
  खर्च: 'ख़र्च',
  खर्चा: 'ख़र्चा',
  खबर: 'ख़बर',
  खास: 'ख़ास',
  खुश: 'ख़ुश',
  खुशी: 'ख़ुशी',
};

// ---------------------------------------------------------------------------
// 3. Normalization Functions
// ---------------------------------------------------------------------------

/**
 * Normalizes a single Devanagari Hindi token against standard vocabulary rules.
 */
export const normalizeHindiToken = (token: string): string => {
  if (!token) return token;

  // Extract leading/trailing punctuation
  const match = /^([^\p{L}\p{N}\p{M}]*)([\p{L}\p{N}\p{M}]+)([^\p{L}\p{N}\p{M}]*)$/u.exec(token);
  if (!match) return token;

  const [, lead, core, trail] = match;

  // Direct spelling normalisation
  const normalizedCore =
    HINDI_SPELLING_NORMALISATIONS[core] ||
    HINDI_SPELLING_NORMALISATIONS[core.normalize('NFC')] ||
    HINDI_SPELLING_NORMALISATIONS[core.normalize('NFD')];

  if (normalizedCore) {
    return `${lead}${normalizedCore}${trail}`;
  }

  return token;
};

/**
 * Normalizes a full text segment for pure Hindi mode:
 * 1. Replaces ASCII pipe '|' with Devanagari danda '।'
 * 2. Normalizes whitespace and punctuation
 * 3. Applies Hindi spelling normalisations across tokens
 */
export const normalizeHindiText = (text: string): string => {
  if (!text) return '';

  // Standardize full stops to Devanagari danda when preceded by Devanagari
  let normalized = text
    .replace(/\s*\|\s*/g, ' । ')
    .replace(/([\u0900-\u097F])\s*\.\s*(?=[\u0900-\u097F]|$)/gu, '$1 । ');

  // Tokenize and normalize words
  normalized = normalized
    .split(/(\s+)/)
    .map((piece) => {
      if (/^\s+$/.test(piece)) return piece;
      return normalizeHindiToken(piece);
    })
    .join('');

  return normalized.replace(/\s{2,}/g, ' ').trim();
};

/**
 * Checks whether a token is recognized in the high-frequency Hindi lexicon.
 */
export const isHindiWord = (word: string): boolean => {
  const clean = word.replace(/[^\u0900-\u097F]/gu, '').replace(/[\u0964\u0965\u0970]/g, '');
  return HINDI_VOCABULARY.has(clean) || HINDI_VOCABULARY_CANONICAL.has(canonicalDevanagari(clean));
};

/** The vocabulary in canonical form, so a differently-typed nukta still matches. */
const HINDI_VOCABULARY_CANONICAL = new Set([...HINDI_VOCABULARY].map(canonicalDevanagari));

/**
 * Natural, representative Hindi priming prompt for Whisper speech recognition.
 * Incorporates high-frequency conversational, business, question, and polite words.
 */
export const HINDI_VOCABULARY_PROMPT_SAMPLE =
  'नमस्ते दोस्तों! हमारे चैनल में आपका स्वागत है। आज के इस वीडियो में हम व्यापार रणनीति, नए प्रोजेक्ट, बाजार के रुझान और ग्राहक अनुभव के बारे में विस्तार से चर्चा करेंगे। यदि आपके पास कोई सवाल या सुझाव है तो कृपया कमेंट में बताइए। वीडियो को लाइक करें, अपने दोस्तों के साथ शेयर करें और चैनल को सब्सक्राइब करना न भूलें।';
