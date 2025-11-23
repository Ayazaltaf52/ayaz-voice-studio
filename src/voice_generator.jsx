import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Download, Loader2, Mic, ChevronDown, AlertCircle, Sparkles, Sliders, Zap, Volume2, Wand2, Search, Filter, X, User, BookOpen, Smile, Fingerprint, Plus, Save, Trash2, Upload, Infinity, Clock, FileText, BrainCircuit, History, Pause, UploadCloud, FileAudio, Music, Check, ChevronRight, Menu, Languages, PenTool, Sun, Moon, Mail, StopCircle, Info } from 'lucide-react';

// --- AUDIO UTILITIES ---

// Optimized for unlimited text handling
const splitTextIntoChunks = (text, maxLength = 4000) => {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let currentText = text;
  while (currentText.length > maxLength) {
    let splitIndex = currentText.lastIndexOf('.', maxLength);
    if (splitIndex === -1) splitIndex = currentText.lastIndexOf('?', maxLength);
    if (splitIndex === -1) splitIndex = currentText.lastIndexOf('!', maxLength);
    if (splitIndex === -1) splitIndex = currentText.lastIndexOf('\n', maxLength);
    if (splitIndex === -1) splitIndex = currentText.lastIndexOf(' ', maxLength);
    if (splitIndex === -1) splitIndex = maxLength;
    
    chunks.push(currentText.slice(0, splitIndex + 1));
    currentText = currentText.slice(splitIndex + 1).trim();
  }
  if (currentText) chunks.push(currentText);
  return chunks;
};

const mergeAudioBuffers = (buffers, ctx) => {
  if (!buffers.length) return null;
  if (buffers.length === 1) return buffers[0];
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const result = ctx.createBuffer(1, totalLength, buffers[0].sampleRate);
  const channelData = result.getChannelData(0);
  let offset = 0;
  for (const buffer of buffers) {
    channelData.set(buffer.getChannelData(0), offset);
    offset += buffer.length;
  }
  return result;
};

const base64ToAudioBuffer = async (base64Pcm, ctx) => {
  const binaryString = window.atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
  const buffer = ctx.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);
  return buffer;
};

const audioBufferToWav = (buffer) => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i, sample, pos = 0, offset = 44;

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, buffer.length * 2, true);

  for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }
  return new Blob([view], { type: 'audio/wav' });
};

// --- EFFECTS ENGINE ---
const createReverbImpulse = (ctx, duration = 2, decay = 2) => {
  const rate = ctx.sampleRate;
  const len = rate * duration;
  const impulse = ctx.createBuffer(2, len, rate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < len; i++) {
    const n = i;
    left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / len, decay);
    right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / len, decay);
  }
  return impulse;
};

const makeDistortionCurve = (amount) => {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
  }
  return curve;
};

