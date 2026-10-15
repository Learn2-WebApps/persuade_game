/**
 * voiceInput.js — 마이크 음성 입력 (실시간 받아쓰기 + 어조 평가용 녹음)
 *
 * 브라우저 음성인식(Web Speech API)은 "텍스트"만 돌려주고 오디오는 주지 않는다.
 * 반대로 녹음(MediaRecorder)은 오디오만 주고 텍스트는 못 만든다.
 * 그래서 한 번의 발화에 대해 둘을 동시에 돌린다:
 *
 *   SpeechRecognition → 말하는 대로 실시간 텍스트 (입력칸에 즉시 표시)
 *   MediaRecorder     → 오디오 (채점 요청에 함께 실어 어조 평가에 쓴다)
 *
 * [설계 원칙]
 * - 녹음이 실패해도 받아쓰기는 계속된다. 어조 평가만 빠지고 게임은 그대로 돌아간다.
 * - 음성인식이 없는 브라우저(Firefox 등)에서는 isVoiceInputSupported()가 false를 돌려주고,
 *   호출부가 마이크 버튼을 숨긴다 → 기존 타이핑 입력으로 수업이 그대로 진행된다.
 * - 오디오는 Gemini가 확실히 받는 16kHz 모노 WAV로 변환해 보낸다.
 *   (MediaRecorder의 webm/opus는 Gemini 공식 지원 포맷이 아니라 그대로 보내지 않는다)
 *
 * ⚠ 마이크는 HTTPS 또는 localhost에서만 열린다. Cloudflare Pages 배포와 `npm run dev` 모두 해당된다.
 */

/** 오디오가 이 크기를 넘으면 어조 평가를 포기한다 (채점 요청 자체가 무거워지는 것을 막는다) */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** 한 발화 최대 녹음 길이 — 넘으면 자동으로 멈춘다 */
const DEFAULT_MAX_SECONDS = 60;
/** 어조 평가용이라 음질은 최소면 충분하다 (16kHz 모노 = 사람 말소리 판별에 필요한 하한선) */
const TARGET_SAMPLE_RATE = 16000;

const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** 이 브라우저에서 마이크 입력을 쓸 수 있는지 — false면 호출부가 마이크 버튼을 숨긴다 */
export function isVoiceInputSupported() {
  return Boolean(SpeechRecognitionCtor && navigator.mediaDevices?.getUserMedia);
}

// ─────────────────────────────────────────────────────────────
// 오디오 변환 (webm/opus → 16kHz 모노 WAV → base64)
// ─────────────────────────────────────────────────────────────

/** Float32 PCM → 16bit PCM WAV (RIFF 헤더 44바이트 + 데이터) */
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 청크 크기
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 바이트/초
  view.setUint16(32, 2, true); // 블록 정렬
  view.setUint16(34, 16, true); // 비트 심도
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** ArrayBuffer → base64 (스택 오버플로를 피하려고 조각내서 변환한다) */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 녹음 blob을 Gemini에 보낼 수 있는 형태로 변환한다.
 * @returns {Promise<{mimeType: string, data: string, durationSec: number} | null>}
 *          변환 실패·무음·용량 초과 시 null (어조 평가만 건너뛴다)
 */
async function blobToWavPayload(blob) {
  if (!blob || blob.size === 0) return null;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch (err) {
    console.warn('[voice] 오디오 디코딩 실패 — 어조 평가 없이 진행합니다:', err);
    return null;
  } finally {
    ctx.close();
  }

  if (!decoded.duration || decoded.duration < 0.3) return null; // 사실상 무음

  // OfflineAudioContext에 채널 1개를 주면 다운믹스와 리샘플링을 한 번에 처리해 준다
  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const wav = encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
  if (wav.byteLength > MAX_AUDIO_BYTES) {
    console.warn(`[voice] 오디오가 너무 큽니다(${wav.byteLength}바이트) — 어조 평가를 건너뜁니다.`);
    return null;
  }

  return { mimeType: 'audio/wav', data: toBase64(wav), durationSec: Math.round(decoded.duration * 10) / 10 };
}

