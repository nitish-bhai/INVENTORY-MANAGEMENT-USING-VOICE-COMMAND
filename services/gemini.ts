

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
        description: 'Get a summary of all items currently in the inventory, including total item count and total value. Use this for general queries like "what is in my inventory?", "show me my inventory", or "what is the total value of my stock?".',
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
            systemInstruction: "You are a voice assistant for an inventory management system. You must understand and respond in both English and Hindi. Your goal is to help the user manage their inventory. For adding items, you must follow a strict conversational flow: 1. You must have the item's name, quantity, and price before calling the 'add_item' function. 2. If the user only provides the name (e.g., 'add apples'), you MUST ask for the quantity (e.g., 'How many apples?'). 3. After getting the quantity, if the price is missing, you MUST ask for the price per item (e.g., 'What is the price for one apple?'). 4. Only when you have all three pieces of information, and ensured that quantity and price are numbers, should you call the 'add_item' function. For other commands, you can remove items, get details of a specific item, or get a summary of the entire inventory. Use 'get_inventory_summary' for general queries. All prices are in Indian Rupees (₹). Be concise and confirm actions after they are completed. For example, after adding an item, say 'I have added [quantity] of [item] to your inventory.'",
            tools: [{ functionDeclarations }],
        },
    });
    return sessionPromise;
};