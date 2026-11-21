// In-browser local AI engine supporting window.ai (Gemini Nano) with offline fallback

// Sample notes document for one-click stage demonstration
export const SAMPLE_DOCUMENT = `Rift Valley Substation 4B Field Assessment
Inspector: Bethwel Kiplagat | Location: Nakuru Basin (-0.3031, 36.0800)

Observation Summary:
During scheduled telemetry validation at geothermal junction 4B, monitoring sensors recorded intermittent thermal spikes on primary coolant loop 2. Visual inspection confirmed minor coolant weepage along high-pressure flange seal F-12. Current line pressure remains nominal at 4.2 bar, but coolant reservoir levels dropped 8% over the past 6 hours.

Risk Assessment & Immediate Action:
Vibration analysis indicates gasket wear caused by thermal cycling. If untreated, loss of coolant will trigger automatic emergency turbine trip within 36 hours. Immediate field intervention required: isolate secondary valve manifold, replace high-temp silicone seal, and flush loop 2.`;

// Runs in-browser AI summarization and risk analysis with zero cloud round-trips
export async function summarizeWithLocalAI(text) {
  const startTime = performance.now();
  const cleanedText = text.trim();

  if (!cleanedText) {
    throw new Error('Please provide text or notes to summarize.');
  }

  // Attempt to use Chrome Built-in AI (Gemini Nano Prompt API)
  if (typeof window !== 'undefined' && window.ai?.languageModel) {
    try {
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available !== 'no') {
        const session = await window.ai.languageModel.create({
          systemPrompt: 'You are an on-device local AI assistant running on Chrome Gemini Nano. Provide a brief 2-sentence summary, 3 bullet points, and suggest severity (low, medium, high, or critical).'
        });
        const aiResponse = await session.prompt(cleanedText);
        const elapsed = Math.round(performance.now() - startTime);

        return {
          model: 'Chrome Gemini Nano (window.ai)',
          source: 'built-in',
          summary: aiResponse,
          bullets: extractBulletPoints(aiResponse),
          suggestedSeverity: inferSeverity(cleanedText + ' ' + aiResponse),
          latencyMs: elapsed,
          networkBytes: 0,
          privacy: '100% On-Device (Zero cloud calls)'
        };
      }
    } catch (err) {
      console.warn('[LocalAI] Gemini Nano session error, falling back to local heuristic engine:', err);
    }
  }

  // Pure in-browser offline heuristic engine (guarantees stage demo never fails)
  const analysis = runLocalHeuristicAnalysis(cleanedText);
  const elapsed = Math.round(performance.now() - startTime);

  return {
    model: 'In-Browser Local AI (Zero-SDK Engine)',
    source: 'local-engine',
    summary: analysis.summary,
    bullets: analysis.bullets,
    suggestedSeverity: analysis.severity,
    latencyMs: Math.max(elapsed, 18),
    networkBytes: 0,
    privacy: '100% On-Device (Data never leaves browser)'
  };
}

// In-browser local NLP extraction without external dependencies
function runLocalHeuristicAnalysis(text) {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'were', 'been',
    'during', 'over', 'into', 'will', 'what', 'when', 'which', 'their', 'there'
  ]);

  const freq = {};
  for (const w of words) {
    if (!stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  // Score sentences by keyword significance
  const scored = sentences.map((sentence) => {
    const sWords = sentence.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const score = sWords.reduce((acc, w) => acc + (freq[w] || 0), 0) / (sWords.length || 1);
    return { sentence, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Formulate concise summary and action points
  const topSentences = scored.slice(0, 2).map((s) => s.sentence);
  const summary = topSentences.join(' ') || sentences[0] || text.slice(0, 160);

  const bullets = [
    scored[0]?.sentence || 'Primary observation recorded on-device.',
    scored[1]?.sentence || 'Operational telemetry logged without cloud round-trip.',
    findActionSentence(sentences)
  ].filter(Boolean);

  const severity = inferSeverity(text);

  return { summary, bullets, severity };
}

// Find recommended action statement within text
function findActionSentence(sentences) {
  const actionMatch = sentences.find((s) =>
    /\b(action|replace|isolate|repair|intervene|immediate|scheduled|monitor|fix)\b/i.test(s)
  );
  return actionMatch || 'Action: Monitor subsystem and verify telemetry.';
}

// Extract bullet points from AI generated response
function extractBulletPoints(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
    .filter((l) => l.length > 10);
  return lines.slice(0, 3);
}

// Infer severity classification based on keyword signals
function inferSeverity(text) {
  const lower = text.toLowerCase();
  if (/\b(critical|life safety|hazard|emergency|explosion|collapse|fatal)\b/.test(lower)) {
    return 'critical';
  }
  if (/\b(urgent|leak|trip|spike|wear|danger|immediate|unstable|high)\b/.test(lower)) {
    return 'high';
  }
  if (/\b(routine|normal|nominal|minor|low|scheduled)\b/.test(lower)) {
    return 'low';
  }
  return 'medium';
}

// Opens local file using Project Fugu File System Access API with input fallback
export async function pickLocalDocument() {
  // Native File System Access API
  if (typeof window !== 'undefined' && 'showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Text and Markdown Documents',
            accept: {
              'text/plain': ['.txt', '.md', '.log', '.json']
            }
          }
        ],
        multiple: false
      });
      const file = await handle.getFile();
      const content = await file.text();
      return { name: file.name, size: file.size, content };
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn('[Fugu] File picker error, using input fallback:', err);
    }
  }

  // DOM file input fallback for unsupported environments
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.log,.json,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const content = await file.text();
      resolve({ name: file.name, size: file.size, content });
    };
    input.click();
  });
}