// ─────────────────────────────────────────────────────────────
// 음성 입력 컨트롤러
// ─────────────────────────────────────────────────────────────

/** SpeechRecognition 오류코드 → 학습자에게 보여줄 말 */
function describeRecognitionError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '마이크 사용이 차단되어 있어요. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.';
    case 'audio-capture':
      return '마이크를 찾지 못했어요. 장치 연결을 확인해 주세요.';
    case 'network':
      return '음성 인식 서버에 연결하지 못했어요. 네트워크를 확인해 주세요.';
    case 'aborted':
      return ''; // 사용자가 직접 멈춘 경우 — 오류로 취급하지 않는다
    default:
      return '음성 인식에 문제가 생겼어요. 타이핑으로 입력해 주세요.';
  }
}

/**
 * 음성 입력 컨트롤러를 만든다.
 *
 * @param {object}   opts
 * @param {string}   [opts.lang='ko-KR']
 * @param {number}   [opts.maxSeconds=60]        자동 종료까지의 최대 녹음 길이
 * @param {Function} [opts.onInterim]  (text) => {}          말하는 도중 실시간 텍스트
 * @param {Function} [opts.onFinal]    (text, audio) => {}   멈췄을 때 최종 텍스트 + 오디오(없으면 null)
 * @param {Function} [opts.onState]    ('idle'|'listening'|'processing') => {}
 * @param {Function} [opts.onError]    (message) => {}       빈 문자열이면 표시하지 않는다
 */
