

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, signOut } from 'firebase/auth';
import { LiveSession, LiveServerMessage } from '@google/genai';
import { auth, listenToInventory, addItem, removeItem, getItemDetails, getInventorySummary } from '../services/firebase';
import { playGreeting, startLiveSession } from '../services/gemini';
import { InventoryItem } from '../types';
import { decode, decodeAudioData, encode } from '../utils/audio';
import { MicIcon, StopIcon, LogoutIcon, UserIcon } from './Icons';

interface InventoryProps {
  user: User;
}

const Inventory: React.FC<InventoryProps> = ({ user }) => {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('Click mic to start');
  
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    if (!user) return;
    const unsubscribe = listenToInventory(user.uid, setInventory);
    return () => unsubscribe();
  }, [user]);

  const handleToolResponse = useCallback(async (toolCall: any) => {
    setAssistantStatus('Processing...');
    let result = "An unknown error occurred.";
    try {
      if (toolCall.name === 'add_item') {
        const { name, quantity, pricePerItem } = toolCall.args;
        result = await addItem(user.uid, { name, quantity, pricePerItem });
      } else if (toolCall.name === 'remove_item') {
        const { name, quantity } = toolCall.args;
        result = await removeItem(user.uid, name, quantity);
      } else if (toolCall.name === 'get_item_details') {
        const { name } = toolCall.args;
        result = await getItemDetails(user.uid, name);
      } else if (toolCall.name === 'get_inventory_summary') {
        result = await getInventorySummary(user.uid);
      } else {
        result = `Unknown function: ${toolCall.name}`;
      }
    } catch (e: any) {
        result = `Error executing function: ${e.message}`;
    }

    sessionPromiseRef.current?.then(session => {
        session.sendToolResponse({
            functionResponses: {
                id: toolCall.id,
                name: toolCall.name,
                response: { result },
            }
        });
    });
  }, [user.uid]);

  const onLiveMessage = useCallback(async (message: LiveServerMessage) => {
    if (message.toolCall) {
        message.toolCall.functionCalls.forEach(handleToolResponse);
    }

    if (message.serverContent?.interrupted) {
        console.log("Assistant interrupted by user.");
        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        setAssistantStatus('Listening...');
        return;
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
        setAssistantStatus('Speaking...');
        if (!outputAudioContextRef.current) {
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = outputAudioContextRef.current;
        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.addEventListener('ended', () => {
          audioSourcesRef.current.delete(source);
          if (audioSourcesRef.current.size === 0) {
            setAssistantStatus('Listening...');
          }
        });
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        audioSourcesRef.current.add(source);
    }
  }, [handleToolResponse]);
  
  const stopListening = useCallback(() => {
    if (!sessionPromiseRef.current) {
        return;
    }

    setIsListening(false);
    setAssistantStatus('Click mic to start');
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    scriptProcessorRef.current?.disconnect();
    audioContextRef.current?.close().catch(console.error);
    sessionPromiseRef.current?.then(session => session.close());
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    outputAudioContextRef.current?.close().catch(console.error);

    mediaStreamRef.current = null;
    audioContextRef.current = null;
    scriptProcessorRef.current = null;
    sessionPromiseRef.current = null;
    outputAudioContextRef.current = null;
    nextStartTimeRef.current = 0;
  }, []);

  const startListening = useCallback(async () => {
    setIsListening(true);
    setAssistantStatus('Starting...');
    await playGreeting();
    setAssistantStatus('Listening...');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContextRef.current.createMediaStreamSource(stream);
        scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

        scriptProcessorRef.current.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const l = inputData.length;
            const int16 = new Int16Array(l);
            for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
            }
            const base64 = encode(new Uint8Array(int16.buffer));
            sessionPromiseRef.current?.then(session => {
                session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' }});
            });
        };
        
        source.connect(scriptProcessorRef.current);
        scriptProcessorRef.current.connect(audioContextRef.current.destination);
        
        sessionPromiseRef.current = startLiveSession({
            onMessage: onLiveMessage,
            onError: (e) => {
                console.error("Live session error:", e);
                setAssistantStatus('An error occurred.');
                stopListening();
            },
            onClose: () => {
                console.log("Live session closed.");
                stopListening();
            }
        });
    } catch (err) {
        console.error("Error starting microphone:", err);
        setAssistantStatus('Mic permission needed.');
        setIsListening(false);
    }
  }, [onLiveMessage, stopListening]);


  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const filteredInventory = inventory.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totals = filteredInventory.reduce((acc, item) => {
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.pricePerItem) || 0;
    acc.totalItems += quantity;
    acc.totalValue += quantity * price;
    return acc;
  }, { totalItems: 0, totalValue: 0 });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-sm flex justify-between items-center p-4 border-b border-gray-700">
        <div>
            <h1 className="text-xl sm:text-2xl font-bold text-indigo-400">Stock Pilot</h1>
            <p className="text-xs text-gray-500">by SoundSync</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
            <p className="text-sm text-gray-400 hidden md:block transition-all duration-300 w-28 text-center">
                {assistantStatus}
            </p>
            <button
              onClick={toggleListening}
              className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500'
              }`}
              aria-label={isListening ? 'Stop listening' : 'Start listening'}
            >
              {isListening && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>}
              {isListening ? (
                <StopIcon className="w-6 h-6 relative" />
              ) : (
                <MicIcon className="w-6 h-6 relative" />
              )}
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-300 border-l border-gray-700 pl-2 sm:pl-4">
              <UserIcon className="w-5 h-5 text-gray-400" />
              <span className="hidden sm:inline font-medium">{user.displayName || user.email}</span>
            </div>
            <button onClick={() => signOut(auth)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-gray-900">
                <LogoutIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Logout</span>
            </button>
        </div>
      </header>
      
      <main className="p-4 sm:p-6 lg:p-8">
        <div className="bg-gray-800 rounded-xl shadow-lg p-6">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
              <h2 className="text-xl font-semibold">Inventory Status</h2>
              <div className="relative">
                  <input
                      type="text"
                      placeholder="Search items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full sm:w-64 bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-5 h-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                      </svg>
                  </div>
              </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-gray-600">
                <tr>
                  <th className="p-3">Product</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3 text-right">Price/Item</th>
                  <th className="p-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map(item => {
                  const quantity = Number(item.quantity) || 0;
                  const pricePerItem = Number(item.pricePerItem) || 0;
                  return (
                    <tr key={item.id} className="border-b border-gray-700 hover:bg-gray-700/50">
                      <td className="p-3 capitalize">{item.name || 'N/A'}</td>
                      <td className="p-3 text-right">{quantity}</td>
                      <td className="p-3 text-right">₹{pricePerItem.toFixed(2)}</td>
                      <td className="p-3 text-right">₹{(quantity * pricePerItem).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="font-bold">
                <tr>
                  <td className="p-3 pt-4">Total</td>
                  <td className="p-3 pt-4 text-right">{totals.totalItems}</td>
                  <td className="p-3 pt-4"></td>
                  <td className="p-3 pt-4 text-right">₹{totals.totalValue.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Inventory;