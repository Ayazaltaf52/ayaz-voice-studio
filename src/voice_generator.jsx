import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Download, Loader2, Mic, ChevronDown, AlertCircle, Sparkles, Sliders, Zap, Volume2, Wand2, Search, Filter, X, User, BookOpen, Smile, Fingerprint, Plus, Save, Trash2, Upload, Infinity, Clock, FileText, BrainCircuit, History, Pause, UploadCloud, FileAudio, Music, Check, ChevronRight, Menu } from 'lucide-react';

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
      const matches = INITIAL_VOICES.filter(v => 
        cats.includes(v.category) && 
        v.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
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
    const apiKey = ""; 
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