export function createVoiceInput({
  lang = 'ko-KR',
  maxSeconds = DEFAULT_MAX_SECONDS,
  onInterim,
  onFinal,
  onState,
  onError,
} = {}) {
  let recognition = null;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let finalText = '';
  let listening = false;
  let stopping = false;
  let autoStopTimer = null;
  let sawResult = false; // 이번 발화에서 인식 결과가 한 번이라도 왔는지 (진단·안내용)

  const setState = (s) => onState?.(s);
  const log = (msg) => console.log(`[voice] ${msg}`);

  /** 마이크 스트림·녹음기를 모두 정리한다 (버튼을 다시 누르면 새로 연다) */
  function teardown() {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    recorder = null;
    recognition = null;
    listening = false;
  }

  /** 녹음 blob이 모두 모일 때까지 기다린다 */
  function collectAudio() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') return resolve(null);
      const rec = recorder;
      rec.addEventListener(
        'stop',
        () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null),
        { once: true }
      );
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * 녹음을 시작한다. 실패해도 받아쓰기는 계속된다 (어조 평가만 빠진다).
   * 받아쓰기가 마이크를 먼저 잡은 뒤에 호출해야 한다 — 순서가 반대면 Chrome에서
   * 음성인식이 소리를 못 받는 경우가 있다.
   */
  async function startRecording() {
    // 디버그 탈출구: 콘솔에서 window.__voiceNoRecord = true 로 두면 녹음 없이 받아쓰기만 한다.
    // (받아쓰기가 안 될 때 "녹음과 충돌하는지"를 5초 만에 가려내기 위한 스위치)
    if (window.__voiceNoRecord) {
      log('녹음 건너뜀 (window.__voiceNoRecord = true)');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      });
      recorder.start();
      log('녹음 시작');
    } catch (err) {
      console.warn('[voice] 녹음을 시작하지 못했습니다 — 받아쓰기만 진행합니다:', err);
      recorder = null;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }
  }

  async function start() {
    if (listening || stopping) return;

    finalText = '';
    chunks = [];
    sawResult = false;
    setState('listening');
    listening = true;
    log('시작');

    // (1) 받아쓰기를 **먼저** 켠다.
    //     녹음(getUserMedia)이 마이크를 먼저 잡고 있으면 Chrome 음성인식이 무음만 받는 사례가 있어,
    //     인식이 마이크를 확보한 뒤(audiostart)에 녹음을 붙인다.
    recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true; // 중간에 잠깐 끊겨도 계속 듣는다
    recognition.interimResults = true; // 말하는 도중 글자가 화면에 찍히게 한다

    recognition.addEventListener('result', (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      sawResult = true;
      log(`결과 수신: final="${finalText}" interim="${interim}"`);
      onInterim?.((finalText + interim).trim());
    });

    recognition.addEventListener('error', (event) => {
      log(`오류 이벤트: ${event.error}`);
      // no-speech는 침묵이 길었을 뿐이라 계속 듣게 둔다 (end 핸들러가 다시 켠다)
      if (event.error === 'no-speech') return;
      const msg = describeRecognitionError(event.error);
      if (msg) onError?.(msg);
    });

    recognition.addEventListener('end', () => {
      log('인식 세션 종료');
      // Chrome은 침묵이 길면 continuous여도 스스로 멈춘다 — 아직 듣는 중이면 다시 켠다
      if (!listening || stopping) return;
      try {
        recognition.start();
        log('인식 재시작');
      } catch {
        /* 이미 시작된 상태 — 무시 */
      }
    });

    // 진단용 — 마이크를 실제로 잡았는지(audiostart), 사람 목소리를 감지했는지(speechstart)
    recognition.addEventListener('audiostart', () => log('오디오 입력 열림 (audiostart)'));
    recognition.addEventListener('speechstart', () => log('말소리 감지 (speechstart)'));
    recognition.addEventListener('soundstart', () => log('소리 감지 (soundstart)'));

    // 녹음은 인식이 마이크를 잡은 뒤에 붙인다. audiostart가 안 오면 조금 뒤 그냥 시작한다.
    let recorderHooked = false;
    const hookRecorder = () => {
      if (recorderHooked || !listening) return;
      recorderHooked = true;
      startRecording();
    };
    recognition.addEventListener('audiostart', hookRecorder, { once: true });
    setTimeout(hookRecorder, 700);

    try {
      recognition.start();
      log('인식 start() 호출됨');
    } catch (err) {
      console.error('[voice] 음성 인식을 시작하지 못했습니다:', err);
      listening = false;
      teardown();
      setState('idle');
      onError?.('음성 인식을 시작하지 못했어요. 타이핑으로 입력해 주세요.');
      return;
    }

    // (2) 너무 길어지면 자동 종료 — 마이크가 켜진 채 방치되는 것을 막는다
    autoStopTimer = setTimeout(() => stop(), maxSeconds * 1000);
  }

  /** 듣기를 멈추고 최종 텍스트 + 오디오를 onFinal로 넘긴다 */
  async function stop() {
    if (!listening || stopping) return;
    stopping = true;
    listening = false;
    clearTimeout(autoStopTimer);
    setState('processing');

    try {
      recognition?.stop();
    } catch {
      /* 이미 멈춤 */
    }

    let audio = null;
    try {
      const blob = await collectAudio();
      audio = await blobToWavPayload(blob);
    } catch (err) {
      console.warn('[voice] 오디오 처리 실패 — 어조 평가 없이 진행합니다:', err);
    }

    const text = finalText.trim();
    log(
      `정지 — 인식결과 ${sawResult ? '있음' : '없음'}, 텍스트 "${text}", ` +
        `오디오 ${audio ? `${audio.durationSec}초` : '없음'}`
    );
    teardown();
    stopping = false;
    setState('idle');

    // 소리는 들어왔는데 글자가 하나도 안 나온 경우 — 그냥 조용히 끝내면 고장처럼 보인다
    if (!text) {
      onError?.(
        audio
          ? '말소리가 글자로 옮겨지지 않았어요. 다시 한번 말해보시거나 타이핑으로 입력해 주세요.'
          : '음성이 인식되지 않았어요. 마이크를 확인하고 다시 시도해 주세요.'
      );
    }

    onFinal?.(text, audio);
  }

  /** 결과를 버리고 즉시 종료 (스테이지 종료·화면 이탈 시) */
  function cancel() {
    if (!listening && !stopping) return;
    listening = false;
    stopping = false;
    try {
      recognition?.stop();
    } catch {
      /* 이미 멈춤 */
    }
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* 이미 멈춤 */
    }
    teardown();
    setState('idle');
  }

  return {
    start,
    stop,
    cancel,
    toggle: () => (listening ? stop() : start()),
    isListening: () => listening,
  };
}
