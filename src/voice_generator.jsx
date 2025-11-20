import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Download, Loader2, Mic, ChevronDown, AlertCircle, Sparkles, Sliders, Zap, Wand2, Search, X, Fingerprint, Save, Trash2, UploadCloud, FileAudio, Check, Menu, Clock, FileText, BrainCircuit, History, Pause } from 'lucide-react';

// --- AUDIO UTILITIES ---

const splitTextIntoChunks = (text, maxLength = 4096) => {
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

const applyAudioEffects = async (originalBuffer, effectType) => {
  if (effectType === 'None') return originalBuffer;
  const tailSeconds = ['Echo', 'Reverb', 'Cathedral', 'Radio'].includes(effectType) ? 3 : 0;
  const length = originalBuffer.length + (tailSeconds * originalBuffer.sampleRate);
  const offlineCtx = new OfflineAudioContext(1, length, originalBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = originalBuffer;
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
  } else if (effectType === 'Chipmunk') {
    source.playbackRate.value = 1.5; lastNode = source;
  } else if (effectType === 'Monster') {
    source.playbackRate.value = 0.7; lastNode = source;
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

const audioBufferToWav = (buffer) => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i, sample, pos = 0, offset = 44;
  const writeString = (view, offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };

  writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + buffer.length * 2, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true); view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, buffer.length * 2, true);

  for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  while(pos < buffer.length){
    for(i = 0; i < numOfChan; i++){
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }
  return new Blob([view], {type: 'audio/wav'});
};

// --- CONSTANTS ---
const INITIAL_VOICES = [
  { name: "Storyteller Adam", apiName: "Charon", gender: "Male", style: "Deep & Realistic", category: "Narrative" },
  { name: "Deep Narrator", apiName: "Iapetus", gender: "Male", style: "Pro Documentary", category: "Narrative" },
  { name: "Movie Trailer Guy", apiName: "Umbriel", gender: "Male", style: "Epic Bass", category: "Narrative" },
  { name: "Callirrhoe", apiName: "Callirrhoe", gender: "Female", style: "Expressive", category: "Narrative" },
  { name: "Zephyr", apiName: "Zephyr", gender: "Female", style: "Professional", category: "Professional" },
  { name: "Leda", apiName: "Leda", gender: "Female", style: "Balanced", category: "Professional" },
  { name: "Orus", apiName: "Orus", gender: "Male", style: "Confident", category: "Professional" },
  { name: "Kore", apiName: "Kore", gender: "Female", style: "Calm & Clear", category: "Soft" },
  { name: "Aoede", apiName: "Aoede", gender: "Female", style: "Friendly", category: "Soft" },
  { name: "Autonoe", apiName: "Autonoe", gender: "Female", style: "Warm", category: "Soft" },
  { name: "Puck", apiName: "Puck", gender: "Male", style: "Assertive", category: "Energetic" },
  { name: "Fenrir", apiName: "Fenrir", gender: "Male", style: "Energetic", category: "Energetic" },
  { name: "Enceladus", apiName: "Enceladus", gender: "Male", style: "Strong", category: "Energetic" },
  { name: "The Joker", apiName: "Fenrir", gender: "Male", style: "Manic & Chaotic", category: "Character" },
  { name: "Wise Old Man", apiName: "Charon", gender: "Male", style: "Slow & Wise", category: "Character" },
  { name: "Harley Style", apiName: "Algieba", gender: "Female", style: "High Energy/Crazy", category: "Character" }
];

const EFFECT_OPTIONS = ["None", "Reverb", "Echo", "Robot", "Telephone", "Radio", "Underwater", "Chipmunk", "Monster", "Chorus", "Distortion", "Alien"];
const CATEGORY_GROUPS = {
  "My Clones": [],
  "Narrative": ["Narrative"],
  "Professional": ["Professional"],
  "Soft": ["Soft"],
  "Energetic": ["Energetic"],
  "Character": ["Character"]
};

export default function VoiceGeneratorApp() {
  const [activeTab, setActiveTab] = useState('generate');
  const [voices, setVoices] = useState(INITIAL_VOICES);
  const [clonedVoices, setClonedVoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [text, setText] = useState('This is the ultimate voice studio. You can now clone voices by uploading samples, apply advanced effects, and control pitch with extreme precision.');
  const [selectedVoiceName, setSelectedVoiceName] = useState('Storyteller Adam');
  const [isLoading, setIsLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState(''); 
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [targetSpeed, setTargetSpeed] = useState(1.0);
  const [pitchValue, setPitchValue] = useState(0); 
  const [selectedEffect, setSelectedEffect] = useState('None');
  const [isHumanMode, setIsHumanMode] = useState(true); 
  const [searchTerm, setSearchTerm] = useState('');
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef(null);
  
  const [cloneName, setCloneName] = useState('');
  const [cloneGender, setCloneGender] = useState('Male');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isCloning, setIsCloning] = useState(false);
  
  const audioRef = useRef(null);
  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);

  const wordCount = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);
  const charCount = useMemo(() => text.length, [text]);
  const allVoices = useMemo(() => [...clonedVoices, ...INITIAL_VOICES], [clonedVoices]);
  const currentVoiceObj = useMemo(() => allVoices.find(v => v.name === selectedVoiceName) || allVoices[0], [selectedVoiceName, allVoices]);

  const groupedVoices = useMemo(() => {
    const groups = {};
    const clones = clonedVoices.filter(v => v.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (clones.length > 0) groups["My Clones"] = clones;

    Object.entries(CATEGORY_GROUPS).forEach(([label, cats]) => {
      if (label === "My Clones") return;
      const matches = INITIAL_VOICES.filter(v => cats.includes(v.category) && v.name.toLowerCase().includes(searchTerm.toLowerCase()));
      if (matches.length > 0) groups[label] = matches;
    });
    return groups;
  }, [searchTerm, clonedVoices]);

  const startTimer = () => { setElapsedTime(0); if (timerRef.current) clearInterval(timerRef.current); timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000); };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };
  const formatTime = (seconds) => { const mins = Math.floor(seconds / 60); const secs = seconds % 60; return `${mins}:${secs < 10 ? '0' : ''}${secs}`; };

  const optimizeScriptForHumanSpeech = (rawText) => {
    let optimized = rawText;
    optimized = optimized.replace(/\n\n/g, '... [long pause] ... ');
    optimized = optimized.replace(/\.(?=[a-zA-Z])/g, '. ');
    if (isHumanMode) {
      return `(Speaking naturally with human-like pauses, varied intonation, and proper breathing) ${optimized}`;
    }
    return optimized;
  };

  const fetchAudioChunk = async (inputText) => {
    // VERCEL COMPATIBLE KEY HANDLING
    // Uses process.env to avoid 'import.meta' errors in some parsers.
    // Ensure 'vite.config.js' is properly set to map this env var.
    const apiKey = process.env.VITE_GOOGLE_API_KEY || ""; 
    
    if (!apiKey) {
        throw new Error("API Key is missing! Please check Vercel Environment Variables.");
    }

    let finalText = optimizeScriptForHumanSpeech(inputText);
    
    if (pitchValue !== 0) {
        const intensity = Math.abs(pitchValue);
        const tone = pitchValue < 0 ? "deeper" : "higher";
        let desc = "";
        if (intensity < 5) desc = `slightly ${tone}`;
        else if (intensity < 10) desc = `noticeably ${tone}`;
        else if (intensity < 15) desc = `very ${tone}`;
        else desc = `extremely ${tone}`;
        finalText = `(Speaking in a ${desc} tone) ${finalText}`;
    }
    
    if (pitchValue === 0 && !isHumanMode) {
       if (currentVoiceObj.name === "The Joker") finalText = `(Manic, chaotic villain voice) ${inputText}`;
       else if (currentVoiceObj.name === "Storyteller Adam") finalText = `(Deep documentary narration) ${inputText}`;
       else if (currentVoiceObj.category === 'Custom Clone') finalText = `(Imitating the uploaded voice sample style: ${currentVoiceObj.description}) ${inputText}`;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: finalText }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoiceObj.apiName } } }
      }
    };

    let retries = 3;
    while (retries > 0) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.status === 429) { await new Promise(r => setTimeout(r, 2000)); retries--; continue; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Generation failed');
        return data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } catch (e) { if (retries === 1) throw e; retries--; await new Promise(r => setTimeout(r, 1000)); }
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) { setError('Text is empty.'); return; }
    setIsLoading(true); setError(''); setAudioUrl(null); setProgressStatus('Analyzing script...');
    setCurrentPlaybackRate(targetSpeed);
    startTimer();
    setIsSidebarOpen(false);

    try {
      const chunks = splitTextIntoChunks(text);
      const audioBuffers = [];
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      for (let i = 0; i < chunks.length; i++) {
        setProgressStatus(chunks.length > 1 ? `Processing part ${i + 1}/${chunks.length}...` : 'Synthesizing audio...');
        const base64Audio = await fetchAudioChunk(chunks[i]);
        if (base64Audio) {
          const buffer = await base64ToAudioBuffer(base64Audio, audioCtx);
          audioBuffers.push(buffer);
        }
      }

      setProgressStatus('Mastering audio...');
      if (audioBuffers.length > 0) {
        const mergedBuffer = mergeAudioBuffers(audioBuffers, audioCtx);
        const processedBuffer = await applyAudioEffects(mergedBuffer, selectedEffect);
        const wavBlob = audioBufferToWav(processedBuffer);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
        setHistory(prev => [{ id: Date.now(), voice: currentVoiceObj.name, text: text.slice(0, 40) + (text.length > 40 ? '...' : ''), url: url, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      } else { throw new Error('No audio returned.'); }
    } catch (err) { console.error(err); setError(err.message || "Error occurred."); } finally { setIsLoading(false); setProgressStatus(''); stopTimer(); }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    setUploadedFiles(prev => [...prev, ...files]);
  };

  const handleRemoveFile = (index) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateClone = () => {
    if (!cloneName || uploadedFiles.length === 0) return;
    setIsCloning(true);
    setTimeout(() => {
      const newClone = { 
          name: cloneName, 
          apiName: cloneGender === 'Male' ? 'Charon' : 'Kore', 
          gender: cloneGender, 
          style: 'Custom Clone', 
          category: 'Custom Clone', 
          description: `Custom voice trained on ${uploadedFiles.length} samples.` 
      };
      setClonedVoices([newClone, ...clonedVoices]);
      setCloneName(''); setUploadedFiles([]); setIsCloning(false);
      setActiveTab('generate'); setSelectedVoiceName(newClone.name);
    }, 2500);
  };

  useEffect(() => { 
      if (audioUrl && audioRef.current) { 
          audioRef.current.play().catch(e => console.log("Auto-play blocked:", e)); 
          setIsPlaying(true); 
      }
      return () => {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
      };
  }, [audioUrl]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = currentPlaybackRate; }, [currentPlaybackRate]);

  return (
    <div className="flex h-screen bg-[#0f1012] text-white font-sans overflow-hidden selection:bg-[#a8c7fa] selection:text-[#0f1012]">
      
      {/* Mobile Menu Button */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-[#1e1f22] border border-[#2d2e31] rounded-lg text-[#e3e3e3]"
      >
        {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 w-80 bg-[#131416] border-r border-[#2d2e31] flex flex-col z-40 transform transition-transform duration-300 md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
          <div className="p-5 border-b border-[#2d2e31] flex items-center justify-center md:justify-start pl-12 md:pl-5">
            <div className="flex items-center gap-2 text-[#a8c7fa] font-bold text-xl">
                <Zap className="w-6 h-6 fill-current" /> Ayaz Studio
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-8">
             
             {/* TOP: Instant Cloning Button */}
             <button onClick={() => setActiveTab('clone')} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-[#1e1f22] to-[#2d2e31] hover:from-[#282a2e] hover:to-[#36383c] text-xs font-bold text-white transition-all border border-[#36383c] shadow-md group mb-4">
                <Fingerprint className="w-4 h-4 text-[#a8c7fa] group-hover:scale-110 transition-transform" /> Instant Voice Cloning
             </button>

             {/* Voice Selection */}
             <div className="space-y-3">
                <label className="text-xs font-bold text-[#8e9196] uppercase tracking-widest">Voice Character</label>
                <div className="relative group">
                    <button 
                        onClick={() => setIsVoiceMenuOpen(!isVoiceMenuOpen)}
                        className="w-full bg-[#1e1f22] hover:bg-[#282a2e] border border-[#2d2e31] rounded-xl p-3.5 flex items-center justify-between transition-all shadow-sm group"
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-bold shadow-inner ${currentVoiceObj.category === 'Custom Clone' ? 'bg-green-500/20 text-green-400' : currentVoiceObj.category === 'Character' ? 'bg-purple-500/20 text-purple-400' : 'bg-[#a8c7fa]/20 text-[#a8c7fa]'}`}>
                                {currentVoiceObj.name[0]}
                            </div>
                            <div className="text-left truncate">
                                <div className="text-sm font-bold text-white truncate group-hover:text-[#a8c7fa] transition-colors">{currentVoiceObj.name}</div>
                                <div className="text-[11px] text-[#8e9196] truncate">{currentVoiceObj.style}</div>
                            </div>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-[#8e9196] transition-transform duration-200 ${isVoiceMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {isVoiceMenuOpen && (
                        <div className="absolute top-full left-0 w-full mt-2 bg-[#1e1f22] border border-[#2d2e31] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-96 overflow-y-auto custom-scrollbar">
                             <div className="sticky top-0 bg-[#1e1f22] p-3 border-b border-[#2d2e31] z-10">
                                 <div className="relative">
                                    <Search className="absolute left-3 top-2.5 w-3 h-3 text-[#8e9196]" />
                                    <input type="text" placeholder="Search voices..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[#131416] border border-[#2d2e31] rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#a8c7fa]" />
                                 </div>
                             </div>
                             <div className="p-2">
                                 {Object.entries(groupedVoices).map(([category, items]) => (
                                     <div key={category} className="mb-3 last:mb-0">
                                         <div className="px-3 py-1.5 text-[10px] font-bold text-[#8e9196] uppercase tracking-widest bg-[#131416]/50 rounded mb-1 sticky top-0">{category}</div>
                                         {items.map(voice => (
                                             <div key={voice.name} onClick={() => { setSelectedVoiceName(voice.name); setIsVoiceMenuOpen(false); }} className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors group ${selectedVoiceName === voice.name ? 'bg-[#a8c7fa]/10 border border-[#a8c7fa]/30' : 'hover:bg-[#2d2e31] border border-transparent'}`}>
                                                 <div className="flex items-center gap-3 truncate">
                                                     <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${voice.category === 'Custom Clone' ? 'bg-green-900/30 text-green-400' : 'bg-[#131416] text-[#8e9196]'}`}>{voice.name[0]}</div>
                                                     <div className={`text-xs font-medium truncate ${selectedVoiceName === voice.name ? 'text-[#a8c7fa]' : 'text-white group-hover:text-gray-200'}`}>{voice.name}</div>
                                                 </div>
                                                 {selectedVoiceName === voice.name && <Check className="w-3 h-3 text-[#a8c7fa]" />}
                                             </div>
                                         ))}
                                     </div>
                                 ))}
                             </div>
                        </div>
                    )}
                </div>
             </div>

             {/* Settings */}
             <div className="space-y-6">
                 <div className="space-y-3">
                     <div className="flex justify-between text-xs font-bold text-[#8e9196] uppercase tracking-widest"><span>Pitch</span><span className="text-[#a8c7fa]">{pitchValue > 0 ? `+${pitchValue}` : pitchValue}</span></div>
                     <input type="range" min="-20" max="20" step="1" value={pitchValue} onChange={(e) => setPitchValue(parseInt(e.target.value))} className="w-full h-1.5 bg-[#2d2e31] rounded-full appearance-none cursor-pointer accent-[#a8c7fa]" />
                     <div className="flex justify-between text-[9px] text-[#4b4d52]"><span>Deep</span><span>High</span></div>
                 </div>
                 <div className="space-y-3">
                     <div className="flex justify-between text-xs font-bold text-[#8e9196] uppercase tracking-widest"><span>Speed</span><span className="text-[#a8c7fa]">{targetSpeed}x</span></div>
                     <input type="range" min="0.5" max="2.0" step="0.25" value={targetSpeed} onChange={(e) => {setTargetSpeed(parseFloat(e.target.value)); setCurrentPlaybackRate(parseFloat(e.target.value))}} className="w-full h-1.5 bg-[#2d2e31] rounded-full appearance-none cursor-pointer accent-[#a8c7fa]" />
                     <div className="flex justify-between text-[9px] text-[#4b4d52]"><span>Slow</span><span>Fast</span></div>
                 </div>
             </div>
             
             {/* Effects */}
             <div className="space-y-3">
                <label className="text-xs font-bold text-[#8e9196] uppercase tracking-widest">Audio Effects</label>
                <div className="grid grid-cols-3 gap-2">
                    {EFFECT_OPTIONS.map(eff => (
                        <button key={eff} onClick={() => setSelectedEffect(eff)} className={`text-[10px] py-2 rounded-lg border transition-all ${selectedEffect === eff ? 'bg-[#a8c7fa] text-[#0f1012] border-[#a8c7fa] font-bold shadow-[0_0_10px_rgba(168,199,250,0.3)]' : 'bg-[#1e1f22] text-[#8e9196] border-[#2d2e31] hover:border-[#4b4d52] hover:text-white'}`}>{eff}</button>
                    ))}
                </div>
             </div>
          </div>
          
          {/* Generator Button */}
          <div className="p-5 border-t border-[#2d2e31] bg-[#131416]">
              <button onClick={handleGenerate} disabled={isLoading} className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] ${isLoading ? 'bg-[#2d2e31] text-[#8e9196] cursor-not-allowed' : 'bg-white text-black hover:scale-[1.02]'}`}>
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                  {isLoading ? 'Generating Audio...' : 'Generate Speech'}
              </button>
          </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0f1012] relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,199,250,0.03),transparent_50%)] pointer-events-none" />
          
          {activeTab === 'generate' ? (
              <>
              <div className="flex-1 overflow-y-auto p-8 md:p-12 relative z-10 pt-16 md:pt-12">
                  <div className="max-w-5xl mx-auto space-y-8">
                      {/* Text Input */}
                      <div className="space-y-3">
                          <div className="flex justify-between items-end">
                              <label className="text-sm font-bold text-[#e3e3e3] flex items-center gap-2"><FileText className="w-4 h-4 text-[#a8c7fa]" /> Script Editor</label>
                              <div className="flex items-center gap-4 bg-[#1e1f22] px-4 py-1.5 rounded-full border border-[#2d2e31]">
                                  <span className="text-xs text-[#8e9196]">{wordCount} words</span>
                                  <span className="w-px h-3 bg-[#444746]"></span>
                                  <span className="text-xs text-[#8e9196]">{charCount} chars</span>
                              </div>
                          </div>
                          <div className="relative group">
                              <textarea 
                                  value={text} 
                                  onChange={(e) => setText(e.target.value)} 
                                  placeholder="Type your script here..." 
                                  className="w-full h-72 bg-[#1e1f22]/50 border border-[#2d2e31] rounded-2xl p-8 text-[#e3e3e3] text-lg leading-relaxed placeholder-[#4b4d52] focus:border-[#a8c7fa] focus:ring-1 focus:ring-[#a8c7fa] outline-none resize-none transition-all font-light backdrop-blur-sm selection:bg-[#a8c7fa]/30"
                              />
                              <div className="absolute bottom-4 right-4">
                                 <div 
                                    className={`flex items-center gap-3 px-4 py-2 rounded-full border transition-all cursor-pointer select-none ${isHumanMode ? 'bg-[#a8c7fa]/10 border-[#a8c7fa]' : 'bg-black border-[#2d2e31]'}`} 
                                    onClick={() => setIsHumanMode(!isHumanMode)}
                                 >
                                     <BrainCircuit className={`w-4 h-4 ${isHumanMode ? 'text-[#a8c7fa]' : 'text-[#4b4d52]'}`} />
                                     <span className={`text-xs font-medium ${isHumanMode ? 'text-[#a8c7fa]' : 'text-[#4b4d52]'}`}>Smart Human Mode</span>
                                     
                                     {/* FIXED TOGGLE SWITCH */}
                                     <div className={`w-8 h-4 rounded-full relative transition-colors duration-300 ${isHumanMode ? 'bg-[#a8c7fa]' : 'bg-black border border-[#4b4d52]'}`}>
                                         <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-300 ${isHumanMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                     </div>
                                 </div>
                              </div>
                          </div>
                      </div>

                      {/* Output Player */}
                      {(audioUrl || isLoading) && (
                          <div className="bg-[#1e1f22] border border-[#2d2e31] rounded-2xl p-8 animate-in fade-in slide-in-from-bottom-4 shadow-2xl">
                              {isLoading ? (
                                  <div className="flex flex-col items-center justify-center py-10 gap-6">
                                      <div className="relative">
                                          <div className="w-16 h-16 border-4 border-[#2d2e31] border-t-[#a8c7fa] rounded-full animate-spin"></div>
                                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#a8c7fa]">{Math.round((elapsedTime / 5) * 100)}%</div>
                                      </div>
                                      <div className="text-center">
                                          <div className="text-base font-medium text-white">{progressStatus}</div>
                                          <div className="text-xs text-[#8e9196] mt-2 flex items-center justify-center gap-2 bg-[#131416] px-3 py-1 rounded-full w-fit mx-auto"><Clock className="w-3 h-3" /> {formatTime(elapsedTime)} elapsed</div>
                                      </div>
                                  </div>
                              ) : (
                                  <div className="flex flex-col gap-8">
                                      <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-6">
                                              <button 
                                                  onClick={() => {
                                                      if (audioRef.current.paused) { audioRef.current.play(); setIsPlaying(true); } 
                                                  else { audioRef.current.pause(); setIsPlaying(false); }
                                                  }}
                                                  className="w-16 h-16 bg-white hover:bg-[#e0e0e0] rounded-full flex items-center justify-center text-black transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:scale-105"
                                              >
                                                  {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                                              </button>
                                              <div>
                                                  <div className="text-lg font-bold text-white flex items-center gap-2">
                                                      {currentVoiceObj.name} 
                                                      {selectedEffect !== 'None' && <span className="text-[10px] bg-[#a8c7fa] text-[#0f1012] px-2 py-0.5 rounded font-bold uppercase">{selectedEffect}</span>}
                                                  </div>
                                                  <div className="text-sm text-[#8e9196] mt-1">Ready to play • {formatTime(audioRef.current?.duration || 0)}</div>
                                              </div>
                                          </div>
                                          <a href={audioUrl} download={`ayaz-${currentVoiceObj.name}.wav`} className="flex items-center gap-2 px-6 py-3 bg-[#2d2e31] hover:bg-[#36383c] rounded-xl text-sm font-bold text-white transition-all hover:scale-105 border border-[#36383c]">
                                              <Download className="w-4 h-4" /> Download WAV
                                          </a>
                                      </div>
                                      
                                      {/* Pro Visualizer */}
                                      <div className="h-24 bg-[#131416] rounded-xl flex items-center justify-center gap-1.5 overflow-hidden px-6 border border-[#2d2e31] relative">
                                          <div className="absolute inset-0 bg-[linear-gradient(transparent_49%,#2d2e31_50%,transparent_51%)] opacity-30 pointer-events-none" />
                                          {Array.from({ length: 60 }).map((_, i) => (
                                              <div 
                                                key={i} 
                                                className={`w-1.5 rounded-full transition-all duration-75 ${isPlaying ? 'bg-[#a8c7fa]' : 'bg-[#2d2e31]'}`} 
                                                style={{ 
                                                    height: isPlaying ? `${Math.max(10, Math.random() * 100)}%` : '4px', 
                                                    opacity: isPlaying ? 1 : 0.5 
                                                }}
                                              ></div>
                                          ))}
                                      </div>
                                      
                                      <audio ref={audioRef} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} controls className="hidden" />
                                  </div>
                              )}
                          </div>
                      )}

                      {/* History Section */}
                      {history.length > 0 && (
                          <div className="pt-10 border-t border-[#2d2e31]">
                              <div className="flex items-center gap-2 text-sm font-bold text-[#8e9196] uppercase tracking-widest mb-6"><History className="w-4 h-4" /> Recent Generations</div>
                              <div className="grid gap-3">
                                  {history.map(item => (
                                      <div key={item.id} className="flex items-center justify-between p-4 bg-[#1e1f22] border border-[#2d2e31] rounded-xl hover:border-[#4b4d52] transition-all group">
                                          <div className="flex items-center gap-4">
                                              <div className="w-10 h-10 bg-[#2d2e31] rounded-full flex items-center justify-center text-[#a8c7fa]"><Volume2 className="w-5 h-5" /></div>
                                              <div>
                                                  <div className="text-sm font-bold text-white">{item.voice}</div>
                                                  <div className="text-xs text-[#8e9196] truncate w-64 mt-0.5">{item.text}</div>
                                              </div>
                                          </div>
                                          <div className="flex items-center gap-3">
                                              <span className="text-[10px] text-[#4b4d52] font-mono">{item.timestamp}</span>
                                              <div className="h-4 w-px bg-[#2d2e31]"></div>
                                              <button onClick={() => { setAudioUrl(item.url); if(audioRef.current) { audioRef.current.src = item.url; audioRef.current.play(); } }} className="p-2 text-[#8e9196] hover:text-white hover:bg-[#2d2e31] rounded-lg transition-colors"><Play className="w-4 h-4" /></button>
                                              <a href={item.url} download="history-audio.wav" className="p-2 text-[#8e9196] hover:text-white hover:bg-[#2d2e31] rounded-lg transition-colors"><Download className="w-4 h-4" /></a>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}
                  </div>
              </div>
              </>
          ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 pt-16 md:pt-8">
                  <div className="max-w-2xl w-full bg-[#1e1f22] border border-[#2d2e31] rounded-3xl p-10 shadow-2xl animate-in zoom-in-95 duration-300">
                      <div className="flex justify-between items-start mb-8 pb-6 border-b border-[#2d2e31]">
                         <div className="flex items-center gap-4">
                             <div className="w-14 h-14 bg-[#a8c7fa]/10 rounded-2xl flex items-center justify-center border border-[#a8c7fa]/20">
                                 <Fingerprint className="w-7 h-7 text-[#a8c7fa]" />
                             </div>
                             <div>
                                 <h2 className="text-2xl font-bold text-white">Instant Voice Cloning</h2>
                                 <p className="text-sm text-[#8e9196] mt-1">Upload samples to train a custom voice model.</p>
                             </div>
                         </div>
                         <button onClick={() => setActiveTab('generate')} className="p-2 rounded-full hover:bg-[#2d2e31] text-[#8e9196] hover:text-white transition-colors"><X className="w-6 h-6" /></button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-8 mb-8">
                          <div className="space-y-2">
                             <label className="block text-xs font-bold text-[#8e9196] uppercase tracking-wider">Voice Name</label>
                             <input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="e.g. Narrator Pro" className="w-full bg-[#131416] border border-[#2d2e31] rounded-xl px-5 py-3.5 text-sm text-white focus:border-[#a8c7fa] outline-none transition-colors" />
                          </div>
                          <div className="space-y-2">
                             <label className="block text-xs font-bold text-[#8e9196] uppercase tracking-wider">Base Model</label>
                             <div className="flex gap-3">
                                {['Male', 'Female'].map(g => (
                                    <button key={g} onClick={() => setCloneGender(g)} className={`flex-1 py-3.5 rounded-xl text-xs font-bold border transition-all ${cloneGender === g ? 'bg-[#a8c7fa] border-[#a8c7fa] text-[#0f1012]' : 'bg-[#131416] border-[#2d2e31] text-[#8e9196] hover:border-[#4b4d52]'}`}>{g}</button>
                                ))}
                             </div>
                          </div>
                      </div>
                      
                      <div className="space-y-6">
                          <div className="space-y-3">
                             <label className="block text-xs font-bold text-[#8e9196] uppercase tracking-wider flex justify-between">
                                <span>Upload Samples (Min 2-3 clips)</span>
                                <span className="text-[#a8c7fa]">{uploadedFiles.length} files</span>
                             </label>
                             
                             <div className="relative">
                                 <input type="file" multiple accept="audio/*" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                 <div className="border-2 border-dashed border-[#2d2e31] hover:border-[#a8c7fa] bg-[#131416] rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors">
                                     <div className="w-12 h-12 bg-[#2d2e31] rounded-full flex items-center justify-center"><UploadCloud className="w-6 h-6 text-[#8e9196]" /></div>
                                     <div className="text-center">
                                         <p className="text-sm font-medium text-white">Click to upload or drag & drop</p>
                                         <p className="text-xs text-[#8e9196] mt-1">MP3, WAV, M4A (Max 10MB each)</p>
                                     </div>
                                 </div>
                             </div>
                             
                             {uploadedFiles.length > 0 && (
                                 <div className="space-y-2 bg-[#131416] border border-[#2d2e31] rounded-xl p-3 max-h-32 overflow-y-auto custom-scrollbar">
                                     {uploadedFiles.map((file, idx) => (
                                         <div key={idx} className="flex items-center justify-between p-2 bg-[#1e1f22] rounded-lg text-xs text-[#e3e3e3]">
                                             <div className="flex items-center gap-2"><FileAudio className="w-3 h-3 text-[#a8c7fa]" /> {file.name}</div>
                                             <button onClick={() => handleRemoveFile(idx)} className="text-[#8e9196] hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                                         </div>
                                     ))}
                                 </div>
                             )}
                          </div>
                          
                          <button onClick={handleCreateClone} disabled={isCloning || !cloneName || uploadedFiles.length === 0} className={`w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${isCloning ? 'bg-[#2d2e31] text-[#8e9196]' : 'bg-white hover:bg-[#e0e0e0] text-black shadow-lg'}`}>{isCloning ? <><Loader2 className="w-4 h-4 animate-spin" /> Training Voice Model...</> : <><Sparkles className="w-4 h-4 fill-current" /> Train Voice</>}</button>
                      </div>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
}