const applyAudioEffects = async (originalBuffer, effectType, speed = 1.0) => {
  if (effectType === 'None' && speed === 1.0) return originalBuffer;

  const tailSeconds = ['Echo', 'Reverb', 'Cathedral', 'Radio'].includes(effectType) ? 3 : 0;
  const length = Math.ceil(originalBuffer.length / speed) + (tailSeconds * originalBuffer.sampleRate);
  
  const offlineCtx = new OfflineAudioContext(1, length, originalBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = originalBuffer;
  
  let finalSpeed = speed;
  if (effectType === 'Chipmunk') finalSpeed *= 1.5;
  if (effectType === 'Monster') finalSpeed *= 0.7;

  source.playbackRate.value = finalSpeed;

  let lastNode = source;

  if (effectType === 'Echo') {
    const delay = offlineCtx.createDelay(); delay.delayTime.value = 0.3;
    const feedback = offlineCtx.createGain(); feedback.gain.value = 0.4;
    source.connect(delay); delay.connect(feedback); feedback.connect(delay);
    delay.connect(offlineCtx.destination); source.connect(offlineCtx.destination); lastNode = null;
  } else if (effectType === 'Reverb') {
    const convolver = offlineCtx.createConvolver(); convolver.buffer = createReverbImpulse(offlineCtx, 2, 2);
    const wetGain = offlineCtx.createGain(); wetGain.gain.value = 0.5;
    source.connect(convolver); convolver.connect(wetGain); wetGain.connect(offlineCtx.destination); source.connect(offlineCtx.destination); lastNode = null;
  } else if (effectType === 'Robot') {
     const osc = offlineCtx.createOscillator(); osc.type = 'square'; osc.frequency.value = 50; osc.start(0);
     const gain = offlineCtx.createGain(); const depth = offlineCtx.createGain(); depth.gain.value = 1; 
     osc.connect(depth); depth.connect(gain.gain); source.connect(gain); lastNode = gain;
  } else if (effectType === 'Telephone') {
    const lowPass = offlineCtx.createBiquadFilter(); lowPass.type = "lowpass"; lowPass.frequency.value = 3000;
    const highPass = offlineCtx.createBiquadFilter(); highPass.type = "highpass"; highPass.frequency.value = 300;
    source.connect(lowPass); lowPass.connect(highPass); lastNode = highPass;
  } else if (effectType === 'Alien') {
    const osc = offlineCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 10; osc.start(0);
    const delay = offlineCtx.createDelay(); delay.delayTime.value = 0.05;
    const depth = offlineCtx.createGain(); depth.gain.value = 0.005;
    osc.connect(depth); depth.connect(delay.delayTime); source.connect(delay); lastNode = delay;
  } else if (effectType === 'Radio') {
    const lowPass = offlineCtx.createBiquadFilter(); lowPass.type = "lowpass"; lowPass.frequency.value = 2000;
    const highPass = offlineCtx.createBiquadFilter(); highPass.type = "highpass"; highPass.frequency.value = 500;
    const dist = offlineCtx.createWaveShaper(); dist.curve = makeDistortionCurve(20);
    source.connect(lowPass); lowPass.connect(highPass); highPass.connect(dist); lastNode = dist;
  } else if (effectType === 'Underwater') {
    const lowPass = offlineCtx.createBiquadFilter(); lowPass.type = "lowpass"; lowPass.frequency.value = 400;
    source.connect(lowPass); lastNode = lowPass;
  } else if (effectType === 'Distortion') {
    const dist = offlineCtx.createWaveShaper(); dist.curve = makeDistortionCurve(400);
    source.connect(dist); lastNode = dist;
  } else if (effectType === 'Chorus') {
    const delay = offlineCtx.createDelay(); delay.delayTime.value = 0.03;
    const osc = offlineCtx.createOscillator(); osc.frequency.value = 2; osc.start(0);
    const depth = offlineCtx.createGain(); depth.gain.value = 0.002;
    osc.connect(depth); depth.connect(delay.delayTime);
    source.connect(delay); delay.connect(offlineCtx.destination); source.connect(offlineCtx.destination); lastNode = null;
  }
  
  if (lastNode) lastNode.connect(offlineCtx.destination);
  source.start(0);
  return await offlineCtx.startRendering();
};

// --- CONSTANTS ---
const INITIAL_VOICES = [
  // --- Narrative ---
  { name: "Adam", role: "Storyteller", apiName: "Charon", gender: "Male", style: "Deep & Realistic", category: "Narrative" },
  { name: "Marcus", role: "Deep Narrator", apiName: "Iapetus", gender: "Male", style: "Pro Documentary", category: "Narrative" },
  { name: "Attenborough", role: "Nature Docu", apiName: "Iapetus", gender: "Male", style: "Attenborough Style", category: "Narrative" },
  { name: "Axel", role: "Movie Trailer", apiName: "Umbriel", gender: "Male", style: "Epic Bass", category: "Narrative" },
  { name: "Callie", role: "Expressive", apiName: "Callirrhoe", gender: "Female", style: "Audiobook", category: "Narrative" },
  
  // --- Professional ---
  { name: "Zara", role: "Professional", apiName: "Zephyr", gender: "Female", style: "News/Promo", category: "Professional" },
  { name: "Luna", role: "Balanced", apiName: "Leda", gender: "Female", style: "Corporate", category: "Professional" },
  { name: "Orion", role: "Confident", apiName: "Orus", gender: "Male", style: "Business", category: "Professional" },
  { name: "Emily", role: "Podcast Host", apiName: "Zephyr", gender: "Female", style: "Engaging", category: "Professional" }, 
  
  // --- Soft ---
  { name: "Kira", role: "Calm & Clear", apiName: "Kore", gender: "Female", style: "Meditation", category: "Soft" },
  { name: "Aria", role: "Friendly", apiName: "Aoede", gender: "Female", style: "Assistant", category: "Soft" },
  { name: "Nova", role: "Warm Guide", apiName: "Autonoe", gender: "Female", style: "Educational", category: "Soft" },
  
  // --- Energetic ---
  { name: "Jax", role: "Assertive", apiName: "Puck", gender: "Male", style: "Gaming", category: "Energetic" },
  { name: "Finn", role: "Energetic", apiName: "Fenrir", gender: "Male", style: "Youtube", category: "Energetic" },
  { name: "Ryan", role: "Casual Vlogger", apiName: "Puck", gender: "Male", style: "Laid back", category: "Energetic" }, 
  { name: "Titan", role: "Strong", apiName: "Enceladus", gender: "Male", style: "Fitness", category: "Energetic" },
  
  // --- Character ---
  { name: "Joker", role: "Manic Villain", apiName: "Fenrir", gender: "Male", style: "Chaotic", category: "Character" },
  { name: "Batman", role: "Vigilante", apiName: "Umbriel", gender: "Male", style: "Deep Gritty", category: "Character" },
  { name: "Iron Man", role: "Tech Genius", apiName: "Orus", gender: "Male", style: "Witty/Sarcastic", category: "Character" },
  { name: "Gandalf", role: "Wizard", apiName: "Charon", gender: "Male", style: "Wise/Epic", category: "Character" }, 
  { name: "Gollum", role: "Creature", apiName: "Puck", gender: "Male", style: "Raspy/Creepy", category: "Character" }, 
  { name: "Santa Claus", role: "Jolly", apiName: "Charon", gender: "Male", style: "Festive", category: "Character" },
  { name: "Sage", role: "Wise Old Man", apiName: "Iapetus", gender: "Male", style: "Fantasy", category: "Character" },
  { name: "Harley Quinn", role: "High Energy", apiName: "Aoede", gender: "Female", style: "Crazy", category: "Character" } 
];

const EFFECT_OPTIONS = ["None", "Reverb", "Echo", "Robot", "Telephone", "Radio", "Underwater", "Chipmunk", "Monster", "Chorus", "Distortion", "Alien"];

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
      const savedMode = localStorage.getItem('ayazStudioDarkMode');
      return savedMode ? JSON.parse(savedMode) : false;
  });

  useEffect(() => {
      localStorage.setItem('ayazStudioDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const [showContact, setShowContact] = useState(false);
  const [voices, setVoices] = useState(INITIAL_VOICES);
  const [history, setHistory] = useState([]);
  const [text, setText] = useState('This is Ayaz Altaf AI Studio. You can write text in any language (English, Urdu, Hindi) and select a voice to generate natural speech.');
  const [selectedVoiceName, setSelectedVoiceName] = useState('Adam');
  const [isLoading, setIsLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState(''); 
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [genderFilter, setGenderFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [targetSpeed, setTargetSpeed] = useState(1.0);
  const [pitchValue, setPitchValue] = useState(0); 
  const [selectedEffect, setSelectedEffect] = useState('None');
  const [isHumanMode, setIsHumanMode] = useState(true); 
  const [searchTerm, setSearchTerm] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [previewVoice, setPreviewVoice] = useState(null); 
  const [previewAudioEl, setPreviewAudioEl] = useState(null); 
  const [previewLoadingId, setPreviewLoadingId] = useState(null); 
  const [notification, setNotification] = useState(null);
  const timerRef = useRef(null);
  const contactRef = useRef(null);
  const [generatedMetadata, setGeneratedMetadata] = useState({ voice: '', text: '' });
  
  const audioRef = useRef(null);
  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);
  const charCount = useMemo(() => text.length, [text]);
  const allVoices = useMemo(() => [...INITIAL_VOICES], []);
  const currentVoiceObj = useMemo(() => allVoices.find(v => v.name === selectedVoiceName) || allVoices[0], [selectedVoiceName, allVoices]);

  const groupedVoices = useMemo(() => {
    const groups = {};
    let filtered = allVoices.filter(v => 
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        (genderFilter === 'All' || v.gender === genderFilter) &&
        (categoryFilter === 'All' || v.category === categoryFilter)
    );

    const standardVoices = filtered.filter(v => v.category !== 'Custom Clone');
    
    standardVoices.forEach(voice => {
        if (!groups[voice.category]) {
            groups[voice.category] = [];
        }
        groups[voice.category].push(voice);
    });

    return groups;
  }, [searchTerm, genderFilter, categoryFilter, allVoices]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const startTimer = () => { setElapsedTime(0); if (timerRef.current) clearInterval(timerRef.current); timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000); };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };
  const formatTime = (seconds) => { if(!seconds || isNaN(seconds)) return "0:00"; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins}:${secs < 10 ? '0' : ''}${secs}`; };

  const optimizeScriptForHumanSpeech = (rawText) => {
    let optimized = rawText;
    optimized = optimized.replace(/\n\n/g, ' .. ');
    optimized = optimized.replace(/\.(?=[a-zA-Z0-9])/g, '. ');
    return optimized;
  };

  const fetchAudioChunk = async (inputText, targetVoiceApiName = null) => {
    const apiKey = process.env.REACT_APP_GEMINI_KEY || ""; 
    let finalText = optimizeScriptForHumanSpeech(inputText);
    let instructions = "";

    if (pitchValue !== 0) {
        const intensity = Math.abs(pitchValue);
        const tone = pitchValue < 0 ? "deeper" : "higher";
        let desc = intensity < 5 ? `slightly ${tone}` : intensity < 15 ? `noticeably ${tone}` : `extremely ${tone}`;
        instructions += `(Speaking in a ${desc} tone) `;
    }
    
    if (pitchValue === 0 && !isHumanMode) {
       const character = allVoices.find(v => v.apiName === (targetVoiceApiName || currentVoiceObj.apiName)) || currentVoiceObj;
       const charName = character.name || currentVoiceObj.name;

       const styles = {
           "Adam": "(Speaking in a deep, calm, storytelling style)",
           "Marcus": "(Speaking in a professional, serious, and authoritative narrator tone)",
           "Attenborough": "(Speaking in a soft, breathless, fascinated nature documentary narrator style)", 
           "Axel": "(Speaking in an epic, deep bass, movie trailer dramatic voice)",
           "Callie": "(Speaking in an expressive, emotional, and engaging audiobook style)",
           "Zara": "(Speaking in a clear, professional news anchor tone)",
           "Luna": "(Speaking in a balanced, corporate, and professional tone)",
           "Orion": "(Speaking in a confident, business executive male voice)",
           "Emily": "(Speaking in a friendly, engaging, and conversational podcast host tone)", 
           "Kira": "(Speaking in a soft, calm, and soothing meditation guide voice)",
           "Aria": "(Speaking in a friendly, cheerful, and helpful assistant tone)",
           "Nova": "(Speaking in a warm, educational, and guiding teacher voice)",
           "Jax": "(Speaking in an assertive, competitive, and sharp gaming voice)",
           "Finn": "(Speaking in a high energy, excited, and fast-paced YouTuber style)",
           "Ryan": "(Speaking in a casual, laid-back, everyday guy voice)", 
           "Titan": "(Speaking in a strong, motivational, and powerful fitness coach voice)",
           "Joker": "(Speaking in a high-pitched, manic, hysterical, and terrifyingly crazy clown voice)",
           "Batman": "(Speaking in a very deep, raspy, menacing, and gravelly whisper like a dark vigilante)", 
           "Iron Man": "(Speaking in a confident, fast-paced, witty, and slightly sarcastic tech genius tone)", 
           "Gandalf": "(Speaking in a grand, booming, wise, and ancient wizard voice)", 
           "Gollum": "(Speaking in a high-pitched, raspy, desperate, and creepy creature voice)", 
           "Santa Claus": "(Speaking in a jolly, deep, laughing, and warm festive voice)", 
           "Sage": "(Speaking in a slow, wise, raspy, and old man voice)",
           "Harley Quinn": "(Speaking in a high-pitched, manic, erratic, and crazy excited female tone)"
       };

       const specificStyle = styles[charName];
       if (specificStyle) {
           instructions += `${specificStyle} `;
       }
    }

    if (isHumanMode) {
        instructions += `(Speaking at a normal conversational speed. CRITICAL: If the text is English, speak with a standard American accent. Do NOT use an Urdu/Hindi accent for English text. Only use native accents for Urdu/Hindi text.) `;
    }

    finalText = `${instructions} ${finalText}`;

    const voiceToUse = targetVoiceApiName || currentVoiceObj.apiName;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: finalText }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceToUse } } } } };
    let retries = 3;
    while (retries > 0) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        
        if (response.status === 429) { 
            await new Promise(r => setTimeout(r, 2000)); 
            retries--; 
            continue; 
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || `API Error: ${response.statusText}`);
        }

        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].inlineData) {
            return data.candidates[0].content.parts[0].inlineData.data;
        }
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) {
            throw new Error(`Model refused to generate audio: ${data.candidates[0].content.parts[0].text}`);
        }

        if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
             if (data.candidates[0].finishReason !== "STOP") {
                 throw new Error(`Generation stopped due to: ${data.candidates[0].finishReason}`);
             }
        }

        throw new Error('No audio data found in response.');

      } catch (e) { 
          if (retries === 1) throw e; 
          retries--; 
          await new Promise(r => setTimeout(r, 1000)); 
      }
    }
  };

  const handleVoicePreview = async (voice) => {
    if (previewAudioEl) {
        previewAudioEl.pause();
        setPreviewAudioEl(null);
    }
    
    if (previewVoice === voice.name) {
        setPreviewVoice(null);
        return;
    }

    try {
        setPreviewLoadingId(voice.name);
        const previewText = `Hello, I am ${voice.name}. Welcome to Ayaz Altaf AI Studio.`;
        
        const base64 = await fetchAudioChunk(previewText, voice.apiName);
        
        if (base64) {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = await base64ToAudioBuffer(base64, audioCtx);
            const wavBlob = audioBufferToWav(buffer);
            const audioUrl = URL.createObjectURL(wavBlob);
            
            const audio = new Audio(audioUrl);
            audio.onended = () => {
                setPreviewVoice(null);
                URL.revokeObjectURL(audioUrl);
            };
            audio.play();
            
            setPreviewVoice(voice.name);
            setPreviewAudioEl(audio);
        }
    } catch (e) {
        console.error("Preview failed", e);
    } finally {
        setPreviewLoadingId(null);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) { setError('Text is empty.'); return; }
    setIsLoading(true); setError(''); setAudioUrl(null); setProgressStatus('Analyzing script...');
    setCurrentPlaybackRate(targetSpeed);
    setGeneratedMetadata({ voice: currentVoiceObj.name, text: text.length > 60 ? text.slice(0, 60) + '...' : text });
    startTimer();
    setIsSidebarOpen(false);

    try {
      // Unlimited logic: split cleanly without constraints
      const chunks = splitTextIntoChunks(text);
      const audioBuffers = [];
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      for (let i = 0; i < chunks.length; i++) {
        setProgressStatus(chunks.length > 1 ? `Processing unlimited audio part ${i + 1}/${chunks.length}...` : 'Synthesizing audio...');
        // Yield to main thread to keep UI responsive during long generations
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const base64Audio = await fetchAudioChunk(chunks[i]);
        if (base64Audio) {
          const buffer = await base64ToAudioBuffer(base64Audio, audioCtx);
          audioBuffers.push(buffer);
        }
      }

      setProgressStatus('Mastering full audio...');
      if (audioBuffers.length > 0) {
        const mergedBuffer = mergeAudioBuffers(audioBuffers, audioCtx);
        const processedBuffer = await applyAudioEffects(mergedBuffer, selectedEffect, targetSpeed);
        const wavBlob = audioBufferToWav(processedBuffer);
        
        const audioDuration = processedBuffer.duration;
        setDuration(audioDuration);

        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
        
        setHistory(prev => [{ id: Date.now(), voice: currentVoiceObj.name, text: text.slice(0, 40) + (text.length > 40 ? '...' : ''), url: url, timestamp: new Date().toLocaleTimeString(), duration: audioDuration }, ...prev].slice(0, 10));
      } else { throw new Error('No audio returned.'); }
    } catch (err) { console.error(err); setError(err.message || "Error occurred."); } finally { setIsLoading(false); setProgressStatus(''); stopTimer(); }
  };

  const togglePlaybackRate = () => {
      const rates = [1.0, 1.25, 1.5, 2.0];
      const nextIndex = (rates.indexOf(currentPlaybackRate) + 1) % rates.length;
      const nextRate = rates[nextIndex];
      setCurrentPlaybackRate(nextRate);
      if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error("Play error:", e));
      }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl]);

  useEffect(() => { 
      const audioEl = audioRef.current;
      if (audioUrl && audioEl) { 
          audioEl.load();
      }
      return () => {
          if (audioUrl) {
              if (audioEl) {
                  audioEl.pause();
                  audioEl.currentTime = 0;
              }
              URL.revokeObjectURL(audioUrl);
          }
      };
  }, [audioUrl]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = currentPlaybackRate; }, [currentPlaybackRate]);

  useEffect(() => {
    const handleClickOutside = (event) => { if (contactRef.current && !contactRef.current.contains(event.target)) { setShowContact(false); } };
    document.addEventListener('mousedown', handleClickOutside); return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  const theme = {
      bg: isDarkMode 
          ? 'bg-[#050505] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#050505] to-[#050505]' 
          : 'bg-slate-50',
      
      text: isDarkMode ? 'text-gray-100' : 'text-slate-900',
      textMuted: isDarkMode ? 'text-gray-300' : 'text-slate-700',
      textAccent: isDarkMode ? 'text-indigo-400' : 'text-indigo-600',
      border: isDarkMode ? 'border-white/10' : 'border-gray-300',
      surface: isDarkMode ? 'bg-[#121212]/90 backdrop-blur-xl' : 'bg-white/90 backdrop-blur-xl shadow-sm',
      surfaceSecondary: isDarkMode ? 'bg-[#1A1A1A]/80 backdrop-blur-lg' : 'bg-slate-100/80 backdrop-blur-lg',
      surfaceHover: isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5',
      
      interactiveItem: isDarkMode
        ? 'border border-transparent hover:border-white/50 hover:bg-white/90 hover:text-black transition-all duration-200'
        : 'border border-transparent hover:border-gray-400 hover:bg-white hover:text-black transition-all duration-200 shadow-sm',

      buttonPrimary: isDarkMode 
        ? 'bg-white text-black hover:bg-gray-200 shadow-md' 
        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md',
      
      buttonSecondary: isDarkMode ? 'bg-white/5 text-gray-300 border border-white/10' : 'bg-white text-slate-700 border border-slate-300 shadow-sm',
      inputBg: isDarkMode ? 'bg-black/40 border-white/10' : 'bg-white border-slate-300',
  };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text} font-sans flex items-center justify-center md:justify-start md:items-stretch p-4 md:p-0 selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden transition-colors duration-500 relative`}>
      
      <style>{`.no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>

      {isDarkMode && (
         <>
           <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/10 blur-[120px] pointer-events-none" />
           <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/10 blur-[120px] pointer-events-none" />
         </>
      )}

      <div className={`flex flex-col w-full md:w-screen max-w-lg md:max-w-none h-[85vh] md:h-screen ${isDarkMode ? 'bg-[#0f1012]/40' : 'bg-white'} backdrop-blur-3xl rounded-3xl md:rounded-none border ${theme.border} md:border-none shadow-[0_8px_32px_0_rgba(0,0,0,0.1)] md:shadow-none overflow-hidden relative z-10`}>

        <div className={`h-24 flex-shrink-0 border-b ${theme.border} ${isDarkMode ? 'bg-[#0f1012]/30' : 'bg-white/80'} backdrop-blur-md flex items-center justify-center relative z-50`}>
             <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
                className={`md:hidden absolute left-4 p-2 ${theme.surfaceHover} rounded-lg ${theme.text} transition-colors`}
             >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
             </button>

             <div ref={contactRef} className="absolute left-16 md:left-6 top-1/2 -translate-y-1/2 z-40">
                <button 
                    onClick={() => setShowContact(!showContact)}
                    className={`px-3 py-2 md:px-6 md:py-3 rounded-full border ${theme.border} ${theme.surfaceSecondary} hover:scale-105 transition-all shadow-sm flex items-center gap-2`}
                >
                    <Mail className={`w-5 h-5 ${theme.text}`} />
                    <span className={`hidden md:inline text-base font-bold ${theme.text}`}>Contact Me</span>
                </button>

                {showContact && (
                    <div className={`absolute top-full left-0 mt-2 p-4 rounded-xl border ${theme.border} ${isDarkMode ? 'bg-[#131416]' : 'bg-white'} shadow-xl animate-in fade-in slide-in-from-top-2 min-w-[240px] z-50`}>
                        <div className={`text-xs font-bold ${theme.textMuted} mb-1 uppercase tracking-wider`}>Email Address</div>
                        <div className={`text-sm font-bold ${theme.textAccent} select-all`}>Ayazaltaf5252@gmail.com</div>
                    </div>
                )}
             </div>
             
             <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 md:gap-3 px-3 py-2 md:px-8 md:py-3 rounded-full ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-white border-slate-200'} border shadow-sm backdrop-blur-md max-w-[50%] md:max-w-none justify-center`}>
                 <Zap className={`w-4 h-4 md:w-9 md:h-9 ${theme.textAccent} fill-current flex-shrink-0`} />
                 <h1 className={`text-xs sm:text-base md:text-3xl font-bold ${theme.text} tracking-wide whitespace-nowrap truncate`} style={{ fontFamily: 'sans-serif' }}>Ayaz Altaf AI Studio</h1>
             </div>

             <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`absolute right-6 px-3 py-2 md:px-6 md:py-3 rounded-full border ${theme.border} ${theme.surfaceSecondary} hover:scale-105 transition-all shadow-sm flex items-center gap-2`}
             >
                 {isDarkMode ? (
                     <>
                        <Sun className="w-5 h-5 md:w-6 md:h-6 text-yellow-400" />
                        <span className={`hidden md:inline text-base font-bold ${theme.text}`}>Light Mode</span>
                     </>
                 ) : (
                     <>
                        <Moon className="w-5 h-5 md:w-6 md:h-6 text-indigo-600" />
                        <span className={`hidden md:inline text-base font-bold ${theme.text}`}>Dark Mode</span>
                     </>
                 )}
             </button>
        </div>

        <div className="flex-1 flex overflow-hidden relative">
            
            <div className={`
              absolute md:relative inset-y-0 left-0 w-80 md:w-[420px] ${theme.surface} border-r ${theme.border} flex flex-col z-40 transform transition-transform duration-300
              ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}>
                <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-8" style={{ direction: 'rtl' }}>
                  <div style={{ direction: 'ltr' }}>
                  
                    <div className="space-y-5">
                        <label className={`text-base font-bold ${theme.textMuted} uppercase tracking-widest`}>Select Voice</label>
                        
                        <div className={`flex p-1.5 rounded-lg ${theme.surfaceSecondary} border ${theme.border}`}>
                            {['All', 'Male', 'Female'].map(g => (
                                <button 
                                    key={g} 
                                    onClick={() => setGenderFilter(g)}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all duration-200 ${genderFilter === g ? (isDarkMode ? 'bg-indigo-500 text-white shadow-md' : 'bg-indigo-500 text-white shadow-md') : `${theme.textMuted} hover:bg-gray-200 hover:text-black hover:shadow-md hover:font-extrabold`}`}
                                >
                                    {g}
                                </button>
                            ))}
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            {['All', 'Trending', 'Narrative', 'Professional', 'Energetic', 'Character', 'Soft', 'News', 'Conversational'].map(c => (
                                <button 
                                    key={c} 
                                    onClick={() => setCategoryFilter(c)}
                                    className={`text-sm py-2.5 rounded-lg transition-all duration-200 ${categoryFilter === c ? (isDarkMode ? 'bg-indigo-500 text-white shadow-md font-bold scale-[1.02]' : 'bg-indigo-500 text-white shadow-md font-bold scale-[1.02]') : `${theme.surfaceSecondary} ${theme.textMuted} hover:bg-gray-200 hover:text-black hover:shadow-md hover:scale-105 hover:font-bold hover:z-10`}`}
                                >
                                    {c}
                                </button>
                            ))}
                        </div>

                        <div className={`relative rounded-xl border ${theme.border} overflow-hidden ${theme.surfaceSecondary}`}>
                            <div className="max-h-80 overflow-y-auto no-scrollbar">
                                {Object.entries(groupedVoices).map(([category, items]) => (
                                    <div key={category} className={`border-b last:border-0 ${theme.border}`}>
                                        <div className={`px-5 py-3 text-sm font-bold ${theme.textMuted} uppercase tracking-widest ${isDarkMode ? 'bg-black/20' : 'bg-slate-200/50'} backdrop-blur-sm sticky top-0 z-10`}>
                                            {category}
                                        </div>
                                        <div className="p-2 grid grid-cols-2 gap-2">
                                            {items.map(voice => {
                                                const isSelected = selectedVoiceName === voice.name;
                                                const isPreviewing = previewVoice === voice.name;
                                                const isLoadingPreview = previewLoadingId === voice.name;
                                                
                                                return (
                                                    <div key={voice.name} className={`w-full flex flex-col justify-between p-4 rounded-xl relative overflow-hidden group transition-all duration-200 ${isSelected ? (isDarkMode ? 'bg-indigo-500 text-white shadow-inner' : 'bg-indigo-500 text-white shadow-md') : `hover:bg-gray-200 hover:shadow-lg hover:scale-[1.02] hover:z-10 hover:border-gray-300 border border-transparent`}`}>
                                                        
                                                        <div className="w-full cursor-pointer" onClick={() => setSelectedVoiceName(voice.name)}>
                                                            <div className={`text-lg font-bold mb-1 transition-colors ${isSelected ? 'text-white' : `group-hover:text-black ${theme.text}`}`}>{voice.name}</div>
                                                            <div className={`text-xs font-semibold uppercase tracking-wider mb-2 transition-colors ${isSelected ? 'text-indigo-100' : `text-indigo-500 group-hover:text-indigo-700`}`}>{voice.role || voice.category}</div>
                                                            <div className={`text-[10px] transition-colors ${isSelected ? 'text-indigo-200' : `${theme.textMuted} group-hover:text-black/70`}`}>{voice.gender} • {voice.style}</div>
                                                        </div>

                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation(); 
                                                                handleVoicePreview(voice);
                                                            }}
                                                            disabled={isLoadingPreview}
                                                            className={`absolute top-3 right-3 p-1.5 rounded-full transition-colors z-20 ${isSelected ? 'text-indigo-100 hover:bg-white/20 hover:text-white' : `${theme.textMuted} hover:bg-indigo-100 hover:text-indigo-600`}`}
                                                            title={isPreviewing ? "Stop Preview" : "Preview Voice"}
                                                        >
                                                            {isLoadingPreview ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : isPreviewing ? (
                                                                <StopCircle className="w-4 h-4 animate-pulse text-red-400" />
                                                            ) : (
                                                                <Volume2 className="w-4 h-4" />
                                                            )}
                                                        </button>

                                                        {isSelected && !isPreviewing && !isLoadingPreview && <div className="absolute bottom-3 right-3 pointer-events-none"><Check className="w-4 h-4 text-white/50" /></div>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {Object.keys(groupedVoices).length === 0 && (
                                    <div className={`p-8 text-center text-base ${theme.textMuted}`}>No voices found matching filter.</div>
                                )}
                            </div>
                        </div>
                    </div>
                  </div>
                </div>
            </div>

            <div className={`flex-1 flex flex-col min-w-0 ${isDarkMode ? 'bg-transparent' : 'bg-slate-50/50'} relative border-l ${theme.border}`}>
                {/* REMOVED TAB LOGIC: Always show generator */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-8 pb-8 pt-6 md:px-12 md:pb-12 md:pt-8 relative z-10">
                    <div className="max-w-4xl mx-auto space-y-8">
                        
                        {error && (
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-red-500/20 border-red-500/50 text-red-100' : 'bg-red-50 border-red-200 text-red-700'} flex items-center gap-3 animate-in fade-in slide-in-from-top-2 shadow-sm`}>
                                <AlertCircle className="w-5 h-5" />
                                <span className="text-sm font-bold">{error}</span>
                            </div>
                        )}

                        {notification && (
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-green-500/20 border-green-500/50 text-green-100' : 'bg-green-50 border-green-200 text-green-700'} flex items-center gap-3 animate-in fade-in slide-in-from-top-2 shadow-sm`}>
                                <Check className="w-5 h-5" />
                                <span className="text-sm font-bold">{notification}</span>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                                <div><label className={`text-xl font-bold ${theme.text} flex items-center gap-2 mb-2`}>Text to speech</label></div>
                                <div className={`flex items-center gap-4 ${theme.surfaceSecondary} px-5 py-2 rounded-full border ${theme.border}`}><span className={`text-base ${theme.textMuted}`}>{wordCount} words</span><span className="w-px h-4 bg-gray-400"></span><span className={`text-base ${theme.textMuted}`}>{charCount} chars</span></div>
                            </div>
                            <div className="relative group">
                                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your script here..." className={`w-full h-56 ${theme.inputBg} border ${theme.border} rounded-2xl p-8 ${theme.text} text-xl leading-relaxed placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition-all font-light shadow-sm no-scrollbar`} />
                                <div className="absolute bottom-5 right-5">
                                    <div className={`flex items-center gap-3 px-4 py-2 rounded-full border transition-all cursor-pointer select-none ${isHumanMode ? `${isDarkMode ? 'bg-indigo-900/20 border-indigo-500' : 'bg-indigo-50 border-indigo-200'}` : `${theme.surfaceSecondary} ${theme.border}`}`} onClick={() => setIsHumanMode(!isHumanMode)}>
                                        <BrainCircuit className={`w-4 h-4 ${isHumanMode ? theme.textAccent : theme.textMuted}`} /><span className={`text-sm font-medium ${isHumanMode ? theme.textAccent : theme.textMuted}`}>Smart Human Mode</span>
                                        <div className={`w-9 h-5 rounded-full relative transition-colors duration-300 ${isHumanMode ? 'bg-indigo-500' : 'bg-gray-400'}`}><div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${isHumanMode ? 'translate-x-4' : 'translate-x-0'}`} /></div>
                                    </div>
                                </div>
                            </div>
                            
                            {audioUrl && (
                                <div className={`flex items-start justify-between p-5 rounded-xl border ${theme.border} ${theme.surfaceSecondary} animate-in fade-in slide-in-from-top-2 mt-2 shadow-sm`}>
                                    <div className="flex items-center gap-5">
                                        <button onClick={togglePlayPause} className={`p-4 rounded-full ${theme.buttonPrimary}`}>{isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}</button>
                                        <audio 
                                            ref={audioRef} 
                                            src={audioUrl} 
                                            onPlay={() => setIsPlaying(true)} 
                                            onPause={() => setIsPlaying(false)} 
                                            onEnded={() => setIsPlaying(false)} 
                                            onTimeUpdate={(e) => { setCurrentTime(e.target.currentTime); setDuration(e.target.duration || 0); }}
                                        />
                                        <div className="flex flex-col justify-center h-full">
                                            <span className={`text-lg font-bold ${theme.text} truncate`}>{generatedMetadata.voice || 'Unknown Voice'}</span>
                                            <div className="flex items-center gap-3 mt-1.5">
                                                <span className={`text-sm ${theme.textMuted} truncate max-w-[300px]`}>{generatedMetadata.text || 'No text'}</span>
                                                <span className={`text-sm ${theme.textMuted} font-mono flex-shrink-0 opacity-70`}>• {formatTime(currentTime)} / {formatTime(duration)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-col items-end gap-3 self-start">
                                        <a href={audioUrl} download={`ayaz-${currentVoiceObj.name}.wav`} className={`p-2.5 rounded-full ${theme.textMuted} hover:${theme.text} hover:bg-black/5 transition-colors`}>
                                            <Download className="w-5 h-5" />
                                        </a>
                                        <button onClick={togglePlaybackRate} className={`px-3 py-1.5 rounded text-xs font-bold border ${theme.border} ${theme.text} hover:${theme.surfaceHover}`}>
                                            {currentPlaybackRate}x
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className={`p-5 rounded-xl border ${theme.border} ${theme.surfaceSecondary} shadow-sm`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2"><div className={`flex justify-between text-sm font-bold ${theme.textMuted} uppercase tracking-widest`}><span>Pitch</span><span className={theme.textAccent}>{pitchValue > 0 ? `+${pitchValue}` : pitchValue}</span></div><input type="range" min="-20" max="20" step="1" value={pitchValue} onChange={(e) => setPitchValue(parseInt(e.target.value))} className={`w-full h-1.5 ${isDarkMode ? 'bg-[#2d2e31]' : 'bg-gray-200'} rounded-full appearance-none cursor-pointer accent-indigo-500`} /><div className={`flex justify-between text-xs ${theme.textMuted}`}><span>Deep</span><span>High</span></div></div>
                                <div className="space-y-2"><div className={`flex justify-between text-sm font-bold ${theme.textMuted} uppercase tracking-widest`}><span>Speed</span><span className={theme.textAccent}>{targetSpeed}x</span></div><input type="range" min="0.5" max="2.0" step="0.25" value={targetSpeed} onChange={(e) => {setTargetSpeed(parseFloat(e.target.value));}} className={`w-full h-1.5 ${isDarkMode ? 'bg-[#2d2e31]' : 'bg-gray-200'} rounded-full appearance-none cursor-pointer accent-indigo-500`} /><div className={`flex justify-between text-xs ${theme.textMuted}`}><span>Slow</span><span>Fast</span></div></div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className={`text-base font-bold ${theme.textMuted} uppercase tracking-widest`}>Audio Effects</label>
                            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                {EFFECT_OPTIONS.map(eff => (
                                    <button key={eff} onClick={() => setSelectedEffect(eff)} className={`text-sm py-2.5 rounded-lg transition-all duration-200 ${selectedEffect === eff ? (isDarkMode ? 'bg-indigo-500 text-white shadow-md font-bold scale-[1.02]' : 'bg-indigo-500 text-white shadow-md font-bold scale-[1.02]') : `${theme.surfaceSecondary} ${theme.textMuted} hover:bg-gray-200 hover:text-black hover:shadow-md hover:scale-105 hover:font-bold hover:z-10`}`}>{eff}</button>
                                ))}
                            </div>
                        </div>

                        <button onClick={handleGenerate} disabled={isLoading} className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] ${isLoading ? 'bg-gray-400 cursor-not-allowed' : theme.buttonPrimary}`}>{isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6 fill-current" />}{isLoading ? 'Generating...' : 'Generate Speech'}</button>
                        
                        {isLoading && (<div className={`${theme.surfaceSecondary} border ${theme.border} rounded-2xl p-8 animate-in fade-in slide-in-from-bottom-4 shadow-sm text-center`}><div className={`text-lg font-medium ${theme.text}`}>{progressStatus}</div><div className={`text-sm ${theme.textMuted} mt-3 flex items-center justify-center gap-2 ${theme.surface} px-4 py-1.5 rounded-full w-fit mx-auto`}><Clock className="w-4 h-4" /> {formatTime(elapsedTime)} elapsed</div></div>)}

                        {history.length > 0 && (<div className={`pt-12 border-t ${theme.border}`}><div className={`flex items-center gap-2 text-lg font-bold ${theme.textMuted} uppercase tracking-widest mb-8`}><History className="w-5 h-5" /> Recent Generations</div><div className="grid gap-4">{history.map(item => (<div key={item.id} className={`flex items-center justify-between p-5 ${theme.surfaceSecondary} border ${theme.border} rounded-xl hover:border-indigo-400/50 transition-all group`}><div className="flex items-center gap-5"><button onClick={() => { setAudioUrl(item.url); if(audioRef.current) { audioRef.current.src = item.url; audioRef.current.play(); } }} className={`p-3 rounded-full ${theme.buttonPrimary}`}><Play className="w-5 h-5 fill-current" /></button><div><div className={`text-base font-bold ${theme.text}`}>{item.voice}</div><div className={`text-sm ${theme.textMuted} truncate w-72 mt-1`}>{item.text}</div></div></div><div className="flex items-center gap-4"><span className={`text-xs ${theme.textMuted} font-mono`}>{item.duration ? formatTime(item.duration) : item.timestamp}</span></div></div>))}</div></div>)}
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
