

import { GoogleGenAI, LiveSession, FunctionDeclaration, Type, Modality, LiveServerMessage } from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audio';

let ai: GoogleGenAI;

const getAi = () => {
    if (!ai) {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set");
        }
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}

const functionDeclarations: FunctionDeclaration[] = [
    {
        name: 'add_item',
        description: 'Add an item to the inventory. If the item already exists, its quantity is updated.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'The name of the item.' },
                quantity: { type: Type.NUMBER, description: 'The quantity of the item to add.' },
                pricePerItem: { type: Type.NUMBER, description: 'The price of a single unit of the item.' },
            },
            required: ['name', 'quantity', 'pricePerItem'],
        },
    },
    {
        name: 'remove_item',
        description: 'Remove a specified quantity of an item from the inventory.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'The name of the item to remove.' },
                quantity: { type: Type.NUMBER, description: 'The quantity to remove.' },
            },
            required: ['name', 'quantity'],
        },
    },
    {
        name: 'get_inventory_summary',
        description: 'Get a summary of all items currently in the inventory. Use this when the user asks a general question like "what is in my inventory?" or "show me my inventory".',
        parameters: {
            type: Type.OBJECT,
            properties: {},
        },
    },
    {
        name: 'get_item_details',
        description: 'Get details of a specific item from the inventory, such as its quantity and price.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'The name of the item to look for.' },
            },
            required: ['name'],
        },
    },
];

export const playGreeting = (): Promise<void> => {
    return new Promise(async (resolve, reject) => {
        const aiInstance = getAi();
        try {
            const response = await aiInstance.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: 'Hello sir, how can I help you?' }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                source.onended = () => {
                    outputAudioContext.close().catch(console.error);
                    resolve();
                };
                source.start();
            } else {
                resolve();
            }
        } catch (error) {
            console.error("Error playing greeting:", error);
            reject(error);
        }
    });
};

export const startLiveSession = (callbacks: {
    onMessage: (message: LiveServerMessage) => Promise<void>;
    onError: (error: ErrorEvent) => void;
    onClose: (event: CloseEvent) => void;
}) => {
    const aiInstance = getAi();
    const sessionPromise = aiInstance.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => console.log('Live session opened.'),
            onmessage: callbacks.onMessage,
            onerror: callbacks.onError,
            onclose: callbacks.onClose,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
            systemInstruction: "You are a voice assistant for an inventory management system. You must understand and respond in both English and Hindi. Your goal is to help the user manage their inventory through voice commands. You can add, remove, get details of a specific item, or get a summary of the entire inventory. Use the 'get_inventory_summary' function for general queries about what's in stock. When adding a new item, if the user does not specify a price, you MUST ask for the price per item before calling the function. All prices are in Indian Rupees (₹). Be concise and confirm actions after they are completed. For example, after adding an item, say 'I have added [quantity] of [item] to your inventory.' When removing, say 'I have removed [quantity] of [item].'",
            tools: [{ functionDeclarations }],
        },
    });
    return sessionPromise;
};