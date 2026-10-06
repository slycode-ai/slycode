/**
 * Gemini voice cloning consent statements (#0376), verbatim from Google's
 * voice-replication docs (checked 2026-10-05). The consent recording must be
 * the same person as the sample, reading one of these exactly.
 *
 * LOCKSTEP: messaging/src/tts/consent-statements.ts holds an identical copy from
 * the `export` line down (the web shows the text; messaging validates the
 * locale). Change both or neither.
 */
export interface ConsentStatement {
  locale: string;
  language: string;
  statement: string;
}

export const CONSENT_STATEMENTS: ReadonlyArray<ConsentStatement> = [
  { locale: 'ar-XA', language: 'Arabic', statement: 'أنا مالك هذا الصوت وأوافق على أن تستخدم Google هذا الصوت لإنشاء نموذج صوتي اصطناعي.' },
  { locale: 'bn-IN', language: 'Bengali', statement: 'আমি এই ভয়েসের মালিক এবং আমি একটি সিন্থেটিক ভয়েস মডেল তৈরি করতে এই ভয়েস ব্যবহার করে Google-এর সাথে সম্মতি দিচ্ছি।' },
  { locale: 'zh-CN', language: 'Chinese (Simplified)', statement: '我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型' },
  { locale: 'nl-NL', language: 'Dutch', statement: 'Ik ben de eigenaar van deze stem en ik geef Google toestemming om deze stem te gebruiken om een synthetisch stemmodel te maken.' },
  { locale: 'en-US', language: 'English (US)', statement: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.' },
  { locale: 'en-GB', language: 'English (UK)', statement: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.' },
  { locale: 'en-IN', language: 'English (India)', statement: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.' },
  { locale: 'en-AU', language: 'English (Australia)', statement: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.' },
  { locale: 'fr-FR', language: 'French (France)', statement: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique." },
  { locale: 'fr-CA', language: 'French (Canada)', statement: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique." },
  { locale: 'de-DE', language: 'German', statement: 'Ich bin der Eigentümer dieser Stimme und bin damit einverstanden, dass Google diese Stimme zur Erstellung eines synthetischen Stimmmodells verwendet.' },
  { locale: 'gu-IN', language: 'Gujarati', statement: 'હું આ વોઈસનો માલિક છું અને સિન્થેટિક વોઈસ મોડલ બનાવવા માટે આ વોઈસનો ઉપયોગ કરીને google ને હું સંમતિ આપું છું' },
  { locale: 'hi-IN', language: 'Hindi', statement: 'मैं इस आवाज का मालिक हूं और मैं सिंथेटिक आवाज मॉडल बनाने के लिए Google को इस आवाज का उपयोग करने की सहमति देता हूं' },
  { locale: 'id-ID', language: 'Indonesian', statement: 'Saya pemilik suara ini dan saya menyetujui Google menggunakan suara ini untuk membuat model suara sintetis.' },
  { locale: 'it-IT', language: 'Italian', statement: 'Sono il proprietario di questa voce e acconsento che Google la utilizzi per creare un modello di voce sintetica.' },
  { locale: 'ja-JP', language: 'Japanese', statement: '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。' },
  { locale: 'kn-IN', language: 'Kannada', statement: 'ನಾನು ಈ ಧ್ವನಿಯ ಮಾಲಿಕ ಮತ್ತು ಸಂಶ್ಲೇಷಿತ ಧ್ವನಿ ಮಾದರಿಯನ್ನು ರಚಿಸಲು ಈ ಧ್ವನಿಯನ್ನು ಬಳಸಿಕೊಂಡುಗೂಗಲ್ ಗೆ ನಾನು ಸಮ್ಮತಿಸುತ್ತೇನೆ.' },
  { locale: 'ko-KR', language: 'Korean', statement: '나는 이 음성의 소유자이며 구글이 이 음성을 사용하여 음성 합성 모델을 생성할 것을 허용합니다.' },
  { locale: 'ml-IN', language: 'Malayalam', statement: 'ഈ ശബ്ദത്തിന്റെ ഉടമ ഞാനാണ്, ഒരു സിന്തറ്റിക് വോയ്സ് മോഡൽ സൃഷ്ടിക്കാൻ ഈ ശബ്ദം ഉപയോഗിക്കുന്നതിന് ഞാൻ Google-ന് സമ്മതം നൽകുന്നു.' },
  { locale: 'mr-IN', language: 'Marathi', statement: 'मी या आवाजाचा मालक आहे आणि सिंथेटिक व्हॉइस मॉडेल तयार करण्यासाठी हा आवाज वापरण्यासाठी मी Google ला संमती देतो' },
  { locale: 'pl-PL', language: 'Polish', statement: 'Jestem właścicielem tego głosu i wyrażam zgodę na wykorzystanie go przez Google w celu utworzenia syntetycznego modelu głosu.' },
  { locale: 'pt-BR', language: 'Portuguese (Brazil)', statement: 'Eu sou o proprietário desta voz e autorizo o Google a usá-la para criar um modelo de voz sintética.' },
  { locale: 'ru-RU', language: 'Russian', statement: 'Я являюсь владельцем этого голоса и даю согласие Google на использование этого голоса для создания модели синтетического голоса.' },
  { locale: 'es-ES', language: 'Spanish (Spain)', statement: 'Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.' },
  { locale: 'es-US', language: 'Spanish (US)', statement: 'Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.' },
  { locale: 'ta-IN', language: 'Tamil', statement: 'நான் இந்த குரலின் உரிமையாளர் மற்றும் செயற்கை குரல் மாதிரியை உருவாக்க இந்த குரலை பயன்படுத்த குகல்க்கு நான் ஒப்புக்கொள்கிறேன்.' },
  { locale: 'te-IN', language: 'Telugu', statement: 'నేను ఈ వాయిస్ యజమానిని మరియు సింతటిక్ వాయిస్ మోడల్ ని రూపొందించడానికి ఈ వాయిస్ ని ఉపయోగించడానికి googleకి నేను సమ్మతిస్తున్నాను.' },
  { locale: 'th-TH', language: 'Thai', statement: 'ฉันเป็นเจ้าของเสียงนี้ และฉันยินยอมให้ Google ใช้เสียงนี้เพื่อสร้างแบบจำลองเสียงสังเคราะห์' },
  { locale: 'tr-TR', language: 'Turkish', statement: "Bu sesin sahibi benim ve Google'ın bu sesi kullanarak sentetik bir ses modeli oluşturmasına izin veriyorum." },
  { locale: 'vi-VN', language: 'Vietnamese', statement: 'Tôi là chủ sở hữu giọng nói này và tôi đồng ý cho Google sử dụng giọng nói này để tạo mô hình giọng nói tổng hợp.' },
];

/** Locale when none is chosen. */
export const DEFAULT_CONSENT_LOCALE = 'en-US';

/** The statement for a locale (case-insensitive), or null when Google doesn't support it. */
export function consentFor(locale: string | null | undefined): ConsentStatement | null {
  const want = (locale ?? '').trim().toLowerCase();
  return CONSENT_STATEMENTS.find((c) => c.locale.toLowerCase() === want) ?? null;
}

/**
 * The best consent locale for a language or accent code: an exact match
 * ("en-AU"), else the first locale of that language ("en" → en-US), else the
 * default.
 */
export function consentLocaleFor(code: string | null | undefined): string {
  const exact = consentFor(code);
  if (exact) return exact.locale;
  const lang = (code ?? '').trim().toLowerCase().split('-')[0];
  return CONSENT_STATEMENTS.find((c) => c.locale.toLowerCase().startsWith(`${lang}-`))?.locale ?? DEFAULT_CONSENT_LOCALE;
}

/** Sample (reference) take: Google needs 10–30 s of natural speech. */
export const CLONE_SAMPLE_SECONDS = { min: 10, max: 30 } as const;
/** Consent take: long enough for the statement, short enough to stay one take. */
export const CLONE_CONSENT_SECONDS = { min: 3, max: 20 } as const;
/** Slack for encoder rounding at either end. */
export const CLONE_SECONDS_TOLERANCE = 0.25;
